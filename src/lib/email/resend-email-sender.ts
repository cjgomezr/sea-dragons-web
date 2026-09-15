import { readStringAt } from "@/lib/api/read-string-at";
import type {
  EmailProviderProbe,
  EmailProviderStatus,
} from "./email-delivery-availability";

/**
 * El envío de correo transaccional por Resend (INT-006). Es de servidor: lee
 * una clave secreta, y el chequeo del bundle falla si este módulo llega al
 * navegador.
 *
 * Habla con la API HTTP de Resend con `fetch` y no con su SDK: es una sola
 * petición, y no justifica una dependencia más en tiempo de ejecución.
 */

/** El nombre que usa el propio SDK de Resend, decidido en el issue #137. */
export const RESEND_API_KEY_ENV = "RESEND_API_KEY";
/** Sin prefijo del proveedor, para que cambiar de proveedor no obligue a
 * renombrarla. */
export const EMAIL_FROM_ENV = "EMAIL_FROM";

export const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

/** Dónde se pegan las dos variables, con las mismas palabras que
 * `entornos.json` usa para el ámbito Production. */
const EMAIL_VARIABLES_LOCATION =
  "Vercel, proyecto victoria-seadragons, Settings, Environment Variables, ámbito Production";

/** Un proveedor que no contesta no puede dejar colgada la petición del socio
 * hasta que la plataforma la corte: pasado este plazo, es un envío fallido. */
const SEND_TIMEOUT_MS = 10_000;

type Environment = Readonly<Record<string, string | undefined>>;

export type OutgoingEmail = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

/** `id` es el identificador que Resend da al envío: con él se busca en su
 * panel qué pasó con ese correo. */
export type SentEmail = { readonly id: string };

/** Lanza `EmailDeliveryError` si el correo no sale. */
export type EmailSender = {
  sendEmail(email: OutgoingEmail): Promise<SentEmail>;
};

export type EmailSenderConnection =
  | { readonly kind: "connected"; readonly sender: EmailSender }
  | { readonly kind: "not_connected"; readonly reason: string };

export class EmailDeliveryError extends Error {
  /** El estado HTTP de Resend, o `undefined` si la petición ni llegó. */
  readonly status: number | undefined;

