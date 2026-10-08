import {
  DEVELOPMENT_SUPABASE_PROJECT_REF,
  PRODUCTION_SUPABASE_PROJECT_REF,
} from "../../src/lib/supabase/environment-guard";

/**
 * La guardia del sembrado de NFR-008 (#524). El sembrado mete 500 socios y
 * 50.000 asistencias de mentira: en `seadragons-dev` o en producción sería un
 * destrozo. Sólo corre contra un Supabase de la propia máquina.
 *
 * Mira sólo el host, no el puerto: la épica de CI puede levantar su Supabase
 * en otros puertos, y lo que importa es que no salga de la máquina.
 */

const LOCAL_HOSTNAMES: readonly string[] = ["127.0.0.1", "localhost"];

export type SeedTargetCheck =
  | { readonly kind: "local" }
  | { readonly kind: "refused"; readonly message: string };

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function refusalMessage(hostname: string): string {
  const reason = "El sembrado sólo corre contra un Supabase local";
  if (hostname === `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`) {
    return `La URL de Supabase apunta a PRODUCCIÓN (seadragons-prod). ${reason}. No se escribe nada.`;
  }
  if (hostname === `${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`) {
    return `La URL de Supabase apunta a seadragons-dev. ${reason}: los datos de prueba de carga no van a ningún proyecto compartido. No se escribe nada.`;
  }
  return `La URL de Supabase apunta a ${hostname}, que no es esta máquina. ${reason} (${LOCAL_HOSTNAMES.join(" o ")}). No se escribe nada.`;
}

/** Sin URL no hay ningún proyecto remoto configurado: el sembrado va al
 * Supabase local de `npm run db:start`, que es su destino por defecto. */
export function checkSeedTarget(
  supabaseUrl: string | undefined,
): SeedTargetCheck {
  const url = supabaseUrl?.trim();
  if (!url) {
    return { kind: "local" };
  }
  const parsed = parseUrl(url);
  if (parsed === null) {
    return {
      kind: "refused",
      message:
        "La URL de Supabase no es una URL válida. El sembrado sólo corre contra un Supabase local. No se escribe nada.",
    };
  }
  if (!LOCAL_HOSTNAMES.includes(parsed.hostname)) {
    return { kind: "refused", message: refusalMessage(parsed.hostname) };
  }
  return { kind: "local" };
}
