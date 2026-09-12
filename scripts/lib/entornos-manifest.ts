import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

export const ENVIRONMENT_MANIFEST_PATH = "entornos.json";

/** Los sitios donde puede vivir una variable de esta aplicación. Un `null` en
 * `scopes` significa que la variable no existe ahí, que es distinto de existir
 * vacía.
 *
 * `ci` y `ci-produccion` son los dos ámbitos de GitHub Actions y la diferencia
 * importa: `ci` son los secretos del repositorio, que lee cualquier workflow
 * (el que construye un PR incluido), y `ci-produccion` son los del entorno
 * Production, que sólo recibe el job que lo declara. Esa segunda puerta es la
 * única por la que una credencial de producción entra en CI. */
export const ENVIRONMENT_NAMES = [
  "local",
  "preview",
  "production",
  "ci",
  "ci-produccion",
] as const;

export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

const environmentSchema = z.object({
  /** Dónde se pega el valor, en palabras que se puedan seguir sin pensar.
   * La tabla de rotación de `docs/entornos.md` copia este texto tal cual. */
  where: z.string().min(1),
  allowsProductionSources: z.boolean(),
  allowsWriteCredentials: z.boolean(),
  /** Por qué este entorno admite credenciales de escritura, y qué control lo
   * compensa. Obligatorio cuando las admite: es la decisión que más caro
   * cuesta equivocar, y quien quiera aflojarla en otro entorno merece
   * encontrarse con el razonamiento antes que con el interruptor. */
  whyWriteCredentials: z.string().min(1).optional(),
});

const sourceSchema = z.object({
  /** De dónde sale el valor: `true` sólo para lo que pertenece al proyecto de
   * producción. Es la marca que hace posible el chequeo de RF-4. */
  production: z.boolean(),
});

const variableSchema = z.object({
  secret: z.boolean(),
  /** Credencial que puede escribir en una base de Supabase de este proyecto.
   * La conexión desechable de los tests de migraciones no lo es: nunca apunta
   * a Supabase. */
  writeCredential: z.boolean(),
  scopes: z.record(z.enum(ENVIRONMENT_NAMES), z.string().nullable()),
});

const manifestSchema = z.object({
  environments: z.record(z.enum(ENVIRONMENT_NAMES), environmentSchema),
  sources: z.record(z.string(), sourceSchema),
  variables: z.record(z.string(), variableSchema),
});

export type EnvironmentManifest = z.infer<typeof manifestSchema>;
export type ManifestVariable = z.infer<typeof variableSchema>;

function findUnknownSources(manifest: EnvironmentManifest): string[] {
  const declared = new Set(Object.keys(manifest.sources));
  const used = Object.values(manifest.variables).flatMap((variable) =>
    Object.values(variable.scopes).filter((source) => source !== null),
  );
  return [...new Set(used)].filter((source) => !declared.has(source));
}

function findUnexplainedWriteCredentials(
  manifest: EnvironmentManifest,
): string[] {
  return Object.entries(manifest.environments)
    .filter(
      ([, rules]) =>
        rules.allowsWriteCredentials && rules.whyWriteCredentials === undefined,
    )
    .map(([name]) => name);
}

/** Valida el manifiesto y devuelve su contenido. Falla ruidosamente: un
 * manifiesto mal formado deja sin sentido a todo lo que se apoya en él. */
export function parseEnvironmentManifest(raw: unknown): EnvironmentManifest {
  const manifest = manifestSchema.parse(raw);

  const unknownSources = findUnknownSources(manifest);
  if (unknownSources.length > 0) {
    throw new Error(
      `el manifiesto usa orígenes que no declara: ${unknownSources.join(", ")}`,
    );
  }

  const unexplained = findUnexplainedWriteCredentials(manifest);
  if (unexplained.length > 0) {
    throw new Error(
      "estos entornos admiten credenciales de escritura sin decir por qué " +
        `en whyWriteCredentials: ${unexplained.join(", ")}`,
    );
  }
  return manifest;
}

