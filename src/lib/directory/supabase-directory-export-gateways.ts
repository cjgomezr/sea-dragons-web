import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { readClubBrand } from "@/lib/club/supabase-club-brand";
import { cachedClubPositions } from "@/lib/club/supabase-club-positions";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { DirectoryExportGateways } from "./directory-export";
import { createDirectoryGateways } from "./supabase-directory-gateways";

/**
 * Adaptador entre la exportación del directorio (#500) y Supabase: el mismo
 * directorio, más la marca del club para el nombre del archivo y la bitácora.
 * Va por la llave de servicio por lo mismo que el directorio
 * (`supabase-directory-gateways.ts`), y `audit_log` sólo la escribe ella.
 */

type Environment = Readonly<Record<string, string | undefined>>;

export type DirectoryExportGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: DirectoryExportGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

export function createSupabaseDirectoryExportGateways(
  env: Environment,
): DirectoryExportGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  const serviceClient = createServiceRoleClient(env);
  return {
    kind: "ready",
    gateways: {
      ...createDirectoryGateways(serviceClient, cachedClubPositions),
      brand: { readClubBrand },
      audit: createSupabaseAuditLogWriter(serviceClient),
    },
  };
}
