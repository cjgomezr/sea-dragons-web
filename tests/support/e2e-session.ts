import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { assertTestSupabaseEnvironment } from "@/lib/supabase/environment-guard";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { createSessionClient } from "@/lib/supabase/session-client";
import { loadLocalEnvFile } from "./load-local-env";
import { decideSupabaseCredentials } from "./supabase-credentials";

/**
 * Los socios de prueba con los que Playwright entra a la aplicación.
 *
 * Son varios porque lo que cada uno puede ver depende del estado de SU fila:
 * el activo llega a la aplicación entera, y los que están a medias sólo a
 * completar registro. Ese estado no se cambia desde el navegador, así que la
 * suite abre una cuenta por pantalla que necesita fotografiar.
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
 * Cuando el entorno no tiene credenciales de Supabase (una máquina sin
 * `.env.local`), el estado queda `unavailable` con las variables que faltan, y
 * los tests que necesitan sesión se saltan diciendo cuáles son. Lo que no hace
 * es inventarse una sesión: una puerta de mentira en los tests vale menos que
 * no probar la puerta. En CI ese salto no se admite y el arranque falla (ver
 * `decideSupabaseCredentials`): allí las credenciales están, y saltarse
 * dejaría el check en verde sin haber comparado ninguna captura.
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

/**
 * Los socios a medias que necesita la suite (#133). Cada uno existe para un
 * caso concreto, y son cuentas distintas porque el estado vive en la fila: qué
 * le falta a una cuenta no se elige desde el navegador.
 *
 * Los que un test MODIFICA van aparte de los que se fotografían. La suite
 * corre en paralelo, así que un test que activa la cuenta que otro está
 * fotografiando produciría una regresión visual que no es de nadie.
 *
 * Todos nacen con el correo ya confirmado. Sin confirmar no habría nada que
 * fotografiar: Supabase no da sesión a una identidad sin confirmar, así que
 * esa cuenta ni siquiera llega a la pantalla.
 */
const FALTA_LA_MEMBRESIA = {
  country: "AU",
  date_of_birth: "1994-03-02",
  membership_type: null,
} as const;

export const INCOMPLETE_MEMBERS = {
  "un-dato": FALTA_LA_MEMBRESIA,
  "varios-datos": {
    country: null,
    date_of_birth: null,
    membership_type: null,
  },
  /** Lo activa el test que guarda el último dato. */
  "para-activar": FALTA_LA_MEMBRESIA,
  /** Cierra su propia sesión, que es justo lo que lo inutiliza para todo lo
   * demás. Por eso no lo comparte con nadie. */
  "para-cerrar-sesion": FALTA_LA_MEMBRESIA,
} as const;

export type IncompleteMemberName = keyof typeof INCOMPLETE_MEMBERS;

export const INCOMPLETE_MEMBER_NAMES = Object.keys(
  INCOMPLETE_MEMBERS,
) as readonly IncompleteMemberName[];

/** Los estados de la pantalla que tienen línea base visual: uno con un solo
 * dato pendiente y otro con varios. Los demás socios existen para tests que
 * los modifican, y una foto suya sería una foto de cuándo corrió cada test. */
export const PHOTOGRAPHED_MEMBERS = [
  "un-dato",
  "varios-datos",
] as const satisfies readonly IncompleteMemberName[];

export function incompleteStorageStatePath(name: IncompleteMemberName): string {
  return path.join(REPO_ROOT, "test-results", `e2e-storage-state-${name}.json`);
}

const APP_URL = process.env.APP_URL ?? "http://localhost:3417";

const CLUB_SLUG = "victoria-seadragons";
const MEMBERS_TABLE = "members";
const CLUBS_TABLE = "clubs";

export type E2eSessionState =
  | {
      readonly kind: "available";
      readonly email: string;
      readonly password: string;
      /** Todas las identidades que abrió el arranque, la activa y las que
       * están a medias. El cierre las borra sin tener que saber cuál es cuál. */
      readonly userIds: readonly string[];
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
  statePath: string,
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
  writeJson(statePath, { cookies, origins: [] });
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
    for (const statePath of everyStorageStatePath()) {
      writeJson(statePath, { cookies: [], origins: [] });
    }
  }
}

