import type {
  ClubAttendanceRate,
  MemberAttendance,
} from "@/lib/attendance/attendance-stats";
import {
  type ClubAttendanceRateGateways,
  readClubAttendanceRate,
} from "@/lib/attendance/club-attendance-rate";
import {
  type OwnAttendanceGateways,
  readOwnAttendance,
} from "@/lib/attendance/own-attendance";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { type Role, hasCapability } from "@/lib/auth/roles";
import {
  type AgendaEvent,
  type AgendaPeriod,
  type EventAgendaGateways,
  listAgenda,
} from "@/lib/events/event-agenda";
import { isStillAhead } from "@/lib/events/event-occurrences";
import {
  type MembershipBlock,
  type MembershipGateway,
  type MembershipPlan,
  type MembershipReading,
  membershipBlockOfStatus,
  readMembership,
} from "@/lib/membership/membership";
import { nextChargeOf } from "@/lib/membership/membership-view";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import {
  type NewsFeedItem,
  type NewsFeedPage,
  listNewsFeed,
} from "@/lib/news/news-feed";
import type { NewsCategory, NewsGateways } from "@/lib/news/news-posts";
import { isNewsUnread, newsUnreadCutoff } from "@/lib/news/news-seen";
import {
  type ContactReminder,
  contactReminderOf,
} from "@/lib/members/contact-reminder";
import type { ProfileContact } from "@/lib/members/profile-contact";
import type { MyTeamGateways } from "@/lib/teams/my-team";
import {
  clubCalendarDate,
  clubMoment,
  subtractClubDays,
} from "@/lib/time/club-calendar";
import {
  type AgendaWindow,
  type DashboardNextUpEvent,
  type StaffNextUpEvent,
  type WeekEvent,
  findNextUpCandidate,
  listWeekEvents,
  readNextUpEvent,
} from "./dashboard-events";

export type {
  DashboardNextUpEvent,
  NextUpTeam,
  StaffNextUpEvent,
  TeamsStatus,
  WeekEvent,
} from "./dashboard-events";

/**
 * El dashboard de la pantalla de inicio (#424, RF-1, RF-2, RF-5 y RF-6 del
 * PRD de E14) en una sola respuesta.
 *
 * Nada se recalcula aquí: cada parte sale de la función de dominio que ya
 * sirve su sección (la tasa del club, la asistencia propia, la agenda y el
 * feed), así que el dashboard ve exactamente lo que vería quien entrara en
 * ella. Las fuentes se piden a la vez y cada una puede caer sola: la que
 * falla llega como `unavailable`, se apunta en el log con su causa, y el
 * resto se sirve igual (RF-6).
 *
 * Quien no tiene la membresía al día (#453, D2 del PRD de E12) recibe el
 * inicio reducido: el saludo, el motivo y el próximo entrenamiento, sin
 * teselas de club ni noticias. Vale para todos los roles: el personal
 * conserva sus pantallas de gestión desde el menú, no desde el inicio.
 *
 * Los dos inicios llevan el aviso de los datos de contacto que faltan (#498,
 * RF-2 del PRD de E19): no depende de tener la membresía al día.
 *
 * El rediseño de E27 (#745) añade a los dos el próximo evento, la semana, la
 * membresía y las noticias. Al inicio reducido las noticias le llegan sólo
 * con el título, la categoría y la fecha (D2).
 */

/** Cuántos eventos y noticias enseña el inicio (FR-077). */
export const DASHBOARD_LIST_SIZE = 3;

/** Los días hacia atrás que cubren las altas (D2). Las noticias sin leer
 * usan la misma ventana, `NEWS_UNREAD_WINDOW_DAYS`. */
export const DASHBOARD_WINDOW_DAYS = 30;

export type Unavailable = { readonly kind: "unavailable" };

/** La primera tesela según el rol (D1). */
export type AttendanceTile =
  | { readonly kind: "club_rate"; readonly rate: ClubAttendanceRate }
  | { readonly kind: "own_attendance"; readonly attendance: MemberAttendance }
  | Unavailable;

export type MembersTile =
  | {
      readonly kind: "members";
      readonly active: number;
      /** Cuántos de los activos se unieron en los últimos 30 días. */
      readonly joinedRecently: number;
    }
  | Unavailable;

