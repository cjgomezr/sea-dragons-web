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
import {
  createConfirmedUser,
  describeSupabaseFailure,
  withSupabaseRetry,
} from "./supabase-retry";

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

/** Una fecha de nacimiento que da 16 años el día en que corre la suite, que es
 * el día en que nace la fila. Una fecha fija no serviría: dentro de dos años
 * esa persona ya no sería menor el día de su registro (#134). */
function minorDateOfBirth(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 16);
  return date.toISOString().slice(0, 10);
}

/** Tiene todos sus datos: lo único que le falta es el consentimiento del
 * tutor, que es el estado de cuenta bloqueada que el ticket pide mirar. */
const FALTA_EL_TUTOR = {
  country: "AU",
  date_of_birth: minorDateOfBirth(),
  membership_type: "Student",
} as const;

export const INCOMPLETE_MEMBERS = {
  "un-dato": FALTA_LA_MEMBRESIA,
  "varios-datos": {
    country: null,
    date_of_birth: null,
    membership_type: null,
  },
  "menor-sin-consentimiento": FALTA_EL_TUTOR,
  /** Lo activa el test que guarda el último dato. */
  "para-activar": FALTA_LA_MEMBRESIA,
  /** Lo activa el test que registra el consentimiento del tutor. */
  "menor-para-consentir": FALTA_EL_TUTOR,
  /** Cierra su propia sesión, que es justo lo que lo inutiliza para todo lo
   * demás. Por eso no lo comparte con nadie. */
  "para-cerrar-sesion": FALTA_LA_MEMBRESIA,
} as const;

export type IncompleteMemberName = keyof typeof INCOMPLETE_MEMBERS;

export const INCOMPLETE_MEMBER_NAMES = Object.keys(
  INCOMPLETE_MEMBERS,
) as readonly IncompleteMemberName[];

/** Los estados de la pantalla que tienen línea base visual: uno con un solo
 * dato pendiente, otro con varios, y el menor que espera a su tutor. Los demás
 * socios existen para tests que los modifican, y una foto suya sería una foto
 * de cuándo corrió cada test. */
export const PHOTOGRAPHED_MEMBERS = [
  "un-dato",
  "varios-datos",
  "menor-sin-consentimiento",
] as const satisfies readonly IncompleteMemberName[];

export function incompleteStorageStatePath(name: IncompleteMemberName): string {
  return path.join(REPO_ROOT, "test-results", `e2e-storage-state-${name}.json`);
}

/**
 * Los socios que un test busca por nombre entre todo el club: el Admin de la
 * pantalla de administración (#212), el socio cuya solicitud decide, y la
 * socia que se busca en el directorio después de subir su foto (#245).
 *
 * Su nombre lleva el sufijo de la corrida (#254). Dos suites a la vez contra
 * `seadragons-dev` sembraban el mismo nombre, y `getByRole` encontraba dos
 * filas. El sufijo sólo va en estos: los socios fotografiados conservan un
 * nombre fijo, porque su pantalla lo dibuja y un sufijo cambiaría la captura
 * en cada corrida. A ellos nadie los busca entre el club, así que un
 * homónimo de otra corrida no les estorba.
 */
export const RUN_NAMED_MEMBERS = {
  "admin-de-administracion": "Admin de administración",
  "socio-para-decidir": "Socio para decidir",
  "perfil-para-foto": "Socia que sube su foto",
} as const;

export type RunNamedMember = keyof typeof RUN_NAMED_MEMBERS;

/** Ocho caracteres de un UUID: de sobra para que dos corridas no coincidan, y
 * cortos para que el nombre siga cabiendo en su fila. */
const RUN_ID_LENGTH = 8;

/** El identificador de una corrida. Lo calcula el arranque global una vez y
 * viaja a los tests dentro del estado de la sesión. */
export function createRunId(): string {
  return randomUUID().slice(0, RUN_ID_LENGTH);
}

function runMemberName(member: RunNamedMember, runId: string): string {
  return `${RUN_NAMED_MEMBERS[member]} ${runId}`;
}

function isRunNamedMember(name: string): name is RunNamedMember {
  return Object.hasOwn(RUN_NAMED_MEMBERS, name);
}

/**
 * Los socios activos que necesitan una fila propia más allá del socio
 * compartido (#209, #212, #241). El compartido no sirve para esto: una
 * solicitud, un rol o una ficha suyos cambiarían lo que fotografían los demás
 * tests de Mi cuenta.
 *
 * La pendiente nace con una fecha fija, para que la captura no cambie con el
 * día en que corre la suite.
 */
