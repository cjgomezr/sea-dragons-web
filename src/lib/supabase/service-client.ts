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

  // La llave de servicio es una credencial estática, no una sesión de
  // usuario: sin esto, el SDK comparte el mismo storage de auth (misma URL de
  // proyecto) con cualquier otro cliente del proceso, y una sesión iniciada
  // en otro cliente termina pisando las cabeceras de este.
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
