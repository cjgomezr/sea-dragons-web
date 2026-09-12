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
  variablesFromSource,
} from "../../scripts/lib/entornos-manifest";
import {
  CI_ONLY_SECRET_ENV_VARS,
  PLATFORM_INJECTED_ENV_VARS,
  readEnvExampleNames,
} from "../support/env-vars";

const PRODUCTION_SOURCE = "seadragons-prod";
const DEVELOPMENT_SOURCE = "seadragons-dev";

/** Entornos del manifiesto sintético, con las mismas decisiones que el real:
 * preview no escribe, CI sí desde el issue #149. */
const ENVIRONMENTS = {
  local: {
    where: "un .env.local",
    allowsProductionSources: false,
    allowsWriteCredentials: true,
    whyWriteCredentials: "es la máquina de quien desarrolla",
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
    whyWriteCredentials: "es el despliegue que sirve a los socios",
  },
  ci: {
    where: "los secretos de Actions",
    allowsProductionSources: false,
    allowsWriteCredentials: true,
    whyWriteCredentials: "el guardia de entorno sólo admite desarrollo",
  },
  "ci-produccion": {
    where: "los secretos del entorno Production de Actions",
    allowsProductionSources: true,
    allowsWriteCredentials: true,
    whyWriteCredentials: "es por donde las migraciones llegan a producción",
  },
} as const;

/** Manifiesto mínimo y sano, para poder alterar una sola cosa en cada test y
 * saber que el fallo viene de esa cosa. */
