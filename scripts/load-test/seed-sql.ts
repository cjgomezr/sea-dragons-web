import {
  LOAD_TEST_PASSWORD,
  type SeedDataset,
  type SeedNewsPost,
} from "./seed-dataset";

/**
 * El SQL que siembra el dataset de NFR-008 (#524). Inserta por lotes de
 * `INSERT_BATCH_SIZE` filas, no fila a fila: 50.000 asistencias son 52
 * sentencias. Se ejecuta en una sola transacción (`psql --single-transaction`),
 * así que un fallo a mitad no deja nada a medias.
 *
 * Los valores van como texto y se convierten en el `select` (`v.col::tipo`):
 * así una columna toda nula en un lote no confunde a Postgres con su tipo.
 */

export const INSERT_BATCH_SIZE = 1_000;

/** El club que crea la migración 0001. El dataset es suyo. */
const CLUB_SLUG = "victoria-seadragons";

/** `instance_id` de todas las cuentas del Auth de Supabase. */
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";

/** Las notas de una evaluación, entre 4 y 8: ni todo dieces ni todo unos. */
const MIN_RATING = 4;
const RATING_SPREAD = 5;

type SqlValue = string | boolean | null;
type Row = readonly SqlValue[];

/** Columna del `values` y el tipo al que se convierte. */
type Column = readonly [name: string, type: string];

/** Columnas que valen lo mismo en todas las filas, como SQL ya escrito. */
type FixedColumns = Readonly<Record<string, string>>;

type BatchedInsert = {
  /** `esquema.tabla (columnas)`. */
  readonly target: string;
  /** Lo que se inserta, en el orden de `target`. `c.id` es el club. */
  readonly select: string;
  readonly columns: readonly Column[];
  readonly rows: readonly Row[];
};

function quote(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function literal(value: SqlValue): string {
  return value === null ? "null" : quote(String(value));
}

function typed(columns: readonly Column[]): string {
  return columns.map(([name, type]) => `v.${name}::${type}`).join(", ");
}

function batches<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += INSERT_BATCH_SIZE) {
    result.push(items.slice(start, start + INSERT_BATCH_SIZE));
  }
  return result;
}

function renderBatchedInsert(insert: BatchedInsert): string {
  const aliases = insert.columns.map(([name]) => name).join(", ");
  return batches(insert.rows)
    .map((rows) => {
      const values = rows
        .map((row) => `(${row.map(literal).join(", ")})`)
        .join(",\n");
      return `insert into ${insert.target}\nselect ${insert.select}\nfrom seed_club c, (values\n${values}\n) as v(${aliases});`;
    })
    .join("\n");
}

/** Una tabla del club: sus columnas del dataset, el club y las fijas. */
function renderClubTable(
  table: string,
  columns: readonly Column[],
  rows: readonly Row[],
  fixed: FixedColumns = {},
): string {
  const names = [
    "club_id",
    ...Object.keys(fixed),
    ...columns.map(([name]) => name),
  ];
  return renderBatchedInsert({
    target: `public.${table} (${names.join(", ")})`,
    select: ["c.id", ...Object.values(fixed), typed(columns)].join(", "),
    columns,
    rows,
  });
}

/** Para todo antes de escribir si la base no es la recién levantada: el
 * sembrado no mezcla su club con socios que ya estaban. La contraseña se
 * cifra una vez y la comparten las 50 identidades: bcrypt es lento a
 * propósito. */
function preamble(): string {
  return `do $$
begin
  if not exists (select 1 from public.clubs where slug = ${quote(CLUB_SLUG)}) then
    raise exception 'No existe el club ${CLUB_SLUG} de la migración 0001: ¿están aplicadas las migraciones?';
  end if;
  if exists (select 1 from public.members) then
    raise exception 'La base ya tiene socios. El sembrado sólo corre sobre un Supabase local recién levantado: npm run db:reset y vuelve a lanzarlo.';
  end if;
end
$$;
create temp table seed_club on commit drop as
  select id from public.clubs where slug = ${quote(CLUB_SLUG)};
create temp table seed_login on commit drop as
  select extensions.crypt(${quote(LOAD_TEST_PASSWORD)}, extensions.gen_salt('bf')) as hash;`;
}