export function readEnvironmentManifest(): EnvironmentManifest {
  const file = path.join(REPO_ROOT, ENVIRONMENT_MANIFEST_PATH);
  return parseEnvironmentManifest(JSON.parse(readFileSync(file, "utf8")));
}

export type ScopeViolation = {
  readonly variable: string;
  readonly environment: EnvironmentName;
  readonly message: string;
};

/** Un chequeo de seguridad que ante la duda dice "todo bien" no es un chequeo.
 * Cuando al manifiesto le falta un dato, esto falla nombrándolo en vez de dar
 * por buena la asignación que no supo evaluar. */
function requireDeclared<T>(value: T | undefined, missing: string): T {
  if (value === undefined) {
    throw new Error(`el manifiesto no declara ${missing}`);
  }
  return value;
}

function checkScope(
  manifest: EnvironmentManifest,
  variableName: string,
  environment: EnvironmentName,
): ScopeViolation | null {
  const variable = requireDeclared(
    manifest.variables[variableName],
    `la variable ${variableName}`,
  );
  const source = variable.scopes[environment];
  if (source === null || source === undefined) {
    return null;
  }

  const rules = requireDeclared(
    manifest.environments[environment],
    `el entorno ${environment}`,
  );
  const sourceRules = requireDeclared(
    manifest.sources[source],
    `el origen ${source}, que usa ${variableName}`,
  );

  if (sourceRules.production && !rules.allowsProductionSources) {
    return {
      variable: variableName,
      environment,
      message: `${variableName} sale de ${source} en el entorno ${environment}, que no admite credenciales de producción`,
    };
  }

  if (variable.writeCredential && !rules.allowsWriteCredentials) {
    return {
      variable: variableName,
      environment,
      message: `${variableName} puede escribir en Supabase y el entorno ${environment} no admite credenciales de escritura`,
    };
  }
  return null;
}

function isViolation(value: ScopeViolation | null): value is ScopeViolation {
  return value !== null;
}

/** Toda asignación del manifiesto que rompe la separación por entorno: una
 * credencial de producción fuera de producción, o una de escritura en un
 * entorno que no las admite. */
export function findScopeViolations(
  manifest: EnvironmentManifest,
): ScopeViolation[] {
  return Object.keys(manifest.variables).flatMap((variableName) =>
    ENVIRONMENT_NAMES.map((environment) =>
      checkScope(manifest, variableName, environment),
    ).filter(isViolation),
  );
}

/** Entornos en los que la variable existe, en el orden de `ENVIRONMENT_NAMES`. */
export function environmentsFor(
  manifest: EnvironmentManifest,
  variableName: string,
): EnvironmentName[] {
  const variable = manifest.variables[variableName];
  if (variable === undefined) {
    return [];
  }
  return ENVIRONMENT_NAMES.filter((environment) => {
    const source = variable.scopes[environment];
    return source !== null && source !== undefined;
  });
}

/** Variables que el manifiesto declara en `environment` con ese origen
 * concreto, en el orden del manifiesto. Responde "qué credenciales de
 * `seadragons-dev` lleva CI", que es lo que un workflow tiene que pasarle a
 * sus tests. */
export function variablesFromSource(
  manifest: EnvironmentManifest,
  environment: EnvironmentName,
  source: string,
): string[] {
  return Object.entries(manifest.variables)
    .filter(([, variable]) => variable.scopes[environment] === source)
    .map(([name]) => name);
}

/** Variables sin un solo entorno asignado. Una variable así está documentada a
 * medias: nadie sabe dónde ponerla. */
export function findVariablesWithoutEnvironment(
  manifest: EnvironmentManifest,
): string[] {
  return Object.keys(manifest.variables).filter(
    (name) => environmentsFor(manifest, name).length === 0,
  );
}

/** Nombres de las variables marcadas como secretas, en el orden del manifiesto. */
export function secretVariableNames(manifest: EnvironmentManifest): string[] {
  return Object.entries(manifest.variables)
    .filter(([, variable]) => variable.secret)
    .map(([name]) => name);
}
