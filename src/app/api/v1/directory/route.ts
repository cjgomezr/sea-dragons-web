import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  type DirectoryGateways,
  type DirectoryListing,
  type DirectoryQuery,
  DirectoryForbiddenError,
  listDirectory,
} from "@/lib/directory/directory";
import {
  InvalidDirectoryQueryError,
  parseDirectoryQuery,
} from "@/lib/directory/directory-query";
import { createSupabaseDirectoryGateways } from "@/lib/directory/supabase-directory-gateways";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/**
 * El directorio del club (#238, FR-015 a FR-019, RF-2 del PRD de E5).
 *
 * Lo alcanza cualquier cuenta activa, sea cual sea su rol, así que la ruta NO
 * está en `RESTRICTED_ROUTES`: la frontera ya respondió 401 a quien no tiene
 * sesión y 403 a la cuenta incompleta. Lo que sí es de un Admin (el AUF de
 * BR-008 y los socios dados de baja de AC-040) lo decide el dominio leyendo el
 * rol de quien llama, como la bandeja de `GET /api/v1/role-requests` desde
 * #212.
 */

// Depende de la sesión de quien llama, de lo que pida y de los socios que
// haya ahora.
export const dynamic = "force-dynamic";

/** La lista, marcada con si la está viendo un Admin. */
export type DirectoryResponse = DirectoryListing;

function requireDirectoryGateways(): DirectoryGateways {
  const wiring = createSupabaseDirectoryGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

function asDirectoryApiError(error: unknown): never {
  if (error instanceof DirectoryForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}

/** Una consulta mal escrita es una petición mal hecha, venga de quien venga:
 * se contesta antes de identificar a nadie y sin leer la base, igual que la
 * bandeja de solicitudes contesta a un filtro que no sabe servir. */
function readDirectoryQuery(searchParams: URLSearchParams): DirectoryQuery {
  try {
    return parseDirectoryQuery(searchParams);
  } catch (error) {
    if (error instanceof InvalidDirectoryQueryError) {
      throw new ApiError("validation_error", error.message);
    }
    throw error;
  }
}

const getDirectory = createApiRoute<DirectoryResponse>({
  handler: async ({ request, decorateResponse }) => {
    const query = readDirectoryQuery(request.nextUrl.searchParams);
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await listDirectory(requireDirectoryGateways(), {
          callerId,
          query,
          // El vencimiento del AUF se mide en el día del club (NFR-003): en
          // Melbourne ya es mañana mientras en UTC sigue siendo hoy.
          todayInClub: clubCalendarDate(new Date()),
        }),
      };
    } catch (error) {
      asDirectoryApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getDirectory,
});
