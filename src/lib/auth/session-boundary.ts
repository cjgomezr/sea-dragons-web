import {
  API_V1_PREFIX,
  PUBLIC_API_PATHS,
  PUBLIC_PAGE_PATHS,
  SIGN_IN_PATH,
} from "./routes";

/**
 * La decisión de la frontera de sesión (NFR-004), sin saber nada de HTTP.
 *
 * - `allow`: la petición sigue su curso.
 * - `redirect`: una pantalla pedida sin sesión, que aterriza en la entrada.
 * - `unauthenticated`: un endpoint pedido sin sesión, que responde 401 con el
 *   cuerpo de error de la convención de la API.
 */
export type SessionBoundaryOutcome =
  | { readonly kind: "allow" }
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "unauthenticated" };

export type SessionBoundaryRequest = {
  readonly pathname: string;
  readonly hasSession: boolean;
};

/** Compara la ruta con la declarada, sin que `/registros` cuele por parecerse
 * a `/registro`: o es la misma, o cuelga de ella. */
function isPathWithin(pathname: string, declaredPath: string): boolean {
  return pathname === declaredPath || pathname.startsWith(`${declaredPath}/`);
}

/**
 * Una pantalla pública abre también lo que cuelga de ella, porque el registro
 * crecerá en pasos (`/registro/tutor`). Un endpoint público NO: se compara por
 * igualdad, para que `/api/v1/auth/session/loquesea` nazca protegido como
 * cualquier endpoint nuevo. Una pantalla de más es una pantalla; un endpoint
 * de más es una puerta.
 */
function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PAGE_PATHS.some((publicPage) =>
      isPathWithin(pathname, publicPage),
    ) || PUBLIC_API_PATHS.includes(pathname)
  );
}

function isApiPath(pathname: string): boolean {
  return isPathWithin(pathname, API_V1_PREFIX);
}

export function decideSessionBoundary({
  pathname,
  hasSession,
}: SessionBoundaryRequest): SessionBoundaryOutcome {
  if (isPublicPath(pathname)) {
    return { kind: "allow" };
  }
  if (hasSession) {
    return { kind: "allow" };
  }
  return isApiPath(pathname)
    ? { kind: "unauthenticated" }
    : { kind: "redirect", to: SIGN_IN_PATH };
}
