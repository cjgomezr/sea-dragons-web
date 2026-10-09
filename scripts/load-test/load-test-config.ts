import type { Options } from "k6/options";
import {
  LOAD_TEST_PASSWORD,
  LOGIN_IDENTITY_COUNT,
  type SeedRole,
  seedEmailOf,
  seedRoleOf,
} from "./seed-dataset.ts";

/**
 * Los números de la prueba de carga (#525, RF-7 y RF-8 del PRD de E16b). Los
 * lee k6 para sus umbrales y el informe para su veredicto, así que los dos
 * miden contra lo mismo.
 *
 * Los imports llevan la extensión `.ts` porque k6 no la adivina.
 */

/** NFR-001: 50 usuarios a la vez. */
export const VIRTUAL_USERS = 50;
/** RF-7: la prueba mide al menos 5 minutos. */
export const MINIMUM_MEASURED_MINUTES = 5;
/** Un minuto más de escenario para los 50 inicios de sesión del arranque:
 * así lo medido después sigue pasando de los 5 minutos. */
const SIGN_IN_MARGIN_MINUTES = 1;
/** NFR-001: el 95% de las peticiones por debajo de 1 segundo. */
export const P95_LIMIT_MS = 1000;
/** RF-7: la prueba falla si fallan más del 1% de las peticiones. */
export const MAX_ERROR_RATE = 0.01;
/** NFR-002 (AC-019c): el reparto automático tiene 2 segundos. */
export const TEAM_BALANCE_P95_LIMIT_MS = 2000;

/** Cada petición lleva una fase. Solo el recorrido cuenta para NFR-001: el
 * inicio de sesión ocurre una vez por usuario y el reparto tiene su propio
 * límite. */
export const SIGN_IN_PHASE = "sign-in";
export const JOURNEY_PHASE = "journey";
export const TEAM_BALANCE_PHASE = "team-balance";

/** El nombre de cada petición en el informe. Agrupa por ruta, no por URL:
 * cada evento tiene la suya y el informe quiere una fila por endpoint. */
export const MEASURED_REQUESTS = {
  signIn: "POST /api/v1/auth/session",
  dashboardPage: "GET /dashboard",
  dashboard: "GET /api/v1/dashboard",
  unreadCount: "GET /api/v1/notifications/unread-count",
  calendarPage: "GET /calendario",
  events: "GET /api/v1/events",
  eventDetail: "GET /api/v1/events/[id]",
  rsvp: "PUT /api/v1/events/[id]/rsvp",
  directoryPage: "GET /directorio",
  directory: "GET /api/v1/directory",
  attendancePage: "GET /asistencia",
  attendanceSessions: "GET /api/v1/attendance/sessions",
  attendanceSheet: "GET /api/v1/attendance/[eventId]",
  clubAttendanceRate: "GET /api/v1/attendance/club-rate",
  ownAttendance: "GET /api/v1/account/attendance",
  newsPage: "GET /noticias",
  news: "GET /api/v1/news",
  newsPost: "GET /api/v1/news/[id]",
  notifications: "GET /api/v1/notifications",
  paymentsPage: "GET /pagos",
  membership: "GET /api/v1/membership",
  teamBalance: "POST /api/v1/teams/[eventId]/auto-balance",
} as const;

export type SignInIdentity = {
  readonly email: string;
  readonly password: string;
  readonly role: SeedRole;
};

/** La identidad sembrada del usuario virtual `virtualUser` (k6 cuenta desde
 * 1). Cada usuario virtual es un socio distinto. */
export function signInIdentityOf(virtualUser: number): SignInIdentity {
  const index = virtualUser - 1;
  if (!Number.isInteger(index) || index < 0 || index >= LOGIN_IDENTITY_COUNT) {
    throw new Error(
      `El usuario virtual ${virtualUser} no tiene identidad sembrada: solo hay ${LOGIN_IDENTITY_COUNT}.`,
    );
  }
  return {
    email: seedEmailOf(index),
    password: LOAD_TEST_PASSWORD,
    role: seedRoleOf(index),
  };
}

/** Las opciones de k6. Los umbrales hacen fallar a k6 por sí mismo; el
 * informe repite el veredicto con los mismos números y dice qué fue lento. */
export function buildLoadTestOptions(): Options {
  return {
    scenarios: {
      club: {
        executor: "constant-vus",
        vus: VIRTUAL_USERS,
        duration: `${MINIMUM_MEASURED_MINUTES + SIGN_IN_MARGIN_MINUTES}m`,
      },
    },
    // Una página sin sesión redirige a /entrar, que contesta 200. Sin seguir
    // la redirección, esa respuesta cuenta como el error que es.
    maxRedirects: 0,
    thresholds: {
      [`http_req_duration{phase:${JOURNEY_PHASE}}`]: [`p(95)<${P95_LIMIT_MS}`],
      [`http_req_failed{phase:${JOURNEY_PHASE}}`]: [`rate<${MAX_ERROR_RATE}`],
      [`http_req_duration{phase:${TEAM_BALANCE_PHASE}}`]: [
        `p(95)<${TEAM_BALANCE_P95_LIMIT_MS}`,
      ],
      [`http_req_failed{phase:${TEAM_BALANCE_PHASE}}`]: [
        `rate<${MAX_ERROR_RATE}`,
      ],
    },
  };
}