export type NextTraining = {
  readonly id: string;
  readonly title: string;
  readonly startsOn: string;
  readonly startTime: string;
  readonly location: string;
  /** Los conteos van con la respuesta: la tarjeta del móvil responde con
   * ellos igual que una fila del calendario (#426). */
  readonly goingCount: number;
  readonly maybeCount: number;
  readonly myResponse: RsvpResponse | null;
};

export type NextTrainingTile =
  | { readonly kind: "training"; readonly training: NextTraining }
  | { readonly kind: "none" }
  | Unavailable;

export type UnreadNewsTile =
  | {
      readonly kind: "unread";
      readonly count: number;
      readonly announcements: number;
    }
  | Unavailable;

export type UpcomingEvents =
  | { readonly kind: "events"; readonly events: readonly AgendaEvent[] }
  | Unavailable;

/** Lo que ve de una noticia quien no tiene la membresía al día (D2). */
export type LatestNewsItem = {
  readonly id: string;
  readonly category: NewsCategory;
  readonly title: string;
  readonly publishedAt: string;
};

export type MemberLatestNewsItem = LatestNewsItem & {
  /** La portada grande firmada, o null sin portada. */
  readonly coverUrl: string | null;
  readonly excerpt: string;
  readonly isPinned: boolean;
  /** Publicada después de la última visita a Noticias (D7). */
  readonly isUnread: boolean;
};

export type LatestNews<Item = MemberLatestNewsItem> =
  { readonly kind: "news"; readonly posts: readonly Item[] } | Unavailable;

/** El próximo evento que ve quien mira (D4). */
export type NextUp =
  | DashboardNextUpEvent
  | StaffNextUpEvent
  | { readonly kind: "none" }
  | Unavailable;

/** Hoy y los seis días siguientes (D14). */
export type Week =
  | { readonly kind: "week"; readonly events: readonly WeekEvent[] }
  | Unavailable;

export type ActiveMembershipSummary = {
  readonly status: "active";
  readonly plan: MembershipPlan | null;
  /** `YYYY-MM-DD` del club del próximo cobro, o null si no renueva. */
  readonly renewsOn: string | null;
};

export type RestrictedMembershipSummary = {
  readonly status: "restricted";
  readonly block: MembershipBlock;
  /** `YYYY-MM-DD` del club en que acabó el último periodo pagado (D8). */
  readonly endedOn: string | null;
};

/** Qué dato de contacto le falta a quien mira (#498). */
export type ContactReminderPart =
  | { readonly kind: "reminder"; readonly reminder: ContactReminder }
  | Unavailable;

/** Quien mira, para el saludo de la pantalla (#426, RF-4). */
export type DashboardViewer = { readonly firstName: string };

/** El inicio de un socio al día. */
export type MemberDashboard = {
  readonly kind: "member";
  readonly viewer: DashboardViewer;
  readonly tiles: {
    readonly attendance: AttendanceTile;
    readonly members: MembersTile;
    readonly nextTraining: NextTrainingTile;
    readonly unreadNews: UnreadNewsTile;
  };
  readonly upcomingEvents: UpcomingEvents;
  readonly latestNews: LatestNews;
  readonly contactReminder: ContactReminderPart;
  readonly nextUp: NextUp;
  readonly week: Week;
  readonly membership: ActiveMembershipSummary;
};

/** El inicio de quien no tiene la membresía al día (#453). */
export type RestrictedDashboard = {
  readonly kind: "restricted";
  readonly viewer: DashboardViewer;
  /** Por qué: lo que dice el aviso que lleva a Pagos. */
  readonly block: MembershipBlock;
  readonly nextTraining: NextTrainingTile;
  readonly contactReminder: ContactReminderPart;
  readonly nextUp: NextUp;
  readonly week: Week;
  readonly membership: RestrictedMembershipSummary;
  readonly latestNews: LatestNews<LatestNewsItem>;
};

export type Dashboard = MemberDashboard | RestrictedDashboard;

export type ActiveMembers = {
  readonly active: number;
  readonly joinedRecently: number;
};

/** Lo que el dashboard lee de `members` y ninguna sección servía ya. */
export type DashboardRosterGateway = {
  /** Los socios `active` del club, y cuántos con `joined_on` desde
   * `joinedSince` (YYYY-MM-DD del club, incluido). */
  countActiveMembers(query: {
    readonly clubId: string;
    readonly joinedSince: string;
  }): Promise<ActiveMembers>;
  /** La última visita a Noticias, o `null` si nunca las abrió. */
  findNewsSeenAt(userId: string): Promise<string | null>;
  /** El teléfono y el contacto de emergencia de quien mira (#498). */
  findOwnContact(userId: string): Promise<ProfileContact>;
};

