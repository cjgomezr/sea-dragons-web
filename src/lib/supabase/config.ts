export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

export type SupabaseConfig =
  | { readonly kind: "configured"; readonly url: string; readonly anonKey: string }
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
