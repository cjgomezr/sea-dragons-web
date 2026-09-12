import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { findMissingSupabaseKeys } from "@/lib/supabase/config";
import { assertTestSupabaseEnvironment } from "@/lib/supabase/environment-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { createSessionClient } from "@/lib/supabase/session-client";
import { loadLocalEnvFile } from "./load-local-env";

/**
 * El socio de prueba con el que Playwright entra a la aplicación.
 *
 * Desde este ticket la cáscara con menú está detrás de la frontera de sesión,
 * así que un navegador sin sesión ya no la ve: aterriza en la pantalla de
 * entrada. Las capturas de la barra de pestañas, del menú lateral y de las
 * secciones necesitan, por tanto, una sesión de verdad.
 *
 * Se crea con la llave de servicio contra `seadragons-dev` y se borra al
 * terminar. No manda ningún correo: la identidad nace confirmada, que es lo
 * que `admin.createUser` permite.
 *
 * Cuando el entorno no tiene credenciales de Supabase (el caso de un runner
 * de CI sin secretos), el estado queda `unavailable` con las variables que
 * faltan, y los tests que necesitan sesión se saltan diciendo cuáles son. Lo
 * que no hace es inventarse una sesión: una puerta de mentira en los tests
 * vale menos que no probar la puerta.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
/** `test-results/` ya está en .gitignore y lo borra cada corrida: es el sitio
 * de un archivo con una credencial de usar y tirar. */
const STATE_PATH = path.join(REPO_ROOT, "test-results", "e2e-session.json");

/**
 * Las cookies de la única sesión que abre la suite, en el formato que
 * Playwright carga con `storageState`.
 *
 * Es una sola a propósito. La primera versión abría sesión en cada test y la
 * cuarentena de intentos que trae Supabase Auth empezaba a responder que no a
 * mitad de la corrida: nueve tests caíos por un límite que está bien puesto.
 * Ese límite es el que el ticket dice que no se reimplementa, así que lo que
 * cambia es la suite, no el límite.
 */
export const E2E_STORAGE_STATE_PATH = path.join(
  REPO_ROOT,
  "test-results",
  "e2e-storage-state.json",
);

const APP_URL = process.env.APP_URL ?? "http://localhost:3417";

const CLUB_SLUG = "victoria-seadragons";
const MEMBERS_TABLE = "members";
const CLUBS_TABLE = "clubs";

export type E2eSessionState =
  | {
      readonly kind: "available";
      readonly email: string;
      readonly password: string;
      readonly userId: string;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

/** La forma que pide Playwright. Su `sameSite` va en mayúscula inicial y el
 * de la cabecera `Set-Cookie` en minúscula, que es la única traducción con
 * miga de todo esto. */
type BrowserCookie = {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "Strict" | "Lax" | "None";
};

const SAME_SITE_BY_OPTION: Readonly<Record<string, BrowserCookie["sameSite"]>> =
  {
    strict: "Strict",
    lax: "Lax",
    none: "None",
  };

/** Cookie de sesión: vive lo que viva el navegador, que para una corrida de
 * tests es de sobra y evita traducir maxAge a un instante absoluto. */
const SESSION_COOKIE_EXPIRY = -1;

function toBrowserCookie(cookie: {
  readonly name: string;
  readonly value: string;
  readonly options: {
    readonly path?: string;
    readonly httpOnly?: boolean;
    readonly secure?: boolean;
    readonly sameSite?: boolean | string;
  };
}): BrowserCookie {
  const { options } = cookie;
  return {
    name: cookie.name,
    value: cookie.value,
    domain: new URL(APP_URL).hostname,
    path: options.path ?? "/",
    expires: SESSION_COOKIE_EXPIRY,
    httpOnly: options.httpOnly ?? false,
    secure: options.secure ?? false,
    sameSite:
      typeof options.sameSite === "string"
        ? (SAME_SITE_BY_OPTION[options.sameSite.toLowerCase()] ?? "Lax")
        : "Lax",
  };
}

/** Abre la sesión una sola vez y guarda sus cookies. No pasa por el servidor
 * de la aplicación: el mismo cliente que usa la API en producción sabe
 * emitirlas, y así el arranque no depende de que el dev server ya escuche. */
async function writeStorageState(
  email: string,
  password: string,
): Promise<void> {
  const session = createSessionClient(process.env, []);
  if (session.kind === "unconfigured") {
    throw new Error(
      `Faltan variables de entorno para abrir la sesión de prueba: ${session.missingKeys.join(", ")}`,
    );
  }

  const { error } = await session.client.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    throw new Error(
      `No se pudo abrir la sesión del socio de prueba: ${error.message}`,
    );
  }

  const cookies = session.recorder.recorded().cookies.map(toBrowserCookie);
  if (cookies.length === 0) {
    throw new Error(
      "La sesión de prueba se abrió pero no dejó ninguna cookie que dar al navegador.",
    );
  }
  writeJson(E2E_STORAGE_STATE_PATH, { cookies, origins: [] });
}

