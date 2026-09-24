import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  DEFAULT_DIRECTORY_QUERY,
  type DirectoryQuery,
  listDirectory,
} from "@/lib/directory/directory";
import { createDirectoryGateways } from "@/lib/directory/supabase-directory-gateways";
import { createClubPositionsGateway } from "@/lib/club/supabase-club-positions";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * El adaptador del directorio contra `seadragons-dev` (#238). Va con la llave
 * de servicio, que se salta RLS, así que lo único que separa un club de otro
 * es el filtro del adaptador (NFR-009). Los dobles de los tests de ruta no lo
 * ven; esto sí, y también ve que las columnas de #237 llegan con la grafía que
 * el dominio espera.
 *
 * Todo pasa en un solo test: cada socio de prueba cuesta un usuario real de
 * Supabase Auth, y el club de prueba no se puede borrar hasta que no le quede
 * ninguno.
 */

const CLUBS_TABLE = "clubs";
const MEMBERS_TABLE = "members";
const TODAY = "2026-09-21";

type MemberSeed = {
  readonly clubId: string;
  readonly fullName: string;
  readonly role: "Admin" | "Coach" | "Committee" | "Player";
  readonly accountStatus: "active" | "inactive";
  readonly country: string | null;
  readonly position: "Goalkeeper" | "Defender" | "Forward" | null;
  readonly experienceLevel: "Beginner" | "Intermediate" | "Advanced" | null;
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
};

async function withTwoClubs<T>(
  serviceClient: ServiceRoleClient,
  run: (clubIds: readonly [string, string]) => Promise<T>,
): Promise<T> {
  const club = (name: string) => ({
    slug: `directorio-${randomUUID()}`,
    name,
  });
  return withSeededRows(
    serviceClient,
    CLUBS_TABLE,
    [club("Club del directorio"), club("Club vecino")],
    ([own, other]) => run([own!.id as string, other!.id as string]),
  );
}

async function insertMember(
  serviceClient: ServiceRoleClient,
  seed: MemberSeed,
  user: TestUser,
): Promise<void> {
  const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
    club_id: seed.clubId,
    user_id: user.id,
    full_name: seed.fullName,
    email: user.email,
    role: seed.role,
    account_status: seed.accountStatus,
    country: seed.country,
    position: seed.position,
    experience_level: seed.experienceLevel,
    auf_number: seed.aufNumber,
    auf_expiry: seed.aufExpiry,
  });
  if (error) {
    throw new Error(`No se pudo sembrar a ${seed.fullName}: ${error.message}`);
  }
}

/** El club pone Forward delante de las otras dos (#299): ordenado por
 * posición, el directorio tiene que seguir al club y no al SRD. */
async function moveForwardFirst(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<void> {
  const { data: names, error: nameError } = await serviceClient.client
    .from("club_position_names")
    .select("position_id")
    .eq("club_id", clubId)
    .eq("locale", "en")
    .eq("name", "Forward")
    .single();
  if (nameError) {
    throw new Error(`No se pudo leer Forward: ${nameError.message}`);
  }
  const { error } = await serviceClient.client
    .from("club_positions")
    .update({ sort_order: 0 })
    .eq("id", names.position_id);
  if (error) {
    throw new Error(`No se pudo mover Forward: ${error.message}`);
  }
}

/** Crea un usuario real por socio, anidando las limpiezas: al terminar, cada
 * usuario se borra y su fila de `members` se va con él (la cascada de
 * `0003_members.sql`), que es lo que deja borrar después los clubes. */
async function withMembers<T>(
  serviceClient: ServiceRoleClient,
  seeds: readonly MemberSeed[],
  run: (users: readonly TestUser[]) => Promise<T>,
): Promise<T> {
  const seeded: TestUser[] = [];
  async function seedFrom(index: number): Promise<T> {
    const seed = seeds[index];
    if (seed === undefined) {
      return run(seeded);
    }
    return withTestUser(serviceClient, async (user) => {
      await insertMember(serviceClient, seed, user);
      seeded.push(user);
      return seedFrom(index + 1);
    });
  }
  return seedFrom(0);
}

describeRls("el directorio contra seadragons-dev", () => {
  it(
    "sirve sólo el club de quien pregunta, filtrado, ordenado y con el AUF sólo para el Admin",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createDirectoryGateways(
        serviceClient.client,
        createClubPositionsGateway(serviceClient.client),
      );

      await withTwoClubs(serviceClient, async ([clubId, otherClubId]) => {
        await moveForwardFirst(serviceClient, clubId);
        const seeds: readonly MemberSeed[] = [
          {
            clubId,
            fullName: "Ana Admin",
            role: "Admin",
            accountStatus: "active",
            country: "AU",
            position: null,
            experienceLevel: "Advanced",
            aufNumber: "AUF-ANA",
            aufExpiry: "2027-01-31",
          },
          {
            clubId,
            fullName: "María Ñíguez",
            role: "Player",
            accountStatus: "active",
            country: null,
            position: "Defender",
            experienceLevel: "Intermediate",
            aufNumber: "AUF-MARIA",
            aufExpiry: "2020-01-31",
          },
          {
            clubId,
            fullName: "Zoe Zapata",
            role: "Committee",
            accountStatus: "inactive",
            country: "AU",
            position: "Forward",
            experienceLevel: null,
            aufNumber: null,
            aufExpiry: null,
          },
          {
            clubId: otherClubId,
            fullName: "Beto Vecino",
            role: "Player",
            accountStatus: "active",
            country: "CO",
            position: "Goalkeeper",
            experienceLevel: "Beginner",
            aufNumber: null,
            aufExpiry: null,
          },
        ];

        await withMembers(serviceClient, seeds, async (users) => {
          const [admin, maria] = users as readonly TestUser[];
          const askAs = (
            callerId: string,
            query: Partial<DirectoryQuery> = {},
          ) =>
            listDirectory(gateways, {
              callerId,
              query: { ...DEFAULT_DIRECTORY_QUERY, ...query },
              todayInClub: TODAY,
            });

          const listed = await askAs(admin!.id);
          expect(listed.kind).toBe("admin");
          expect(listed.members.map((member) => member.fullName)).toEqual([
            "Ana Admin",
            "María Ñíguez",
          ]);
          expect(listed.members[1]).toMatchObject({
            country: null,
            experienceLevel: "Intermediate",
            position: { names: { en: "Defender", es: "Defensa" } },
            role: "Player",
            status: "active",
            aufNumber: "AUF-MARIA",
            aufExpiry: "2020-01-31",
            isAufExpired: true,
          });

          const searched = await askAs(admin!.id, { search: "maria niguez" });
          expect(searched.members.map((member) => member.fullName)).toEqual([
            "María Ñíguez",
          ]);

          const byRole = await askAs(admin!.id, { role: "Committee" });
          expect(byRole.members).toEqual([]);

          const withInactive = await askAs(admin!.id, {
            includeInactive: true,
            sort: "position",
          });
          expect(
            withInactive.members.map((member) => [
              member.fullName,
              member.status,
            ]),
          ).toEqual([
            ["Zoe Zapata", "inactive"],
            ["María Ñíguez", "active"],
            ["Ana Admin", "active"],
          ]);

          const asPlayer = await askAs(maria!.id);
          expect(asPlayer.kind).toBe("member");
          expect(asPlayer.members[0]).not.toHaveProperty("aufNumber");
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
