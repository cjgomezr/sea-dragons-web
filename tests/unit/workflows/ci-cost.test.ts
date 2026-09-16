import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github/workflows");
const BROWSERS_ACTION = ".github/actions/playwright-browsers";
const BROWSERS_ACTION_PATH = path.join(
  REPO_ROOT,
  BROWSERS_ACTION,
  "action.yml",
);
/** Donde Playwright deja los navegadores en Linux, que es el único sistema en
 * el que corre CI. La caché guarda exactamente esta ruta. */
const BROWSER_CACHE_PATH = "~/.cache/ms-playwright";

const VISUAL = "visual-baselines.yml";
const MIGRATIONS = "migrations.yml";
const CHECKS = "checks.yml";

const ONLY_DOCS = ["docs/prd/e17.md", "README.md"];

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
}

interface Job {
  if?: string;
  needs?: string | string[];
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  steps?: Step[];
}

interface Trigger {
  branches?: string[];
  types?: string[];
  paths?: string[];
}

interface Workflow {
  on: {
    pull_request?: Trigger;
    push?: Trigger;
    workflow_dispatch?: unknown;
  };
  jobs: Record<string, Job>;
}

function readWorkflow(fileName: string): Workflow {
  return load(
    readFileSync(path.join(WORKFLOWS_DIR, fileName), "utf8"),
  ) as Workflow;
}

function readBrowsersActionSteps(): Step[] {
  const action = load(readFileSync(BROWSERS_ACTION_PATH, "utf8")) as {
    runs: { steps: Step[] };
  };
  return action.runs.steps;
}

function allSteps(fileName: string): Step[] {
  return Object.values(readWorkflow(fileName).jobs).flatMap(
    (job) => job.steps ?? [],
  );
}

/** Marca de paso para `**` mientras se traduce el patrón: sin ella, el `*`
 * simple del paso siguiente se comería la mitad de cada `**`. Es texto ASCII
 * corriente a propósito: un centinela con un byte fuera de rango convertiría
 * este archivo en binario para git, y nadie podría leer su diff en el PR. */
const MARCA_DOBLE_ASTERISCO = "@@DOBLE-ASTERISCO@@";

/**
 * Traduce un patrón de `paths:` de Actions a una expresión regular. Actions
 * usa un glob anclado a la raíz del repositorio donde `*` no cruza `/` y `**`
 * sí. Se traduce en vez de comparar la lista literal porque lo que importa no
 * es qué cadenas están escritas, sino qué cambios disparan el workflow.
 */
function toRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, MARCA_DOBLE_ASTERISCO)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(MARCA_DOBLE_ASTERISCO, "g"), ".*");
  return new RegExp(`^${source}$`);
}

function wouldRun(fileName: string, changedFiles: readonly string[]): boolean {
  const { paths } = readWorkflow(fileName).on.pull_request ?? {};
  if (!paths) {
    return true;
  }
  return changedFiles.some((file) =>
    paths.some((pattern) => toRegExp(pattern).test(file)),
  );
}

