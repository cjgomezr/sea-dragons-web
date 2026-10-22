import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ACCOUNT_STATUSES } from "@/lib/auth/account-status";
import { ISO_WEEKDAYS } from "@/lib/events/event-occurrences";
import { toHoursAndMinutes } from "@/lib/events/supabase-event-management-gateways";
import { readRequiredText } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { signProfilePhotoUrls } from "@/lib/members/supabase-profile-photo-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { compareNames } from "@/lib/text/name-order";
import type {
  AudienceEventRecord,
  AudiencePostRecord,
  AudienceSeriesRecord,
  GroupAudienceGateways,
  GroupAudienceRecords,
} from "./group-audience";
import type { GroupMembershipRecord } from "./group-overview";
import { groupExists } from "./supabase-group-members-gateways";
import type { Group, GroupsGateways } from "./groups";

/**
 * Adaptadores entre los grupos y Supabase.
 *
 * Van por la llave de servicio: `0015_groups.sql` no deja escribir a
 * `authenticated`, y sólo le deja leer los grupos a los que pertenece. Gestionar
 * es justo lo contrario, así que lo hace el servidor, que ya averiguó por la
 * cookie de sesión quién pregunta y de qué club. Cada consulta filtra por ese
 * club: es lo único que separa un club de otro con esta llave.
 */

const GROUPS_TABLE = "groups";
const MEMBERSHIPS_TABLE = "group_memberships";
const MEMBERS_TABLE = "members";
const GROUP_COLUMNS = "id, name";
const ACTIVE_STATUS = "active";

/** El código de Postgres de una violación de unicidad, y el índice del nombre
 * por club. Se mira el nombre para no confundir este choque con otro. */
const UNIQUE_VIOLATION_CODE = "23505";
const GROUP_NAME_INDEX = "groups_club_id_name_key";

function compareGroupNames(a: GroupRow, b: GroupRow): number {
  return compareNames(a.name, b.name);
}

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

type GroupRow = { readonly id: string; readonly name: string };

function toGroupRow(row: Row): GroupRow {
  return {
    id: readRequiredText(row, "id", GROUPS_TABLE),
    name: readRequiredText(row, "name", GROUPS_TABLE),
  };
}

function isGroupNameViolation(error: {
  readonly code: string;
  readonly message: string;
}): boolean {
  return (
    error.code === UNIQUE_VIOLATION_CODE &&
    error.message.includes(GROUP_NAME_INDEX)
  );
}

async function readActiveMemberIds(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<ReadonlySet<string>> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select("user_id")
    .eq("club_id", clubId)
    .eq("account_status", ACTIVE_STATUS);
  if (error) {
    throw new Error(
      `No se pudieron leer los socios activos del club ${clubId}: ${error.message}`,
    );
  }
  return new Set(
    data.map((row: Row) => readRequiredText(row, "user_id", MEMBERS_TABLE)),
  );
}

/**
 * Cuántos socios activos tiene cada grupo del club. No cuentan los dados de
 * baja (RF-3 de E4) ni los que todavía no activaron su cuenta, como el
 * miembro recién dado de alta por un Admin (#243).
 *
 * Son dos consultas fijas y no una que incruste `members` en las pertenencias:
 * esa relación va por una clave foránea compuesta contra una restricción única,
 * y una lectura que depende de cómo PostgREST la deduzca se rompe sin que nadie
 * toque este archivo (lo mismo que evita `supabase-club-administration-
 * gateways.ts`). Lo que se evita es ese sentido; el contrario, las
 * pertenencias incrustadas bajo `members`, es el que usan el directorio y
 * `findMemberships`. El club tiene decenas de socios, no miles.
 */
