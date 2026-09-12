import { type NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import {
  type SessionBoundaryOutcome,
  decideSessionBoundary,
} from "@/lib/auth/session-boundary";
import { hasValidSession } from "@/lib/auth/session-reader";
import {
  applySessionCookies,
  createSessionClient,
  readIncomingCookies,
} from "@/lib/supabase/session-client";

/**
 * La frontera de sesión (NFR-004), en el servidor y para el 100% de las
 * peticiones. En Next 16 esto se llama `proxy`; era `middleware` hasta la 15.
 *
 * Aquí no se decide QUÉ puede hacer quien entra, sólo SI hay alguien. La
 * matriz de permisos por rol es E3 y vivirá en las policies de la base y en
 * los propios endpoints, no en este archivo.
 */

const UNAUTHENTICATED_MESSAGE =
  "Necesitas iniciar sesión para usar este endpoint.";

function buildResponse(
  outcome: SessionBoundaryOutcome,
  request: NextRequest,
): NextResponse {
  switch (outcome.kind) {
    case "allow":
      return NextResponse.next();
    case "redirect":
      return NextResponse.redirect(new URL(outcome.to, request.nextUrl));
    case "unauthenticated":
      return apiError("unauthenticated", UNAUTHENTICATED_MESSAGE);
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const session = createSessionClient(
    process.env,
    readIncomingCookies(request),
  );
  // Un entorno sin Supabase no puede reconocer a nadie, así que nadie tiene
  // sesión. Se cierra en vez de abrirse: una frontera que se cae hacia el lado
  // abierto cuando falta una variable de entorno no es una frontera.
  const hasSession =
    session.kind === "ready" ? await hasValidSession(session.client) : false;

  const response = buildResponse(
    decideSessionBoundary({ pathname: request.nextUrl.pathname, hasSession }),
    request,
  );

  // El refresco del token ocurre dentro de `hasValidSession`, y las cookies
  // nuevas sólo existen si se copian a ESTA respuesta. Perderlas es el fallo
  // clásico del patrón: cierres de sesión al azar y un refresco por petición.
  if (session.kind === "ready") {
    applySessionCookies(response, session.recorder);
  }
  return response;
}

export const config = {
  // Todo menos lo que sirve el propio Next y los archivos estáticos: pedir una
  // fuente o un PNG no es pedir una pantalla, y hacerle una comprobación de
  // sesión a cada uno sería una ida y vuelta a Supabase por archivo.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)",
  ],
};
