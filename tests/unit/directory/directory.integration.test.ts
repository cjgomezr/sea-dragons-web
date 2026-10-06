import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  DEFAULT_DIRECTORY_QUERY,
  type DirectoryGateways,
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

type AttendanceStatus = "present" | "late" | "absent";

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
  /** El teléfono y el contacto de emergencia (#499). Sin ellos, null. */
  readonly contact?: {
    readonly phone: string;
    readonly emergencyContact: {
      readonly name: string;
      readonly phone: string;
      readonly relationship: string;
    };
  };
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
    phone: seed.contact?.phone ?? null,
    emergency_contact_name: seed.contact?.emergencyContact.name ?? null,
    emergency_contact_phone: seed.contact?.emergencyContact.phone ?? null,
    emergency_contact_relationship:
      seed.contact?.emergencyContact.relationship ?? null,
  });
  if (error) {
    throw new Error(`No se pudo sembrar a ${seed.fullName}: ${error.message}`);
  }
}

/** Una evaluación sin valoraciones basta: el directorio sólo cuenta que
 * existe (#324). Se va con el socio, por la cascada de `0031`. */
async function insertEvaluation(
  serviceClient: ServiceRoleClient,
  member: { readonly clubId: string; readonly userId: string },
): Promise<void> {
  const { error } = await serviceClient.client
    .from("member_evaluations")
    .insert({ club_id: member.clubId, user_id: member.userId });
  if (error) {
    throw new Error(`No se pudo sembrar la evaluación: ${error.message}`);
  }
}

/** Un grupo con un solo socio. Borrar el grupo se lleva la pertenencia, por
 * la cascada de `0015_groups.sql`. */
async function withGroupOf<T>(
  serviceClient: ServiceRoleClient,
  member: { readonly clubId: string; readonly userId: string },
  run: (groupId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "groups",
    [{ club_id: member.clubId, name: "Grupo del directorio" }],
    async ([group]) => {
      const groupId = group!.id as string;
      const { error } = await serviceClient.client
        .from("group_memberships")
        .insert({
          group_id: groupId,
          user_id: member.userId,
          club_id: member.clubId,
        });
      if (error) {
        throw new Error(`No se pudo sembrar el grupo: ${error.message}`);
      }
      return run(groupId);
    },
  );
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

/** Un entrenamiento para todo el club con su hoja guardada, que se borra al
 * terminar con sus filas: su autor no puede irse del club mientras exista.
 * Va en 2030 para quedar después del alta de cualquier socio sembrado hoy. */
async function withSavedTraining<T>(
  serviceClient: ServiceRoleClient,
  sheet: {
    readonly clubId: string;
    readonly authorId: string;
    readonly statuses: readonly (readonly [string, AttendanceStatus])[];
  },
  run: () => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "events",
    [
      {
        club_id: sheet.clubId,
        title: "Entrenamiento con hoja",
        event_type: "training",
        starts_on: "2030-06-04",
        start_time: "19:00",
        location: "MSAC",
        audience: "all",
        author_id: sheet.authorId,
      },
    ],
    async ([event]) => {
      const { error } = await serviceClient.client
        .from("attendance_records")
        .insert(
          sheet.statuses.map(([userId, status]) => ({
            event_id: event!.id,
            user_id: userId,
            club_id: sheet.clubId,
            status,
          })),
        );
      if (error) {
        throw new Error(`No se pudo guardar la hoja: ${error.message}`);
      }
      return run();
    },
  );
}

/** Los mismos gateways, contando cuántas veces se pide la asistencia. */
function countingAttendanceCalls(gateways: DirectoryGateways): {
  readonly gateways: DirectoryGateways;
  readonly calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    gateways: {
      ...gateways,
      attendance: {
        findMemberAttendance: (clubId, userIds) => {
          calls += 1;
          return gateways.attendance.findMemberAttendance(clubId, userIds);
        },
      },
    },
  };
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
            contact: {
              phone: "0412 345 678",
              emergencyContact: {
                name: "Rosa Ñíguez",
                phone: "+61 499 111 222",
                relationship: "Madre",
              },
            },
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
          await insertEvaluation(serviceClient, {
            clubId,
            userId: maria!.id,
          });
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
            isEvaluated: true,
          });
          expect(listed.members[0]).toMatchObject({ isEvaluated: false });

          // #499: el correo de la cuenta y el contacto llegan en la misma
          // lectura, y los dos filtros de contacto los usan.
          expect(listed.members[1]).toMatchObject({
            email: maria!.email,
            phone: "0412 345 678",
            emergencyContact: {
              name: "Rosa Ñíguez",
              phone: "+61 499 111 222",
              relationship: "Madre",
            },
          });
          expect(listed.members[0]).toMatchObject({
            email: admin!.email,
            phone: null,
            emergencyContact: null,
          });
          const withoutPhone = await askAs(admin!.id, { withoutPhone: true });
          expect(withoutPhone.members.map((member) => member.fullName)).toEqual(
            ["Ana Admin"],
          );

          const searched = await askAs(admin!.id, { search: "maria niguez" });
          expect(searched.members.map((member) => member.fullName)).toEqual([
            "María Ñíguez",
          ]);

          const byRole = await askAs(admin!.id, { role: "Committee" });
          expect(byRole.members).toEqual([]);

          // #497: los grupos de cada socio llegan en la misma lectura.
          await withGroupOf(
            serviceClient,
            { clubId, userId: maria!.id },
            async (groupId) => {
              const byGroup = await askAs(admin!.id, { groupId });
              expect(byGroup.members.map((member) => member.fullName)).toEqual([
                "María Ñíguez",
              ]);
            },
          );

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
          expect(asPlayer.members[1]).not.toHaveProperty("isEvaluated");
          for (const member of asPlayer.members) {
            expect(member).not.toHaveProperty("email");
            expect(member).not.toHaveProperty("phone");
            expect(member).not.toHaveProperty("emergencyContact");
          }

          // #394: con una hoja guardada, cada socio trae su porcentaje, y la
          // lista entera sale de una sola llamada a la función agregada.
          await withSavedTraining(
            serviceClient,
            {
              clubId,
              authorId: admin!.id,
              statuses: [
                [admin!.id, "present"],
                [maria!.id, "absent"],
              ],
            },
            async () => {
              const counting = countingAttendanceCalls(gateways);
              const withAttendance = await listDirectory(counting.gateways, {
                callerId: maria!.id,
                query: {
                  ...DEFAULT_DIRECTORY_QUERY,
                  sort: "attendance",
                  direction: "asc",
                },
                todayInClub: TODAY,
              });
              expect(
                withAttendance.members.map((member) => [
                  member.fullName,
                  member.attendance,
                ]),
              ).toEqual([
                ["María Ñíguez", { kind: "rate", percent: 0, sessions: 0 }],
                ["Ana Admin", { kind: "rate", percent: 100, sessions: 1 }],
              ]);
              expect(counting.calls()).toBe(1);
            },
          );
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
