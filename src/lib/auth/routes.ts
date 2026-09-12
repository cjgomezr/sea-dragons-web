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

/** La pantalla del ticket #133. El inicio de sesión manda aquí a las cuentas
 * `incomplete`, así que la ruta tiene que existir como destino antes que la
 * pantalla. */
export const COMPLETE_REGISTRATION_PATH = "/completar-registro";

/** El panel principal: el destino de una cuenta activa. */
export const DASHBOARD_PATH = "/dashboard";

/** El destino del enlace del correo de confirmación (#132). No es una
 * pantalla del PRD: canjea el token y redirige. Es público por definición,
 * porque quien abre ese enlace todavía no puede iniciar sesión. */
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

/**
 * Los únicos endpoints de la API que no exigen sesión.
 *
 * La lista es explícita y no un prefijo de `/api/v1/auth/`: un endpoint nuevo
 * nace protegido, y si de verdad tiene que ser público hay que escribirlo
 * aquí. El fallo de olvidarse es un 401 que se ve en cuanto se prueba; el de
 * un prefijo abierto es un endpoint público que nadie nota.
 */
/** Con el que se crea la cuenta (#132). Exigirle sesión deja al club sin
 * forma de dar de alta a nadie: hay que tener cuenta para poder crearse una. */
export const REGISTER_API_PATH = "/api/v1/auth/register";

/** Reenvía la confirmación (#132). Lo pide quien no recibió el correo, que es
 * exactamente quien todavía no puede tener sesión. */
export const CONFIRMATION_EMAIL_API_PATH = "/api/v1/auth/confirmation-email";

export const PUBLIC_API_PATHS: readonly string[] = [
  HEALTH_API_PATH,
  SESSION_API_PATH,
  REGISTER_API_PATH,
  CONFIRMATION_EMAIL_API_PATH,
];

export const API_V1_PREFIX = "/api/v1";
