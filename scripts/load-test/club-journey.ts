import { sleep } from "k6";
import exec from "k6/execution";
import http, { type RefinedResponse, type ResponseType } from "k6/http";
import type { Options } from "k6/options";
import {
  JOURNEY_PHASE,
  MEASURED_REQUESTS,
  SIGN_IN_PHASE,
  type SignInIdentity,
  TEAM_BALANCE_PHASE,
  buildLoadTestOptions,
  signInIdentityOf,
} from "./load-test-config.ts";

/**
 * El recorrido de un socio por la aplicación, para k6 (#525). Cada usuario
 * virtual inicia sesión una vez con su identidad sembrada y después da vueltas
 * por inicio, calendario con RSVP, directorio, asistencia, noticias,
 * notificaciones y Pagos. Su tarro de cookies guarda la sesión entre vueltas.
 *
 * Se lanza con `k6 run`, no con Node: los imports `k6/*` solo existen dentro
 * de k6.
 */

export const options: Options = buildLoadTestOptions();

// k6 da por buena cualquier respuesta por debajo de 400. Aquí una redirección
// es un fallo: la página mandó a /entrar o a /pagos en lugar de pintarse.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }));

const BASE_URL = __ENV.APP_URL || "http://localhost:3417";
/** Lo que un socio tarda entre pantalla y pantalla. */
const THINK_TIME_SECONDS = 1;
/** Un RSVP a un evento que ya empezó da 422. Dos días de margen sobre la
 * fecha UTC dejan fuera cualquier evento de hoy en Melbourne. */
const RSVP_SAFETY_DAYS = 2;
const DAY_MS = 86_400_000;
const RSVP_RESPONSES = ["yes", "maybe", "no"] as const;
/** Variantes del directorio con filtros que cualquier rol puede usar. */
const DIRECTORY_QUERIES = [
  "role=Player&sort=attendance&direction=desc",
  "q=Ma",
  "sort=position",
  "role=Coach&sort=name&direction=asc",
] as const;

type RequestName = (typeof MEASURED_REQUESTS)[keyof typeof MEASURED_REQUESTS];
type Phase =
  typeof SIGN_IN_PHASE | typeof JOURNEY_PHASE | typeof TEAM_BALANCE_PHASE;

type AgendaEvent = {
  readonly id: string;
  readonly startsOn: string;
  readonly status: string;
  readonly inAudience: boolean;
  readonly goingCount: number;
};

type SessionCookies = Readonly<Record<string, string>>;

type Visitor = {
  readonly identity: SignInIdentity;
  readonly cookies: SessionCookies;
};

/** Por usuario virtual: k6 da a cada uno su propia copia del módulo. */
let visitor: Visitor | null = null;