/** Las partes que pueden caer por separado, para el log. */
export type DashboardSource =
  | "attendance"
  | "members"
  | "agenda"
  | "next_up"
  | "news"
  | "news_seen"
  | "contact";

export type DashboardFailureLog = {
  report(source: DashboardSource, error: unknown): void;
};

export type DashboardGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly clubRate: ClubAttendanceRateGateways;
  readonly ownAttendance: OwnAttendanceGateways;
  readonly agenda: EventAgendaGateways;
  readonly news: NewsGateways;
  readonly roster: DashboardRosterGateway;
  readonly membership: MembershipGateway;
  readonly myTeam: MyTeamGateways;
  readonly failures: DashboardFailureLog;
};

export type DashboardRequest = {
  readonly callerId: string;
  readonly now: Date;
};

const UNAVAILABLE: Unavailable = { kind: "unavailable" };

/** La primera palabra del nombre completo: el saludo dice "Alba", no
 * "Alba Ferrer". */
function firstNameOf(fullName: string): string {
  const [firstName = fullName] = fullName.trim().split(/\s+/);
  return firstName;
}

/** Admin y Coach, los que pasan lista, ven la tasa del club (D1). */
function seesClubRate(role: Role): boolean {
  return hasCapability(role, "buildTeamsAndTrackAttendance");
}

async function readAttendanceTile(
  gateways: DashboardGateways,
  request: DashboardRequest & { readonly role: Role },
): Promise<AttendanceTile> {
  if (seesClubRate(request.role)) {
    return {
      kind: "club_rate",
      rate: await readClubAttendanceRate(gateways.clubRate, {
        callerId: request.callerId,
        todayInClub: clubCalendarDate(request.now),
      }),
    };
  }
  return {
    kind: "own_attendance",
    attendance: await readOwnAttendance(
      gateways.ownAttendance,
      request.callerId,
    ),
  };
}

async function readMembersTile(
  gateways: DashboardGateways,
  request: { readonly clubId: string; readonly now: Date },
): Promise<MembersTile> {
  const counts = await gateways.roster.countActiveMembers({
    clubId: request.clubId,
    // Hoy y los 29 días anteriores, como la tasa del club.
    joinedSince: subtractClubDays(
      clubCalendarDate(request.now),
      DASHBOARD_WINDOW_DAYS - 1,
    ),
  });
  return { kind: "members", ...counts };
}

/** Lo que el inicio puede enseñar como "próximo": dirigido a quien mira,
 * no cancelado y que todavía no empezó en la hora del club (RF-3). */
function isAheadForViewer(event: AgendaEvent, now: Date): boolean {
  return (
    event.inAudience &&
    event.status === "scheduled" &&
    isStillAhead(
      { date: event.startsOn, time: event.startTime },
      clubMoment(now),
    )
  );
}

function toNextTrainingTile(events: readonly AgendaEvent[]): NextTrainingTile {
  const training = events.find((event) => event.eventType === "training");
  if (training === undefined) {
    return { kind: "none" };
  }
  return {
    kind: "training",
    training: {
      id: training.id,
      title: training.title,
      startsOn: training.startsOn,
      startTime: training.startTime,
      location: training.location,
      goingCount: training.goingCount,
      maybeCount: training.maybeCount,
      myResponse: training.myResponse,
    },
  };
}

/** La primera página de próximos y la de pasados: 50 eventos sobran para
 * encontrar tres, un entrenamiento y la semana, y los pasados recientes son
 * donde está un evento de varios días que sigue en curso (D4). */
async function readAgendaWindow(
  gateways: DashboardGateways,
  request: DashboardRequest,
): Promise<AgendaWindow> {
  const readPage = (period: AgendaPeriod) =>
    listAgenda(gateways.agenda, {
      callerId: request.callerId,
      period,
      now: request.now,
    });
  const [upcoming, started] = await Promise.all([
    readPage("upcoming"),
    readPage("past"),
  ]);
  return { upcoming: upcoming.events, started: started.events };
}

