import { ApiError } from "@/lib/api/response";
import type { NotificationMarker } from "./member-notifications";
import { createSupabaseNotificationMarker } from "./supabase-notification-gateways";

/** Lo que comparten los dos endpoints que marcan avisos como leídos. */

export function requireNotificationMarker(): NotificationMarker {
  const wiring = createSupabaseNotificationMarker(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      `El servicio de avisos no está configurado: faltan ${wiring.missingKeys.join(", ")}.`,
    );
  }
  return wiring.marker;
}