async function readActiveMemberCounts(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<ReadonlyMap<string, number>> {
  const [memberships, activeIds] = await Promise.all([
    serviceClient
      .from(MEMBERSHIPS_TABLE)
      .select("group_id, user_id")
      .eq("club_id", clubId),
    readActiveMemberIds(serviceClient, clubId),
  ]);
  if (memberships.error) {
    throw new Error(
      `No se pudieron leer las pertenencias del club ${clubId}: ${memberships.error.message}`,
    );
  }
  const counts = new Map<string, number>();
  for (const row of memberships.data as Row[]) {
    if (!activeIds.has(readRequiredText(row, "user_id", MEMBERSHIPS_TABLE))) {
      continue;
    }
    const groupId = readRequiredText(row, "group_id", MEMBERSHIPS_TABLE);
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }
  return counts;
}

async function withMemberCount(
  serviceClient: SupabaseClient,
  clubId: string,
  group: GroupRow,
): Promise<Group> {
  const counts = await readActiveMemberCounts(serviceClient, clubId);
  return { ...group, memberCount: counts.get(group.id) ?? 0 };
}

const EVENTS_TABLE = "events";
const SERIES_TABLE = "event_series";
const POSTS_TABLE = "news_posts";

const MEMBERSHIP_PREVIEW_COLUMNS =
  "user_id, full_name, account_status, photo_path, group_memberships(group_id)";

/** `!inner`: sólo lo que tiene algún grupo en su audiencia. Con un filtro
 * sobre `audience`, sólo lo que tiene a ese grupo. */
const AUDIENCE_EMBED = "audience";
const AUDIENCE_GROUP_FILTER = `${AUDIENCE_EMBED}.group_id`;
const STANDALONE_EVENT_COLUMNS = `id, title, starts_on, start_time, status, ${AUDIENCE_EMBED}:event_groups!inner(group_id)`;
const POST_COLUMNS = `id, title, status, published_at, ${AUDIENCE_EMBED}:news_post_groups!inner(group_id)`;

/** Las sesiones que le quedan a la serie, filtradas abajo a las programadas
 * de hoy en adelante, ordenadas y cortadas a una: la próxima. */
const SESSIONS_LEFT = "sessions_left";
const SERIES_COLUMNS = `id, title, weekdays, start_time, ends_on, ${AUDIENCE_EMBED}:event_series_groups!inner(group_id), ${SESSIONS_LEFT}:events(id, starts_on)`;

const SCHEDULED_STATUS = "scheduled";

const audienceSchema = z.array(z.object({ group_id: z.uuid() })).min(1);

const membershipPreviewRowSchema = z.object({
  user_id: z.uuid(),
  full_name: z.string(),
  account_status: z.enum(ACCOUNT_STATUSES),
  photo_path: z.string().nullable(),
  group_memberships: z.array(z.object({ group_id: z.uuid() })),
});

const standaloneEventRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  starts_on: z.string(),
  start_time: z.string(),
  status: z.enum(["scheduled", "cancelled"]),
  audience: audienceSchema,
});

const seriesRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  weekdays: z.array(z.union(ISO_WEEKDAYS.map((day) => z.literal(day)))),
  start_time: z.string(),
  ends_on: z.string(),
  audience: audienceSchema,
  [SESSIONS_LEFT]: z.array(z.object({ id: z.uuid(), starts_on: z.string() })),
});

const postRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(["published", "withdrawn"]),
  published_at: z.string(),
  audience: audienceSchema,
});

/** El club y hoy, y el grupo cuando se pide la audiencia de uno solo (D9);
 * null es todo el club, para el uso de la lista (D4). */
type AudienceQuery = {
  readonly clubId: string;
  readonly today: string;
  readonly groupId: string | null;
};

function toGroupIds(audience: z.infer<typeof audienceSchema>): string[] {
  return audience.map(({ group_id: groupId }) => groupId);
}

