import {
  ACCOUNT_API_PATH,
  API_V1_PREFIX,
  COMPLETE_REGISTRATION_PATH,
  DASHBOARD_PATH,
  GUARDIAN_CONSENT_API_PATH,
  PUBLIC_API_PATHS,
  PUBLIC_PAGE_PATHS,
  RESTRICTED_ROUTES,
  SIGN_IN_PATH,
} from "./routes";
import { type Role, hasCapability } from "./roles";

/**
 * La decisión de la frontera (NFR-004 y FR-083), sin saber nada de HTTP.
 *
 * - `allow`: la petición sigue su curso.
 * - `redirect`: una pantalla que quien pide no puede ver desde donde está,
 *   sea por su sesión, por su cuenta o por su rol.
 * - `unauthenticated`: un endpoint pedido sin sesión, que responde 401 con el
 *   cuerpo de error de la convención de la API.
 * - `forbidden`: un endpoint pedido por una cuenta que tiene sesión pero
 *   todavía no puede operar, que responde 403 sin hacer el trabajo. Es el caso
 *   que AC-038 nombra y el que la redirección de las pantallas esconde.
 * - `missingCapability`: un endpoint que la matriz de la sección 4 del SRD no
 *   le permite al rol de una cuenta activa. También es un 403, pero se separa
 *   de `forbidden` porque lo que hay que explicarle a quien llama es otro.
 */
export type SessionBoundaryOutcome =
  | { readonly kind: "allow" }
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "missingCapability" };

/**
 * Lo único que la frontera necesita saber de quien pide.
 *
 * `anonymous` cubre también a la cuenta que tiene sesión pero no puede operar
 * (una baja de socio, o una identidad sin fila de miembro): son sesiones que
 * no abren ninguna puerta, así que distinguirlas aquí sería inventar un caso
 * que nadie trata distinto. Quién colapsa en `anonymous` lo decide
 * `session-reader.ts`, que es quien habla con la base.
 *
 * Sólo la cuenta activa lleva rol, porque es la única que llega a la decisión
 * por rol: las otras dos ya se resuelven antes.
 */
export type SessionState =
  | { readonly kind: "anonymous" }
  | { readonly kind: "incomplete" }
  | { readonly kind: "active"; readonly role: Role };

export type SessionBoundaryRequest = {
  readonly pathname: string;
  readonly session: SessionState;
};

/** Compara la ruta con la declarada, sin que `/registros` cuele por parecerse
 * a `/registro`: o es la misma, o cuelga de ella. */
function isPathWithin(pathname: string, declaredPath: string): boolean {
  return pathname === declaredPath || pathname.startsWith(`${declaredPath}/`);
}

function isApiPath(pathname: string): boolean {
  return isPathWithin(pathname, API_V1_PREFIX);
}

/**
 * Una pantalla pública abre también lo que cuelga de ella, porque el registro
 * crecerá en pasos (`/registro/tutor`). Un endpoint público NO: se compara por
 * igualdad, para que `/api/v1/auth/session/loquesea` nazca protegido como
 * cualquier endpoint nuevo. Una pantalla de más es una pantalla; un endpoint
 * de más es una puerta.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PAGE_PATHS.some((publicPage) =>
      isPathWithin(pathname, publicPage),
    ) || PUBLIC_API_PATHS.includes(pathname)
  );
}

function denyWithoutSession(pathname: string): SessionBoundaryOutcome {
  return isApiPath(pathname)
    ? { kind: "unauthenticated" }
    : { kind: "redirect", to: SIGN_IN_PATH };
}

/**
 * Una cuenta `incomplete` sólo alcanza lo que la deja dejar de estarlo: la
 * pantalla de completar registro (y los pasos que cuelguen de ella) y los dos
 * endpoints con los que guarda lo que falta: sus datos y el consentimiento de
 * su tutor. Se comparan por igualdad, como los públicos. Cerrar sesión y
 * reenviar la confirmación le llegan por la lista de rutas públicas, que ya
 * salió antes.
 */
function decideForIncompleteAccount(pathname: string): SessionBoundaryOutcome {
  if (
    isPathWithin(pathname, COMPLETE_REGISTRATION_PATH) ||
    pathname === ACCOUNT_API_PATH ||
    pathname === GUARDIAN_CONSENT_API_PATH
  ) {
    return { kind: "allow" };
  }
  return isApiPath(pathname)
    ? { kind: "forbidden" }
    : { kind: "redirect", to: COMPLETE_REGISTRATION_PATH };
}

/** Si el rol cumple cada capacidad que exigen las rutas restringidas bajo las
 * que cae la petición. Sin ninguna, la ruta es de cualquier cuenta activa. */
function isAllowedForRole(pathname: string, role: Role): boolean {
  return RESTRICTED_ROUTES.filter((route) =>
    isPathWithin(pathname, route.path),
  ).every((route) => hasCapability(role, route.capability));
}

/** Quien ya no tiene nada que completar no vuelve a ver esa pantalla, ni
 * escribiendo la dirección a mano. El endpoint sí se deja pasar: responde por
 * sí mismo que no falta nada, que es un mensaje mejor que un 403 pelado.
 *
 * Una pantalla que el rol no alcanza lleva al panel, que todos los roles ven
 * (AC-007). Un endpoint responde 403 y el handler no llega a ejecutarse. */
function decideForActiveAccount(
  pathname: string,
  role: Role,
): SessionBoundaryOutcome {
  if (isPathWithin(pathname, COMPLETE_REGISTRATION_PATH)) {
    return { kind: "redirect", to: DASHBOARD_PATH };
  }
  if (isAllowedForRole(pathname, role)) {
    return { kind: "allow" };
  }
  return isApiPath(pathname)
    ? { kind: "missingCapability" }
    : { kind: "redirect", to: DASHBOARD_PATH };
}

export function decideSessionBoundary({
  pathname,
  session,
}: SessionBoundaryRequest): SessionBoundaryOutcome {
  if (isPublicPath(pathname)) {
    return { kind: "allow" };
  }
  // El orden es el de las fronteras: sin sesión, luego cuenta incompleta, y
  // sólo una cuenta activa llega a la decisión por rol.
  switch (session.kind) {
    case "anonymous":
      return denyWithoutSession(pathname);
    case "incomplete":
      return decideForIncompleteAccount(pathname);
    case "active":
      return decideForActiveAccount(pathname, session.role);
  }
}
