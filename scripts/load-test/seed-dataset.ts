/**
 * El club de NFR-008 para la prueba de carga (#524, RF-6 del PRD de E16b):
 * 500 socios, 5.070 ocurrencias y unas 51.000 asistencias, más grupos, RSVP,
 * noticias, avisos, evaluaciones y membresías.
 *
 * Es una función pura: la misma semilla y la misma fecha de anclaje dan el
 * mismo club, fila por fila. La fecha de anclaje es el "hoy" del dataset; las
 * asistencias caen antes de ella y los RSVP después, así que sembrar otro día
 * mueve las fechas pero no cambia nada más.
 */

export const MEMBER_COUNT = 500;
export const LOGIN_IDENTITY_COUNT = 50;
export const GROUP_COUNT = 10;
export const NEWS_POST_COUNT = 200;

/** La contraseña de las 50 identidades con sesión. Sólo existe en un
 * Supabase local: la guardia del sembrado no deja llevarla a otro sitio. */
export const LOAD_TEST_PASSWORD = "Seadragons-carga-2026";

const EMAIL_DOMAIN = "carga.seadragons.test";

/** Los primeros socios: 2 Admin, 3 Committee y 5 Coach. Todos tienen sesión,
 * como los 40 Player que les siguen. */
const LEADERSHIP_ROLES: readonly SeedRole[] = [
  "Admin",
  "Admin",
  "Committee",
  "Committee",
  "Committee",
  "Coach",
  "Coach",
  "Coach",
  "Coach",
  "Coach",
];
const FIRST_ADMIN_INDEX = 0;
const FIRST_COACH_INDEX = 5;
const COACH_COUNT = 5;
const NEWS_AUTHOR_COUNT = 5;

/** Tres años de historia y un trimestre por delante. Con 10 grupos que
 * entrenan 3 días a la semana son 30 ocurrencias por semana: 169 semanas dan
 * 5.070, y las 156 pasadas dan 4.680 con asistencia. */
const PAST_WEEKS = 156;
const FUTURE_WEEKS = 13;
const DAYS_PER_WEEK = 7;
/** Una serie dura como mucho un año (`event_series_date_range`, 0034). */
const SERIES_LENGTH_DAYS = 364;

/** Días ISO (1 = lunes) en que entrena cada grupo. */
const GROUP_WEEKDAYS: readonly (readonly number[])[] = [
  [2, 4, 6],
  [1, 3, 6],
  [2, 4, 7],
  [1, 3, 5],
  [2, 5, 6],
  [1, 4, 6],
  [3, 5, 7],
  [2, 4, 6],
  [1, 3, 6],
  [2, 5, 7],
];
const GROUP_NAMES: readonly string[] = [
  "Élite",
  "Desarrollo",
  "Principiantes",
  "Femenino",
  "Masculino",
  "Juvenil",
  "Máster",
  "Universitario",
  "Social",
  "Competición",
];
const START_TIMES: readonly string[] = ["18:00", "19:00", "20:00", "08:00"];
const LOCATIONS: readonly string[] = [
  "Melbourne Sports and Aquatic Centre",
  "Monash Aquatic Centre",
  "Harold Holt Swim Centre",
];

/** Uno de cada 4 socios entrena además en un segundo grupo. */
const SECOND_GROUP_EVERY = 4;
const SECOND_GROUP_OFFSET = 3;

/** 11 por cada una de las 4.680 ocurrencias pasadas: 51.480 asistencias. */
const ATTENDEES_PER_PAST_TRAINING = 11;
const PRESENT_SHARE = 0.8;
const LATE_SHARE = 0.1;

/** Una de cada dos ocurrencias futuras tiene RSVP, de 15 socios del grupo. */
const ANSWER_EVERY_OTHER_FUTURE_EVENT = 2;
const RSVPS_PER_ANSWERED_EVENT = 15;
const YES_SHARE = 0.7;
const MAYBE_SHARE = 0.15;

/** Una noticia cada 3 días; una de cada 5 va sólo a un grupo. */
const NEWS_INTERVAL_DAYS = 3;
const GROUP_NEWS_EVERY = 5;
const NEWS_SHARE = 0.6;