function buildManifest(
  variables: EnvironmentManifest["variables"],
): EnvironmentManifest {
  return parseEnvironmentManifest({
    environments: ENVIRONMENTS,
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
    "ci-produccion": null,
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

  // Las tres que necesita un runner para abrir una sesión de verdad: sin
  // ellas, las pruebas que viven detrás del login se saltan y el check sale
  // verde sin haber probado nada (issue #149).
  it("acepta las tres credenciales de desarrollo en CI", () => {
    const manifest = buildManifest({
      NEXT_PUBLIC_SUPABASE_URL: {
        secret: false,
        writeCredential: false,
        scopes: scopes({ ci: DEVELOPMENT_SOURCE }),
      },
      NEXT_PUBLIC_SUPABASE_ANON_KEY: {
        secret: false,
        writeCredential: false,
        scopes: scopes({ ci: DEVELOPMENT_SOURCE }),
      },
      SUPABASE_SERVICE_ROLE_KEY: {
        secret: true,
        writeCredential: true,
        scopes: scopes({ ci: DEVELOPMENT_SOURCE }),
      },
    });

    expect(findScopeViolations(manifest)).toEqual([]);
  });

  it("falla nombrando la variable cuando un origen de producción llega a CI", () => {
    const manifest = buildManifest({
      SUPABASE_SERVICE_ROLE_KEY: {
        secret: true,
        writeCredential: true,
        scopes: scopes({ ci: PRODUCTION_SOURCE }),
      },
    });

    const violations = findScopeViolations(manifest);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.variable).toBe("SUPABASE_SERVICE_ROLE_KEY");
    expect(violations[0]?.environment).toBe("ci");
    expect(violations[0]?.message).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  // Admitir credenciales de escritura es la decisión que más caro cuesta
  // equivocar, así que el manifiesto no la deja tomar en silencio: quien la
  // encienda tiene que escribir qué control la compensa.
  it("rechaza un entorno que admite credenciales de escritura sin decir por qué", () => {
    expect(() =>
      parseEnvironmentManifest({
        environments: {
          ...ENVIRONMENTS,
          preview: {
            where: "el ámbito Preview de Vercel",
            allowsProductionSources: false,
            allowsWriteCredentials: true,
          },
        },
        sources: { [DEVELOPMENT_SOURCE]: { production: false } },
        variables: {},
      }),
    ).toThrowError(/preview/);
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

  it("obliga a declarar todos los entornos de cada variable, aunque sea con null", () => {
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
            "ci-produccion": null,
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

  it("no declara ninguna variable que no exista ni en .env.example, ni en la plataforma, ni en los secretos de CI", () => {
    const manifest = readEnvironmentManifest();
    const known = new Set<string>([
      ...readEnvExampleNames(),
      ...PLATFORM_INJECTED_ENV_VARS,
      ...CI_ONLY_SECRET_ENV_VARS,
    ]);

    const unknown = Object.keys(manifest.variables).filter(
      (name) => !known.has(name),
    );

    expect(unknown, `sobran en entornos.json: ${unknown.join(", ")}`).toEqual(
      [],
    );
  });

  // `ci` son los secretos del repositorio, que cualquier workflow puede leer,
  // incluido el que construye un PR. `ci-produccion` son los del entorno
  // Production de Actions, que sólo recibe el job que declara ese entorno.
  // Distinguirlos es lo que permite que las migraciones lleguen a producción
  // (issue #94) sin abrirle producción a todo lo que corra en Actions.
  it("sólo producción y el entorno protegido de Actions admiten credenciales del proyecto de producción", () => {
    const manifest = readEnvironmentManifest();

    const permissive = ENVIRONMENT_NAMES.filter(
      (name) => manifest.environments[name]?.allowsProductionSources === true,
    );

    expect(permissive).toEqual(["production", "ci-produccion"]);
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

  it("marca como secreta la llave de servicio, el token de cuenta y la conexión a producción", () => {
    expect(secretVariableNames(readEnvironmentManifest())).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_PRODUCTION_DB_URL",
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

  // Sin fijarlo, encender `preview.allowsWriteCredentials` apagaría esa mitad
  // de la regla sin que nada se pusiera rojo. `ci` entró en la lista con el
  // issue #149, y el control que lo compensa es el guardia de entorno.
  it("todos los entornos menos preview admiten credenciales de escritura", () => {
    const { environments } = readEnvironmentManifest();

    expect(
      ENVIRONMENT_NAMES.filter(
        (name) => environments[name]?.allowsWriteCredentials,
      ),
    ).toEqual(["local", "production", "ci", "ci-produccion"]);
  });

  // El criterio del issue #149: sin estas tres en el runner, las pruebas que
  // viven detrás de la sesión se saltan y su check sale verde sin decidir
  // nada.
  it("CI recibe las tres credenciales de desarrollo, y sólo de desarrollo", () => {
    const manifest = readEnvironmentManifest();

    expect(variablesFromSource(manifest, "ci", DEVELOPMENT_SOURCE)).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(variablesFromSource(manifest, "ci", PRODUCTION_SOURCE)).toEqual([]);
  });

  // El porqué vive en el manifiesto y no sólo en el PR que lo cambió: la
  // siguiente persona que quiera aflojar una regla merece encontrarse con el
  // razonamiento antes que con el interruptor.
  it("cada entorno que admite credenciales de escritura explica por qué", () => {
    const { environments } = readEnvironmentManifest();

    for (const name of ENVIRONMENT_NAMES) {
      const environment = environments[name];
      if (!environment?.allowsWriteCredentials) {
        continue;
      }
      expect(
        environment.whyWriteCredentials,
        `el entorno ${name} admite escritura sin decir por qué`,
      ).toBeTruthy();
    }
  });

  it("el porqué de CI nombra el guardia de entorno, que es el control que lo compensa", () => {
    const ci = readEnvironmentManifest().environments.ci;

    expect(ci?.whyWriteCredentials).toContain("environment-guard");
  });

  // La credencial con la que el workflow del issue #94 aplica migraciones en
  // producción. Es la más peligrosa del proyecto: escribe en el esquema de la
  // base con datos reales. No existe en ninguna máquina ni en ningún ámbito de
  // Vercel, y tampoco en los secretos generales del repositorio.
  it("la conexión a producción sólo vive en el entorno protegido de Actions", () => {
    const manifest = readEnvironmentManifest();

    expect(environmentsFor(manifest, "SUPABASE_PRODUCTION_DB_URL")).toEqual([
      "ci-produccion",
    ]);
    expect(
      manifest.variables["SUPABASE_PRODUCTION_DB_URL"]?.scopes["ci-produccion"],
    ).toBe(PRODUCTION_SOURCE);
  });

  it("los secretos generales del repositorio no llevan ninguna credencial de producción", () => {
    // El ámbito `ci` lo lee cualquier workflow, el del PR incluido. Lo que
    // llegue ahí deja de estar separado de preview en la práctica.
    const manifest = readEnvironmentManifest();

    const desdeProduccion = Object.entries(manifest.variables)
      .filter(([, variable]) => {
        const source = variable.scopes.ci;
        return (
          source !== null &&
          source !== undefined &&
          manifest.sources[source]?.production === true
        );
      })
      .map(([name]) => name);

    expect(desdeProduccion).toEqual([]);
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
