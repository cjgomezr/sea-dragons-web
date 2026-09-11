import { type NextRequest, NextResponse } from "next/server";
import {
  type EmailConfirmationResult,
  confirmEmailAndActivate,
  parseEmailConfirmationOtpType,
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
 * Destino del enlace que Supabase manda en el correo de confirmación. Vive
 * fuera de `api/v1` a propósito: no es un endpoint del producto que consuma
 * nadie, es una URL que un navegador abre desde un correo y que siempre
 * termina en una redirección a una pantalla. La aplicación móvil de Release 2
 * abrirá el mismo enlace (CON-002 habla de los endpoints de datos, y este no
 * devuelve datos).
 */
export const dynamic = "force-dynamic";

const TOKEN_HASH_PARAM = "token_hash";
const TYPE_PARAM = "type";

function redirectToRegistration(
  request: NextRequest,
  state: ConfirmationState,
): NextResponse {
  return NextResponse.redirect(
    new URL(registrationPathWithConfirmation(state), request.url),
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const tokenHash = params.get(TOKEN_HASH_PARAM);
  const type = parseEmailConfirmationOtpType(params.get(TYPE_PARAM));
  if (tokenHash === null || tokenHash.length === 0 || type === null) {
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
    result = await confirmEmailAndActivate(wiring.gateways, {
      tokenHash,
      type,
      now: new Date(),
    });
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
