import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  DIRECTORY_FILTER_FORBIDDEN_REASON,
  DirectoryFilterForbiddenError,
  type DirectoryQuery,
} from "@/lib/directory/directory";
import {
  DIRECTORY_EXPORT_FORBIDDEN_REASON,
  type DirectoryExportGateways,
  DirectoryExportForbiddenError,
  exportDirectory,
} from "@/lib/directory/directory-export";
import {
  INVALID_DIRECTORY_QUERY_REASON,
  InvalidDirectoryQueryError,
  parseDirectoryQuery,
} from "@/lib/directory/directory-query";
import { createSupabaseDirectoryExportGateways } from "@/lib/directory/supabase-directory-export-gateways";
import { readApiRequestLocale } from "@/lib/i18n/request-locale";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/**
 * La exportación a CSV del directorio (#500, RF-5 del PRD de E19, D6). Lee
 * los mismos parámetros que `GET /api/v1/directory` y responde el archivo,
 * no `{ data }`: quien lo pide lo guarda.
 *
 * Lo alcanza cualquier cuenta activa por la frontera, como el directorio:
 * que quien llama sea Admin o Committee lo decide el dominio, y a los demás
 * les responde 403 con motivo. Las cabeceras van en el idioma de quien
 * exporta: la web lo manda en su cookie y una app nativa (CON-002) en
 * `accept-language`.
 */

// Depende de la sesión de quien llama, de lo que pida y de los socios que
// haya ahora.
export const dynamic = "force-dynamic";

const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

function requireExportGateways(): DirectoryExportGateways {
  const wiring = createSupabaseDirectoryExportGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

function asExportApiError(error: unknown): never {
  if (error instanceof DirectoryExportForbiddenError) {
    throw new ApiError(
      "forbidden",
      error.message,
      DIRECTORY_EXPORT_FORBIDDEN_REASON,
    );
  }
  if (error instanceof DirectoryFilterForbiddenError) {
    throw new ApiError(
      "forbidden",
      error.message,
      DIRECTORY_FILTER_FORBIDDEN_REASON,
    );
  }
  return asAccountApiError(error);
}

/** Una consulta mal escrita se contesta antes de identificar a nadie, como
 * en el directorio. */
function readExportQuery(searchParams: URLSearchParams): DirectoryQuery {
  try {
    return parseDirectoryQuery(searchParams);
  } catch (error) {
    if (error instanceof InvalidDirectoryQueryError) {
      throw new ApiError(
        "validation_error",
        error.message,
        INVALID_DIRECTORY_QUERY_REASON,
      );
    }
    throw error;
  }
}

const getExport = createApiRoute<never>({
  handler: async ({ request, decorateResponse }) => {
    const query = readExportQuery(request.nextUrl.searchParams);
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      const exported = await exportDirectory(requireExportGateways(), {
        callerId,
        query,
        // El día de Melbourne (NFR-003): el del nombre del archivo y el que
        // mide los AUF por vencer, como en el directorio.
        todayInClub: clubCalendarDate(new Date()),
        locale: readApiRequestLocale(request),
      });
      return {
        file: {
          body: exported.csv,
          contentType: CSV_CONTENT_TYPE,
          filename: exported.filename,
        },
      };
    } catch (error) {
      asExportApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getExport,
});