  constructor(
    message: string,
    options: { readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(message);
    this.name = "EmailDeliveryError";
    this.status = options.status;
    this.cause = options.cause;
  }
}

type ResendConnection = {
  readonly apiKey: string;
  readonly from: string;
  readonly fetchImplementation: typeof fetch;
};

function readVariable(env: Environment, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function describeMissingVariables(missing: readonly string[]): string {
  return `El envío de correos no está configurado: faltan ${missing.join(", ")}. Se ponen en ${EMAIL_VARIABLES_LOCATION}; ver docs/entornos.md.`;
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function postToResend(
  connection: ResendConnection,
  email: OutgoingEmail,
): Promise<Response> {
  try {
    return await connection.fetchImplementation(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: connection.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    throw new EmailDeliveryError(
      `No se pudo hablar con Resend: ${describeCause(error)}`,
      { cause: error },
    );
  }
}

/** Un cuerpo que no es JSON (una página de error de un proxy, por ejemplo) no
 * es un fallo aparte: la respuesta ya dice por su estado si el envío salió, y
 * el cuerpo sólo añade detalle cuando lo hay. */
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** El estado con el nombre y el mensaje del error de Resend, cuando los hay. */
function describeResendAnswer(status: number, body: unknown): string {
  const name = readStringAt(body, ["name"]);
  const message = readStringAt(body, ["message"]);
  const detail = [
    name === null ? "" : ` (${name})`,
    message === null ? "" : `: ${message}`,
  ].join("");
  return `${status}${detail}`;
}

function describeRejection(status: number, body: unknown): string {
  return `Resend rechazó el envío con ${describeResendAnswer(status, body)}`;
}

async function sendThroughResend(
  connection: ResendConnection,
  email: OutgoingEmail,
): Promise<SentEmail> {
  const response = await postToResend(connection, email);
  const body = await readJsonBody(response);
  if (!response.ok) {
    throw new EmailDeliveryError(describeRejection(response.status, body), {
      status: response.status,
    });
  }

  const id = readStringAt(body, ["id"]);
  if (id === null) {
    throw new EmailDeliveryError(
      `Resend respondió ${response.status} sin el identificador del envío, así que no hay constancia de que saliera.`,
      { status: response.status },
    );
  }
  return { id };
}

/** Devuelve las variables que faltan en vez de lanzar, para que quien llama
 * decida: la recuperación responde 503 nombrándolas, y el registro sigue y lo
 * deja en el registro del servidor. */
export function connectResendEmailSender(
  env: Environment,
  fetchImplementation: typeof fetch = fetch,
): EmailSenderConnection {
  const apiKey = readVariable(env, RESEND_API_KEY_ENV);
  const from = readVariable(env, EMAIL_FROM_ENV);
  if (apiKey === null || from === null) {
    return {
      kind: "not_connected",
      reason: describeMissingVariables([
        ...(apiKey === null ? [RESEND_API_KEY_ENV] : []),
        ...(from === null ? [EMAIL_FROM_ENV] : []),
      ]),
    };
  }

  const connection: ResendConnection = { apiKey, from, fetchImplementation };
  return {
    kind: "connected",
    sender: { sendEmail: (email) => sendThroughResend(connection, email) },
  };
}

/** Una consulta de sólo lectura: la sonda no manda nada a nadie (#154). */
export const RESEND_PROBE_ENDPOINT = "https://api.resend.com/domains";

/** Más corto que el del envío: la sonda va antes de responder a todo el que
 * se registra, y un proveedor que tarda tanto ya no está disponible. */
const PROBE_TIMEOUT_MS = 3_000;

const SERVER_ERROR_MIN_STATUS = 500;

/** Los errores de Resend que hablan de la clave, en minúsculas porque su
 * documentación mezcla mayúsculas (`invalid_api_Key`). Son los únicos que
 * prueban que no podemos enviar. */
const KEY_FAILURE_ERRORS: ReadonlySet<string> = new Set([
  "missing_api_key",
  "invalid_api_key",
  "suspended_api_key",
]);

/** Contestar, aunque sea con un rechazo, es estar en pie: la pregunta de la
 * sonda es si Resend responde y si nuestra clave sirve. Por eso la regla es
 * una lista negra y no una lista blanca. Equivocarse hacia "en pie" sólo
 * devuelve el texto neutro del #147, que es lo que había antes de este
 * ticket; equivocarse hacia "caído" deja a todo el mundo sin registrarse. Por
 * ejemplo, la clave de producción sólo envía y `GET /domains` le responde un
 * rechazo que no habla de una clave rota. */
function isProviderAnswering(response: Response, body: unknown): boolean {
  if (response.status >= SERVER_ERROR_MIN_STATUS) {
    return false;
  }
  const errorName = readStringAt(body, ["name"])?.toLowerCase() ?? "";
  return !KEY_FAILURE_ERRORS.has(errorName);
}

async function probeResend(
  apiKey: string,
  fetchImplementation: typeof fetch,
): Promise<EmailProviderStatus> {
  let response: Response;
  try {
    response = await fetchImplementation(RESEND_PROBE_ENDPOINT, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      kind: "unreachable",
      reason: `No se pudo hablar con Resend: ${describeCause(error)}`,
    };
  }
  const body = await readJsonBody(response);
  if (isProviderAnswering(response, body)) {
    return { kind: "reachable" };
  }
  return {
    kind: "unreachable",
    reason: `La sonda de Resend respondió ${describeResendAnswer(response.status, body)}`,
  };
}

/** Cuánto vale un "está en pie". La sonda corre antes de responder a todo el
 * que se registra, y sin esto cada registro gasta dos de las dos peticiones
 * por segundo que permite Resend: la sonda y el envío de verdad. Con dos
 * registros en el mismo segundo, el envío se llevaba el 429 y ese correo se
 * perdía. Sólo se recuerda el resultado bueno: una caída tiene que poder
 * recuperarse en la petición siguiente. Es un dato global, igual para toda
 * dirección, así que no reabre el oráculo del #147. */
const REACHABLE_CACHE_MS = 10_000;

export function createResendProviderProbe(
  env: Environment,
  fetchImplementation: typeof fetch = fetch,
  now: () => number = Date.now,
): EmailProviderProbe {
  let reachableUntil = 0;
  return {
    async probeProvider() {
      if (now() < reachableUntil) {
        return { kind: "reachable" };
      }
      const apiKey = readVariable(env, RESEND_API_KEY_ENV);
      if (apiKey === null) {
        return {
          kind: "unreachable",
          reason: describeMissingVariables([RESEND_API_KEY_ENV]),
        };
      }
      const status = await probeResend(apiKey, fetchImplementation);
      if (status.kind === "reachable") {
        reachableUntil = now() + REACHABLE_CACHE_MS;
      }
      return status;
    },
  };
}
