import { expect, it } from "vitest";
import {
  DEFAULT_DIRECTORY_QUERY,
  listDirectory,
} from "@/lib/directory/directory";
import { createDirectoryGateways } from "@/lib/directory/supabase-directory-gateways";
import { createClubPositionsGateway } from "@/lib/club/supabase-club-positions";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import {
  type OwnProfileSubmission,
  OwnAufVerifiedError,
  ProfileValidationError,
  readOwnProfile,
  updateOwnProfile,
} from "@/lib/members/own-profile";
import { createOwnProfileGateways } from "@/lib/members/supabase-own-profile-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";
import { withClubWithArchivedPosition } from "../../support/club-positions";

/**
 * El perfil propio contra `seadragons-dev` con los adaptadores de verdad
 * (#241). Lo que ningún doble puede decir: que las columnas y los `check` de
 * `0016_member_profile_fields.sql` aceptan lo que el dominio deja pasar, que
 * se guarda sólo la fila de quien llama, y que el directorio lee lo nuevo
 * (AC-039). Desde #274, también que el AUF propuesto queda sin verificar y
 * que uno verificado no se deja cambiar.
 */

const MEMBERS_TABLE = "members";
const TODAY_IN_CLUB = "2026-09-21";

type SeededPositionName = "Goalkeeper" | "Defender" | "Forward";

type SeededMember = {
  readonly userId: string;
  /** Las posiciones de su club por su nombre en inglés (#299). */
  readonly positionIds: Readonly<Record<SeededPositionName, string>>;
};

/** Los cinco campos como los siembra `withActiveMember`. */
function unchangedFields(
  member: SeededMember,
): Omit<OwnProfileSubmission, "auf"> {
  return {
    fullName: "Socia que edita su perfil",
    country: "AU",
    positionId: member.positionIds.Defender,
    experienceLevel: "Beginner",
    gender: "female",
  };
}

async function readDefaultClubId(
  serviceClient: ServiceRoleClient,
): Promise<string> {
  const { data: club, error: clubError } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", DEFAULT_CLUB_SLUG)
    .single();
  if (clubError || !club) {
    throw new Error(
      `No se pudo leer el club sembrado: ${clubError?.message ?? "sin datos"}`,
    );
  }
  return club.id;
}

async function readPositionIds(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<SeededMember["positionIds"]> {
  const { data, error } = await serviceClient.client
    .from("club_position_names")
    .select("position_id, name")
    .eq("club_id", clubId)
    .eq("locale", "en")
    .in("name", ["Goalkeeper", "Defender", "Forward"]);
  if (error) {
    throw new Error(`No se pudieron leer las posiciones: ${error.message}`);
  }
  const idOf = (name: SeededPositionName): string => {
    const found = data.find((row) => row.name === name);
    if (found === undefined) {
      throw new Error(`El club ${clubId} no tiene ${name}.`);
    }
    return found.position_id;
  };
  return {
    Goalkeeper: idOf("Goalkeeper"),
    Defender: idOf("Defender"),
    Forward: idOf("Forward"),
  };
}

/** En el club sembrado, salvo que se pida otro. */
async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  run: (member: SeededMember) => Promise<T>,
  clubId?: string,
): Promise<T> {
  const memberClubId = clubId ?? (await readDefaultClubId(serviceClient));
  const positionIds = await readPositionIds(serviceClient, memberClubId);

  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: memberClubId,
      user_id: user.id,
      full_name: "Socia que edita su perfil",
      email: user.email,
      country: "AU",
      position_id: positionIds.Defender,
      experience_level: "Beginner",
      gender: "female",
      account_status: "active",
    });
    if (error) {
      throw new Error(`No se pudo sembrar la socia: ${error.message}`);
    }
    // La fila se va con la identidad por la cascada de 0003.
    return run({ userId: user.id, positionIds });
  });
}

