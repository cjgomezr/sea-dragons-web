import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_NAMES,
  type EnvironmentManifest,
  environmentsFor,
  findScopeViolations,
  findVariablesWithoutEnvironment,
  parseEnvironmentManifest,
  readEnvironmentManifest,
  secretVariableNames,
} from "../../scripts/lib/entornos-manifest";
import {
  PLATFORM_INJECTED_ENV_VARS,
  readEnvExampleNames,
} from "../support/env-vars";

const PRODUCTION_SOURCE = "seadragons-prod";
const DEVELOPMENT_SOURCE = "seadragons-dev";

/** Manifiesto mínimo y sano, para poder alterar una sola cosa en cada test y
 * saber que el fallo viene de esa cosa. */
function buildManifest(
  variables: EnvironmentManifest["variables"],
): EnvironmentManifest {
  return parseEnvironmentManifest({
    environments: {
      local: {
        where: "un .env.local",
        allowsProductionSources: false,
        allowsWriteCredentials: true,
      },
      preview: {
        where: "el ámbito Preview de Vercel",
        allowsProductionSources: false,
        allowsWriteCredentials: false,
      },
      production: {
        where: "el ámbito Production de Vercel",
        allowsProductionSources: true,
        allowsWriteCredentials: true,
      },
      ci: {
        where: "los secretos de Actions",
        allowsProductionSources: false,
        allowsWriteCredentials: false,
      },
    },
    sources: {
      [DEVELOPMENT_SOURCE]: { production: false },
      [PRODUCTION_SOURCE]: { production: true },
    },
    variables,
  });
}

function scopes(
  overrides: Partial<Record<(typeof ENVIRONMENT_NAMES)[number], string | null>>,
): Record<string, string | null> {
  return {
    local: null,
    preview: null,
    production: null,
    ci: null,
    ...overrides,
  };
}