/** 10 avisos por socio, de las últimas semanas: 5.000 en total. El 70% leídos. */
const NOTIFICATIONS_PER_MEMBER = 10;
const NOTIFICATION_INTERVAL_DAYS = 5;
const RECENT_NEWS_FOR_NOTIFICATIONS = 20;
const READ_SHARE = 0.7;

/** Uno de cada tres socios recibe los correos en español. */
const SPANISH_LOCALE_EVERY = 3;
/** Altas repartidas en unos cinco años, una semana entre cada una. */
const JOIN_STEP_DAYS = 7;
const JOIN_SPREAD_DAYS = 1800;
/** Nacidos entre 1966 y 2000. */
const OLDEST_BIRTH_YEAR = 1966;
const BIRTH_YEAR_SPREAD = 35;
const MONTHS_PER_YEAR = 12;
const DAYS_VALID_IN_EVERY_MONTH = 28;

/** Tres de cada cinco Player tienen evaluación. */
const EVALUATION_CYCLE = 5;
const EVALUATED_PER_CYCLE = 3;

/** Planes: 60% Full, 25% Student, 15% Casual. */
const PLAN_CYCLE = 20;
const FULL_PLANS_PER_CYCLE = 12;
const STUDENT_PLANS_PER_CYCLE = 5;
const PAST_DUE_EVERY = 25;
const WAIVED_EVERY = 50;
const WAIVED_OFFSET = 13;
const BILLING_CYCLE_DAYS = 30;

const FIRST_NAMES: readonly string[] = [
  "Olivia",
  "Jack",
  "Charlotte",
  "Noah",
  "Amelia",
  "William",
  "Isla",
  "Oliver",
  "Mia",
  "Leo",
  "Ava",
  "Lucas",
  "Grace",
  "Thomas",
  "Chloe",
  "Henry",
  "Sofía",
  "Mateo",
  "Valentina",
  "Hiroshi",
  "Priya",
  "Arjun",
  "Mei",
  "Tane",
  "Aroha",
];
const LAST_NAMES: readonly string[] = [
  "Smith",
  "Nguyen",
  "Williams",
  "Brown",
  "Wilson",
  "Taylor",
  "Johnson",
  "White",
  "Martin",
  "Anderson",
  "Thompson",
  "García",
  "Chen",
  "Kelly",
  "Patel",
  "Rossi",
  "Murphy",
  "Singh",
  "Walker",
  "O'Connor",
];
const GENDERS: readonly SeedGender[] = [
  "female",
  "male",
  "female",
  "male",
  "non_binary",
  "undisclosed",
];
const EXPERIENCE_LEVELS: readonly SeedExperienceLevel[] = [
  "Beginner",
  "Intermediate",
  "Intermediate",
  "Advanced",
];
const NEWS_TOPICS: readonly string[] = [
  "Resultados del torneo estatal",
  "Cambio de horario en la piscina",
  "Asamblea anual del club",
  "Nuevo material de entrenamiento",
  "Clínica de técnica de apnea",
  "Viaje al campeonato nacional",
  "Bienvenida a los nuevos socios",
  "Recaudación de fondos",
];

export type SeedRole = "Admin" | "Committee" | "Coach" | "Player";
export type SeedPlan = "Full" | "Student" | "Casual";
type SeedGender = "female" | "male" | "non_binary" | "undisclosed";
type SeedExperienceLevel = "Beginner" | "Intermediate" | "Advanced";

export type SeedMember = {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: SeedRole;
  readonly canSignIn: boolean;
  readonly emailLocale: "en" | "es";
  readonly joinedOn: string;
  readonly dateOfBirth: string;
  readonly gender: SeedGender;
  readonly experienceLevel: SeedExperienceLevel;
  readonly membershipType: SeedPlan;
};

export type SeedGroup = { readonly id: string; readonly name: string };

export type SeedGroupMembership = {
  readonly groupId: string;
  readonly userId: string;
};

type EventFields = {
  readonly id: string;
  readonly groupId: string;
  readonly title: string;
  readonly eventType: "training";
  readonly startTime: string;
  readonly location: string;
  readonly authorId: string;
};

export type SeedSeries = EventFields & {
  readonly weekdays: readonly number[];
  readonly startsOn: string;
  readonly endsOn: string;
};