/** 17 de septiembre de 2026 a las 18:30 en Melbourne. */
const SEEDED_AUF_VERIFIED_AT = "2026-09-17T08:30:00.000Z";

export const ROLE_REQUEST_MEMBERS = {
  "con-solicitud-pendiente": { pendingRequest: "Coach", columns: {} },
  /** Lo usa el test que envía una solicitud desde el formulario. */
  "para-pedir-rol": { pendingRequest: null, columns: {} },
  /** El único Admin que siembra esta corrida: abre la bandeja del directorio (#212, #240). */
  "admin-de-administracion": {
    pendingRequest: null,
    columns: { role: "Admin" },
  },
  /** Su solicitud es la que un Admin aprueba desde la bandeja. Lleva nombre
   * propio para que el test la señale entre las demás del club. */
  "socio-para-decidir": {
    pendingRequest: "Committee",
    columns: {},
  },
  /** El perfil con la ficha entera (#241). Sus capturas guardan sin cambiar
   * nada, así que varias a la vez escriben lo mismo que ya había. */
  "perfil-completo": {
    pendingRequest: null,
    columns: {
      full_name: "Nerea Ruiz",
      country: "AU",
      position: "Defender",
      experience_level: "Intermediate",
      gender: "female",
    },
  },
  /** Lo usa el test que cambia la ficha y la busca después en el directorio.
   * El país va puesto porque el compartido no lo tiene y sin él no se guarda. */
  "perfil-para-editar": {
    pendingRequest: null,
    columns: { country: "AU" },
  },
  /** El perfil con foto (#245): nace con la foto fija de
   * `tests/support/fixtures`, y sus capturas no la cambian. */
  "perfil-con-foto": {
    pendingRequest: null,
    columns: { full_name: "Lía Fotógrafa", country: "AU" },
  },
  /** Lo usa el test que sube una foto, la busca en el directorio y la quita. */
  "perfil-para-foto": {
    pendingRequest: null,
    columns: { country: "AU" },
  },
  /** El AUF que escribió la socia y ningún Admin ha verificado (#274). */
  "perfil-auf-pendiente": {
    pendingRequest: null,
    columns: {
      full_name: "Irene Pendiente",
      country: "AU",
      auf_number: "AUF-2026-0274",
      auf_expiry: "2030-06-30",
    },
  },
  /** El AUF ya verificado: la pantalla lo enseña sin dejar cambiarlo, y la
   * API rechaza cambiarlo (#274). La fecha es fija para que no dependa del
   * día de la corrida. */
  "perfil-auf-verificado": {
    pendingRequest: null,
    columns: {
      full_name: "Vera Verificada",
      country: "AU",
      auf_number: "AUF-2026-0275",
      auf_expiry: "2030-06-30",
      auf_verified_at: SEEDED_AUF_VERIFIED_AT,
    },
  },
  /** Tiene una posición que el club archivó (#299): la sigue viendo,
   * marcada como retirada. La posición la pone `createTestMembers`. */
  "perfil-posicion-retirada": {
    pendingRequest: null,
    columns: { full_name: "Rita Retirada", country: "AU" },
  },
} as const;

export type RoleRequestMemberName = keyof typeof ROLE_REQUEST_MEMBERS;

/** Los socios de este grupo cuyas pantallas tienen línea base visual. */
export const PHOTOGRAPHED_ROLE_REQUEST_MEMBERS = [
  "perfil-completo",
  "perfil-con-foto",
  "perfil-auf-pendiente",
  "perfil-auf-verificado",
  "perfil-posicion-retirada",
] as const satisfies readonly RoleRequestMemberName[];

/** Las columnas con las que nace uno de estos socios en la corrida `runId`:
 * las suyas, más el nombre de corrida si un test lo busca por nombre. */
export function seededRoleRequestColumns(
  name: RoleRequestMemberName,
  runId: string,
): Readonly<Record<string, string | null>> {
  const { columns } = ROLE_REQUEST_MEMBERS[name];
  if (!isRunNamedMember(name)) {
    return columns;
  }
  return { ...columns, full_name: runMemberName(name, runId) };
}

/** Los socios que nacen con la posición archivada del club (#299). */
const MEMBERS_WITH_ARCHIVED_POSITION: readonly RoleRequestMemberName[] = [
  "perfil-posicion-retirada",
];

