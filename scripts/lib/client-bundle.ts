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

/** Etiqueta con la que se reporta una clave de servicio del formato clásico.
 * No es una aguja de texto como las demás: se reconoce por el contenido del
 * JWT, no por su forma. */
export const SERVICE_ROLE_JWT_LABEL = "clave service_role en formato JWT";

export type BundleScan = {
  /** Ruta con `/`, relativa a la raíz del repositorio. */
  readonly dir: string;
  readonly extensions: readonly string[];
  readonly needles: readonly string[];
  /** Si un directorio sin archivos es un error. `.next/static` siempre trae
   * JavaScript después de un build, así que ahí vacío significa build roto. El
   * HTML prerenderizado puede no existir legítimamente el día que todas las
   * rutas sean dinámicas, y un rojo que nadie sabe arreglar es como se acaba
   * desactivando un chequeo. */
  readonly mustHaveFiles: boolean;
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
    {
      dir: ".next/static",
      extensions: [".js"],
      needles,
      mustHaveFiles: true,
    },
    {
      dir: ".next/server/app",
      extensions: [".html", ".rsc"],
      needles,
      mustHaveFiles: false,
    },
  ];
}

// Las agujas de texto no cazan una clave de servicio del formato clásico, que
// es una cadena `eyJ...` sin ningún nombre reconocible dentro. Y por la forma
// no se puede distinguir de la llave anónima, que viaja al navegador con todo
// derecho: las dos son JWT del mismo proyecto. Lo que las separa es el rol que
// llevan en el payload, así que hay que abrirlo y mirarlo.
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;
const SERVICE_ROLE = "service_role";

function decodeJwtPayload(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    // Una cadena con pinta de JWT que no decodifica no es un JWT. No es un
    // error que tratar: es la respuesta a la pregunta que se hizo.
    return null;
  }
}

function isServiceRolePayload(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "role" in payload &&
    payload.role === SERVICE_ROLE
  );
}

function hasServiceRoleJwt(content: string): boolean {
  return [...content.matchAll(JWT_PATTERN)].some((match) =>
    isServiceRolePayload(decodeJwtPayload(match[1] ?? "")),
  );
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
  if (files.length === 0 && scan.mustHaveFiles) {
    throw new Error(
      `${dir} no tiene ningún archivo ${extensions.join(" ni ")}: el build no dejó lo que se esperaba`,
    );
  }

  const leaks = files.flatMap((file) => {
    const content = readFileSync(path.join(dir, file), "utf8");
    const name = file.split(path.sep).join("/");
    return [
      ...needles
        .filter((needle) => content.includes(needle))
        .map((needle) => ({ file: name, needle })),
      ...(hasServiceRoleJwt(content)
        ? [{ file: name, needle: SERVICE_ROLE_JWT_LABEL }]
        : []),
    ];
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
