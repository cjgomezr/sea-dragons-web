import type { ClubAttendanceRateGateways } from "@/lib/attendance/club-attendance-rate";
import {
  type SeasonAttendance,
  type SeasonAttendanceGateway,
  readSeasonAttendance,
} from "@/lib/attendance/season-attendance";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import {
  type AgendaPeriod,
  type EventAgendaGateways,
  listAgenda,
} from "@/lib/events/event-agenda";
import {
  type MembershipBlock,
  type MembershipGateway,
  type MembershipPlan,
  type MembershipReading,
  membershipBlockOfStatus,
  readMembership,
} from "@/lib/membership/membership";
import { nextChargeOf } from "@/lib/membership/membership-view";
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
import { clubCalendarDate } from "@/lib/time/club-calendar";
import {
  type AgendaWindow,
  type DashboardNextUpEvent,
  type StaffNextUpEvent,
  type WeekEvent,
  findNextUpCandidate,
  listWeekEvents,
  readNextUpEvent,
} from "./dashboard-events";
import {
  type ClubAttendanceTrend,
  type DashboardTodo,
  type TodoGateways,
  listTodos,
  readClubAttendanceTrend,
  seesManagementColumn,
} from "./dashboard-management";
import { firstNameOf } from "./dashboard-view";

export type {
  ClubAttendanceTrend,
  DashboardTodo,
} from "./dashboard-management";
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
 * inicio reducido: el saludo, el motivo y lo que hay, sin responder. Vale
 * para todos los roles: el personal conserva sus pantallas de gestión desde
 * el menú, no desde el inicio.
 *
 * Los dos inicios llevan el aviso de los datos de contacto que faltan (#498,
 * RF-2 del PRD de E19): no depende de tener la membresía al día.
 *
 * El rediseño de E27 (#745) añade a los dos el próximo evento, la semana, la
 * membresía y las noticias. Al inicio reducido las noticias le llegan sólo
 * con el título, la categoría y la fecha (D2). Las teselas, la lista de
 * próximos y el próximo entrenamiento del inicio de E14 ya no salen (#752).
 *
 * Los dos llevan también la asistencia de la temporada de quien mira (#746,
 * D13). Admin, Coach y Committee al día reciben además la columna de
 * gestión: los pendientes y los números del club (D3, D9, D11).
 */

/** Cuántas noticias enseña el inicio (FR-077). */
export const DASHBOARD_LIST_SIZE = 3;

export type Unavailable = { readonly kind: "unavailable" };

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

/** Lo de quien mira (D13): null sin sesiones elegibles en la temporada. */
export type DashboardMe = {
  readonly attendance: SeasonAttendance | null | Unavailable;
};

/** Vacía si no hay nada pendiente. */
export type DashboardTodos = readonly DashboardTodo[] | Unavailable;

export type ClubMembersNumbers = {
  readonly active: number;
  /** Los activos que se unieron desde el día 1 del mes del club. */
  readonly joinedThisMonth: number;
};

export type ClubUnreadNews = {
  readonly count: number;
  readonly announcements: number;
};

/** Los números del club de la columna de gestión (D11). */
export type ClubNumbers = {
  readonly attendance: ClubAttendanceTrend | Unavailable;
  readonly members: ClubMembersNumbers | Unavailable;
  readonly unreadNews: ClubUnreadNews | Unavailable;
};

/** Un Player no recibe ni los pendientes ni los números (D3). */
export type PlayerColumn = { readonly column: "player" };

export type ManagementColumn = {
  readonly column: "management";
  readonly todos: DashboardTodos;
  readonly club: ClubNumbers;
};

/** El inicio de un socio al día. */
export type MemberDashboard = (PlayerColumn | ManagementColumn) & {
  readonly kind: "member";
  readonly viewer: DashboardViewer;
  readonly me: DashboardMe;
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
  readonly me: DashboardMe;
  /** Por qué: lo que dice el aviso que lleva a Pagos. */
  readonly block: MembershipBlock;
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
  | "members"
  | "agenda"
  | "next_up"
  | "news"
  | "news_seen"
  | "contact"
  | "season_attendance"
  | "todos"
  | "club_attendance";

export type DashboardFailureLog = {
  report(source: DashboardSource, error: unknown): void;
};

export type DashboardGateways = TodoGateways & {
  readonly members: RoleRequestGateways["members"];
  /** Sólo la tasa: de ella salen los números del club (D11). */
  readonly clubRate: ClubAttendanceRateGateways["clubRate"];
  readonly agenda: EventAgendaGateways;
  readonly news: NewsGateways;
  readonly roster: DashboardRosterGateway;
  readonly membership: MembershipGateway;
  readonly myTeam: MyTeamGateways;
  readonly seasonAttendance: SeasonAttendanceGateway;
  readonly failures: DashboardFailureLog;
};

export type DashboardRequest = {
  readonly callerId: string;
  readonly now: Date;
};

const UNAVAILABLE: Unavailable = { kind: "unavailable" };

/** La primera página de próximos y la de pasados: 50 eventos sobran para
 * encontrar el próximo y la semana, y los pasados recientes son
 * donde está un evento de varios días que sigue en curso (D4). Uno que
 * empezó antes de los 50 pasados más recientes no se ve: para este club no
 * pasa. */
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
 * ya está en el log, y sin saber qué es nuevo es mejor no marcar ninguna que
 * marcarlas todas. */
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

async function countUnreadNews(
  gateways: DashboardGateways,
  request: DashboardRequest & {
    readonly firstPage: NewsFeedPage;
    readonly seenAt: string | null;
  },
): Promise<ClubUnreadNews> {
  const sinceMs = newsUnreadCutoff(request.seenAt, request.now);
  const unread = await countUnreadFrom(gateways, {
    callerId: request.callerId,
    page: request.firstPage,
    sinceMs,
    now: request.now,
  });
  return addPinnedUnread(unread, request.firstPage, sinceMs);
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
  readonly nextUp: NextUp;
  readonly week: Week;
};

const UNAVAILABLE_EVENT_PARTS: EventParts = {
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
  return {
    nextUp: await readNextUp(gateways, { ...request, window }),
    week: { kind: "week", events: listWeekEvents(window, request.now) },
  };
}

/** La primera página del feed y la marca de visita: las noticias del inicio
 * y la cuenta sin leer de la gestión salen de las dos. */
type NewsReads = {
  readonly firstPage: NewsFeedPage | Unavailable;
  readonly seenAt: string | null | Unavailable;
};

async function readNews(
  gateways: DashboardGateways,
  request: DashboardRequest,
): Promise<NewsReads> {
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
  return { firstPage, seenAt };
}

function toLatestNews({ firstPage, seenAt }: NewsReads, now: Date): LatestNews {
  if (isUnavailable(firstPage)) {
    return firstPage;
  }
  return toMemberLatestNews(
    firstPage,
    isUnavailable(seenAt) ? null : newsUnreadCutoff(seenAt, now),
  );
}

/** Sin el feed o sin la marca de visita no se sabe cuántas hay; el fallo ya
 * está en el log. */
async function readUnreadNews(
  gateways: DashboardGateways,
  request: DashboardRequest & { readonly news: NewsReads },
): Promise<ClubUnreadNews | Unavailable> {
  const { firstPage, seenAt } = request.news;
  if (isUnavailable(firstPage) || isUnavailable(seenAt)) {
    return UNAVAILABLE;
  }
  return orUnavailable(
    gateways,
    "news",
    countUnreadNews(gateways, { ...request, firstPage, seenAt }),
  );
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

type CallerRequest = DashboardRequest & { readonly caller: DashboardCaller };

async function readMe(
  gateways: DashboardGateways,
  request: CallerRequest,
): Promise<DashboardMe> {
  const attendance = await orUnavailable(
    gateways,
    "season_attendance",
    readSeasonAttendance(gateways.seasonAttendance, {
      clubId: request.caller.clubId,
      userId: request.callerId,
      today: clubCalendarDate(request.now),
    }),
  );
  return { attendance };
}

/** Sin el próximo evento no se sabe si falta publicar el reparto ni quién
 * no ha respondido: los pendientes caen con él. Su fallo ya está en el log. */
async function readTodos(
  gateways: DashboardGateways,
  request: CallerRequest & { readonly nextUp: NextUp },
): Promise<DashboardTodos> {
  const { nextUp } = request;
  if (isUnavailable(nextUp)) {
    return UNAVAILABLE;
  }
  return orUnavailable(
    gateways,
    "todos",
    listTodos(gateways, {
      callerId: request.callerId,
      clubId: request.caller.clubId,
      role: request.caller.role,
      now: request.now,
      nextEvent: nextUp.kind === "none" ? null : nextUp,
    }),
  );
}

/** El día 1 del mes de `today`, los dos días del club en YYYY-MM-DD. */
function firstOfMonthOf(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

async function readClubMembers(
  gateways: DashboardGateways,
  request: { readonly clubId: string; readonly today: string },
): Promise<ClubMembersNumbers> {
  const counts = await gateways.roster.countActiveMembers({
    clubId: request.clubId,
    joinedSince: firstOfMonthOf(request.today),
  });
  return { active: counts.active, joinedThisMonth: counts.joinedRecently };
}

async function readClubNumbers(
  gateways: DashboardGateways,
  request: CallerRequest & { readonly news: Promise<NewsReads> },
): Promise<ClubNumbers> {
  const scope = {
    clubId: request.caller.clubId,
    today: clubCalendarDate(request.now),
  };
  const [attendance, members, unreadNews] = await Promise.all([
    orUnavailable(
      gateways,
      "club_attendance",
      readClubAttendanceTrend(gateways.clubRate, scope),
    ),
    orUnavailable(gateways, "members", readClubMembers(gateways, scope)),
    request.news.then((news) => readUnreadNews(gateways, { ...request, news })),
  ]);
  return { attendance, members, unreadNews };
}

/** La columna de gestión espera al próximo evento y a la primera página de
 * noticias, que ya se piden para el resto del inicio. */
async function readColumn(
  gateways: DashboardGateways,
  request: CallerRequest & {
    readonly eventParts: Promise<EventParts>;
    readonly news: Promise<NewsReads>;
  },
): Promise<PlayerColumn | ManagementColumn> {
  if (!seesManagementColumn(request.caller.role)) {
    return { column: "player" };
  }
  const [todos, club] = await Promise.all([
    request.eventParts.then(({ nextUp }) =>
      readTodos(gateways, { ...request, nextUp }),
    ),
    readClubNumbers(gateways, request),
  ]);
  return { column: "management", todos, club };
}

async function readMemberDashboard(
  gateways: DashboardGateways,
  request: DashboardRequest & {
    readonly caller: DashboardCaller;
    readonly membership: ActiveMembershipSummary;
  },
): Promise<MemberDashboard> {
  const eventPartsRead = readEventParts(gateways, {
    ...request,
    isRestricted: false,
  });
  const newsRead = readNews(gateways, request);
  const [eventParts, news, contactReminder, me, column] = await Promise.all([
    eventPartsRead,
    newsRead,
    readContactReminder(gateways, request.callerId),
    readMe(gateways, request),
    readColumn(gateways, {
      ...request,
      eventParts: eventPartsRead,
      news: newsRead,
    }),
  ]);
  return {
    kind: "member",
    ...column,
    viewer: { firstName: firstNameOf(request.caller.fullName) },
    me,
    latestNews: toLatestNews(news, request.now),
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
  const [eventParts, contactReminder, latestNews, me] = await Promise.all([
    readEventParts(gateways, { ...request, isRestricted: true }),
    readContactReminder(gateways, request.callerId),
    readRestrictedNews(gateways, request),
    readMe(gateways, request),
  ]);
  return {
    kind: "restricted",
    viewer: { firstName: firstNameOf(request.caller.fullName) },
    me,
    block: request.membership.block,
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
