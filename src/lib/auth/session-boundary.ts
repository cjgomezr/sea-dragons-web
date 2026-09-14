import {
  ACCOUNT_API_PATH,
  API_V1_PREFIX,
  COMPLETE_REGISTRATION_PATH,
  DASHBOARD_PATH,
  GUARDIAN_CONSENT_API_PATH,
  PUBLIC_API_PATHS,
  PUBLIC_PAGE_PATHS,
  SIGN_IN_PATH,
} from "./routes";

/**
 * La decisión de la frontera (NFR-004 y FR-083), sin saber nada de HTTP.
 *
 * - `allow`: la petición sigue su curso.
 * - `redirect`: una pantalla que quien pide no puede ver desde donde está.
 * - `unauthenticated`: un endpoint pedido sin sesión, que responde 401 con el
 *   cuerpo de error de la convención de la API.
 * - `forbidden`: un endpoint pedido por una cuenta que tiene sesión pero
 *   todavía no puede operar, que responde 403 sin hacer el trabajo. Es el caso
 *   que AC-038 nombra y el que la redirección de las pantallas esconde.
 */
export type SessionBoundaryOutcome =
  | { readonly kind: "allow" }
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" };

/**
 * Lo único que la frontera necesita saber de quien pide.
 *
 * `anonymous` cubre también a la cuenta que tiene sesión pero no puede operar
 * (una baja de socio, o una identidad sin fila de miembro): son sesiones que
 * no abren ninguna puerta, así que distinguirlas aquí sería inventar un caso
 * que nadie trata distinto. Quién colapsa en `anonymous` lo decide
 * `session-reader.ts`, que es quien habla con la base.
 */
export type SessionState = "anonymous" | "incomplete" | "active";

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

/** Quien ya no tiene nada que completar no vuelve a ver esa pantalla, ni
 * escribiendo la dirección a mano. El endpoint sí se deja pasar: responde por
 * sí mismo que no falta nada, que es un mensaje mejor que un 403 pelado. */
function decideForActiveAccount(pathname: string): SessionBoundaryOutcome {
  return isPathWithin(pathname, COMPLETE_REGISTRATION_PATH)
    ? { kind: "redirect", to: DASHBOARD_PATH }
    : { kind: "allow" };
}

export function decideSessionBoundary({
  pathname,
  session,
}: SessionBoundaryRequest): SessionBoundaryOutcome {
  if (isPublicPath(pathname)) {
    return { kind: "allow" };
  }
  switch (session) {
    case "anonymous":
      return denyWithoutSession(pathname);
    case "incomplete":
      return decideForIncompleteAccount(pathname);
    case "active":
      return decideForActiveAccount(pathname);
  }
}
