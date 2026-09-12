/** Los tres estados de cuenta que `supabase/migrations/0003_members.sql` deja
 * cerrados con un `check`. La base es quien los cierra; esto es la misma lista
 * del lado de TypeScript, para poder estrechar lo que llega de una consulta. */
export const ACCOUNT_STATUSES = ["incomplete", "active", "inactive"] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Estrecha un valor que llega de la base. Devuelve `null` en vez de lanzar
 * para que quien llame decida: en el inicio de sesión, un estado desconocido
 * es una cuenta que no puede operar, no una caída del servicio. */
export function parseAccountStatus(value: unknown): AccountStatus | null {
  return ACCOUNT_STATUSES.find((status) => status === value) ?? null;
}
