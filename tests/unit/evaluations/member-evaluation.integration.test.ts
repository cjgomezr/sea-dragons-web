import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  EvaluationChangedError,
  type MemberEvaluation,
  createMemberEvaluation,
  readMemberEvaluation,
  saveEvaluationRatings,
} from "@/lib/evaluations/member-evaluation";
import { createMemberEvaluationGateways } from "@/lib/evaluations/supabase-member-evaluation-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  assertDenied,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * La evaluación de un miembro contra `seadragons-dev` (#319), con los
 * adaptadores de verdad y `0032_member_evaluation_writes.sql` aplicada. Lo
 * que ningún doble dice: que la lectura anidada trae las categorías del club
 * en su orden, que las funciones se llaman con lo que esperan, que la fecha
 * que devuelve la lectura sirve para guardar, y que la sesión de un Player no
 * saca nada de la base (FR-055).
 *
 * Cada caso corre en un club propio y desechable, que nace con las diez
 * categorías por defecto.
 */

const MEMBERS_TABLE = "members";
const AUDIT_LOG_TABLE = "audit_log";
const CLUBS_TABLE = "clubs";
const DEFAULT_CATEGORY_COUNT = 10;

type Evaluated = Extract<MemberEvaluation, { status: "evaluated" }>;

async function deleteAuditEntries(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<void> {
  const { error } = await serviceClient.client
    .from(AUDIT_LOG_TABLE)
    .delete()
    .eq("club_id", clubId);
  if (error) {
    throw new Error(`No se pudo limpiar la bitácora: ${error.message}`);
  }
}

/** La bitácora se borra antes que el club, que no se puede borrar mientras
 * alguna entrada lo nombre. */
async function withTemporaryClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    CLUBS_TABLE,
    [{ slug: `evaluaciones-${randomUUID()}`, name: "Club de evaluaciones" }],
    async ([club]) => {
      const clubId = String(club?.id);
      try {
        return await run(clubId);
      } finally {
        await deleteAuditEntries(serviceClient, clubId);
      }
    },
  );
}

/** Borrar la identidad borra el miembro, y el miembro su evaluación. */
async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly role: Role },
  run: (member: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: seed.clubId,
      user_id: user.id,
      full_name: `Socia ${seed.role} de prueba`,
      email: user.email,
      account_status: "active",
      role: seed.role,
    });
    if (error) {
      throw new Error(
        `No se pudo sembrar el socio ${seed.role}: ${error.message}`,
      );
    }
    return run(user);
  });
}

async function withCoachAndPlayer(
  run: (club: {
    readonly clubId: string;
    readonly coach: TestUser;
    readonly player: TestUser;
  }) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  await withTemporaryClub(serviceClient, (clubId) =>
    withActiveMember(serviceClient, { clubId, role: "Coach" }, (coach) =>
      withActiveMember(serviceClient, { clubId, role: "Player" }, (player) =>
        run({ clubId, coach, player }),
      ),
    ),
  );
}

function asEvaluated(evaluation: MemberEvaluation): Evaluated {
  if (evaluation.status !== "evaluated") {
    throw new Error("Se esperaba una evaluación y el miembro no la tiene.");
  }
  return evaluation;
}

async function readAuditActions(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await serviceClient.client
    .from(AUDIT_LOG_TABLE)
    .select("actor_id, action, entity_type, entity_id, metadata")
    .eq("club_id", clubId)
    .order("created_at");
  if (error) {
    throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  }
  return data;
}

describeRls("la evaluación de un miembro en Supabase", () => {
  it(
    "un Coach la crea, la lee y la guarda, y no pisa un cambio ajeno",
    async () => {
      await withCoachAndPlayer(async ({ clubId, coach, player }) => {
        const serviceClient = createServiceRoleTestClient(process.env);
        const gateways = createMemberEvaluationGateways(serviceClient.client);
        const request = { callerId: coach.id, memberId: player.id };

        await expect(readMemberEvaluation(gateways, request)).resolves.toEqual({
          status: "not_evaluated",
          memberId: player.id,
        });
        const created = asEvaluated(
          await createMemberEvaluation(gateways, request),
        );
        expect(created.ratings).toHaveLength(DEFAULT_CATEGORY_COUNT);
        expect(created.ratings[0]?.name).toBe("Fitness");
        expect(created.overallRating).toBe(5);

        const [fitness] = created.ratings;
        const saved = asEvaluated(
          await saveEvaluationRatings(gateways, {
            ...request,
            expectedUpdatedAt: created.updatedAt,
            ratings: [{ categoryId: String(fitness?.categoryId), rating: 9 }],
          }),
        );
        expect(saved.overallRating).toBe(5.4);
        await expect(
          saveEvaluationRatings(gateways, {
            ...request,
            expectedUpdatedAt: created.updatedAt,
            ratings: [{ categoryId: String(fitness?.categoryId), rating: 1 }],
          }),
        ).rejects.toBeInstanceOf(EvaluationChangedError);

        expect(await readAuditActions(serviceClient, clubId)).toEqual([
          expect.objectContaining({
            actor_id: coach.id,
            action: "member_evaluation.created",
            entity_id: player.id,
            metadata: null,
          }),
          expect.objectContaining({
            actor_id: coach.id,
            action: "member_evaluation.ratings_saved",
            entity_id: player.id,
            metadata: null,
          }),
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS * 2,
  );

  it(
    "la sesión de un Player no saca nada de la base, ni lo suyo",
    async () => {
      await withCoachAndPlayer(async ({ coach, player }) => {
        const serviceClient = createServiceRoleTestClient(process.env);
        await createMemberEvaluation(
          createMemberEvaluationGateways(serviceClient.client),
          { callerId: coach.id, memberId: player.id },
        );
        const playerClient = await createRlsClient(
          {
            role: "authenticated",
            email: player.email,
            password: player.password,
          },
          process.env,
        );

        await assertDenied(playerClient, (client) =>
          client.from("member_evaluations").select("*"),
        );
        await assertDenied(playerClient, (client) =>
          client.from("member_evaluation_ratings").select("*"),
        );
        await assertDenied(playerClient, (client) =>
          client.rpc("save_member_evaluation_ratings", {
            acting_club_id: null,
            target_user_id: player.id,
            expected_updated_at: null,
            ratings: [],
          }),
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS * 2,
  );
});
