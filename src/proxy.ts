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
 * Decide, en este orden, si hay alguien, si su cuenta puede operar y si su
 * rol alcanza la ruta (FR-013). La matriz por rol se aplica aquí a propósito:
 * redirigir desde el proxy es lo único que cubre también a quien escribe la
 * dirección de una pantalla a mano, y un endpoint restringido responde 403
 * sin que su handler tenga que acordarse de comprobarlo. Qué exige cada ruta
 * se declara en `RESTRICTED_ROUTES`, no en este archivo. Las policies de la
 * base siguen siendo la otra mitad: protegen los datos aunque se llegue a
 * ellos por otro camino.
 */

const UNAUTHENTICATED_MESSAGE =
  "Necesitas iniciar sesión para usar este endpoint.";
const INCOMPLETE_ACCOUNT_MESSAGE =
  "Tu cuenta todavía está incompleta. Termina tu registro antes de usar este endpoint.";
const MISSING_CAPABILITY_MESSAGE = "Tu rol no te permite usar este endpoint.";

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
    case "missingCapability":
      return apiError("forbidden", MISSING_CAPABILITY_MESSAGE);
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
      : { kind: "anonymous" as const };

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