/** Lo que volvió de la base, o un error que dice qué lectura no encajó. */
function parseRows<T>(
  schema: z.ZodType<T>,
  result: {
    readonly data: unknown;
    readonly error: { message: string } | null;
  },
  what: string,
): readonly T[] {
  if (result.error) {
    throw new Error(`No se pudieron leer ${what}: ${result.error.message}`);
  }
  const parsed = z.array(schema).safeParse(result.data);
  if (!parsed.success) {
    throw new Error(
      `${what} volvieron con una forma que el dominio no reconoce: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/** Cada pertenencia del club con su socio, de una lectura de los socios con
 * sus pertenencias incrustadas, como el directorio. */
async function findMemberships(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<readonly GroupMembershipRecord[]> {
  const rows = parseRows(
    membershipPreviewRowSchema,
    await serviceClient
      .from(MEMBERS_TABLE)
      .select(MEMBERSHIP_PREVIEW_COLUMNS)
      .eq("club_id", clubId),
    `las pertenencias del club ${clubId}`,
  );
  return rows.flatMap((row) =>
    row.group_memberships.map(({ group_id: groupId }) => ({
      groupId,
      member: {
        id: row.user_id,
        fullName: row.full_name,
        accountStatus: row.account_status,
        photoPath: row.photo_path,
      },
    })),
  );
}

/** El filtro del grupo, o ninguno: con él, `audience` trae sólo esa fila y el
 * `!inner` deja fuera lo que no la tiene. */
function groupFilter(groupId: string | null): Record<string, string> {
  return groupId === null ? {} : { [AUDIENCE_GROUP_FILTER]: groupId };
}

/** Los eventos sueltos con grupos que no empezaron antes de hoy. Las
 * ocurrencias de una serie llevan su copia de la audiencia, pero cuentan como
 * su serie. */
async function findStandaloneEvents(
  serviceClient: SupabaseClient,
  query: AudienceQuery,
): Promise<readonly AudienceEventRecord[]> {
  const rows = parseRows(
    standaloneEventRowSchema,
    await serviceClient
      .from(EVENTS_TABLE)
      .select(STANDALONE_EVENT_COLUMNS)
      .eq("club_id", query.clubId)
      .is("series_id", null)
      .gte("starts_on", query.today)
      .match(groupFilter(query.groupId)),
    `los eventos del club ${query.clubId}`,
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    groupIds: toGroupIds(row.audience),
    startsOn: row.starts_on,
    startTime: toHoursAndMinutes(row.start_time),
    status: row.status,
  }));
}

async function findSeries(
  serviceClient: SupabaseClient,
  query: AudienceQuery,
): Promise<readonly AudienceSeriesRecord[]> {
  const rows = parseRows(
    seriesRowSchema,
    await serviceClient
      .from(SERIES_TABLE)
      .select(SERIES_COLUMNS)
      .eq("club_id", query.clubId)
      .gte("ends_on", query.today)
      .match(groupFilter(query.groupId))
      .eq(`${SESSIONS_LEFT}.status`, SCHEDULED_STATUS)
      .gte(`${SESSIONS_LEFT}.starts_on`, query.today)
      .order("starts_on", { referencedTable: SESSIONS_LEFT })
      .order("start_time", { referencedTable: SESSIONS_LEFT })
      .limit(1, { referencedTable: SESSIONS_LEFT }),
    `las series del club ${query.clubId}`,
  );
  return rows.map((row) => {
    const [next] = row[SESSIONS_LEFT];
    return {
      id: row.id,
      title: row.title,
      groupIds: toGroupIds(row.audience),
      weekdays: row.weekdays,
      startTime: toHoursAndMinutes(row.start_time),
      endsOn: row.ends_on,
      nextSession:
        next === undefined ? null : { id: next.id, startsOn: next.starts_on },
    };
  });
}

async function findPosts(
  serviceClient: SupabaseClient,
  query: AudienceQuery,
): Promise<readonly AudiencePostRecord[]> {
  const rows = parseRows(
    postRowSchema,
    await serviceClient
      .from(POSTS_TABLE)
      .select(POST_COLUMNS)
      .eq("club_id", query.clubId)
      .match(groupFilter(query.groupId)),
    `las noticias del club ${query.clubId}`,
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    groupIds: toGroupIds(row.audience),
    status: row.status,
    publishedAt: new Date(row.published_at).toISOString(),
  }));
}

async function findAudienceRecords(
  serviceClient: SupabaseClient,
  query: AudienceQuery,
): Promise<GroupAudienceRecords> {
  const [events, series, posts] = await Promise.all([
    findStandaloneEvents(serviceClient, query),
    findSeries(serviceClient, query),
    findPosts(serviceClient, query),
  ]);
  return { events, series, posts };
}

export function createGroupsGateways(
  serviceClient: SupabaseClient,
): GroupsGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    groups: {
      async findClubGroups(clubId) {
        const [groups, counts] = await Promise.all([
          serviceClient
            .from(GROUPS_TABLE)
            .select(GROUP_COLUMNS)
            .eq("club_id", clubId),
          readActiveMemberCounts(serviceClient, clubId),
        ]);
        if (groups.error) {
          throw new Error(
            `No se pudieron leer los grupos del club ${clubId}: ${groups.error.message}`,
          );
        }
        return groups.data
          .map((row: Row) => {
            const group = toGroupRow(row);
            return { ...group, memberCount: counts.get(group.id) ?? 0 };
          })
          .sort(compareGroupNames);
      },

      async insertGroup({ clubId, name }) {
        const { data, error } = await serviceClient
          .from(GROUPS_TABLE)
          .insert({ club_id: clubId, name })
          .select(GROUP_COLUMNS)
          .single();
        if (error) {
          if (isGroupNameViolation(error)) {
            return { kind: "name_taken" };
          }
          throw new Error(
            `No se pudo crear el grupo en el club ${clubId}: ${error.message}`,
          );
        }
        // Un grupo recién creado no tiene pertenencias todavía.
        return {
          kind: "created",
          group: { ...toGroupRow(data), memberCount: 0 },
        };
      },

      async renameGroup({ clubId, groupId, name }) {
        const { data, error } = await serviceClient
          .from(GROUPS_TABLE)
          .update({ name })
          .eq("id", groupId)
          .eq("club_id", clubId)
          .select(GROUP_COLUMNS)
          .maybeSingle();
        if (error) {
          if (isGroupNameViolation(error)) {
            return { kind: "name_taken" };
          }
          throw new Error(
            `No se pudo renombrar el grupo ${groupId} del club ${clubId}: ${error.message}`,
          );
        }
        if (data === null) {
          return { kind: "not_found" };
        }
        return {
          kind: "renamed",
          group: await withMemberCount(serviceClient, clubId, toGroupRow(data)),
        };
      },

      async deleteGroup({ clubId, groupId }) {
        const { data, error } = await serviceClient
          .from(GROUPS_TABLE)
          .delete()
          .eq("id", groupId)
          .eq("club_id", clubId)
          .select("id");
        if (error) {
          throw new Error(
            `No se pudo borrar el grupo ${groupId} del club ${clubId}: ${error.message}`,
          );
        }
        return data.length === 0 ? { kind: "not_found" } : { kind: "deleted" };
      },
    },
    overview: {
      findMemberships: (clubId) => findMemberships(serviceClient, clubId),
      findAudienceUses: (query) =>
        findAudienceRecords(serviceClient, { ...query, groupId: null }),
    },
    photos: {
      signPhotoUrls: (photoPaths) =>
        signProfilePhotoUrls(serviceClient, photoPaths),
    },
  };
}

export type GroupsGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: GroupsGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para los endpoints de grupos. Devuelve las variables
 * que faltan en vez de lanzar, como las demás. */
export function createSupabaseGroupsGateways(
  env: Environment,
): GroupsGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createGroupsGateways(createServiceRoleClient(env)),
  };
}

/** La audiencia de un grupo (D9), leída a la vez que se comprueba que el
 * grupo sigue siendo del club. */
export function createGroupAudienceGateways(
  serviceClient: SupabaseClient,
): GroupAudienceGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    audience: {
      async findGroupAudience(query) {
        const [isGroupOfClub, records] = await Promise.all([
          groupExists(serviceClient, query),
          findAudienceRecords(serviceClient, query),
        ]);
        return isGroupOfClub
          ? { kind: "found", records }
          : { kind: "group_not_found" };
      },
    },
  };
}

export type GroupAudienceGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: GroupAudienceGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para la audiencia de un grupo. */
export function createSupabaseGroupAudienceGateways(
  env: Environment,
): GroupAudienceGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createGroupAudienceGateways(createServiceRoleClient(env)),
  };
}
