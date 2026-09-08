import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCANNED_DIRECTORIES = ["src", "scripts", "tests"] as const;
const SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

// process.env.PATH sólo extiende el PATH heredado del proceso al lanzar
// subprocesos en tests: no es configuración de la aplicación. Documentarla
// invitaría a poner un valor de PATH en .env.local, y eso rompería el shell
// de quien lo intentara.
const IGNORED_ENV_VARS = new Set(["PATH"]);

/** Variables que nunca pueden llevar el prefijo `NEXT_PUBLIC_`: exponerlas al
 * navegador filtraría una credencial de servidor. Cuando E12 añada las de
 * Stripe (`STRIPE_SECRET_KEY`), se añaden aquí. */
export const SECRET_ENV_VARS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
] as const;

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