function tagsOf(name: RequestName, phase: Phase = JOURNEY_PHASE) {
  return { tags: { name, phase } };
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function get(name: RequestName, path: string) {
  return http.get(`${BASE_URL}${path}`, tagsOf(name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** El `data` del sobre de la API, o `null` si la respuesta no lo trae. */
function readData(response: RefinedResponse<ResponseType>): unknown {
  if (response.status !== 200) return null;
  const body: unknown = response.json();
  return isRecord(body) ? body.data : null;
}

function readList(data: unknown, key: string): unknown[] {
  if (!isRecord(data)) return [];
  const list = data[key];
  return Array.isArray(list) ? list : [];
}

function readIds(data: unknown, listKey: string, idKey: string): string[] {
  return readList(data, listKey)
    .map((item) => (isRecord(item) ? item[idKey] : null))
    .filter((id): id is string => typeof id === "string");
}

function isAgendaEvent(value: unknown): value is AgendaEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.startsOn === "string" &&
    typeof value.status === "string" &&
    typeof value.inAudience === "boolean" &&
    typeof value.goingCount === "number"
  );
}

function pickAny<T>(items: readonly T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}

/** Sin sesión no hay prueba: seguir midiría 401 en lugar de la aplicación. */
function signIn(identity: SignInIdentity): void {
  const response = http.post(
    `${BASE_URL}/api/v1/auth/session`,
    JSON.stringify({ email: identity.email, password: identity.password }),
    {
      headers: JSON_HEADERS,
      ...tagsOf(MEASURED_REQUESTS.signIn, SIGN_IN_PHASE),
    },
  );
  if (response.status !== 200) {
    exec.test.abort(
      `${identity.email} no pudo iniciar sesión (HTTP ${response.status}): ¿se sembró el club de NFR-008?`,
    );
  }
}

/** Las cookies de la aplicación tal como están ahora en el tarro. Guarda la
 * última de cada nombre: el proxy puede haberlas refrescado. */
function currentCookies(): SessionCookies {
  const cookies = http.cookieJar().cookiesForURL(BASE_URL);
  return Object.fromEntries(
    Object.entries(cookies).flatMap(([name, values]) => {
      const latest = values[values.length - 1];
      return latest === undefined ? [] : [[name, latest]];
    }),
  );
}

/** k6 vacía el tarro de cookies al empezar cada iteración. Sin devolverle la
 * sesión, desde la segunda vuelta todo contestaría 401. */
function restoreCookies(cookies: SessionCookies): void {
  const jar = http.cookieJar();
  for (const [name, value] of Object.entries(cookies)) {
    jar.set(BASE_URL, name, value);
  }
}

function ensureSignedIn(): Visitor {
  if (visitor) {
    restoreCookies(visitor.cookies);
    return visitor;
  }
  const identity = signInIdentityOf(exec.vu.idInTest);
  signIn(identity);
  visitor = { identity, cookies: currentCookies() };
  return visitor;
}

function keepSession(signedIn: Visitor): void {
  visitor = { ...signedIn, cookies: currentCookies() };
}

/** Inicio. Devuelve si la membresía está al día: un socio con la cuota
 * pendiente ve el inicio restringido y no puede usar directorio ni noticias. */
function visitHome(): boolean {
  get(MEASURED_REQUESTS.dashboardPage, "/dashboard");
  const dashboard = readData(
    get(MEASURED_REQUESTS.dashboard, "/api/v1/dashboard"),
  );
  get(MEASURED_REQUESTS.unreadCount, "/api/v1/notifications/unread-count");
  return isRecord(dashboard) && dashboard.kind === "member";
}

function upcomingEvents(): AgendaEvent[] {
  const data = readData(
    get(MEASURED_REQUESTS.events, "/api/v1/events?period=upcoming"),
  );
  return readList(data, "events").filter(isAgendaEvent);
}

function canRespondTo(event: AgendaEvent): boolean {
  const earliest = new Date(Date.now() + RSVP_SAFETY_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return (
    event.inAudience &&
    event.status === "scheduled" &&
    event.startsOn > earliest
  );
}

function answerEvent(eventId: string): void {
  http.put(
    `${BASE_URL}/api/v1/events/${eventId}/rsvp`,
    JSON.stringify({ response: pickAny(RSVP_RESPONSES) }),
    { headers: JSON_HEADERS, ...tagsOf(MEASURED_REQUESTS.rsvp) },
  );
}

/** Calendario y detalle de evento; responde solo si la cuota está al día. */
function visitCalendar(isMembershipCurrent: boolean): AgendaEvent[] {
  get(MEASURED_REQUESTS.calendarPage, "/calendario");
  const events = upcomingEvents();
  const event = pickAny(events.filter(canRespondTo));
  if (!event) return events;
  get(MEASURED_REQUESTS.eventDetail, `/api/v1/events/${event.id}`);
  if (isMembershipCurrent) answerEvent(event.id);
  return events;
}

function visitDirectory(): void {
  get(MEASURED_REQUESTS.directoryPage, "/directorio");
  const query =
    DIRECTORY_QUERIES[exec.vu.iterationInScenario % DIRECTORY_QUERIES.length];
  get(MEASURED_REQUESTS.directory, `/api/v1/directory?${query}`);
}

/** Admin y Coach pasan lista y ven las estadísticas del club. */
function visitAttendance(): void {
  get(MEASURED_REQUESTS.attendancePage, "/asistencia");
  const sessions = readData(
    get(MEASURED_REQUESTS.attendanceSessions, "/api/v1/attendance/sessions"),
  );
  const eventId = pickAny(readIds(sessions, "sessions", "eventId"));
  if (eventId) {
    get(MEASURED_REQUESTS.attendanceSheet, `/api/v1/attendance/${eventId}`);
  }
  get(MEASURED_REQUESTS.clubAttendanceRate, "/api/v1/attendance/club-rate");
}

function visitNews(): void {
  get(MEASURED_REQUESTS.newsPage, "/noticias");
  const news = readData(get(MEASURED_REQUESTS.news, "/api/v1/news"));
  const postId = pickAny(readIds(news, "posts", "id"));
  if (postId) get(MEASURED_REQUESTS.newsPost, `/api/v1/news/${postId}`);
}

function visitPayments(): void {
  get(MEASURED_REQUESTS.paymentsPage, "/pagos");
  get(MEASURED_REQUESTS.membership, "/api/v1/membership");
}

/** RF-8: el Coach reparte el evento con más confirmados de los suyos. */
function balanceTeams(events: readonly AgendaEvent[]): void {
  const fullest = events
    .filter((event) => canRespondTo(event) && event.goingCount > 0)
    .reduce<AgendaEvent | null>(
      (best, event) =>
        best === null || event.goingCount > best.goingCount ? event : best,
      null,
    );
  if (!fullest) return;
  http.post(`${BASE_URL}/api/v1/teams/${fullest.id}/auto-balance`, null, {
    ...tagsOf(MEASURED_REQUESTS.teamBalance, TEAM_BALANCE_PHASE),
  });
}

export default function clubJourney(): void {
  const signedIn = ensureSignedIn();
  const { identity } = signedIn;
  const isMembershipCurrent = visitHome();
  sleep(THINK_TIME_SECONDS);
  const events = visitCalendar(isMembershipCurrent);
  sleep(THINK_TIME_SECONDS);
  if (isMembershipCurrent) {
    visitDirectory();
    sleep(THINK_TIME_SECONDS);
    visitNews();
    sleep(THINK_TIME_SECONDS);
  }
  if (identity.role === "Admin" || identity.role === "Coach") {
    visitAttendance();
    sleep(THINK_TIME_SECONDS);
  }
  if (identity.role === "Coach") balanceTeams(events);
  get(MEASURED_REQUESTS.ownAttendance, "/api/v1/account/attendance");
  get(MEASURED_REQUESTS.notifications, "/api/v1/notifications");
  sleep(THINK_TIME_SECONDS);
  visitPayments();
  keepSession(signedIn);
  sleep(THINK_TIME_SECONDS);
}