/** Retirada sólo le llega a quien la publicó; no es algo que leer. */
function isReadable(post: NewsFeedItem): boolean {
  return post.status === "published";
}

type HomePost = { readonly post: NewsFeedItem; readonly isPinned: boolean };

/** Las que enseña el inicio: la fijada primero y detrás las más nuevas
 * (#745). El feed trae la fijada aparte (#592). */
function homePostsOf(page: NewsFeedPage): readonly HomePost[] {
  const pinned = page.pinned === null ? [] : [page.pinned];
  return [
    ...pinned.map((post) => ({ post, isPinned: true })),
    ...page.posts.map((post) => ({ post, isPinned: false })),
  ]
    .filter(({ post }) => isReadable(post))
    .slice(0, DASHBOARD_LIST_SIZE);
}

function toLatestNewsItem(post: NewsFeedItem): LatestNewsItem {
  return {
    id: post.id,
    category: post.category,
    title: post.title,
    publishedAt: post.publishedAt,
  };
}

/** `unreadCutoff` es nulo si no se pudo leer la marca de visita: el fallo
 * ya está en el log y la tesela sin leer lo dice, y sin saber qué es nuevo
 * es mejor no marcar ninguna que marcarlas todas. */
function toMemberLatestNews(
  page: NewsFeedPage,
  unreadCutoff: number | null,
): LatestNews {
  return {
    kind: "news",
    posts: homePostsOf(page).map(({ post, isPinned }) => ({
      ...toLatestNewsItem(post),
      coverUrl: post.coverUrl,
      excerpt: post.excerpt,
      isPinned,
      isUnread: unreadCutoff !== null && isNewsUnread(post, unreadCutoff),
    })),
  };
}

type UnreadCount = { readonly count: number; readonly announcements: number };

/** Recorre el feed desde `page` mientras siga habiendo publicaciones
 * posteriores a `sinceMs`. El feed va de la más reciente a la más antigua,
 * así que la primera anterior cierra la cuenta. */
async function countUnreadFrom(
  gateways: DashboardGateways,
  request: {
    readonly callerId: string;
    readonly page: NewsFeedPage;
    readonly sinceMs: number;
    readonly now: Date;
  },
): Promise<UnreadCount> {
  const fresh = request.page.posts.filter(
    (post) => Date.parse(post.publishedAt) > request.sinceMs,
  );
  const readable = fresh.filter(isReadable);
  const here = {
    count: readable.length,
    announcements: readable.filter((post) => post.category === "announcement")
      .length,
  };
  const reachedOlder = fresh.length < request.page.posts.length;
  if (reachedOlder || request.page.nextCursor === null) {
    return here;
  }
  const next = await countUnreadFrom(gateways, {
    ...request,
    page: await listNewsFeed(gateways.news, {
      callerId: request.callerId,
      cursor: request.page.nextCursor,
      now: request.now,
    }),
  });
  return {
    count: here.count + next.count,
    announcements: here.announcements + next.announcements,
  };
}

async function readUnreadNewsTile(
  gateways: DashboardGateways,
  request: DashboardRequest & {
    readonly firstPage: NewsFeedPage;
    readonly seenAt: string | null;
  },
): Promise<UnreadNewsTile> {
  const sinceMs = newsUnreadCutoff(request.seenAt, request.now);
  const unread = await countUnreadFrom(gateways, {
    callerId: request.callerId,
    page: request.firstPage,
    sinceMs,
    now: request.now,
  });
  return {
    kind: "unread",
    ...addPinnedUnread(unread, request.firstPage, sinceMs),
  };
}

/** La fijada no sale en ninguna página del feed (#592), así que se cuenta
 * aparte. Recorrer las páginas se corta en la primera publicación ya leída,
 * y meterla entre ellas por fecha podría cortarlo antes de tiempo. */
function addPinnedUnread(
  unread: UnreadCount,
  firstPage: NewsFeedPage,
  sinceMs: number,
): UnreadCount {
  const { pinned } = firstPage;
  if (pinned === null || !isNewsUnread(pinned, sinceMs)) {
    return unread;
  }
  return {
    count: unread.count + 1,
    announcements:
      unread.announcements + (pinned.category === "announcement" ? 1 : 0),
  };
}

/** Lo que devuelve la fuente, o `unavailable` con el fallo en el log. Es el
 * único sitio donde se atrapa: una fuente caída no tumba las demás (RF-6). */
