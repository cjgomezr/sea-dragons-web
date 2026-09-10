import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  type EnvironmentManifest,
  secretVariableNames,
} from "./entornos-manifest.ts";

/** Dónde deja Next.js lo que el navegador descarga. Todo lo demás que hay bajo
 * `.next/` se queda en el servidor. */
export const CLIENT_BUNDLE_DIR = path.join(".next", "static");

/** Prefijo con el que Supabase entrega sus claves secretas del formato nuevo.
 * Ninguna cadena que empiece así tiene nada que hacer en el navegador, se
 * llame como se llame la variable de la que salió. */
export const FORBIDDEN_KEY_PREFIX = "sb_secret_";

const CLIENT_SCRIPT_EXTENSION = ".js";

export type BundleLeak = {
  /** Ruta relativa al propio bundle, siempre con `/`, para que el mensaje del
   * fallo se lea igual en el runner de Linux y en un portátil con Windows. */
  readonly file: string;
  readonly needle: string;
};

/** Lo que se busca en el bundle: el nombre de cada variable secreta y el
 * prefijo de las claves secretas de Supabase.
 *
 * Buscar el *nombre* funciona como canario porque el nombre sólo llega al
 * navegador si llegó el módulo de servidor que lo menciona (por ejemplo
 * `src/lib/supabase/config.ts`). Buscar el *valor* no serviría: la llave
 * anónima tiene la misma forma que la de servicio y sí viaja al navegador con
 * todo derecho. */
export function forbiddenNeedles(manifest: EnvironmentManifest): string[] {
  return [...secretVariableNames(manifest), FORBIDDEN_KEY_PREFIX];
}

function listScriptFiles(root: string, relativeDir = ""): string[] {
  const entries = readdirSync(path.join(root, relativeDir), {
    withFileTypes: true,
  });

  return entries.flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return listScriptFiles(root, relativePath);
    }
    return path.extname(entry.name) === CLIENT_SCRIPT_EXTENSION
      ? [relativePath]
      : [];
  });
}

/** Toda aparición de una cadena prohibida en el JavaScript que el navegador
 * descarga. Un directorio ausente es un error, no un bundle limpio: dar por
 * bueno lo que no se miró es justo el fallo silencioso que esto evita. */
export function findClientBundleLeaks(options: {
  readonly bundleDir: string;
  readonly needles: readonly string[];
}): BundleLeak[] {
  const { bundleDir, needles } = options;
  if (!statSync(bundleDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `no hay bundle que revisar en ${bundleDir}: corre \`npm run build\` antes`,
    );
  }

  return listScriptFiles(bundleDir).flatMap((file) => {
    const content = readFileSync(path.join(bundleDir, file), "utf8");
    return needles
      .filter((needle) => content.includes(needle))
      .map((needle) => ({ file: file.split(path.sep).join("/"), needle }));
  });
}

export function describeLeaks(leaks: readonly BundleLeak[]): string {
  const lines = leaks.map((leak) => `  ${leak.needle} en ${leak.file}`);
  return [
    "El bundle que llega al navegador contiene cadenas que no deben salir del servidor:",
    ...lines,
    "",
    "Suele significar que un componente de cliente importa código de servidor.",
    "Ver docs/entornos.md, sección de secretos por entorno.",
  ].join("\n");
}