describe("manifiesto de entornos", () => {
  it("se lee y valida sin errores", () => {
    expect(() => readEnvironmentManifest()).not.toThrow();
  });

  it("el conjunto de preview no contiene ninguna variable marcada como de producción", () => {
    const violations = findScopeViolations(readEnvironmentManifest());

    expect(
      violations.map((violation) => violation.message),
      violations.map((violation) => violation.message).join("\n"),
    ).toEqual([]);
  });

  it("falla nombrando la variable cuando se cuela una de producción en preview", () => {
    const manifest = buildManifest({
      NEXT_PUBLIC_SUPABASE_URL: {
        secret: false,
        writeCredential: false,
        scopes: scopes({
          preview: PRODUCTION_SOURCE,
          production: PRODUCTION_SOURCE,
        }),
      },
    });

    const violations = findScopeViolations(manifest);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.variable).toBe("NEXT_PUBLIC_SUPABASE_URL");
    expect(violations[0]?.environment).toBe("preview");
    expect(violations[0]?.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("acepta una credencial de producción en el entorno de producción", () => {
    const manifest = buildManifest({
      NEXT_PUBLIC_SUPABASE_URL: {
        secret: false,
        writeCredential: false,
        scopes: scopes({
          preview: DEVELOPMENT_SOURCE,
          production: PRODUCTION_SOURCE,
        }),
      },
    });

    expect(findScopeViolations(manifest)).toEqual([]);
  });

  it("falla nombrando la variable cuando una credencial de escritura llega a preview", () => {
    const manifest = buildManifest({
      SUPABASE_SERVICE_ROLE_KEY: {
        secret: true,
        writeCredential: true,
        scopes: scopes({ preview: DEVELOPMENT_SOURCE }),
      },
    });

    const violations = findScopeViolations(manifest);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(violations[0]?.message).toContain("escritura");
  });

  it("rechaza un manifiesto que usa un origen que no declara", () => {
    expect(() =>
      buildManifest({
        UNA_VARIABLE: {
          secret: false,
          writeCredential: false,
          scopes: scopes({ local: "un-origen-inventado" }),
        },
      }),
    ).toThrowError(/un-origen-inventado/);
  });

  it("obliga a declarar los cuatro entornos de cada variable, aunque sea con null", () => {
    expect(() =>
      buildManifest({
        UNA_VARIABLE: {
          secret: false,
          writeCredential: false,
          // Sin `ci`: omitir un entorno sería decidir por descuido.
          scopes: {
            local: DEVELOPMENT_SOURCE,
            preview: null,
            production: null,
          },
        } as never,
      }),
    ).toThrow();
  });

  it("toda variable de .env.example está asignada a al menos un entorno", () => {
    const manifest = readEnvironmentManifest();

    const missing = [...readEnvExampleNames()].filter(
      (name) => environmentsFor(manifest, name).length === 0,
    );

    expect(
      missing,
      `sin entorno en ${JSON.stringify(missing)}: añádelas a entornos.json`,
    ).toEqual([]);
  });

  it("no declara ninguna variable huérfana, sin un solo entorno", () => {
    expect(findVariablesWithoutEnvironment(readEnvironmentManifest())).toEqual(
      [],
    );
  });

  it("no declara ninguna variable que no exista ni en .env.example ni en la plataforma", () => {
    const manifest = readEnvironmentManifest();
    const known = new Set<string>([
      ...readEnvExampleNames(),
      ...PLATFORM_INJECTED_ENV_VARS,
    ]);

    const unknown = Object.keys(manifest.variables).filter(
      (name) => !known.has(name),
    );

    expect(unknown, `sobran en entornos.json: ${unknown.join(", ")}`).toEqual(
      [],
    );
  });

  it("sólo el entorno de producción admite credenciales del proyecto de producción", () => {
    const manifest = readEnvironmentManifest();

    const permissive = ENVIRONMENT_NAMES.filter(
      (name) => manifest.environments[name]?.allowsProductionSources === true,
    );

    expect(permissive).toEqual(["production"]);
  });

  // Un preview de un fork se construye con las variables del ámbito Preview.
  // Si ahí no hay ninguna credencial de escritura, el fork tampoco puede
  // recibirla: la garantía es de construcción, no de confianza.
  it("preview no lleva ninguna credencial de escritura, ni siquiera de desarrollo", () => {
    const manifest = readEnvironmentManifest();

    const writers = Object.entries(manifest.variables)
      .filter(([, variable]) => variable.writeCredential)
      .filter(([name]) => environmentsFor(manifest, name).includes("preview"))
      .map(([name]) => name);

    expect(writers).toEqual([]);
  });

  it("ninguna variable secreta lleva el prefijo NEXT_PUBLIC_", () => {
    for (const name of secretVariableNames(readEnvironmentManifest())) {
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it("marca como secreta la llave de servicio y el token de cuenta", () => {
    expect(secretVariableNames(readEnvironmentManifest())).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ACCESS_TOKEN",
    ]);
  });
});

// Las reglas de arriba se apoyan en marcas del propio manifiesto, así que
// apagar una marca apagaría la regla que la usa y la suite seguiría en verde
// con la URL de producción en preview. Esto fija las decisiones, no la
// mecánica: cambiarlas exige tocar este test, que es donde hay que discutirlas.
describe("decisiones que el manifiesto no puede cambiar en silencio", () => {
  it("sólo seadragons-prod cuenta como origen de producción", () => {
    const { sources } = readEnvironmentManifest();

    expect(sources[PRODUCTION_SOURCE]?.production).toBe(true);
    expect(
      Object.entries(sources)
        .filter(([, rules]) => rules.production)
        .map(([name]) => name),
    ).toEqual([PRODUCTION_SOURCE]);
  });

  // Sin fijarlo, encender `ci.allowsWriteCredentials` apagaría esa mitad de la
  // regla sin que nada se pusiera rojo.
  it("sólo local y producción admiten credenciales de escritura", () => {
    const { environments } = readEnvironmentManifest();

    expect(
      ENVIRONMENT_NAMES.filter(
        (name) => environments[name]?.allowsWriteCredentials,
      ),
    ).toEqual(["local", "production"]);
  });

  it("la llave de servicio y el token de cuenta son credenciales de escritura", () => {
    const { variables } = readEnvironmentManifest();

    expect(variables["SUPABASE_SERVICE_ROLE_KEY"]?.writeCredential).toBe(true);
    expect(variables["SUPABASE_ACCESS_TOKEN"]?.writeCredential).toBe(true);
  });

  it("preview apunta a desarrollo y producción a producción", () => {
    const { variables } = readEnvironmentManifest();

    for (const name of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]) {
      expect(variables[name]?.scopes.preview).toBe(DEVELOPMENT_SOURCE);
      expect(variables[name]?.scopes.production).toBe(PRODUCTION_SOURCE);
    }
  });

  it("la llave de servicio no existe en preview y en producción es la de producción", () => {
    const serviceRoleKey =
      readEnvironmentManifest().variables["SUPABASE_SERVICE_ROLE_KEY"];

    expect(serviceRoleKey?.scopes.preview).toBeNull();
    expect(serviceRoleKey?.scopes.production).toBe(PRODUCTION_SOURCE);
  });

  it("no contiene ningún valor, sólo nombres de variable y de origen", () => {
    const raw = JSON.stringify(readEnvironmentManifest());

    expect(raw).not.toMatch(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );
    expect(raw).not.toMatch(/sb_[a-z]+_/);
  });
});