async function orUnavailable<T>(
  gateways: DashboardGateways,
  source: DashboardSource,
  read: Promise<T>,
): Promise<T | Unavailable> {
  try {
    return await read;
  } catch (error) {
    gateways.failures.report(source, error);
    return UNAVAILABLE;
  }
}

function isUnavailable<T>(value: T | Unavailable): value is Unavailable {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "unavailable"
  );
}

type EventParts = {
  readonly nextTraining: NextTrainingTile;
  readonly upcomingEvents: UpcomingEvents;
  readonly nextUp: NextUp;
  readonly week: Week;
};

const UNAVAILABLE_EVENT_PARTS: EventParts = {
  nextTraining: UNAVAILABLE,
  upcomingEvents: UNAVAILABLE,
  nextUp: UNAVAILABLE,
  week: UNAVAILABLE,
};

type EventPartsRequest = DashboardRequest & {
  readonly caller: DashboardCaller;
  readonly isRestricted: boolean;
};

/** Lo que no trae la agenda (la imagen, la audiencia y el reparto) se lee
 * aparte y puede caer solo: entonces cae el próximo y nada más. */
async function readNextUp(
  gateways: DashboardGateways,
  request: EventPartsRequest & { readonly window: AgendaWindow },
): Promise<NextUp> {
  const event = findNextUpCandidate(request.window, request.now);
  if (event === null) {
    return { kind: "none" };
  }
  return orUnavailable(
    gateways,
    "next_up",
    readNextUpEvent(gateways, {
      event,
      callerId: request.callerId,
      clubId: request.caller.clubId,
      role: request.caller.role,
      isRestricted: request.isRestricted,
    }),
  );
}

async function readEventParts(
  gateways: DashboardGateways,
  request: EventPartsRequest,
): Promise<EventParts> {
  const window = await orUnavailable(
    gateways,
    "agenda",
    readAgendaWindow(gateways, request),
  );
  if (isUnavailable(window)) {
    return UNAVAILABLE_EVENT_PARTS;
  }
  const ahead = window.upcoming.filter((event) =>
    isAheadForViewer(event, request.now),
  );
  return {
    nextTraining: toNextTrainingTile(ahead),
    upcomingEvents: {
      kind: "events",
      events: ahead.slice(0, DASHBOARD_LIST_SIZE),
    },
    nextUp: await readNextUp(gateways, { ...request, window }),
    week: { kind: "week", events: listWeekEvents(window, request.now) },
  };
}

type NewsParts = {
  readonly unreadNews: UnreadNewsTile;
  readonly latestNews: LatestNews;
};

/** La primera página del feed sirve a las dos partes; sin la marca de
 * visita sólo cae la cuenta sin leer. */
async function readNewsParts(
  gateways: DashboardGateways,
  request: DashboardRequest,
): Promise<NewsParts> {
  const [firstPage, seenAt] = await Promise.all([
    orUnavailable(
      gateways,
      "news",
      listNewsFeed(gateways.news, {
        callerId: request.callerId,
        now: request.now,
      }),
    ),
    orUnavailable(
      gateways,
      "news_seen",
      gateways.roster.findNewsSeenAt(request.callerId),
    ),
  ]);
  if (isUnavailable(firstPage)) {
    return { unreadNews: UNAVAILABLE, latestNews: UNAVAILABLE };
  }
  if (isUnavailable(seenAt)) {
    return {
      unreadNews: UNAVAILABLE,
      latestNews: toMemberLatestNews(firstPage, null),
    };
  }
  const latestNews = toMemberLatestNews(
    firstPage,
    newsUnreadCutoff(seenAt, request.now),
  );
  const unreadNews = await orUnavailable(
    gateways,
    "news",
    readUnreadNewsTile(gateways, { ...request, firstPage, seenAt }),
  );
  return { unreadNews, latestNews };
}

/** Las mismas tres que el inicio de socio, sin portada, extracto ni punto
 * de sin leer (D2). */
async function readRestrictedNews(
  gateways: DashboardGateways,
  request: DashboardRequest,
): Promise<LatestNews<LatestNewsItem>> {
  const page = await orUnavailable(
    gateways,
    "news",
    listNewsFeed(gateways.news, {
      callerId: request.callerId,
      now: request.now,
    }),
  );
  if (isUnavailable(page)) {
    return page;
  }
  return {
    kind: "news",
    posts: homePostsOf(page).map(({ post }) => toLatestNewsItem(post)),
  };
}