/** Las cuentas de Auth de todos los socios. Sólo las de `can_sign_in` tienen
 * contraseña; el resto existe porque `members.user_id` apunta a `auth.users`.
 * Los tokens van vacíos y no nulos: GoTrue no sabe leer un nulo ahí. */
function renderAuth(dataset: SeedDataset): string[] {
  const columns: Column[] = [
    ["id", "uuid"],
    ["email", "text"],
    ["can_sign_in", "boolean"],
  ];
  const rows = dataset.members.map((m) => [m.userId, m.email, m.canSignIn]);
  return [
    renderBatchedInsert({
      target:
        "auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)",
      select: `${quote(AUTH_INSTANCE_ID)}::uuid, v.id::uuid, 'authenticated', 'authenticated', v.email::text, case when v.can_sign_in::boolean then (select hash from seed_login) end, now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''`,
      columns,
      rows,
    }),
    renderBatchedInsert({
      target:
        "auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)",
      select:
        "v.id::text, v.id::uuid, jsonb_build_object('sub', v.id::text, 'email', v.email::text, 'email_verified', true), 'email', now(), now()",
      columns,
      rows,
    }),
  ];
}

function renderMembers(dataset: SeedDataset): string {
  return renderClubTable(
    "members",
    [
      ["user_id", "uuid"],
      ["full_name", "text"],
      ["email", "text"],
      ["role", "text"],
      ["email_locale", "text"],
      ["joined_on", "date"],
      ["date_of_birth", "date"],
      ["gender", "text"],
      ["experience_level", "text"],
      ["membership_type", "text"],
    ],
    dataset.members.map((m) => [
      m.userId,
      m.fullName,
      m.email,
      m.role,
      m.emailLocale,
      m.joinedOn,
      m.dateOfBirth,
      m.gender,
      m.experienceLevel,
      m.membershipType,
    ]),
    { account_status: "'active'" },
  );
}

function renderGroups(dataset: SeedDataset): string[] {
  return [
    renderClubTable(
      "groups",
      [
        ["id", "uuid"],
        ["name", "text"],
      ],
      dataset.groups.map((g) => [g.id, g.name]),
    ),
    renderClubTable(
      "group_memberships",
      [
        ["group_id", "uuid"],
        ["user_id", "uuid"],
      ],
      dataset.groupMemberships.map((gm) => [gm.groupId, gm.userId]),
    ),
  ];
}

/** Los entrenamientos son de un grupo, no de todo el club. */
const GROUP_AUDIENCE: FixedColumns = { audience: "'groups'" };
const GROUP_LINK: Column = ["group_id", "uuid"];
const EVENT_COLUMNS: readonly Column[] = [
  ["id", "uuid"],
  ["title", "text"],
  ["event_type", "text"],
  ["start_time", "time"],
  ["location", "text"],
  ["author_id", "uuid"],
];

function renderCalendar(dataset: SeedDataset): string[] {
  return [
    renderClubTable(
      "event_series",
      [
        ...EVENT_COLUMNS,
        ["weekdays", "smallint[]"],
        ["starts_on", "date"],
        ["ends_on", "date"],
      ],
      dataset.series.map((s) => [
        s.id,
        s.title,
        s.eventType,
        s.startTime,
        s.location,
        s.authorId,
        `{${s.weekdays.join(",")}}`,
        s.startsOn,
        s.endsOn,
      ]),
      GROUP_AUDIENCE,
    ),
    renderClubTable(
      "event_series_groups",
      [["series_id", "uuid"], GROUP_LINK],
      dataset.series.map((s) => [s.id, s.groupId]),
    ),
    renderClubTable(
      "events",
      [...EVENT_COLUMNS, ["series_id", "uuid"], ["starts_on", "date"]],
      dataset.events.map((e) => [
        e.id,
        e.title,
        e.eventType,
        e.startTime,
        e.location,
        e.authorId,
        e.seriesId,
        e.startsOn,
      ]),
      GROUP_AUDIENCE,
    ),
    renderClubTable(
      "event_groups",
      [["event_id", "uuid"], GROUP_LINK],
      dataset.events.map((e) => [e.id, e.groupId]),
    ),
  ];
}