function writeJson(file: string, contents: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(contents), "utf8");
}

function writeState(state: E2eSessionState): void {
  writeJson(STATE_PATH, state);
  if (state.kind === "unavailable") {
    // Playwright carga el archivo al crear cada contexto, tenga o no sesión
    // que meter: sin él, los tests que se van a saltar fallarían antes de
    // llegar a saltarse.
    writeJson(E2E_STORAGE_STATE_PATH, { cookies: [], origins: [] });
  }
}

/** El estado que dejó `prepareE2eSession`. Sin archivo, la suite no pasó por
 * el arranque global: es un error de configuración, no un entorno sin
 * credenciales, y decirlo así ahorra media hora de búsqueda. */
export function readE2eSessionState(): E2eSessionState {
  if (!existsSync(STATE_PATH)) {
    return {
      kind: "unavailable",
      reason:
        "el arranque global de Playwright no dejó el estado de la sesión de prueba",
    };
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as E2eSessionState;
}

async function createTestMember(): Promise<E2eSessionState> {
  const serviceClient = createServiceRoleClient(process.env);
  const email = `e2e-${randomUUID()}@example.test`;
  const password = randomUUID();

  const { data: club, error: clubError } = await serviceClient
    .from(CLUBS_TABLE)
    .select("id")
    .eq("slug", CLUB_SLUG)
    .single();
  if (clubError || !club) {
    throw new Error(
      `No se pudo leer el club sembrado: ${clubError?.message ?? "sin datos"}`,
    );
  }

  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `No se pudo crear el socio de prueba: ${error?.message ?? "sin datos"}`,
    );
  }

  const { error: memberError } = await serviceClient
    .from(MEMBERS_TABLE)
    .insert({
      club_id: club.id,
      user_id: data.user.id,
      full_name: "Socio de prueba",
      email,
      account_status: "active",
    });
  if (memberError) {
    await serviceClient.auth.admin.deleteUser(data.user.id);
    throw new Error(
      `No se pudo crear la fila de miembro de prueba: ${memberError.message}`,
    );
  }

  return { kind: "available", email, password, userId: data.user.id };
}

/** Lo llama el arranque global de Playwright, antes de cualquier test. */
export async function prepareE2eSession(): Promise<void> {
  loadLocalEnvFile();
  // El mismo guardia que `vitest.setup.ts`: la suite no crea usuarios en
  // ningún proyecto de Supabase que no sea el de desarrollo.
  assertTestSupabaseEnvironment();

  const missingKeys = findMissingSupabaseKeys(process.env);
  if (missingKeys.length > 0) {
    writeState({
      kind: "unavailable",
      reason: `faltan variables de entorno de Supabase: ${missingKeys.join(", ")}`,
    });
    return;
  }
  const state = await createTestMember();
  writeState(state);
  if (state.kind === "available") {
    await writeStorageState(state.email, state.password);
  }
}

/** Lo llama el cierre global de Playwright. Borrar la identidad se lleva por
 * delante su fila de miembro (`on delete cascade`), así que no queda residuo
 * en el proyecto de desarrollo. */
export async function discardE2eSession(): Promise<void> {
  const state = readE2eSessionState();
  if (state.kind === "available") {
    await createServiceRoleClient(process.env).auth.admin.deleteUser(
      state.userId,
    );
  }
  rmSync(STATE_PATH, { force: true });
  rmSync(E2E_STORAGE_STATE_PATH, { force: true });
}