export type SeedEvent = EventFields & {
  readonly seriesId: string;
  readonly startsOn: string;
};

export type SeedAttendance = {
  readonly eventId: string;
  readonly userId: string;
  readonly status: "present" | "late" | "absent";
  readonly recordedBy: string;
  readonly recordedAt: string;
};

export type SeedRsvp = {
  readonly eventId: string;
  readonly userId: string;
  readonly response: "yes" | "maybe" | "no";
  readonly respondedAt: string;
};

type NewsFields = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly category: "news" | "announcement";
  readonly authorId: string;
  readonly publishedAt: string;
};

export type SeedNewsPost =
  | (NewsFields & { readonly audience: "club" })
  | (NewsFields & { readonly audience: "groups"; readonly groupId: string });

export type SeedNotification = {
  readonly id: string;
  readonly userId: string;
  readonly type: "news_post_published" | "event_series_created";
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly readAt: string | null;
};

export type SeedEvaluation = { readonly id: string; readonly userId: string };

type MembershipFields = {
  readonly userId: string;
  readonly plan: SeedPlan;
  readonly currentPeriodEnd: string;
};

export type SeedMembership =
  | (MembershipFields & { readonly status: "active" | "past_due" })
  | (MembershipFields & {
      readonly status: "waived";
      readonly waivedBy: string;
      readonly waivedReason: string;
    });

export type SeedDataset = {
  readonly members: readonly SeedMember[];
  readonly groups: readonly SeedGroup[];
  readonly groupMemberships: readonly SeedGroupMembership[];
  readonly series: readonly SeedSeries[];
  readonly events: readonly SeedEvent[];
  readonly attendance: readonly SeedAttendance[];
  readonly rsvps: readonly SeedRsvp[];
  readonly newsPosts: readonly SeedNewsPost[];
  readonly notifications: readonly SeedNotification[];
  readonly evaluations: readonly SeedEvaluation[];
  readonly memberships: readonly SeedMembership[];
};

export type SeedOptions = {
  readonly seed: number;
  /** El "hoy" del dataset, `YYYY-MM-DD` en Melbourne. */
  readonly anchorDate: string;
};

/** Números pseudoaleatorios en [0, 1) a partir de una semilla (mulberry32):
 * corto, rápido y con la misma secuencia en cualquier máquina. */
type Random = () => number;

const UINT32_RANGE = 2 ** 32;

function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

const UUID_WORDS = 4;
const HEX_PER_WORD = 8;

/** Un UUID v4 bien formado, pero sacado de la semilla. */
function createUuid(random: Random): string {
  const hex = Array.from({ length: UUID_WORDS }, () =>
    Math.floor(random() * UINT32_RANGE)
      .toString(16)
      .padStart(HEX_PER_WORD, "0"),
  ).join("");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

const MS_PER_DAY = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? DAYS_PER_WEEK : day;
}

function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length]!;
}

/** `count` elementos distintos de `items`, con un Fisher-Yates parcial. */
function sample<T>(items: readonly T[], count: number, random: Random): T[] {
  const pool = [...items];
  const size = Math.min(count, pool.length);
  for (let index = 0; index < size; index += 1) {
    const swap = index + Math.floor(random() * (pool.length - index));
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }
  return pool.slice(0, size);
}

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function planOf(memberIndex: number): SeedPlan {
  const slot = memberIndex % PLAN_CYCLE;
  if (slot < FULL_PLANS_PER_CYCLE) return "Full";
  if (slot < FULL_PLANS_PER_CYCLE + STUDENT_PLANS_PER_CYCLE) return "Student";
  return "Casual";
}

/** Todos adultos: así ninguno necesita el consentimiento de un tutor. El día
 * no pasa de 28 para que sea válido en cualquier mes. */
function birthDateOf(index: number): string {
  const year = OLDEST_BIRTH_YEAR + (index % BIRTH_YEAR_SPREAD);
  const month = 1 + (index % MONTHS_PER_YEAR);
  const day = 1 + (index % DAYS_VALID_IN_EVERY_MONTH);
  return `${year}-${padNumber(month, 2)}-${padNumber(day, 2)}`;
}

