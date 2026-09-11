import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  readEnvironmentManifest,
  secretVariableNames,
} from "../../scripts/lib/entornos-manifest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCANNED_DIRECTORIES = ["src", "scripts", "tests"] as const;
const SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

/** Variables que el código lee pero que **no** van a `.env.example`, porque no
 * las escribe una persona: las inyecta la plataforma que despliega. Ponerlas en
 * `.env.local` no configuraría nada, mentiría.
 *
 * `VERCEL_GIT_COMMIT_SHA` es el caso vivo: con un valor a mano en local,
 * `/api/v1/health` afirmaría servir un commit que no es el que hay en el disco,
 * que es exactamente la mentira que el endpoint existe para no contar.
 *
 * Salirse de `.env.example` no es salirse de la documentación:
 * `tests/unit/entornos-doc.test.ts` exige que cada nombre de esta lista siga
 * explicado en `docs/entornos.md`. */
export const PLATFORM_INJECTED_ENV_VARS = ["VERCEL_GIT_COMMIT_SHA"] as const;

/** Secretos que sólo existen dentro de un workflow y que **no** van a
 * `.env.example` por el motivo contrario a los de arriba: no es que nadie los
 * escriba, es que nadie debe poder escribirlos en una máquina. Enumerarlos en
 * el archivo de ejemplo invitaría a pegar la conexión de producción en un
 * `.env.local`, que es justo lo que RF-4 prohíbe.
 *
 * `SUPABASE_PRODUCTION_DB_URL` es el caso vivo: la conexión con la que
 * `migraciones-produccion.yml` aplica el esquema en la base con datos reales.
 * Vive en los secretos del entorno Production de Actions y en ningún otro
 * sitio. `tests/unit/entornos-doc.test.ts` exige que siga explicada en
 * `docs/entornos.md`. */
export const CI_ONLY_SECRET_ENV_VARS = ["SUPABASE_PRODUCTION_DB_URL"] as const;

// process.env.PATH sólo extiende el PATH heredado del proceso al lanzar
// subprocesos en tests: no es configuración de la aplicación. Documentarla
// invitaría a poner un valor de PATH en .env.local, y eso rompería el shell
// de quien lo intentara. No entra en PLATFORM_INJECTED_ENV_VARS porque no la
// inyecta ningún despliegue: no es de esta aplicación en absoluto.
export const IGNORED_ENV_VARS = new Set<string>([
  "PATH",
  ...PLATFORM_INJECTED_ENV_VARS,
]);

/** Variables que nunca pueden llevar el prefijo `NEXT_PUBLIC_`: exponerlas al
 * navegador filtraría una credencial de servidor. Sale del manifiesto de
 * entornos, que es donde se declara qué es secreto: duplicar la lista aquí
 * dejaría al chequeo del bundle y a los tests mirando conjuntos distintos.
 * Cuando E12 añada `STRIPE_SECRET_KEY`, se marca `secret` allí y aparece sola.
 */
export const SECRET_ENV_VARS: readonly string[] = secretVariableNames(
  readEnvironmentManifest(),
);

const DIRECT_ACCESS_PATTERN = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
const BRACKET_ACCESS_PATTERN =
  /process\.env\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g;
// Convención de este proyecto (ver src/lib/supabase/config.ts): el nombre
// real de una variable puede vivir en una constante exportada cuyo
// identificador termina en "_ENV" y cuyo valor es el nombre real, en vez de
// escribirse en el sitio donde se lee como una propiedad literal de
// process.env, para poder inyectar un objeto de entorno de prueba. Sin este
// patrón, escanear solo accesos directos no vería SUPABASE_SERVICE_ROLE_KEY.
const ENV_NAME_CONSTANT_PATTERN =
  /\b[A-Z][A-Z0-9_]*_ENV\s*=\s*(['"])([A-Z][A-Z0-9_]*)\1/g;

function listScannedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", ...SCANNED_DIRECTORIES], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return output
    .split("\n")
    .filter((file) => SOURCE_FILE_EXTENSIONS.has(path.extname(file)));
}

function isDefined(value: string | undefined): value is string {
  return value !== undefined;
}

function extractMatches(
  content: string,
  pattern: RegExp,
  group: number,
): string[] {
  return [...content.matchAll(pattern)]
    .map((match) => match[group])
    .filter(isDefined);
}

/** Toda variable que el código bajo `src/`, `scripts/` y `tests/` lee de
 * `process.env`, directa o indirectamente a través de una constante `*_ENV`. */
export function findEnvVarsReadByCode(): Set<string> {
  const names = new Set<string>();

  for (const file of listScannedFiles()) {
    const content = readFileSync(path.join(REPO_ROOT, file), "utf8");
    for (const name of extractMatches(content, DIRECT_ACCESS_PATTERN, 1)) {
      names.add(name);
    }
    for (const name of extractMatches(content, BRACKET_ACCESS_PATTERN, 2)) {
      names.add(name);
    }
    for (const name of extractMatches(content, ENV_NAME_CONSTANT_PATTERN, 2)) {
      names.add(name);
    }
  }

  for (const ignored of IGNORED_ENV_VARS) {
    names.delete(ignored);
  }
  return names;
}

export function readEnvExampleContent(): string {
  return readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
}

/** Nombres de variable declarados en `.env.example` (una por línea, forma
 * `NOMBRE=valor`). */
export function readEnvExampleNames(): Set<string> {
  return new Set(
    extractMatches(readEnvExampleContent(), /^([A-Z_][A-Z0-9_]*)=/gm, 1),
  );
}

/** Nombres de `used` que no están en `documented`, en el orden en que
 * aparecen. Separada de `findEnvVarsReadByCode` para poder probar el mensaje
 * de fallo con nombres sintéticos, sin depender del estado real del repo. */
export function findUndocumentedEnvVars(
  used: ReadonlySet<string>,
  documented: ReadonlySet<string>,
): string[] {
  return [...used].filter((name) => !documented.has(name));
}
