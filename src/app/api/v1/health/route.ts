import { createClient } from "@supabase/supabase-js";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  type DatabaseProbeResult,
  type HealthReport,
  buildHealthReport,
} from "@/lib/health";
import { readDeploymentCommit } from "@/lib/deployment";
import {
  readSupabaseConfig,
  readSupabaseProjectRef,
} from "@/lib/supabase/config";

// The probe must reflect the database right now, never a cached answer.
export const dynamic = "force-dynamic";

const PROBED_TABLE = "clubs";

async function probeDatabase(): Promise<DatabaseProbeResult> {
  const config = readSupabaseConfig(process.env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }

  const supabase = createClient(config.url, config.anonKey);
  // Nada de `head: true`: PostgREST responde 404 sin cuerpo y supabase-js lo
  // traduce a `{ status: 204, error: null }`, así que una base sin la tabla se
  // reportaba como sana. La sonda pide un cuerpo para poder leer el error.
  const { error } = await supabase.from(PROBED_TABLE).select("id").limit(1);

  if (error) {
    return { kind: "unreachable", reason: error.message };
  }
  return { kind: "reachable" };
}

const getHealth = createApiRoute<HealthReport>({
  handler: async () => {
    // El ref se lee del entorno por su cuenta, no de la config que usa la
    // sonda: con la URL puesta y la llave anónima ausente, la config es
    // `missing` y no trae URL, pero el ref se sabe igual y decirlo es justo lo
    // que hace falta para diagnosticar ese caso.
    const report = buildHealthReport({
      probe: await probeDatabase(),
      supabaseProjectRef: readSupabaseProjectRef(process.env),
      commit: readDeploymentCommit(process.env),
    });
    if (report.status === "degraded") {
      throw new ApiError("service_unavailable", report.detail);
    }
    return { data: report };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getHealth,
});
