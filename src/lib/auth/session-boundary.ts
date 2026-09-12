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

function isPublicPath(pathname: string): boolean {
  return [...PUBLIC_PAGE_PATHS, ...PUBLIC_API_PATHS].some((publicPath) =>
    isPathWithin(pathname, publicPath),
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