/** La posición archivada del club de dev (#299). Queda ahí entre corridas:
 * archivada no le sale a nadie que no la tenga, así que no mueve ninguna otra
 * captura, y borrarla chocaría con otra corrida que la esté usando. */
const ARCHIVED_E2E_POSITION = {
  en: "Utility",
  es: "Comodín",
  /** Detrás de las tres sembradas, que van del 1 al 3. */
  sortOrder: 99,
} as const;

/** Los socios que nacen con foto de perfil (#245). */
const MEMBERS_WITH_PHOTO: readonly RoleRequestMemberName[] = [
  "perfil-con-foto",
];

/** La foto fija de las capturas: siempre la misma, para que no cambien. */
export const PROFILE_PHOTO_FIXTURE_PATH = path.join(
  __dirname,
  "fixtures",
  "foto-de-perfil.png",
);

const ROLE_REQUEST_MEMBER_NAMES = Object.keys(
  ROLE_REQUEST_MEMBERS,
) as readonly RoleRequestMemberName[];

/** 17 de septiembre de 2026 a las 18:30 en Melbourne. */
export const SEEDED_REQUEST_CREATED_AT = "2026-09-17T08:30:00.000Z";

export function roleRequestStorageStatePath(
  name: RoleRequestMemberName,
): string {
  return path.join(
    REPO_ROOT,
    "test-results",
    `e2e-storage-state-rol-${name}.json`,
  );
}

/**
 * El socio de Mi cuenta con grupos (#229), con nombre de grupo del ejemplo del
 * ticket. El compartido sigue sin ninguno, que es la captura "sin grupos".
 *
 * Los nombres son fijos para que la captura no cambie entre corridas, y el
 * nombre es único por club: si el grupo ya existe (otra corrida a la vez, o
 * alguien lo creó en dev) se reutiliza. El cierre sólo borra los que creó esta
 * corrida, y sólo si ya no queda nadie dentro.
 */
export const GROUPED_MEMBER_GROUP_NAMES = [
  "Senior Squad",
  "Masters Squad",
] as const;

export const GROUPED_MEMBER_STORAGE_STATE_PATH = path.join(
  REPO_ROOT,
  "test-results",
  "e2e-storage-state-con-grupos.json",
);

const APP_URL = process.env.APP_URL ?? "http://localhost:3417";

const CLUB_SLUG = "victoria-seadragons";
const MEMBERS_TABLE = "members";
const CLUBS_TABLE = "clubs";
const ROLE_REQUESTS_TABLE = "role_requests";
const GROUPS_TABLE = "groups";
const GROUP_MEMBERSHIPS_TABLE = "group_memberships";
const PHOTOS_BUCKET = "member-photos";
/** El código de Postgres de una violación de unicidad: otra corrida creó el
 * mismo grupo entre la búsqueda y el alta. */
const UNIQUE_VIOLATION_CODE = "23505";

