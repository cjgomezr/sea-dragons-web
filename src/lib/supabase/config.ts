export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
export const SUPABASE_SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";

export type SupabaseConfig =
  | {
      readonly kind: "configured";
      readonly url: string;
      readonly anonKey: string;
    }
  | { readonly kind: "missing"; readonly missingKeys: readonly string[] };

export type SupabaseServiceRoleConfig =
  | {
      readonly kind: "configured";
      readonly url: string;
      readonly serviceRoleKey: string;
    }
  | { readonly kind: "missing"; readonly missingKeys: readonly string[] };

type Environment = Readonly<Record<string, string | undefined>>;

function readRequired(env: Environment, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

export function readSupabaseConfig(env: Environment): SupabaseConfig {
  const url = readRequired(env, SUPABASE_URL_ENV);
  const anonKey = readRequired(env, SUPABASE_ANON_KEY_ENV);

  if (url === null || anonKey === null) {
    const missingKeys = [
      ...(url === null ? [SUPABASE_URL_ENV] : []),
      ...(anonKey === null ? [SUPABASE_ANON_KEY_ENV] : []),
    ];
    return { kind: "missing", missingKeys };
  }

  return { kind: "configured", url, anonKey };
}

/** Config del cliente que evita RLS. Solo se usa en el servidor, nunca en un
 * componente de cliente: ver `recordAuditEvent` en `src/lib/audit/audit-log.ts`. */
export function readSupabaseServiceRoleConfig(
  env: Environment,
): SupabaseServiceRoleConfig {
  const url = readRequired(env, SUPABASE_URL_ENV);
  const serviceRoleKey = readRequired(env, SUPABASE_SERVICE_ROLE_KEY_ENV);

  if (url === null || serviceRoleKey === null) {
    const missingKeys = [
      ...(url === null ? [SUPABASE_URL_ENV] : []),
      ...(serviceRoleKey === null ? [SUPABASE_SERVICE_ROLE_KEY_ENV] : []),
    ];
    return { kind: "missing", missingKeys };
  }

  return { kind: "configured", url, serviceRoleKey };
}
