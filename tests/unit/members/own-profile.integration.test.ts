import { expect, it } from "vitest";
import {
  DEFAULT_DIRECTORY_QUERY,
  listDirectory,
} from "@/lib/directory/directory";
import { createDirectoryGateways } from "@/lib/directory/supabase-directory-gateways";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import {
  OwnAufVerifiedError,
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

/** Los cinco campos como los siembra `withActiveMember`. */
const UNCHANGED_FIELDS = {
  fullName: "Socia que edita su perfil",
  country: "AU",
  position: "Defender",
  experienceLevel: "Beginner",
  gender: "female",
} as const;

type SeededMember = { readonly userId: string };

async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  run: (member: SeededMember) => Promise<T>,
): Promise<T> {
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

  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: club.id,
      user_id: user.id,
      full_name: "Socia que edita su perfil",
      email: user.email,
      country: "AU",
      position: "Defender",
      experience_level: "Beginner",
      gender: "female",
      account_status: "active",
    });
    if (error) {
      throw new Error(`No se pudo sembrar la socia: ${error.message}`);
    }
    // La fila se va con la identidad por la cascada de 0003.
    return run({ userId: user.id });
  });
}

describeRls("perfil propio contra seadragons-dev", () => {
  it(
    "guarda los cinco campos y el directorio enseña los valores nuevos",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createOwnProfileGateways(serviceClient.client);

      await withActiveMember(serviceClient, async ({ userId }) => {
        const saved = await updateOwnProfile(gateways, {
          userId,
          submission: {
            fullName: "Socia Renombrada",
            country: "nz",
            position: "Forward",
            experienceLevel: "Advanced",
            gender: "undisclosed",
            auf: null,
          },
        });

        const expected = {
          fullName: "Socia Renombrada",
          country: "NZ",
          position: "Forward",
          experienceLevel: "Advanced",
          gender: "undisclosed",
          auf: { status: "none" },
        };
        expect(saved).toEqual(expected);
        await expect(readOwnProfile(gateways, userId)).resolves.toEqual(
          expected,
        );

        const listing = await listDirectory(
          createDirectoryGateways(serviceClient.client),
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
            position: "Forward",
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
      const gateways = createOwnProfileGateways(serviceClient.client);

      await withActiveMember(serviceClient, async ({ userId }) => {
        await updateOwnProfile(gateways, {
          userId,
          submission: {
            fullName: "Socia Sin Posición",
            country: "AU",
            position: null,
            experienceLevel: null,
            gender: null,
            auf: null,
          },
        });

        const listing = await listDirectory(
          createDirectoryGateways(serviceClient.client),
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
      const gateways = createOwnProfileGateways(serviceClient.client);

      await withActiveMember(serviceClient, async ({ userId }) => {
        await updateOwnProfile(gateways, {
          userId,
          submission: {
            fullName: "Socia Que No Asciende",
            country: "AU",
            position: "Goalkeeper",
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
      const gateways = createOwnProfileGateways(serviceClient.client);

      await withActiveMember(serviceClient, async ({ userId }) => {
        const saved = await updateOwnProfile(gateways, {
          userId,
          submission: {
            ...UNCHANGED_FIELDS,
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
      const gateways = createOwnProfileGateways(serviceClient.client);

      await withActiveMember(serviceClient, async ({ userId }) => {
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
              ...UNCHANGED_FIELDS,
              auf: { number: "AUF-OTRO", expiry: "2030-06-30" },
            },
          }),
        ).rejects.toBeInstanceOf(OwnAufVerifiedError);
        await expect(readOwnProfile(gateways, userId)).resolves.toMatchObject({
          auf: { status: "verified", number: "AUF-VERIFICADO" },
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
