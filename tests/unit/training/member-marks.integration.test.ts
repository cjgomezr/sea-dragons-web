import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  clearMemberMark,
  readMemberMarks,
  saveMemberMark,
} from "@/lib/training/member-marks";
import { createMemberMarksGateways } from "@/lib/training/supabase-member-marks-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  seedCurrentMembership,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * Las marcas del socio contra Supabase (#899), con el adaptador de verdad y
 * `0083_training.sql` aplicada. Lo que ningún doble dice: que el `upsert`
 * encuentra su clave, que el `numeric` llega como número, que otro socio no
 * ve el valor ni con su sesión, y que nada llega a la bitácora (D11).
 *
 * Corre en un club propio y desechable con dos socios al día.
 */

const NOW = new Date();
const SQUAT_VALUE = 82.5;

type Seed = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly owner: TestUser;
  readonly other: TestUser;
};

function memberRow(clubId: string, user: TestUser, fullName: string) {
  return {
    club_id: clubId,
    user_id: user.id,
    full_name: fullName,
    email: user.email,
    account_status: "active",
    role: "Player",
  };
}

function withClubAndTwoPlayers<T>(
  serviceClient: ServiceRoleClient,
  run: (seed: Seed) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `marcas-${randomUUID()}`, name: "Club de las marcas" }],
    ([club]) => {
      const clubId = String(club?.id);
      return withTestUser(serviceClient, (owner) =>
        withTestUser(serviceClient, (other) =>
          withSeededRows(
            serviceClient,
            "members",
            [
              memberRow(clubId, owner, "Olga Owner"),
              memberRow(clubId, other, "Otto Other"),
            ],
            async () => {
              for (const user of [owner, other]) {
                await seedCurrentMembership(serviceClient, {
                  clubId,
                  userId: user.id,
                });
              }
              return run({ serviceClient, clubId, owner, other });
            },
          ),
        ),
      );
    },
  );
}

function withMark<T>(
  seed: Seed,
  run: (markId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    seed.serviceClient,
    "training_marks",
    [{ club_id: seed.clubId, name: "Back squat 1RM" }],
    ([mark]) => run(String(mark?.id)),
  );
}

describeRls("las marcas del socio contra Supabase (#899)", () => {
  it(
    "guarda y lee la marca del socio, y otro socio no la ve",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      await withClubAndTwoPlayers(serviceClient, (seed) =>
        withMark(seed, async (markId) => {
          const gateways = createMemberMarksGateways(serviceClient.client);

          const saved = await saveMemberMark(gateways, {
            callerId: seed.owner.id,
            now: NOW,
            markId,
            value: SQUAT_VALUE,
          });
          const ownerMarks = await readMemberMarks(gateways, {
            callerId: seed.owner.id,
            now: NOW,
          });
          const otherMarks = await readMemberMarks(gateways, {
            callerId: seed.other.id,
            now: NOW,
          });

          const expected = {
            marks: [
              {
                id: markId,
                name: "Back squat 1RM",
                unit: "kg",
                value: SQUAT_VALUE,
              },
            ],
          };
          expect(saved).toEqual(expected);
          expect(ownerMarks).toEqual(expected);
          expect(otherMarks.marks.map((mark) => mark.value)).toEqual([null]);

          const otherSession = await createRlsClient(
            {
              role: "authenticated",
              email: seed.other.email,
              password: seed.other.password,
            },
            process.env,
          );
          const { data, error } = await otherSession.client
            .from("training_member_marks")
            .select("value")
            .eq("mark_id", markId);
          expect(error).toBeNull();
          expect(data).toEqual([]);

          const cleared = await clearMemberMark(gateways, {
            callerId: seed.owner.id,
            now: NOW,
            markId,
          });
          expect(cleared.marks.map((mark) => mark.value)).toEqual([null]);
        }),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no deja ninguna fila en la bitácora con el valor (D11)",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      await withClubAndTwoPlayers(serviceClient, (seed) =>
        withMark(seed, async (markId) => {
          const gateways = createMemberMarksGateways(serviceClient.client);

          await saveMemberMark(gateways, {
            callerId: seed.owner.id,
            now: NOW,
            markId,
            value: SQUAT_VALUE,
          });
          await clearMemberMark(gateways, {
            callerId: seed.owner.id,
            now: NOW,
            markId,
          });

          const { data, error } = await serviceClient.client
            .from("audit_log")
            .select("id")
            .eq("club_id", seed.clubId);
          expect(error).toBeNull();
          expect(data).toEqual([]);
        }),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