/** El correo del socio en la posición `index` (desde 0). La prueba de carga
 * lo usa para iniciar sesión con las identidades sembradas. */
export function seedEmailOf(index: number): string {
  return `socio-${padNumber(index + 1, 3)}@${EMAIL_DOMAIN}`;
}

/** El rol del socio en la posición `index` (desde 0). */
export function seedRoleOf(index: number): SeedRole {
  return LEADERSHIP_ROLES[index] ?? "Player";
}

function buildMember(
  index: number,
  anchorDate: string,
  random: Random,
): SeedMember {
  const firstName = pick(FIRST_NAMES, index);
  const lastName = pick(LAST_NAMES, Math.floor(index / FIRST_NAMES.length));
  return {
    userId: createUuid(random),
    fullName: `${firstName} ${lastName}`,
    email: seedEmailOf(index),
    role: seedRoleOf(index),
    canSignIn: index < LOGIN_IDENTITY_COUNT,
    emailLocale: index % SPANISH_LOCALE_EVERY === 0 ? "es" : "en",
    joinedOn: addDays(
      anchorDate,
      -(((index * JOIN_STEP_DAYS) % JOIN_SPREAD_DAYS) + 1),
    ),
    dateOfBirth: birthDateOf(index),
    gender: pick(GENDERS, index),
    experienceLevel: pick(EXPERIENCE_LEVELS, index),
    membershipType: planOf(index),
  };
}

function buildGroupMemberships(
  members: readonly SeedMember[],
  groups: readonly SeedGroup[],
): SeedGroupMembership[] {
  return members.flatMap((member, index) => {
    const primary = { groupId: pick(groups, index).id, userId: member.userId };
    if (index % SECOND_GROUP_EVERY !== 0) return [primary];
    const second = pick(groups, index + SECOND_GROUP_OFFSET);
    return [primary, { groupId: second.id, userId: member.userId }];
  });
}

type Calendar = {
  readonly series: readonly SeedSeries[];
  readonly events: readonly SeedEvent[];
};

function seriesStarts(firstDay: string, lastDay: string): string[] {
  const starts: string[] = [];
  for (
    let day = firstDay;
    day <= lastDay;
    day = addDays(day, SERIES_LENGTH_DAYS)
  ) {
    starts.push(day);
  }
  return starts;
}

function occurrencesOf(series: SeedSeries, random: Random): SeedEvent[] {
  const events: SeedEvent[] = [];
  for (let day = series.startsOn; day <= series.endsOn; day = addDays(day, 1)) {
    if (!series.weekdays.includes(isoWeekday(day))) continue;
    events.push({
      groupId: series.groupId,
      title: series.title,
      eventType: series.eventType,
      startTime: series.startTime,
      location: series.location,
      authorId: series.authorId,
      id: createUuid(random),
      seriesId: series.id,
      startsOn: day,
    });
  }
  return events;
}

function buildCalendar(
  groups: readonly SeedGroup[],
  members: readonly SeedMember[],
  options: SeedOptions,
  random: Random,
): Calendar {
  const firstDay = addDays(options.anchorDate, -PAST_WEEKS * DAYS_PER_WEEK);
  const lastDay = addDays(options.anchorDate, FUTURE_WEEKS * DAYS_PER_WEEK - 1);
  const series = groups.flatMap((group, groupIndex) =>
    seriesStarts(firstDay, lastDay).map((startsOn) => {
      const endsOn = addDays(startsOn, SERIES_LENGTH_DAYS - 1);
      return {
        id: createUuid(random),
        groupId: group.id,
        title: `Entrenamiento ${group.name}`,
        eventType: "training" as const,
        startTime: pick(START_TIMES, groupIndex),
        location: pick(LOCATIONS, groupIndex),
        authorId:
          members[FIRST_COACH_INDEX + (groupIndex % COACH_COUNT)]!.userId,
        weekdays: GROUP_WEEKDAYS[groupIndex]!,
        startsOn,
        endsOn: endsOn < lastDay ? endsOn : lastDay,
      };
    }),
  );
  return { series, events: series.flatMap((s) => occurrencesOf(s, random)) };
}