describeRls("perfil propio contra seadragons-dev", () => {
  it(
    "guarda los cinco campos y el directorio enseña los valores nuevos",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createOwnProfileGateways(
        serviceClient.client,
        createClubPositionsGateway(serviceClient.client),
      );

      await withActiveMember(serviceClient, async ({ userId, positionIds }) => {
        const saved = await updateOwnProfile(gateways, {
          userId,
          submission: {
            fullName: "Socia Renombrada",
            country: "nz",
            positionId: positionIds.Forward,
            experienceLevel: "Advanced",
            gender: "undisclosed",
            auf: null,
          },
        });

        const expected = {
          fullName: "Socia Renombrada",
          country: "NZ",
          positionId: positionIds.Forward,
          experienceLevel: "Advanced",
          gender: "undisclosed",
          auf: { status: "none" },
        };
        expect(saved).toEqual(expected);
        await expect(readOwnProfile(gateways, userId)).resolves.toMatchObject({
          profile: expected,
        });

        const listing = await listDirectory(
          createDirectoryGateways(
            serviceClient.client,
            createClubPositionsGateway(serviceClient.client),
          ),
          {
            callerId: userId,
            query: { ...DEFAULT_DIRECTORY_QUERY, search: "Socia Renombrada" },
            todayInClub: TODAY_IN_CLUB,
          },
        );
        expect(listing.members).toEqual([
          expect.objectContaining({
            userId,
            fullName: "Socia Renombrada",
            country: "NZ",
            position: {
              id: positionIds.Forward,
              names: { en: "Forward", es: "Ataque" },
            },
            experienceLevel: "Advanced",
          }),
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "deja sin valor la posición vaciada, y el directorio la sirve vacía",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createOwnProfileGateways(
        serviceClient.client,
        createClubPositionsGateway(serviceClient.client),
      );

      await withActiveMember(serviceClient, async ({ userId }) => {
        await updateOwnProfile(gateways, {
          userId,
          submission: {
            fullName: "Socia Sin Posición",
            country: "AU",
            positionId: null,
            experienceLevel: null,
            gender: null,
            auf: null,
          },
        });

        const listing = await listDirectory(
          createDirectoryGateways(
            serviceClient.client,
            createClubPositionsGateway(serviceClient.client),
          ),
          {
            callerId: userId,
            query: { ...DEFAULT_DIRECTORY_QUERY, search: "Socia Sin Posición" },
            todayInClub: TODAY_IN_CLUB,
          },
        );
        expect(listing.members).toEqual([
          expect.objectContaining({
            userId,
            position: null,
            experienceLevel: null,
          }),
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no deja el rol ni el estado distintos a como estaban",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createOwnProfileGateways(
        serviceClient.client,
        createClubPositionsGateway(serviceClient.client),
      );

      await withActiveMember(serviceClient, async ({ userId, positionIds }) => {
        await updateOwnProfile(gateways, {
          userId,
          submission: {
            fullName: "Socia Que No Asciende",
            country: "AU",
            positionId: positionIds.Goalkeeper,
            experienceLevel: "Intermediate",
            gender: "female",
            auf: null,
          },
        });

        const { data, error } = await serviceClient.client
          .from(MEMBERS_TABLE)
          .select("role, account_status, auf_number, auf_expiry")
          .eq("user_id", userId)
          .single();
        expect(error).toBeNull();
        expect(data).toEqual({
          role: "Player",
          account_status: "active",
          auf_number: null,
          auf_expiry: null,
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "guarda el AUF propuesto sin verificar",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createOwnProfileGateways(
        serviceClient.client,
        createClubPositionsGateway(serviceClient.client),
      );

      await withActiveMember(serviceClient, async (member) => {
        const { userId } = member;
        const saved = await updateOwnProfile(gateways, {
          userId,
          submission: {
            ...unchangedFields(member),
            auf: { number: "AUF-PROPUESTO-1", expiry: "2030-06-30" },
          },
        });

        expect(saved.auf).toEqual({
          status: "pending",
          number: "AUF-PROPUESTO-1",
          expiry: "2030-06-30",
        });
        const { data, error } = await serviceClient.client
          .from(MEMBERS_TABLE)
          .select("auf_verified_at")
          .eq("user_id", userId)
          .single();
        expect(error).toBeNull();
        expect(data).toEqual({ auf_verified_at: null });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "niega cambiar un AUF verificado y lo deja como estaba",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createOwnProfileGateways(
        serviceClient.client,
        createClubPositionsGateway(serviceClient.client),
      );

      await withActiveMember(serviceClient, async (member) => {
        const { userId } = member;
        const { error: seedError } = await serviceClient.client
          .from(MEMBERS_TABLE)
          .update({
            auf_number: "AUF-VERIFICADO",
            auf_expiry: "2030-06-30",
            auf_verified_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
        expect(seedError).toBeNull();

        await expect(
          updateOwnProfile(gateways, {
            userId,
            submission: {
              ...unchangedFields(member),
              auf: { number: "AUF-OTRO", expiry: "2030-06-30" },
            },
          }),
        ).rejects.toBeInstanceOf(OwnAufVerifiedError);
        await expect(readOwnProfile(gateways, userId)).resolves.toMatchObject({
          profile: { auf: { status: "verified", number: "AUF-VERIFICADO" } },
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "rechaza una posición archivada como valor nuevo y deja conservarla a quien la tenía",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createOwnProfileGateways(
        serviceClient.client,
        createClubPositionsGateway(serviceClient.client),
      );

      await withClubWithArchivedPosition(
        serviceClient,
        async ({ clubId, archivedPositionId }) => {
          await withActiveMember(
            serviceClient,
            async (member) => {
              const { userId } = member;
              const choosing = (positionId: string) =>
                updateOwnProfile(gateways, {
                  userId,
                  submission: {
                    ...unchangedFields(member),
                    positionId,
                    auf: null,
                  },
                });

              await expect(choosing(archivedPositionId)).rejects.toBeInstanceOf(
                ProfileValidationError,
              );

              const { error } = await serviceClient.client
                .from(MEMBERS_TABLE)
                .update({ position_id: archivedPositionId })
                .eq("user_id", userId);
              expect(error).toBeNull();
              const kept = await choosing(archivedPositionId);
              expect(kept.positionId).toBe(archivedPositionId);

              const { positionOptions } = await readOwnProfile(
                gateways,
                userId,
              );
              expect(positionOptions.map((position) => position.id)).toContain(
                archivedPositionId,
              );

              await choosing(member.positionIds.Forward);
              await expect(choosing(archivedPositionId)).rejects.toBeInstanceOf(
                ProfileValidationError,
              );
            },
            clubId,
          );
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
