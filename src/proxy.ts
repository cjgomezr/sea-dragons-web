import { type NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import {
  type SessionBoundaryOutcome,
  decideSessionBoundary,
  isPublicPath,
} from "@/lib/auth/session-boundary";
import { readSessionState } from "@/lib/auth/session-reader";
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
const INCOMPLETE_ACCOUNT_MESSAGE =
  "Tu cuenta todavía está incompleta. Termina tu registro antes de usar este endpoint.";

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
    case "forbidden":
      return apiError("forbidden", INCOMPLETE_ACCOUNT_MESSAGE);
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  // Una ruta pública lo es con sesión y sin ella, así que la respuesta no
  // depende de preguntar. Preguntar igual le costaba a cada visita anónima un
  // viaje a Supabase, y al endpoint de salud (que el monitoreo pide cada 5
  // minutos) lo ataba a la latencia del servicio que precisamente está
  // vigilando.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const session = createSessionClient(
    process.env,
    readIncomingCookies(request),
  );
  // Un entorno sin Supabase no puede reconocer a nadie, así que nadie tiene
  // sesión. Se cierra en vez de abrirse: una frontera que se cae hacia el lado
  // abierto cuando falta una variable de entorno no es una frontera.
  const state =
    session.kind === "ready"
      ? await readSessionState(session.client)
      : "anonymous";

  const response = buildResponse(
    decideSessionBoundary({ pathname, session: state }),
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
  // Todo menos lo que sirve el propio Next. La lista NO excluye por extensión:
  // un `/api/v1/adjuntos/foto.png` saldría entonces por esa puerta, sin 401 y
  // sin redirección, y sería un agujero que no se ve al probar. El viaje a
  // Supabase que esa exclusión ahorraba ya no existe: las rutas públicas
  // salen antes de crear el cliente.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
