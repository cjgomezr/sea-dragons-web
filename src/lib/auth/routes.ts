import type { Capability } from "./roles";

/**
 * Las rutas que la frontera de sesión necesita nombrar, en un solo sitio.
 *
 * Las tres pantallas públicas son exactamente las que el PRD de E2 declara
 * (RF-7): registro, inicio de sesión y recuperación de contraseña. Todo lo
 * demás exige sesión, así que esta lista es la frontera entera: alargarla es
 * abrir la aplicación, y hacerlo sin querer se nota aquí y en ningún otro
 * sitio.
 *
 * El olvido contrario también se paga, y ya se pagó: la primera versión de
 * estas listas no incluyó los caminos con los que se crea una cuenta, así que
 * en producción el registro respondía 401 mientras el formulario se seguía
 * dibujando igual. Una pantalla pública cuyo formulario llama a un endpoint
 * protegido no es una pantalla pública. Al declarar una, comprueba a dónde
 * escribe.
 */

/** La "pantalla de entrada" del ticket: donde aterriza quien no tiene sesión
 * y donde vuelve quien la cierra. */
export const SIGN_IN_PATH = "/entrar";

/** La pantalla del ticket #132. Aquí solo se declara pública. */
export const REGISTRATION_PATH = "/registro";

/** La pantalla del ticket #136. Aquí solo se declara pública: sin esto, quien
 * olvidó la contraseña no podría llegar a pedirla, que es justo el caso en el
 * que nunca va a tener sesión. */
export const PASSWORD_RECOVERY_PATH = "/recuperar-contrasena";

/** La pantalla del ticket #133: la única que alcanza una cuenta `incomplete`,
 * y a la que la frontera manda todo lo demás que esa cuenta pida. */
export const COMPLETE_REGISTRATION_PATH = "/completar-registro";

/** El panel principal: el destino de una cuenta activa, y el de quien pide una
 * pantalla que su rol no alcanza. Por eso no puede restringirse nunca: sería
 * una redirección sin fin. */
export const DASHBOARD_PATH = "/dashboard";

/** Mi cuenta (#209): el rol de quien la abre y la solicitud de Coach o
 * Committee (FR-010). Pedir un rol no es una fila de la matriz, así que la
 * alcanza cualquier cuenta activa, sea cual sea su rol, y por eso no aparece
 * en `RESTRICTED_ROUTES`. E5 la convierte después en el perfil. */
export const ACCOUNT_PAGE_PATH = "/cuenta";

/** La pantalla mínima de administración (#212, RF-8): la bandeja de
 * solicitudes pendientes y la lista de socios con su rol. Sólo la alcanza
 * quien gestiona usuarios y roles. E5 la absorbe en el directorio completo. */
export const ADMINISTRATION_PATH = "/administracion";

/** El endpoint de las solicitudes de rol. Su POST está abierto a los cuatro
 * roles, igual que Mi cuenta: el propio dominio responde a quien no tiene nada
 * que pedir. Por eso la ruta NO aparece en `RESTRICTED_ROUTES`, y la bandeja
 * que sirve su GET comprueba la capacidad en el handler: la frontera decide
 * por camino, no por método, y aquí los dos métodos no coinciden en quién
 * puede usarlos. */
export const ROLE_REQUESTS_API_PATH = "/api/v1/role-requests";

/** Aprobar o rechazar una solicitud (#210, FR-011). `[id]` es un segmento
 * dinámico, escrito como en la carpeta de la ruta: la frontera lo casa con
 * cualquier segmento no vacío. Sólo lo alcanza quien gestiona usuarios y
 * roles, aunque cuelgue de un endpoint abierto a los cuatro. */
export const ROLE_REQUEST_DECISION_API_PATH = `${ROLE_REQUESTS_API_PATH}/[id]/decision`;

/** Los socios del club (#212, RF-8). Todo lo que cuelga de este camino es de
 * quien gestiona usuarios y roles: el listado de la pantalla de administración
 * y el cambio de rol de abajo. El directorio que E5 abrirá a cualquier socio
 * (FR-015) tendrá que decidir entonces qué abre, y por eso el cambio de rol se
 * declara además por su cuenta. */
export const MEMBERS_API_PATH = "/api/v1/members";

/** Cambiar el rol de un socio (#211, FR-014). `[id]` es el `user_id` del
 * socio. Sólo lo alcanza quien gestiona usuarios y roles. */
export const MEMBER_ROLE_API_PATH = `${MEMBERS_API_PATH}/[id]/role`;

/** Los grupos del club (#226, E4). Todo lo que cuelga de este camino es de
 * quien gestiona grupos: crear, listar, renombrar y borrar, y también asignar
 * y quitar socios cuando llegue su ticket. */
export const GROUPS_API_PATH = "/api/v1/groups";

/** El team builder (FR-043). */
export const TEAMS_PATH = "/equipos";

/** Las evaluaciones. Un Player no las ve, ni las propias (FR-055). */
export const EVALUATIONS_PATH = "/evaluaciones";

/** El destino del enlace del correo de confirmación (#132). No es una
 * pantalla del PRD: canjea el token y redirige. Es público por definición,
 * porque quien abre ese enlace todavía no puede iniciar sesión.
 *
 * Va en la lista de pantallas a sabiendas de que esa lista abre también lo que
 * cuelga de la ruta. Hoy no cuelga nada, y `/auth` a secas sigue protegida. Si
 * alguna vez nace algo bajo este camino, nacerá público sin que nadie lo
 * decida, y ahí toca compararlo por igualdad en vez de por prefijo. */
export const EMAIL_CONFIRMATION_PATH = "/auth/confirmar";

