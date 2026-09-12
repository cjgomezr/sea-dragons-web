import { findMissingSupabaseKeys } from "@/lib/supabase/config";

type Environment = Readonly<Record<string, string | undefined>>;

export type SupabaseCredentialsDecision =
  | { readonly kind: "available" }
  | { readonly kind: "skip"; readonly reason: string };

/** Actions pone `CI` en cada runner, y es la única señal que importa: allí las
 * credenciales de `seadragons-dev` están en los secretos del repositorio desde
 * el issue #149, así que faltar es un secreto mal configurado. */
function runsInCi(env: Environment): boolean {
  return (env.CI ?? "") !== "";
}

/**
 * Qué hacer cuando faltan las credenciales de Supabase.
 *
 * En la máquina de quien desarrolla sin `.env.local`, saltarse las pruebas que
 * hablan con la base es lo correcto: no hay nada que probar y decirlo así es
 * honesto. En CI no, y esa es la asimetría que este módulo existe para fijar:
 * un salto ahí es una corrida verde que no probó nada, que fue exactamente lo
 * que pasó en el PR #148 con una pantalla sin línea base de Linux.
 */
export function decideSupabaseCredentials(
  env: Environment,
): SupabaseCredentialsDecision {
  const missingKeys = findMissingSupabaseKeys(env);
  if (missingKeys.length === 0) {
    return { kind: "available" };
  }

  const named = missingKeys.join(", ");
  if (runsInCi(env)) {
    throw new Error(
      `Faltan variables de entorno de Supabase en CI: ${named}. Son ` +
        "secretos del repositorio (Settings, Secrets and variables, Actions) " +
        "con los valores de seadragons-dev. Sin ellas esta corrida se " +
        "saltaría justo las pruebas que tenía que decidir.",
    );
  }
  return {
    kind: "skip",
    reason: `faltan variables de entorno de Supabase: ${named}`,
  };
}