function rostersByGroup(
  groupMemberships: readonly SeedGroupMembership[],
): Map<string, string[]> {
  const rosters = new Map<string, string[]>();
  for (const { groupId, userId } of groupMemberships) {
    rosters.set(groupId, [...(rosters.get(groupId) ?? []), userId]);
  }
  return rosters;
}

function attendanceStatus(random: Random): SeedAttendance["status"] {
  const roll = random();
  if (roll < PRESENT_SHARE) return "present";
  if (roll < PRESENT_SHARE + LATE_SHARE) return "late";
  return "absent";
}

function buildAttendance(
  pastEvents: readonly SeedEvent[],
  rosters: ReadonlyMap<string, readonly string[]>,
  random: Random,
): SeedAttendance[] {
  return pastEvents.flatMap((event) =>
    sample(
      rosters.get(event.groupId)!,
      ATTENDEES_PER_PAST_TRAINING,
      random,
    ).map((userId) => ({
      eventId: event.id,
      userId,
      status: attendanceStatus(random),
      recordedBy: event.authorId,
      recordedAt: `${event.startsOn}T12:00:00Z`,
    })),
  );
}

function rsvpResponse(random: Random): SeedRsvp["response"] {
  const roll = random();
  if (roll < YES_SHARE) return "yes";
  if (roll < YES_SHARE + MAYBE_SHARE) return "maybe";
  return "no";
}

function buildRsvps(
  futureEvents: readonly SeedEvent[],
  rosters: ReadonlyMap<string, readonly string[]>,
  options: SeedOptions,
  random: Random,
): SeedRsvp[] {
  return futureEvents
    .filter((_, index) => index % ANSWER_EVERY_OTHER_FUTURE_EVENT === 0)
    .flatMap((event) =>
      sample(rosters.get(event.groupId)!, RSVPS_PER_ANSWERED_EVENT, random).map(
        (userId) => ({
          eventId: event.id,
          userId,
          response: rsvpResponse(random),
          respondedAt: `${options.anchorDate}T00:00:00Z`,
        }),
      ),
    );
}

function buildNewsPost(
  index: number,
  context: {
    groups: readonly SeedGroup[];
    members: readonly SeedMember[];
    options: SeedOptions;
  },
  random: Random,
): SeedNewsPost {
  const topic = pick(NEWS_TOPICS, index);
  const fields: NewsFields = {
    id: createUuid(random),
    title: `${topic} (${index + 1})`,
    body: `${topic}. Toda la información para los socios del club, con fechas, lugar y a quién escribir si hay dudas.`,
    category: random() < NEWS_SHARE ? "news" : "announcement",
    authorId: context.members[index % NEWS_AUTHOR_COUNT]!.userId,
    publishedAt: `${addDays(context.options.anchorDate, -(index * NEWS_INTERVAL_DAYS + 1))}T08:00:00Z`,
  };
  if (index % GROUP_NEWS_EVERY !== GROUP_NEWS_EVERY - 1) {
    return { ...fields, audience: "club" };
  }
  return {
    ...fields,
    audience: "groups",
    groupId: pick(context.groups, index).id,
  };
}

function newsNotificationData(post: SeedNewsPost): Record<string, unknown> {
  return { postId: post.id, category: post.category, title: post.title };
}

function seriesNotificationData(series: SeedSeries): Record<string, unknown> {
  return {
    seriesId: series.id,
    title: series.title,
    eventType: series.eventType,
    weekdays: series.weekdays,
    startsOn: series.startsOn,
    endsOn: series.endsOn,
    startTime: series.startTime,
  };
}

type NotificationContext = {
  readonly recentClubNews: readonly SeedNewsPost[];
  readonly latestSeriesByGroup: ReadonlyMap<string, SeedSeries>;
  readonly groups: readonly SeedGroup[];
  readonly options: SeedOptions;
};