export type E2eSessionState =
  | {
      readonly kind: "available";
      readonly email: string;
      readonly password: string;
      /** El sufijo de los nombres que siembra esta corrida. */
      readonly runId: string;
      /** Todas las identidades que abrió el arranque, la activa y las que
       * están a medias. El cierre las borra sin tener que saber cuál es cuál. */
      readonly userIds: readonly string[];
      /** Los grupos que creó el arranque para el socio con grupos. Sobreviven
       * a sus socios, así que el cierre los borra aparte cuando nadie más los
       * usa. Uno que ya existía no es de la suite y no se toca. */
      readonly createdGroupIds: readonly string[];
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

  const { error } = await withSupabaseRetry(
    "abrir la sesión del socio de prueba",
    () => session.client.auth.signInWithPassword({ email, password }),
  );
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
    ...ROLE_REQUEST_MEMBER_NAMES.map(roleRequestStorageStatePath),
    GROUPED_MEMBER_STORAGE_STATE_PATH,
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

/** El nombre con el que esta corrida sembró a un socio que se busca por
 * nombre. Sin sesión no hay corrida: el nombre base basta, porque los tests
 * que lo usarían se saltan. */
export function seededMemberName(
  state: E2eSessionState,
  member: RunNamedMember,
): string {
  if (state.kind === "unavailable") {
    return RUN_NAMED_MEMBERS[member];
  }
  return runMemberName(member, state.runId);
}

type SeededMember = {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
};

async function findClubId(serviceClient: SupabaseClient): Promise<string> {
  const { data, error } = await withSupabaseRetry("leer el club sembrado", () =>
    serviceClient.from(CLUBS_TABLE).select("id").eq("slug", CLUB_SLUG).single(),
  );
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

  const user = await createConfirmedUser(serviceClient.auth.admin, {
    email,
    password,
    operation: "crear el socio de prueba",
  });

  // Como mensaje y no como throw: si el insert agota el reintento, el usuario
  // ya creado se borra igual y no queda huérfano en dev.
  const memberFailure = await describeSupabaseFailure(
    "crear la fila de miembro de prueba",
    () =>
      serviceClient.from(MEMBERS_TABLE).insert({
        club_id: clubId,
        user_id: user.id,
        full_name: "Socio de prueba",
        email,
        ...columns,
      }),
  );
  if (memberFailure !== null) {
    await deleteTestUser(serviceClient, user.id);
    throw new Error(
      `No se pudo crear la fila de miembro de prueba: ${memberFailure}`,
    );
  }

  return { userId: user.id, email, password };
}

/** Borra una identidad de prueba. Un fallo aquí se registra y no se lanza:
 * quien llama ya está saliendo por otro error, o está limpiando al final, y
 * ese es el resultado que importa. */
async function deleteTestUser(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<void> {
  const failure = await describeSupabaseFailure(
    "borrar el socio de prueba",
    () => serviceClient.auth.admin.deleteUser(userId),
  );
  if (failure !== null) {
    console.error(`No se pudo borrar el socio de prueba ${userId}: ${failure}`);
  }
}

/** Sube la foto fija a la carpeta del socio y la apunta en su ficha, como
 * lo haría el endpoint, pero con la llave de servicio. */
async function seedProfilePhoto(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<void> {
  const photoPath = `${userId}/${randomUUID()}.png`;
  const { error: uploadError } = await serviceClient.storage
    .from(PHOTOS_BUCKET)
    .upload(photoPath, readFileSync(PROFILE_PHOTO_FIXTURE_PATH), {
      contentType: "image/png",
    });
  if (uploadError) {
    throw new Error(
      `No se pudo subir la foto de prueba: ${uploadError.message}`,
    );
  }
  const failure = await describeSupabaseFailure(
    "apuntar la foto de prueba en la ficha",
    () =>
      serviceClient
        .from(MEMBERS_TABLE)
        .update({ photo_path: photoPath })
        .eq("user_id", userId),
  );
  if (failure !== null) {
    throw new Error(`No se pudo apuntar la foto de prueba: ${failure}`);
  }
}

/** Vacía la carpeta de fotos de un socio de prueba. La cascada de `members`
 * no llega a Storage, así que sin esto las fotos se quedarían en dev. */
async function deleteTestPhotos(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<void> {
  const bucket = serviceClient.storage.from(PHOTOS_BUCKET);
  const { data, error } = await bucket.list(userId);
  if (error) {
    console.error(`No se pudo listar las fotos de ${userId}: ${error.message}`);
    return;
  }
  if (data.length === 0) {
    return;
  }
  const { error: removeError } = await bucket.remove(
    data.map((file) => `${userId}/${file.name}`),
  );
  if (removeError) {
    console.error(
      `No se pudo borrar las fotos de ${userId}: ${removeError.message}`,
    );
  }
}

/** La solicitud pendiente con la que nace un socio de Mi cuenta, si lleva
 * una. Se borra con la identidad por las cascadas de 0003 y 0012. */
async function seedPendingRequest(
  serviceClient: SupabaseClient,
  seed: {
    readonly clubId: string;
    readonly userId: string;
    readonly requestedRole: string | null;
  },
): Promise<void> {
  if (seed.requestedRole === null) {
    return;
  }
  const failure = await describeSupabaseFailure(
    "crear la solicitud de rol de prueba",
    () =>
      serviceClient.from(ROLE_REQUESTS_TABLE).insert({
        club_id: seed.clubId,
        user_id: seed.userId,
        requested_role: seed.requestedRole,
        created_at: SEEDED_REQUEST_CREATED_AT,
      }),
  );
  if (failure !== null) {
    await deleteTestUser(serviceClient, seed.userId);
    throw new Error(
      `No se pudo crear la solicitud de rol de prueba: ${failure}`,
    );
  }
}

async function findGroupId(
  serviceClient: SupabaseClient,
  clubId: string,
  name: string,
): Promise<string | null> {
  const { data, error } = await withSupabaseRetry(
    "buscar el grupo de prueba",
    () =>
      serviceClient
        .from(GROUPS_TABLE)
        .select("id")
        .eq("club_id", clubId)
        // Sin distinguir mayúsculas, como el índice único: si dev ya tiene un
        // "senior squad", insertar el nuestro chocaría con él.
        .ilike("name", name)
        .maybeSingle(),
  );
  if (error) {
    throw new Error(`No se pudo buscar el grupo ${name}: ${error.message}`);
  }
  return data === null ? null : (data.id as string);
}

type SeededGroup = { readonly id: string; readonly wasCreated: boolean };

/** El grupo con ese nombre, creado si no existe. Si otra corrida lo crea
 * entre la búsqueda y el alta, el choque con el índice único lo resuelve
 * volviendo a buscar. */
async function findOrCreateGroup(
  serviceClient: SupabaseClient,
  clubId: string,
  name: string,
): Promise<SeededGroup> {
  const existingId = await findGroupId(serviceClient, clubId, name);
  if (existingId !== null) {
    return { id: existingId, wasCreated: false };
  }
  const { data, error } = await withSupabaseRetry(
    "crear el grupo de prueba",
    () =>
      serviceClient
        .from(GROUPS_TABLE)
        .insert({ club_id: clubId, name })
        .select("id")
        .single(),
  );
  if (error?.code === UNIQUE_VIOLATION_CODE) {
    const racedId = await findGroupId(serviceClient, clubId, name);
    if (racedId !== null) {
      return { id: racedId, wasCreated: false };
    }
  }
  if (error || !data) {
    throw new Error(
      `No se pudo crear el grupo ${name}: ${error?.message ?? "sin datos"}`,
    );
  }
  return { id: data.id as string, wasCreated: true };
}

/** Mete al socio en los grupos del ejemplo del ticket y devuelve los ids de
 * los que tuvo que crear. La pertenencia se va con la identidad por las
 * cascadas de 0003 y 0015. */
async function seedGroupMemberships(
  serviceClient: SupabaseClient,
  seed: { readonly clubId: string; readonly userId: string },
): Promise<readonly string[]> {
  const groups: SeededGroup[] = [];
  for (const name of GROUPED_MEMBER_GROUP_NAMES) {
    groups.push(await findOrCreateGroup(serviceClient, seed.clubId, name));
  }
  const failure = await describeSupabaseFailure(
    "meter al socio de prueba en sus grupos",
    () =>
      serviceClient.from(GROUP_MEMBERSHIPS_TABLE).insert(
        groups.map((group) => ({
          club_id: seed.clubId,
          group_id: group.id,
          user_id: seed.userId,
        })),
      ),
  );
  if (failure !== null) {
    throw new Error(`No se pudo meter al socio en sus grupos: ${failure}`);
  }
  return groups.filter((group) => group.wasCreated).map((group) => group.id);
}

/** Borra los grupos de prueba que ya no tienen a nadie dentro. Uno con socios
 * es de otra corrida que sigue en marcha, o de alguien que lo usa en dev. */
async function deleteEmptyGroups(
  serviceClient: SupabaseClient,
  groupIds: readonly string[],
): Promise<void> {
  for (const groupId of groupIds) {
    const { count, error } = await serviceClient
      .from(GROUP_MEMBERSHIPS_TABLE)
      .select("group_id", { count: "exact", head: true })
      .eq("group_id", groupId);
    if (error || count === null) {
      console.error(
        `No se pudo contar quién queda en el grupo ${groupId}: ${error?.message ?? "sin cuenta"}`,
      );
      continue;
    }
    if (count > 0) {
      continue;
    }
    const failure = await describeSupabaseFailure(
      "borrar el grupo de prueba",
      () => serviceClient.from(GROUPS_TABLE).delete().eq("id", groupId),
    );
    if (failure !== null) {
      console.error(`No se pudo borrar el grupo ${groupId}: ${failure}`);
    }
  }
}

async function findArchivedE2ePosition(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from("club_position_names")
    .select("position_id")
    .eq("club_id", clubId)
    .eq("locale", "en")
    .eq("name", ARCHIVED_E2E_POSITION.en)
    .maybeSingle();
  if (error) {
    throw new Error(`No se pudo buscar la posición archivada: ${error.message}`);
  }
  return data === null ? null : (data.position_id as string);
}

/** La crea si falta. Dos corridas a la vez pueden crearla las dos: el índice
 * único de los nombres deja pasar a una, y la otra borra la suya y usa esa. */
async function ensureArchivedE2ePosition(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<string> {
  const existing = await findArchivedE2ePosition(serviceClient, clubId);
  if (existing !== null) {
    return existing;
  }
  const { data: position, error } = await serviceClient
    .from("club_positions")
    .insert({
      club_id: clubId,
      sort_order: ARCHIVED_E2E_POSITION.sortOrder,
      archived_at: SEEDED_AUF_VERIFIED_AT,
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`No se pudo crear la posición archivada: ${error.message}`);
  }
  const { error: namesError } = await serviceClient
    .from("club_position_names")
    .insert(
      (["en", "es"] as const).map((locale) => ({
        position_id: position.id,
        club_id: clubId,
        locale,
        name: ARCHIVED_E2E_POSITION[locale],
      })),
    );
  if (namesError === null) {
    return position.id as string;
  }
  await serviceClient.from("club_positions").delete().eq("id", position.id);
  const winner = await findArchivedE2ePosition(serviceClient, clubId);
  if (winner === null) {
    throw new Error(
      `No se pudo nombrar la posición archivada: ${namesError.message}`,
    );
  }
  return winner;
}

/** El socio activo y uno por cada estado de completar registro, cada uno con
 * su archivo de cookies. Son cuentas distintas porque el estado vive en la
 * fila: no hay forma de cambiarlo desde el navegador a mitad de una corrida. */
async function createTestMembers(): Promise<E2eSessionState> {
  const serviceClient = createServiceRoleClient(process.env);
  const clubId = await findClubId(serviceClient);
  const runId = createRunId();

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

  const archivedPositionId = await ensureArchivedE2ePosition(
    serviceClient,
    clubId,
  );
  for (const name of ROLE_REQUEST_MEMBER_NAMES) {
    const member = await seedMember(serviceClient, clubId, {
      account_status: "active",
      ...seededRoleRequestColumns(name, runId),
      ...(MEMBERS_WITH_ARCHIVED_POSITION.includes(name)
        ? { position_id: archivedPositionId }
        : {}),
    });
    userIds.push(member.userId);
    await seedPendingRequest(serviceClient, {
      clubId,
      userId: member.userId,
      requestedRole: ROLE_REQUEST_MEMBERS[name].pendingRequest,
    });
    if (MEMBERS_WITH_PHOTO.includes(name)) {
      await seedProfilePhoto(serviceClient, member.userId);
    }
    await writeStorageState(
      member.email,
      member.password,
      roleRequestStorageStatePath(name),
    );
  }

  const grouped = await seedMember(serviceClient, clubId, {
    account_status: "active",
  });
  userIds.push(grouped.userId);
  const createdGroupIds = await seedGroupMemberships(serviceClient, {
    clubId,
    userId: grouped.userId,
  });
  await writeStorageState(
    grouped.email,
    grouped.password,
    GROUPED_MEMBER_STORAGE_STATE_PATH,
  );

  return {
    kind: "available",
    email: active.email,
    password: active.password,
    runId,
    userIds,
    createdGroupIds,
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

/** Borra lo que sembró esta corrida, y sólo eso: va por los `userId` que
 * guardó el arranque, así que los socios de otra corrida a la vez siguen en
 * pie aunque se llamen igual. */
export async function deleteSeededMembers(
  serviceClient: SupabaseClient,
  state: Extract<E2eSessionState, { kind: "available" }>,
): Promise<void> {
  for (const userId of state.userIds) {
    await deleteTestPhotos(serviceClient, userId);
    await deleteTestUser(serviceClient, userId);
  }
  // Después de los socios: sus pertenencias se van con ellos, y sólo
  // entonces se sabe qué grupo quedó vacío.
  await deleteEmptyGroups(serviceClient, state.createdGroupIds);
}

/** Lo llama el cierre global de Playwright. Borrar la identidad se lleva por
 * delante su fila de miembro (`on delete cascade`), así que no queda residuo
 * en el proyecto de desarrollo. */
export async function discardE2eSession(): Promise<void> {
  const state = readE2eSessionState();
  if (state.kind === "available") {
    await deleteSeededMembers(createServiceRoleClient(process.env), state);
  }
  rmSync(STATE_PATH, { force: true });
  for (const statePath of everyStorageStatePath()) {
    rmSync(statePath, { force: true });
  }
}
