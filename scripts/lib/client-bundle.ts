import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  type EnvironmentManifest,
  secretVariableNames,
} from "./entornos-manifest.ts";

/** Prefijo con el que Supabase entrega sus claves secretas del formato nuevo.
 * Ninguna cadena que empiece así tiene nada que hacer en el navegador, se
 * llame como se llame la variable de la que salió. */
export const FORBIDDEN_KEY_PREFIX = "sb_secret_";

export type BundleScan = {
  /** Ruta con `/`, relativa a la raíz del repositorio. */
  readonly dir: string;
  readonly extensions: readonly string[];
  readonly needles: readonly string[];
};

export type BundleLeak = {
  /** Ruta relativa al directorio revisado, siempre con `/`, para que el
   * mensaje del fallo se lea igual en el runner de Linux y en Windows. */
  readonly file: string;
  readonly needle: string;
};

/** Lo que se busca: el nombre de cada variable secreta y el prefijo de las
 * claves secretas de Supabase.
 *
 * Buscar el *nombre* funciona como canario porque el nombre sólo llega al
 * navegador si llegó el módulo de servidor que lo menciona (por ejemplo
 * `src/lib/supabase/config.ts`). Buscar el *valor* no serviría: la llave
 * anónima tiene la misma forma que la de servicio y sí viaja al navegador con
 * todo derecho. */
export function forbiddenNeedles(manifest: EnvironmentManifest): string[] {
  return [...secretVariableNames(manifest), FORBIDDEN_KEY_PREFIX];
}

/** Los dos sitios de los que el navegador se lleva algo. `.next/static` es el
 * JavaScript que descarga; `.next/server/app` guarda el HTML prerenderizado y
 * los payloads RSC, que viajan igual aunque el directorio se llame `server`.
 * Revisar sólo el primero dejaría fuera una clave incrustada en el HTML. */
export function clientBundleScans(manifest: EnvironmentManifest): BundleScan[] {
  const needles = forbiddenNeedles(manifest);
  return [
    { dir: ".next/static", extensions: [".js"], needles },
    { dir: ".next/server/app", extensions: [".html", ".rsc"], needles },
  ];
}

function listFiles(
  root: string,
  extensions: readonly string[],
  relativeDir = "",
): string[] {
  const entries = readdirSync(path.join(root, relativeDir), {
    withFileTypes: true,
  });

  return entries.flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(root, extensions, relativePath);
    }
    return extensions.includes(path.extname(entry.name)) ? [relativePath] : [];
  });
}

export type ScanResult = {
  readonly filesRead: number;
  readonly leaks: readonly BundleLeak[];
};

/** Busca las cadenas prohibidas en lo que el navegador se lleva. Falla cerrado
 * en los dos casos en que no hay nada que mirar: un directorio ausente y un
 * directorio sin un solo archivo del tipo esperado. Los dos significan que el
 * build no dejó lo que se esperaba, no que el resultado esté limpio, y dar por
 * bueno lo que no se miró es justo el fallo silencioso que esto evita. */
export function scanForLeaks(scan: BundleScan): ScanResult {
  const { dir, extensions, needles } = scan;
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `no hay nada que revisar en ${dir}: corre \`npm run build\` antes`,
    );
  }

  const files = listFiles(dir, extensions);
  if (files.length === 0) {
    throw new Error(
      `${dir} no tiene ningún archivo ${extensions.join(" ni ")}: el build no dejó lo que se esperaba`,
    );
  }

  const leaks = files.flatMap((file) => {
    const content = readFileSync(path.join(dir, file), "utf8");
    return needles
      .filter((needle) => content.includes(needle))
      .map((needle) => ({ file: file.split(path.sep).join("/"), needle }));
  });
  return { filesRead: files.length, leaks };
}

export function describeLeaks(
  dir: string,
  leaks: readonly BundleLeak[],
): string {
  return [
    `${dir} contiene cadenas que no deben llegar al navegador:`,
    ...leaks.map((leak) => `  ${leak.needle} en ${leak.file}`),
    "",
    "Suele significar que un componente de cliente importa código de servidor.",
    "Ver docs/entornos.md, sección de secretos por entorno.",
  ].join("\n");
}
