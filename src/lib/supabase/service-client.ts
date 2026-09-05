import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseServiceRoleConfig } from "./config";

type Environment = Readonly<Record<string, string | undefined>>;

/** Cliente que evita RLS. Nunca se importa desde un componente `"use client"`:
 * la llave de servicio no puede llegar al navegador. */
export function createServiceRoleClient(env: Environment): SupabaseClient {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    throw new Error(
      `Faltan variables de entorno para el cliente de servicio: ${config.missingKeys.join(", ")}`,
    );
  }

  return createClient(config.url, config.serviceRoleKey);
}