function renderParticipation(dataset: SeedDataset): string[] {
  return [
    renderClubTable(
      "attendance_records",
      [
        ["event_id", "uuid"],
        ["user_id", "uuid"],
        ["status", "text"],
        ["recorded_by", "uuid"],
        ["recorded_at", "timestamptz"],
      ],
      dataset.attendance.map((a) => [
        a.eventId,
        a.userId,
        a.status,
        a.recordedBy,
        a.recordedAt,
      ]),
    ),
    renderClubTable(
      "event_rsvps",
      [
        ["event_id", "uuid"],
        ["user_id", "uuid"],
        ["response", "text"],
        ["responded_at", "timestamptz"],
      ],
      dataset.rsvps.map((r) => [
        r.eventId,
        r.userId,
        r.response,
        r.respondedAt,
      ]),
    ),
  ];
}

function groupLinksOf(posts: readonly SeedNewsPost[]): Row[] {
  return posts.flatMap((post) =>
    post.audience === "groups" ? [[post.id, post.groupId]] : [],
  );
}

function renderNews(dataset: SeedDataset): string[] {
  return [
    renderClubTable(
      "news_posts",
      [
        ["id", "uuid"],
        ["title", "text"],
        ["body", "text"],
        ["category", "text"],
        ["audience", "text"],
        ["author_id", "uuid"],
        ["published_at", "timestamptz"],
      ],
      dataset.newsPosts.map((p) => [
        p.id,
        p.title,
        p.body,
        p.category,
        p.audience,
        p.authorId,
        p.publishedAt,
      ]),
    ),
    renderClubTable(
      "news_post_groups",
      [["post_id", "uuid"], GROUP_LINK],
      groupLinksOf(dataset.newsPosts),
    ),
    renderClubTable(
      "notifications",
      [
        ["id", "uuid"],
        ["user_id", "uuid"],
        ["type", "text"],
        ["data", "jsonb"],
        ["created_at", "timestamptz"],
        ["read_at", "timestamptz"],
      ],
      dataset.notifications.map((n) => [
        n.id,
        n.userId,
        n.type,
        JSON.stringify(n.data),
        n.createdAt,
        n.readAt,
      ]),
    ),
  ];
}

/** Las notas salen de un hash del id de la evaluación y del nombre de la
 * categoría, no de su id: las categorías por defecto las crea la base con
 * `gen_random_uuid()`, y la nota tiene que ser la misma en cada sembrado. */
function renderEvaluations(dataset: SeedDataset): string[] {
  return [
    renderClubTable(
      "member_evaluations",
      [
        ["id", "uuid"],
        ["user_id", "uuid"],
      ],
      dataset.evaluations.map((e) => [e.id, e.userId]),
    ),
    `insert into public.member_evaluation_ratings (evaluation_id, category_id, club_id, rating)
select e.id, cat.id, e.club_id, ${MIN_RATING} + abs(hashtext(e.id::text || cat.name)) % ${RATING_SPREAD}
from public.member_evaluations e
join public.evaluation_categories cat
  on cat.club_id = e.club_id and cat.deactivated_at is null
where e.club_id = (select id from seed_club);`,
  ];
}

function renderMemberships(dataset: SeedDataset): string {
  return renderClubTable(
    "memberships",
    [
      ["user_id", "uuid"],
      ["plan", "text"],
      ["status", "text"],
      ["current_period_end", "timestamptz"],
      ["waived_by", "uuid"],
      ["waived_reason", "text"],
    ],
    dataset.memberships.map((m) => [
      m.userId,
      m.plan,
      m.status,
      m.currentPeriodEnd,
      m.status === "waived" ? m.waivedBy : null,
      m.status === "waived" ? m.waivedReason : null,
    ]),
  );
}

/** Lo que imprime al final: cuántas filas quedaron de lo que pide NFR-008. */
function summary(): string {
  return `select
  (select count(*) from public.members) as socios,
  (select count(*) from public.events) as ocurrencias,
  (select count(*) from public.attendance_records) as asistencias;`;
}

export function renderSeedSql(dataset: SeedDataset): string {
  return [
    preamble(),
    ...renderAuth(dataset),
    renderMembers(dataset),
    ...renderGroups(dataset),
    ...renderCalendar(dataset),
    ...renderParticipation(dataset),
    ...renderNews(dataset),
    ...renderEvaluations(dataset),
    renderMemberships(dataset),
    summary(),
  ].join("\n");
}