describe("filtros de ruta", () => {
  it("el workflow visual declara las rutas de la interfaz", () => {
    expect(readWorkflow(VISUAL).on.pull_request?.paths).toBeDefined();
  });

  it("el workflow visual no corre con un cambio que sólo toca docs/", () => {
    expect(wouldRun(VISUAL, ONLY_DOCS)).toBe(false);
  });

  it.each([
    "src/app/page.tsx",
    "src/components/boton.tsx",
    "tests/ui.spec.ts",
    "tests/theme.spec.ts",
    // playwright.config.ts corre `**/*.spec.ts` bajo ./tests, carpetas
    // incluidas: el filtro tiene que cubrir lo mismo que la suite ejecuta.
    "tests/e2e/rsvp.spec.ts",
    "tests/support/playwright-global-setup.ts",
    "tests/ui.spec.ts-snapshots/panel-desktop-light-chromium-linux.png",
    "playwright.config.ts",
    "next.config.ts",
    "package-lock.json",
  ])("el workflow visual corre cuando el cambio toca %s", (file) => {
    expect(wouldRun(VISUAL, [file])).toBe(true);
  });

  it("el workflow de migraciones declara las rutas de la base", () => {
    expect(readWorkflow(MIGRATIONS).on.pull_request?.paths).toBeDefined();
  });

  it("el workflow de migraciones no corre con un cambio que sólo toca docs/", () => {
    expect(wouldRun(MIGRATIONS, ONLY_DOCS)).toBe(false);
  });

  it.each([
    "supabase/migrations/0042_asistencia.sql",
    "supabase/ci/roles.sql",
    "scripts/apply-migrations.sh",
    "scripts/check-schema-snapshot.sh",
    "scripts/lib/schema-drift.sh",
    "tests/unit/supabase/0042_asistencia.test.ts",
    "tests/unit/scripts/apply-migrations.test.ts",
    // Todos los tests de tests/unit/supabase/ importan este módulo, y es el
    // que decide si se saltan por falta de Postgres. Romperlo no lo caza nadie
    // más: en `npm test` esos tests se auto-saltan.
    "tests/support/postgres.ts",
    "vitest.config.mts",
    "vitest.setup.ts",
  ])("el workflow de migraciones corre cuando el cambio toca %s", (file) => {
    expect(wouldRun(MIGRATIONS, [file])).toBe(true);
  });

  // Renombrar una migración ya aplicada rompe el histórico sin tocar ningún
  // otro archivo, y es uno de los casos que este workflow existe para cazar.
  // Sigue dentro del filtro porque un rename aparece en el diff con las dos
  // rutas, y las dos caen bajo supabase/.
  it("un rename dentro de supabase/migrations sigue disparando migraciones", () => {
    const rename = [
      "supabase/migrations/0007_socios.sql",
      "supabase/migrations/0008_socios.sql",
    ];

    expect(wouldRun(MIGRATIONS, rename)).toBe(true);
  });

  it("un cambio que toca a la vez interfaz y base dispara los dos workflows", () => {
    const both = [
      "src/app/socios/page.tsx",
      "supabase/migrations/0042_asistencia.sql",
    ];

    expect(wouldRun(VISUAL, both)).toBe(true);
    expect(wouldRun(MIGRATIONS, both)).toBe(true);
  });

  // Un filtro que deja fuera su propio workflow no se puede probar al
  // cambiarlo: el PR que lo edita no lo dispara.
  it.each([
    [VISUAL, `.github/workflows/${VISUAL}`],
    [MIGRATIONS, `.github/workflows/${MIGRATIONS}`],
  ])("%s se dispara a sí mismo cuando alguien lo edita", (workflow, file) => {
    expect(wouldRun(workflow, [file])).toBe(true);
  });

  it("el visual se dispara cuando cambia la acción de navegadores que usa", () => {
    expect(wouldRun(VISUAL, [`${BROWSERS_ACTION}/action.yml`])).toBe(true);
  });

  // Sin esto, el push a main compararía contra un filtro distinto al del PR:
  // o gastaría de más, o dejaría de vigilar lo que el PR sí vigilaba.
  it.each([VISUAL, MIGRATIONS])(
    "%s filtra el push a main por las mismas rutas que el pull request",
    (workflow) => {
      const { on } = readWorkflow(workflow);

      expect(on.push?.paths).toEqual(on.pull_request?.paths);
    },
  );

  // `checks` corre `npm test`, y ahí dentro hay tests que leen docs/
  // (tests/unit/entornos-doc.test.ts, tests/unit/prd-e2-doc.test.ts). Un
  // filtro de rutas dejaría pasar sin comprobar el PR que rompe uno de esos.
  it("checks no filtra por rutas, porque un cambio en docs/ puede romper sus tests", () => {
    const { on } = readWorkflow(CHECKS);

    expect(on.pull_request?.paths).toBeUndefined();
    expect(on.push?.paths).toBeUndefined();
  });

  // js-yaml resuelve las anclas, así que una lista escrita con `&x` / `*x`
  // pasaría todos los tests de arriba y reventaría en Actions, que no las
  // admite. La duplicación literal es el precio, y esto la vigila.
  it("ninguna lista de rutas usa anclas de YAML, que Actions no entiende", () => {
    for (const fileName of [VISUAL, MIGRATIONS, CHECKS]) {
      const source = readFileSync(path.join(WORKFLOWS_DIR, fileName), "utf8");

      expect(source, `en ${fileName}`).not.toMatch(/^\s*[\w-]+:\s*[&*][\w-]+/m);
    }
  });

  it("todos los patrones declarados tienen una forma que este test sabe evaluar", () => {
    // Si alguien escribe un patrón con negación o con `?`, toRegExp lo
    // traduciría mal y los tests de arriba pasarían sin probar nada.
    for (const workflow of [VISUAL, MIGRATIONS]) {
      const patterns = readWorkflow(workflow).on.pull_request?.paths ?? [];

      expect(patterns.length).toBeGreaterThan(0);
      for (const pattern of patterns) {
        expect(pattern, `patrón no soportado en ${workflow}`).toMatch(
          /^[A-Za-z0-9_./*-]+$/,
        );
      }
    }
  });
});

describe("caché de navegadores", () => {
  /** Los tres sitios que necesitan un chromium: el job de `checks` (varios
   * tests unitarios capturan UI de verdad) y los jobs `compare` y `accept`
   * del visual. */
  const INSTALLERS: ReadonlyArray<[string, string]> = [
    [CHECKS, "checks"],
    [VISUAL, "compare"],
    [VISUAL, "accept"],
  ];

  it.each(INSTALLERS)(
    "%s, job %s, instala los navegadores con la acción que los cachea",
    (workflow, jobName) => {
      const job = readWorkflow(workflow).jobs[jobName];

      expect(job).toBeDefined();
      expect((job?.steps ?? []).map((step) => step.uses)).toContain(
        `./${BROWSERS_ACTION}`,
      );
    },
  );

  it("ningún workflow instala navegadores a mano, saltándose la caché", () => {
    for (const fileName of [CHECKS, VISUAL, MIGRATIONS]) {
      for (const step of allSteps(fileName)) {
        expect(step.run ?? "", `en ${fileName}`).not.toMatch(
          /playwright install/,
        );
      }
    }
  });

  it("la acción restaura la caché antes de instalar nada", () => {
    const steps = readBrowsersActionSteps();
    const cacheIndex = steps.findIndex((step) =>
      step.uses?.startsWith("actions/cache"),
    );
    const firstInstall = steps.findIndex((step) =>
      step.run?.includes("playwright install"),
    );

    expect(cacheIndex).toBeGreaterThanOrEqual(0);
    expect(firstInstall).toBeGreaterThan(cacheIndex);
  });

  it("cachea la carpeta donde Playwright deja los navegadores", () => {
    const cache = readBrowsersActionSteps().find((step) =>
      step.uses?.startsWith("actions/cache"),
    );

    expect(cache?.with?.path).toContain(BROWSER_CACHE_PATH);
  });

  it("la clave de la caché lleva la versión de Playwright y el sistema", () => {
    const steps = readBrowsersActionSteps();
    const version = steps.find((step) => step.run?.includes("package-lock"));
    const cache = steps.find((step) => step.uses?.startsWith("actions/cache"));

    expect(version?.id).toBeTruthy();
    expect(cache?.with?.key).toContain(`steps.${version?.id}.outputs.`);
    expect(cache?.with?.key).toContain("runner.os");
  });

  // Sin `--with-deps` en el camino del fallo, un runner sin las bibliotecas
  // del sistema no podría lanzar el navegador. Con él en el camino del
  // acierto, la caché no ahorraría nada: los paquetes apt son casi todo lo
  // que este paso cuesta hoy.
  it("sólo paga las dependencias de sistema cuando la caché falla", () => {
    const withDeps = readBrowsersActionSteps().filter((step) =>
      step.run?.includes("--with-deps"),
    );

    expect(withDeps.length).toBeGreaterThan(0);
    for (const step of withDeps) {
      expect(step.if).toMatch(/cache-hit.*!=.*'true'/);
    }
  });
});

describe("main no repite el trabajo del PR", () => {
  const GATE_JOB = "arbol-ya-verificado";

  it("checks pregunta primero si ese árbol ya pasó en verde en el PR", () => {
    const gate = readWorkflow(CHECKS).jobs[GATE_JOB];

    expect(gate).toBeDefined();
    expect(Object.keys(gate?.outputs ?? {})).toContain("ya_verificado");
  });

  it("la pregunta sólo se hace en push a main, no en cada empujón a un PR", () => {
    // Un job que arranca cuesta un minuto facturado. En un PR no hay nada que
    // deduplicar, así que ahí ni siquiera debe arrancar.
    const gate = readWorkflow(CHECKS).jobs[GATE_JOB];

    expect(gate?.if).toMatch(/github\.event_name == 'push'/);
  });

  it("los checks se saltan sólo cuando la respuesta es que sí", () => {
    const checks = readWorkflow(CHECKS).jobs.checks;

    expect(checks?.needs).toContain(GATE_JOB);
    expect(checks?.if).toMatch(
      new RegExp(`needs\\.${GATE_JOB}\\.outputs\\.ya_verificado != 'true'`),
    );
  });

  // Sin `always()`, Actions exige implícitamente que la dependencia haya
  // terminado en success(), y en un pull request el job de la pregunta ni
  // siquiera arranca: los checks se saltarían en todos los PRs.
  it("los checks corren igual cuando la pregunta no llegó a hacerse", () => {
    expect(readWorkflow(CHECKS).jobs.checks?.if).toMatch(/always\(\)/);
  });

  it("la pregunta la responde un script del repositorio, no YAML pegado", () => {
    const gate = readWorkflow(CHECKS).jobs[GATE_JOB];
    const runs = (gate?.steps ?? []).map((step) => step.run ?? "").join("\n");

    expect(runs).toMatch(/checks-already-green-on-pr\.sh/);
  });

  it("la pregunta sólo pide permisos de lectura", () => {
    const gate = readWorkflow(CHECKS).jobs[GATE_JOB];

    expect(Object.values(gate?.permissions ?? {})).not.toContain("write");
    expect(gate?.permissions?.["pull-requests"]).toBe("read");
    expect(gate?.permissions?.actions).toBe("read");
  });

  // El visual es el único que puede desajustarse en main sin que ningún PR lo
  // note: el commit que `accept` empuja deja su comparación en
  // `action_required`, y si alguien mergea sin aprobarla, main llega con la
  // captura sin verificar. Por eso ahí no se deduplica nada.
  it("el visual sigue comparando en cada push a main", () => {
    const { on, jobs } = readWorkflow(VISUAL);

    expect(on.push?.branches).toContain("main");
    expect(jobs.compare?.if).toMatch(/push/);
    expect(jobs["report-incident"]).toBeDefined();
  });
});