async function readContactReminder(
  gateways: DashboardGateways,
  callerId: string,
): Promise<ContactReminderPart> {
  const reminder = await orUnavailable(
    gateways,
    "contact",
    gateways.roster
      .findOwnContact(callerId)
      .then((contact) => contactReminderOf(contact)),
  );
  return isUnavailable(reminder) ? reminder : { kind: "reminder", reminder };
}

type DashboardCaller = NonNullable<
  Awaited<ReturnType<DashboardGateways["members"]["findRoleRequestMember"]>>
>;

async function readMemberDashboard(
  gateways: DashboardGateways,
  request: DashboardRequest & {
    readonly caller: DashboardCaller;
    readonly membership: ActiveMembershipSummary;
  },
): Promise<MemberDashboard> {
  const { caller } = request;
  const [attendance, members, eventParts, newsParts, contactReminder] =
    await Promise.all([
      orUnavailable(
        gateways,
        "attendance",
        readAttendanceTile(gateways, { ...request, role: caller.role }),
      ),
      orUnavailable(
        gateways,
        "members",
        readMembersTile(gateways, { clubId: caller.clubId, now: request.now }),
      ),
      readEventParts(gateways, { ...request, isRestricted: false }),
      readNewsParts(gateways, request),
      readContactReminder(gateways, request.callerId),
    ]);
  return {
    kind: "member",
    viewer: { firstName: firstNameOf(caller.fullName) },
    tiles: {
      attendance,
      members,
      nextTraining: eventParts.nextTraining,
      unreadNews: newsParts.unreadNews,
    },
    upcomingEvents: eventParts.upcomingEvents,
    latestNews: newsParts.latestNews,
    contactReminder,
    nextUp: eventParts.nextUp,
    week: eventParts.week,
    membership: request.membership,
  };
}

async function readRestrictedDashboard(
  gateways: DashboardGateways,
  request: DashboardRequest & {
    readonly caller: DashboardCaller;
    readonly membership: RestrictedMembershipSummary;
  },
): Promise<RestrictedDashboard> {
  const [eventParts, contactReminder, latestNews] = await Promise.all([
    readEventParts(gateways, { ...request, isRestricted: true }),
    readContactReminder(gateways, request.callerId),
    readRestrictedNews(gateways, request),
  ]);
  return {
    kind: "restricted",
    viewer: { firstName: firstNameOf(request.caller.fullName) },
    block: request.membership.block,
    nextTraining: eventParts.nextTraining,
    contactReminder,
    nextUp: eventParts.nextUp,
    week: eventParts.week,
    membership: request.membership,
    latestNews,
  };
}

function toClubDate(instant: Date | null): string | null {
  return instant === null ? null : clubCalendarDate(instant);
}

/** Lo que el inicio dice de la membresía (D8). Sin membresía, el socio está
 * como quien todavía no puso tarjeta, igual que en `membershipBlockOf`. */
function summarizeMembership(
  reading: MembershipReading,
): ActiveMembershipSummary | RestrictedMembershipSummary {
  if (reading.kind === "none") {
    return { status: "restricted", block: "pending", endedOn: null };
  }
  const { membership } = reading;
  const block = membershipBlockOfStatus(membership.status);
  if (block !== null) {
    return {
      status: "restricted",
      block,
      endedOn: toClubDate(membership.currentPeriodEnd),
    };
  }
  return {
    status: "active",
    plan: membership.plan,
    renewsOn: toClubDate(nextChargeOf(membership)),
  };
}

export async function readDashboard(
  gateways: DashboardGateways,
  request: DashboardRequest,
): Promise<Dashboard> {
  const caller = await gateways.members.findRoleRequestMember(request.callerId);
  if (caller === null) {
    throw new MemberNotFoundError(request.callerId);
  }
  // Sin orUnavailable: si no se sabe si está al día, no se le sirve el
  // inicio de socio. La puerta se cierra hacia el lado seguro.
  const membership = summarizeMembership(
    await readMembership(gateways.membership, {
      userId: request.callerId,
      now: request.now,
    }),
  );
  return membership.status === "active"
    ? readMemberDashboard(gateways, { ...request, caller, membership })
    : readRestrictedDashboard(gateways, { ...request, caller, membership });
}
