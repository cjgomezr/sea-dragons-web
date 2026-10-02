import { type NextRequest, NextResponse } from "next/server";
import {
  EMAIL_CONFIRMATION_TOKEN_HASH_PARAM,
  EMAIL_CONFIRMATION_TYPE_PARAM,
  type EmailConfirmationResult,
  confirmEmailAndActivate,
  parseEmailConfirmationLink,
} from "@/lib/auth/email-confirmation";
import {
  type ConfirmationState,
  registrationPathWithConfirmation,
} from "@/lib/auth/registration-screen";
import {
  createSupabaseAuthGateways,
  describeMissingAuthKeys,
} from "@/lib/auth/supabase-auth-gateways";

/**
 * El canje del enlace del correo de confirmación (#477). Lo llama el botón de
 * `EMAIL_CONFIRMATION_PATH`, nunca el enlace: abrir la URL del correo es un
 * GET, y los escáneres de enlaces del correo de empresa lo hacen antes que la
 * persona. Si el canje viviera en ese GET, el escáner gastaría el token.
 *
 * Vive fuera de `api/v1` a propósito: lo envía un formulario HTML y siempre
 * termina en una redirección a una pantalla, no devuelve datos (CON-002).
 */
export const dynamic = "force-dynamic";

// 303 y no el 307 por defecto: tras un POST el navegador tiene que pedir la
// pantalla con un GET, no reenviar el formulario a ella.
const SEE_OTHER = 303;
const FORBIDDEN = 403;

function redirectToRegistration(
  request: NextRequest,
  state: ConfirmationState,
): NextResponse {
  return NextResponse.redirect(
    new URL(registrationPathWithConfirmation(state), request.url),
    SEE_OTHER,
  );
}

/** Un formulario de otro sitio podría mandar un token robado con el navegador
 * de la víctima. Los navegadores ponen `Origin` en todo POST, así que uno que
 * falte o no coincida no viene de nuestra pantalla. */
function isSameOriginRequest(request: NextRequest): boolean {
  return request.headers.get("origin") === request.nextUrl.origin;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return new NextResponse(null, { status: FORBIDDEN });
  }

  const form = await request.formData();
  const link = parseEmailConfirmationLink(
    form.get(EMAIL_CONFIRMATION_TOKEN_HASH_PARAM),
    form.get(EMAIL_CONFIRMATION_TYPE_PARAM),
  );
  if (link === null) {
    return redirectToRegistration(request, "invalida");
  }

  const wiring = createSupabaseAuthGateways(process.env);
  if (wiring.kind === "unconfigured") {
    console.error(
      "[auth/confirmar]",
      describeMissingAuthKeys(wiring.missingKeys),
    );
    return redirectToRegistration(request, "error");
  }

  // El canje ya consumió el token, así que un fallo del servidor aquí deja al
  // visitante sin segundo intento con el mismo enlace. Lo mínimo es no
  // enseñarle la página de error de Next y no llamarlo "enlace inválido", que
  // le haría buscar el problema donde no está.
  let result: EmailConfirmationResult;
  try {
    result = await confirmEmailAndActivate(wiring.gateways, link);
  } catch (error) {
    console.error(
      "[auth/confirmar] no se pudo resolver la confirmación",
      error,
    );
    return redirectToRegistration(request, "error");
  }

  if (result.kind === "rejected") {
    // El motivo se queda en el servidor: al visitante le sirve saber que el
    // enlace no vale y cómo pedir otro, no el texto de Supabase.
    console.warn("[auth/confirmar] enlace rechazado", result.reason);
    return redirectToRegistration(request, "invalida");
  }

  return redirectToRegistration(
    request,
    result.kind === "activated" ? "ok" : "pendiente",
  );
}