export const PUBLIC_PAGE_PATHS: readonly string[] = [
  SIGN_IN_PATH,
  REGISTRATION_PATH,
  PASSWORD_RECOVERY_PATH,
  EMAIL_CONFIRMATION_PATH,
];

/** Lo consulta el monitoreo cada 5 minutos desde fuera y sin autenticarse. Si
 * la frontera lo cerrara, el monitoreo avisaría de una caída que no existe. */
export const HEALTH_API_PATH = "/api/v1/health";

/** El endpoint con el que se consigue y se tira una sesión. Exigirle sesión
 * dejaría la aplicación sin puerta de entrada. */
export const SESSION_API_PATH = "/api/v1/auth/session";

/** El endpoint que crea la cuenta. Quien se registra no tiene sesión todavía,
 * por definición: protegerlo dejaba la pantalla pública de registro con un
 * formulario que sólo podía responder 401. */
export const REGISTER_API_PATH = "/api/v1/auth/register";

/** El reenvío del correo de confirmación. Lo pide la pantalla de registro
 * justo después de crear la cuenta, cuando todavía no hay sesión, y la de
 * completar registro cuando la confirmación es lo que falta. */
export const CONFIRMATION_EMAIL_API_PATH = "/api/v1/auth/confirmation-email";

/** La cuenta de quien llama: qué le falta (GET) y cómo se completa (PATCH).
 * Es el único endpoint que una cuenta `incomplete` puede usar además de los
 * públicos, porque es con el que deja de estarlo. */
export const ACCOUNT_API_PATH = "/api/v1/auth/account";

/** El consentimiento del tutor de un socio menor (#134). Es otro de los
 * pendientes de una cuenta `incomplete`, así que la frontera la deja pasar
 * igual que al de la cuenta. */
export const GUARDIAN_CONSENT_API_PATH = `${ACCOUNT_API_PATH}/guardian-consent`;

/** El destino del enlace del correo de recuperación (#136). Cuelga de
 * `PASSWORD_RECOVERY_PATH`, así que ya es pública por prefijo; se nombra para
 * que el enlace que se manda y la pantalla que lo recibe no se desincronicen. */
export const PASSWORD_RESET_PATH = `${PASSWORD_RECOVERY_PATH}/nueva`;

/** El parámetro con el que el enlace lleva el token hasta esa pantalla. */
export const RESET_TOKEN_QUERY_PARAM = "token_hash";

/** Pedir el enlace de recuperación. Quien lo pide ha perdido la contraseña,
 * así que por definición no tiene sesión. */
export const PASSWORD_RECOVERY_API_PATH = "/api/v1/auth/password-recovery";

/** Fijar la contraseña nueva con el token del enlace. El token es la
 * credencial: exigir además una sesión lo haría imposible de usar. */
export const PASSWORD_RESET_API_PATH = "/api/v1/auth/password-reset";

/**
 * Los únicos endpoints de la API que no exigen sesión.
 *
 * La lista es explícita y no un prefijo de `/api/v1/auth/`: un endpoint nuevo
 * nace protegido, y si de verdad tiene que ser público hay que escribirlo
 * aquí. El fallo de olvidarse es un 401 que se ve en cuanto se prueba; el de
 * un prefijo abierto es un endpoint público que nadie nota.
 */
export const PUBLIC_API_PATHS: readonly string[] = [
  HEALTH_API_PATH,
  SESSION_API_PATH,
  REGISTER_API_PATH,
  CONFIRMATION_EMAIL_API_PATH,
  PASSWORD_RECOVERY_API_PATH,
  PASSWORD_RESET_API_PATH,
];

export const API_V1_PREFIX = "/api/v1";

/** Una ruta que sólo alcanza el rol que tiene la capacidad de la matriz. */
export type RestrictedRoute = {
  readonly path: string;
  readonly capability: Capability;
};

/**
 * Qué capacidad exige cada ruta restringida, pantallas y endpoints juntos
 * (FR-013, NFR-004). Una ruta restringe también todo lo que cuelga de ella,
 * y si una petición cae bajo varias, tiene que cumplirlas todas. Un segmento
 * entre corchetes (`[id]`) casa con cualquier segmento no vacío.
 *
 * Los endpoints se declaran aquí y no en `createApiRoute` por dos motivos. El
 * primero es que el proxy ya leyó el rol en la misma consulta que el estado
 * de la cuenta: comprobarlo otra vez en el handler sería una segunda lectura
 * de `members` por petición. El segundo es que así un endpoint restringido no
 * depende de que su handler se acuerde de pedirlo, y la frontera entera se lee
 * en este archivo.
 *
 * Lo que no esté aquí lo alcanza cualquier cuenta activa. Olvidar una ruta la
 * deja abierta, así que al crear una pantalla o un endpoint que la matriz
 * limita, se declara en el mismo cambio.
 */
export const RESTRICTED_ROUTES: readonly RestrictedRoute[] = [
  { path: TEAMS_PATH, capability: "buildTeamsAndTrackAttendance" },
  { path: EVALUATIONS_PATH, capability: "viewEvaluations" },
  { path: ADMINISTRATION_PATH, capability: "manageUsersAndRoles" },
  { path: ROLE_REQUEST_DECISION_API_PATH, capability: "manageUsersAndRoles" },
  { path: MEMBERS_API_PATH, capability: "manageUsersAndRoles" },
  // Cuelga del anterior, así que hoy no añade nada. Se declara igual porque es
  // el de arriba el que E5 va a abrir al directorio, y el día que lo haga el
  // cambio de rol tiene que seguir siendo sólo de un Admin sin que nadie se
  // acuerde de escribir esta línea.
  { path: MEMBER_ROLE_API_PATH, capability: "manageUsersAndRoles" },
  { path: GROUPS_API_PATH, capability: "manageGroups" },
];
