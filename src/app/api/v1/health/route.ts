import { createClient } from "@supabase/supabase-js";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  DATABASE_PROBE_TIMEOUT_MS,
  type DatabaseProbeResult,
  type HealthReport,
  buildHealthReport,
  probeWithinTimeout,
} from "@/lib/health";
import { readDeploymentCommit } from "@/lib/deployment";
import {
  readSupabaseConfig,
  readSupabaseProjectRef,
} from "@/lib/supabase/config";

// The probe must reflect the database right now, never a cached answer.
export const dynamic = "force-dynamic";

/** Responde `true` y nada más (`supabase/migrations/0008_sonda_salud.sql`).
 * La sonda llama a una función y no lee una tabla para que ninguna tabla le
 * deba un privilegio al rol anónimo. */
const HEALTH_PROBE_FUNCTION = "health_probe";

function describeThrownProbeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function probeDatabase(): Promise<DatabaseProbeResult> {
  const config = readSupabaseConfig(process.env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }

  // El try abarca también la construcción del cliente: `readSupabaseConfig`
  // comprueba que la variable esté puesta, no que sea una URL, y `createClient`
  // lanza con una mal pegada. Dentro, supabase-js devuelve `{ error }`, pero la
  // capa de red por debajo lanza (DNS, TLS, socket cortado). Cualquiera de esas
  // excepciones sería un 500 mudo, y lo que hay debajo es una base inalcanzable
  // o un entorno mal configurado: eso se cuenta con un 503 que diga qué pasó.
  try {
    const supabase = createClient(config.url, config.anonKey);
    // Nada de `head: true`: PostgREST responde 404 sin cuerpo y supabase-js lo
    // traduce a `{ status: 204, error: null }`, así que una base sin la función
    // se leería como sana. La llamada pide un cuerpo para poder leer el error.
    const { error } = await supabase.rpc(HEALTH_PROBE_FUNCTION);
    if (error) {
      return { kind: "unreachable", reason: error.message };
    }
    return { kind: "reachable" };
  } catch (error) {
    return { kind: "unreachable", reason: describeThrownProbeError(error) };
  }
}

const getHealth = createApiRoute<HealthReport>({
  handler: async () => {
    // El ref se parsea del entorno directamente y no de la config de la
    // sonda, porque saber a qué proyecto apunta este entorno no depende de
    // tener la llave anónima. En una respuesta 503 no sale: el cuerpo de error
    // de la API v1 es solo `{ error: { code, message } }` (ver
    // `docs/entornos.md`).
    const report = buildHealthReport({
      probe: await probeWithinTimeout(probeDatabase, DATABASE_PROBE_TIMEOUT_MS),
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
