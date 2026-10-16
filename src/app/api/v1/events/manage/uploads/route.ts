import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { readLimitedBody } from "@/lib/api/read-limited-body";
import { ApiError } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { EventValidationError } from "@/lib/events/event-creation";
import {
  type EventCoverUploadGateways,
  type StagedEventCover,
  stageEventCover,
} from "@/lib/events/event-covers";
import { asEventsApiError } from "@/lib/events/events-api";
import { createSupabaseEventCoverUploadGateways } from "@/lib/events/supabase-event-covers-gateway";
import { NEWS_COVER_MAX_BYTES } from "@/lib/news/news-cover-uploads";

/**
 * Subir la imagen de un evento o una serie (#644, RF-3 y D7 del PRD de E24).
 * El cuerpo son los bytes: JPEG, PNG o WebP de hasta 10 MB, que se guarda
 * reducida a dos WebP. Responde el id que después se manda en
 * `coverUploadId` al crear o editar.
 *
 * Un archivo que no vale es un 422 (`business_rule`) con el motivo en
 * `reason`, que la pantalla traduce, como el resto de los eventos.
 *
 * Cuelga de crear eventos, así que la frontera lo reserva a Admin y
 * Committee, y el dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y escribe en el almacenamiento.
export const dynamic = "force-dynamic";

export type StagedEventCoverResponse = StagedEventCover;

function requireEventCoverUploadGateways(): EventCoverUploadGateways {
  const wiring = createSupabaseEventCoverUploadGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

const postUpload = createApiRoute<StagedEventCoverResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      // El cuerpo se lee como mucho hasta el tope: uno de más se rechaza sin
      // cargarlo entero.
      const body = await readLimitedBody(request, NEWS_COVER_MAX_BYTES);
      if (body.kind === "too_large") {
        throw new EventValidationError("event_cover_too_large");
      }
      return {
        data: await stageEventCover(requireEventCoverUploadGateways(), {
          callerId,
          bytes: body.bytes,
        }),
        status: 201,
      };
    } catch (error) {
      asEventsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postUpload,
});