function everyStorageStatePath(): readonly string[] {
  return [
    E2E_STORAGE_STATE_PATH,
    ...INCOMPLETE_MEMBER_NAMES.map(incompleteStorageStatePath),
  ];
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

type SeededMember = {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
};

async function findClubId(serviceClient: SupabaseClient): Promise<string> {
  const { data, error } = await serviceClient
    .from(CLUBS_TABLE)
    .select("id")
    .eq("slug", CLUB_SLUG)
    .single();
  if (error || !data) {
    throw new Error(
      `No se pudo leer el club sembrado: ${error?.message ?? "sin datos"}`,
    );
  }
  return data.id as string;
}

/** Crea una identidad ya confirmada y su fila de socio. Las columnas que
 * distinguen a un socio de otro llegan en `columns`: lo demás es idéntico,
 * porque lo que cambia entre los socios de prueba es qué les falta. */
async function seedMember(
  serviceClient: SupabaseClient,
  clubId: string,
  columns: Readonly<Record<string, string | null>>,
): Promise<SeededMember> {
  const email = `e2e-${randomUUID()}@example.test`;
  const password = randomUUID();

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
      club_id: clubId,
      user_id: data.user.id,
      full_name: "Socio de prueba",
      email,
      ...columns,
    });
  if (memberError) {
    await serviceClient.auth.admin.deleteUser(data.user.id);
    throw new Error(
      `No se pudo crear la fila de miembro de prueba: ${memberError.message}`,
    );
  }

  return { userId: data.user.id, email, password };
}

/** El socio activo y uno por cada estado de completar registro, cada uno con
 * su archivo de cookies. Son cuentas distintas porque el estado vive en la
 * fila: no hay forma de cambiarlo desde el navegador a mitad de una corrida. */
async function createTestMembers(): Promise<E2eSessionState> {
  const serviceClient = createServiceRoleClient(process.env);
  const clubId = await findClubId(serviceClient);

  const active = await seedMember(serviceClient, clubId, {
    account_status: "active",
  });
  await writeStorageState(
    active.email,
    active.password,
    E2E_STORAGE_STATE_PATH,
  );

  const userIds = [active.userId];
  for (const name of INCOMPLETE_MEMBER_NAMES) {
    const member = await seedMember(serviceClient, clubId, {
      account_status: "incomplete",
      ...INCOMPLETE_MEMBERS[name],
    });
    userIds.push(member.userId);
    await writeStorageState(
      member.email,
      member.password,
      incompleteStorageStatePath(name),
    );
  }

  return {
    kind: "available",
    email: active.email,
    password: active.password,
    userIds,
  };
}

/** Lo llama el arranque global de Playwright, antes de cualquier test. */
export async function prepareE2eSession(): Promise<void> {
  loadLocalEnvFile();
  // El mismo guardia que `vitest.setup.ts`: la suite no crea usuarios en
  // ningún proyecto de Supabase que no sea el de desarrollo.
  assertTestSupabaseEnvironment();

  const decision = decideSupabaseCredentials(process.env);
  if (decision.kind === "skip") {
    writeState({ kind: "unavailable", reason: decision.reason });
    return;
  }
  writeState(await createTestMembers());
}

/** Lo llama el cierre global de Playwright. Borrar la identidad se lleva por
 * delante su fila de miembro (`on delete cascade`), así que no queda residuo
 * en el proyecto de desarrollo. */
export async function discardE2eSession(): Promise<void> {
  const state = readE2eSessionState();
  if (state.kind === "available") {
    const serviceClient = createServiceRoleClient(process.env);
    for (const userId of state.userIds) {
      await serviceClient.auth.admin.deleteUser(userId);
    }
  }
  rmSync(STATE_PATH, { force: true });
  for (const statePath of everyStorageStatePath()) {
    rmSync(statePath, { force: true });
  }
}