function buildMemberNotifications(
  memberIndex: number,
  member: SeedMember,
  context: NotificationContext,
  random: Random,
): SeedNotification[] {
  return Array.from({ length: NOTIFICATIONS_PER_MEMBER }, (_, position) => {
    const day = addDays(
      context.options.anchorDate,
      -(position * NOTIFICATION_INTERVAL_DAYS + 1),
    );
    const isNews = position % 2 === 0;
    return {
      id: createUuid(random),
      userId: member.userId,
      type: isNews ? "news_post_published" : "event_series_created",
      data: isNews
        ? newsNotificationData(
            pick(context.recentClubNews, memberIndex + position),
          )
        : seriesNotificationData(
            context.latestSeriesByGroup.get(
              pick(context.groups, memberIndex).id,
            )!,
          ),
      createdAt: `${day}T09:00:00Z`,
      readAt: random() < READ_SHARE ? `${day}T21:00:00Z` : null,
    };
  });
}

function latestSeriesOfEachGroup(
  series: readonly SeedSeries[],
): Map<string, SeedSeries> {
  return new Map(series.map((s) => [s.groupId, s]));
}

function buildEvaluations(
  members: readonly SeedMember[],
  random: Random,
): SeedEvaluation[] {
  return members
    .filter(
      (member, index) =>
        member.role === "Player" &&
        index % EVALUATION_CYCLE < EVALUATED_PER_CYCLE,
    )
    .map((member) => ({ id: createUuid(random), userId: member.userId }));
}

function buildMembership(
  member: SeedMember,
  index: number,
  context: { members: readonly SeedMember[]; options: SeedOptions },
): SeedMembership {
  const fields: MembershipFields = {
    userId: member.userId,
    plan: member.membershipType,
    currentPeriodEnd: `${addDays(context.options.anchorDate, (index % BILLING_CYCLE_DAYS) + 1)}T00:00:00Z`,
  };
  if (index % WAIVED_EVERY === WAIVED_OFFSET) {
    return {
      ...fields,
      status: "waived",
      waivedBy: context.members[FIRST_ADMIN_INDEX]!.userId,
      waivedReason: "Beca del club",
    };
  }
  const isPastDue = index % PAST_DUE_EVERY === PAST_DUE_EVERY - 1;
  return { ...fields, status: isPastDue ? "past_due" : "active" };
}

/** Los avisos hablan de las noticias del club más recientes y de la última
 * serie del grupo de cada socio. */
function buildNotifications(
  club: {
    readonly members: readonly SeedMember[];
    readonly newsPosts: readonly SeedNewsPost[];
    readonly series: readonly SeedSeries[];
    readonly groups: readonly SeedGroup[];
    readonly options: SeedOptions;
  },
  random: Random,
): SeedNotification[] {
  const context: NotificationContext = {
    recentClubNews: club.newsPosts
      .filter((post) => post.audience === "club")
      .slice(0, RECENT_NEWS_FOR_NOTIFICATIONS),
    latestSeriesByGroup: latestSeriesOfEachGroup(club.series),
    groups: club.groups,
    options: club.options,
  };
  return club.members.flatMap((member, index) =>
    buildMemberNotifications(index, member, context, random),
  );
}

export function generateSeedDataset(options: SeedOptions): SeedDataset {
  const random = createRandom(options.seed);
  const members = Array.from({ length: MEMBER_COUNT }, (_, index) =>
    buildMember(index, options.anchorDate, random),
  );
  const groups = GROUP_NAMES.slice(0, GROUP_COUNT).map((name) => ({
    id: createUuid(random),
    name,
  }));
  const groupMemberships = buildGroupMemberships(members, groups);
  const rosters = rostersByGroup(groupMemberships);
  const { series, events } = buildCalendar(groups, members, options, random);
  const pastEvents = events.filter((e) => e.startsOn < options.anchorDate);
  const futureEvents = events
    .filter((e) => e.startsOn > options.anchorDate)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const newsPosts = Array.from({ length: NEWS_POST_COUNT }, (_, index) =>
    buildNewsPost(index, { groups, members, options }, random),
  );
  return {
    members,
    groups,
    groupMemberships,
    series,
    events,
    attendance: buildAttendance(pastEvents, rosters, random),
    rsvps: buildRsvps(futureEvents, rosters, options, random),
    newsPosts,
    notifications: buildNotifications(
      { members, newsPosts, series, groups, options },
      random,
    ),
    evaluations: buildEvaluations(members, random),
    memberships: members.map((member, index) =>
      buildMembership(member, index, { members, options }),
    ),
  };
}
