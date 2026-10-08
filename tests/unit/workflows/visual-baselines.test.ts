import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  readEnvironmentManifest,
  variablesFromSource,
} from "../../../scripts/lib/entornos-manifest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github/workflows/visual-baselines.yml",
);

/** Los orígenes que el manifiesto pone en los secretos de CI. Desde el #537
 * la visual solo toma de ahí la cuenta de Stripe en modo de prueba (#454),
 * con la que Pagos ofrece Checkout; Supabase lo levanta cada tanda. */
const STRIPE_TEST_SOURCE = "stripe-test";
const DEVELOPMENT_DATABASE_SOURCE = "seadragons-dev";

const LOCAL_SUPABASE_ACTION = "./.github/actions/supabase-local";

/** Las variables que el manifiesto pone en CI desde un origen. Sale de ahí y
 * no de una lista escrita a mano: declarar una más en el manifiesto y
 * olvidarla en el workflow tiene que dejar esto en rojo. */
function ciVariablesFrom(source: string): string[] {
  return variablesFromSource(readEnvironmentManifest(), "ci", source);
}

/** Todo lo que el manifiesto pone en CI como de prueba: dev y Stripe. */
function developmentCredentials(): string[] {
  return [
    ...ciVariablesFrom(DEVELOPMENT_DATABASE_SOURCE),
    ...ciVariablesFrom(STRIPE_TEST_SOURCE),
  ];
}

function referencedSecrets(): string[] {
  const source = readFileSync(WORKFLOW_PATH, "utf8");
  return [
    ...new Set(
      [...source.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]),
    ),
  ].filter((name): name is string => name !== undefined);
}

interface WorkflowStep {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string | boolean>;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
}

interface WorkflowJob {
  if?: string;
  needs?: string | string[];
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  strategy?: {
    "fail-fast"?: boolean;
    matrix?: { shard?: number[] };
  };
  steps: WorkflowStep[];
}

interface WorkflowFile {
  on: {
    push?: { branches?: string[] };
    pull_request?: { types?: string[] };
    workflow_dispatch?: {
      inputs?: Record<string, { required?: boolean }>;
    } | null;
  };
  permissions: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

function parseWorkflow(): WorkflowFile {
  return load(readFileSync(WORKFLOW_PATH, "utf8")) as WorkflowFile;
}

function stepsOf(jobName: string): WorkflowStep[] {
  const job = parseWorkflow().jobs[jobName];
  if (!job) {
    throw new Error(`El workflow no declara el job "${jobName}".`);
  }
  return job.steps;
}

function stepNamed(jobName: string, stepName: string): WorkflowStep {
  const step = stepsOf(jobName).find(
    (candidate) => candidate.name === stepName,
  );
  if (!step) {
    throw new Error(`El job "${jobName}" no tiene el paso "${stepName}".`);
  }
  return step;
}

function runLines(jobName: string): string {
  return stepsOf(jobName)
    .map((step) => step.run ?? "")
    .join("\n");
}

describe("visual-baselines.yml", () => {
  it("parsea como YAML válido", () => {
    expect(() => parseWorkflow()).not.toThrow();
  });

  it("corre en cada pull request, no sólo cuando alguien se acuerda", () => {
    const { on } = parseWorkflow();

    expect(on.pull_request?.types).toContain("opened");
    expect(on.pull_request?.types).toContain("synchronize");
  });

  it("compara la línea base en los pull requests", () => {
    expect(parseWorkflow().jobs.compare?.if).toContain("pull_request");
    expect(runLines("compare")).toMatch(/npx playwright test/);
  });

  it("no regenera ni reescribe la línea base durante un pull request", () => {
    const runs = runLines("compare");

    expect(runs).not.toMatch(/--update-snapshots/);
    expect(runs).not.toMatch(/git commit/);
    expect(runs).not.toMatch(/git push/);
  });

  it("no pide permiso de escritura para comparar, que es lo que un fork no puede dar", () => {
    const workflow = parseWorkflow();

    expect(workflow.permissions.contents).toBe("read");
    expect(workflow.jobs.compare?.permissions).toBeUndefined();
  });

  it("guarda el diff cuando la comparación falla, para que quede algo que mirar", () => {
    const artifact = stepsOf("compare").find((step) =>
      step.uses?.startsWith("actions/upload-artifact"),
    );

    expect(artifact).toBeDefined();
    expect(artifact?.if).toBe("failure()");
  });

  it("acepta una línea base nueva sólo cuando un humano lanza el workflow", () => {
    const { accept, regenerate } = parseWorkflow().jobs;

    expect(accept).toBeDefined();
    expect(accept?.if).toContain("workflow_dispatch");
    expect(regenerate?.if).toContain("workflow_dispatch");
    expect(accept?.permissions?.contents).toBe("write");
    expect(runLines("regenerate")).toMatch(/update-visual-baselines\.sh/);
    expect(runLines("accept")).toMatch(/git push/);
  });

  it("pide la corrida revisada antes de aceptar, para que no sea un botón a ciegas", () => {
    const dispatch = parseWorkflow().on.workflow_dispatch;

    expect(dispatch?.inputs?.reviewed_run_url?.required).toBe(true);
    expect(runLines("accept")).toMatch(/reviewed_run_url/);
  });

  // Pagos ofrece Checkout sólo con Stripe configurado (#454): sin estas, el
  // estado `pagos-pendiente` fotografiaría "pagos sin configurar". Supabase ya
  // no viene de aquí: lo deja en el entorno la acción del Supabase local.
  it.each([
    ["compare", "Compara contra la línea base vinculante"],
    ["regenerate", "Regenera la línea base"],
  ])(
    "da al paso que corre Playwright en el job $0 las llaves de Stripe en modo de prueba que el manifiesto declara en CI",
    (jobName, stepName) => {
      const env = stepNamed(jobName, stepName).env ?? {};

      expect(Object.keys(env).sort()).toEqual(
        ciVariablesFrom(STRIPE_TEST_SOURCE).sort(),
      );
      for (const [name, value] of Object.entries(env)) {
        expect(value).toBe(`\${{ secrets.${name} }}`);
      }
    },
  );

  // La visual era la última que usaba `seadragons-dev` (#537, E20): cada
  // tanda compila y fotografía contra su propio Supabase.
  it("no pasa a ningún paso las credenciales de seadragons-dev", () => {
    const devVariables = ciVariablesFrom(DEVELOPMENT_DATABASE_SOURCE);
    const stepEnvNames = Object.values(parseWorkflow().jobs).flatMap((job) =>
      job.steps.flatMap((step) => Object.keys(step.env ?? {})),
    );

    expect(devVariables.length).toBeGreaterThan(0);
    expect(
      referencedSecrets().filter((name) => devVariables.includes(name)),
    ).toEqual([]);
    expect(stepEnvNames.filter((name) => devVariables.includes(name))).toEqual(
      [],
    );
  });

  // Una llave de escritura en el entorno del job la heredarían `npm ci` y
  // cualquier postinstall de una dependencia, que no tienen nada que hacer
  // con ella. Playwright arranca el dev server como hijo del paso, así que
  // acotarla al paso no le quita nada.
  it("no deja ninguna credencial de Supabase en el entorno de un job entero", () => {
    const credentials = new Set(developmentCredentials());

    for (const [name, job] of Object.entries(parseWorkflow().jobs)) {
      const leaked = Object.keys(job.env ?? {}).filter((key) =>
        credentials.has(key),
      );

      expect(leaked, `el job ${name} las declara a nivel de job`).toEqual([]);
    }
  });

  it("no referencia ningún secreto que no sea de Stripe en modo de prueba", () => {
    const permitted = new Set(ciVariablesFrom(STRIPE_TEST_SOURCE));

    expect(referencedSecrets().filter((name) => !permitted.has(name))).toEqual(
      [],
    );
  });

  it("no necesita ignorar sus propios commits, porque no los hace en un PR", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8");

    expect(source).not.toMatch(/github\.actor\s*!=/);
  });
});

describe("gate visual en main", () => {
  it("compara también en cada push a main, no sólo en pull requests", () => {
    const { on } = parseWorkflow();

    expect(on.push?.branches).toContain("main");
  });

  it("la comparación corre tanto en pull_request como en push", () => {
    const condition = parseWorkflow().jobs.compare?.if ?? "";

    expect(condition).toMatch(/pull_request/);
    expect(condition).toMatch(/push/);
  });

  it("el job que abre el incidente sólo corre en push y sólo cuando la comparación falló", () => {
    const job = parseWorkflow().jobs["report-incident"];

    expect(job).toBeDefined();
    expect(job?.needs).toContain("compare");
    expect(job?.if).toMatch(/push/);
    expect(job?.if).toMatch(/needs\.compare\.result\s*==\s*'failure'/);
    expect(job?.if).not.toMatch(/pull_request/);
  });

  it("el paso que abre el incidente invoca scripts/file-incident.sh, no gh issue create a pelo", () => {
    const runs = runLines("report-incident");

    expect(runs).toMatch(/report-visual-incident\.sh/);
    expect(runs).not.toMatch(/gh issue create/);
  });

  it("el job del incidente puede crear issues y leer el repo para el checkout", () => {
    const job = parseWorkflow().jobs["report-incident"];

    expect(job?.permissions?.issues).toBe("write");
    expect(job?.permissions?.contents).toBe("read");
  });

  it("el job del incidente corre aunque compare haya fallado, no sólo cuando compare tiene éxito", () => {
    const condition = parseWorkflow().jobs["report-incident"]?.if ?? "";

    expect(condition).toMatch(/always\(\)/);
  });

  it("avisa en el PR cuando accept empuja su commit", () => {
    const runs = runLines("accept");

    expect(runs).toMatch(/gh pr comment/);
  });

  it("el job accept puede comentar en el PR", () => {
    const accept = parseWorkflow().jobs.accept;

    expect(accept?.permissions?.["pull-requests"]).toBe("write");
  });
});

/** Los jobs que corren Playwright, repartidos en partes (#255). */
const SHARDED_JOBS = ["compare", "regenerate"] as const;

/** El paso de cada uno de esos jobs que lanza la suite. */
const PLAYWRIGHT_STEP: Record<(typeof SHARDED_JOBS)[number], string> = {
  compare: "Compara contra la línea base vinculante",
  regenerate: "Regenera la línea base",
};

const SHARD_ARGUMENT = "--shard=${{ matrix.shard }}/${{ strategy.job-total }}";

function stepUsing(jobName: string, action: string): WorkflowStep {
  const step = stepsOf(jobName).find(
    (candidate) => candidate.uses?.split("@")[0] === action,
  );
  if (!step) {
    throw new Error(`El job "${jobName}" no usa "${action}".`);
  }
  return step;
}

describe("reparto de la suite (#255)", () => {
  it.each(SHARDED_JOBS)(
    "el job %s reparte la suite en varias máquinas",
    (jobName) => {
      const shards = parseWorkflow().jobs[jobName]?.strategy?.matrix?.shard;

      expect(shards?.length).toBeGreaterThan(1);
    },
  );

  it.each(SHARDED_JOBS)(
    "el job %s deja terminar a todas las partes aunque una falle",
    (jobName) => {
      const strategy = parseWorkflow().jobs[jobName]?.strategy;

      expect(strategy?.["fail-fast"]).toBe(false);
    },
  );

  it.each(SHARDED_JOBS)(
    "cada parte del job %s corre sólo su tramo de la suite",
    (jobName) => {
      const step = stepNamed(jobName, PLAYWRIGHT_STEP[jobName]);

      expect(step.run).toContain(SHARD_ARGUMENT);
    },
  );

  it("cada parte guarda su diff con un nombre propio, que no pisa el de otra", () => {
    const artifact = stepUsing("compare", "actions/upload-artifact");

    expect(artifact.with?.name).toBe("visual-diff-${{ matrix.shard }}");
  });

  it("junta los diffs de las partes que fallaron en un solo artefacto visual-diff", () => {
    const job = parseWorkflow().jobs["visual-diff"];
    const merge = stepUsing("visual-diff", "actions/upload-artifact/merge");

    expect(job?.needs).toContain("compare");
    expect(job?.if).toMatch(/always\(\)/);
    expect(job?.if).toMatch(/needs\.compare\.result\s*==\s*'failure'/);
    expect(merge.with?.name).toBe("visual-diff");
    expect(merge.with?.pattern).toBe("visual-diff-*");
  });

  it("comprueba en cada PR que las partes suman la suite entera", () => {
    const job = parseWorkflow().jobs.reparto;

    expect(job?.if).toMatch(/pull_request/);
    expect(runLines("reparto")).toMatch(/npm run check:shards/);
  });
});

describe("aceptación repartida (#255)", () => {
  it("cada parte sube las capturas que regeneró", () => {
    const artifact = stepUsing("regenerate", "actions/upload-artifact");

    expect(artifact.with?.name).toBe("baseline-${{ matrix.shard }}");
    expect(artifact.with?.["if-no-files-found"]).toBe("error");
  });

  it("una parte que falló sin capturas que aceptar hunde la aceptación", () => {
    const runs = runLines("regenerate");

    expect(runs).toMatch(/no era de píxeles/);
    expect(runs).toMatch(/exit 1/);
  });

  // Sin función de estado en el `if`, Actions exige que todas las tandas de
  // `regenerate` hayan salido bien. Cualquier función de estado lo apagaría.
  it("commitea sólo cuando todas las partes terminaron bien", () => {
    const accept = parseWorkflow().jobs.accept;

    expect(accept?.needs).toContain("regenerate");
    expect(accept?.if).not.toMatch(/always\(\)|cancelled\(\)|failure\(\)/);
  });

  // Sin dependencias no hay un antepasado saltado que la deje sin correr, ni
  // nada a lo que esperar antes de empezar.
  it("regenerate arranca en cuanto se lanza la aceptación, sin esperar a nada", () => {
    const regenerate = parseWorkflow().jobs.regenerate;

    expect(regenerate?.needs).toBeUndefined();
    expect(regenerate?.if).toBe("github.event_name == 'workflow_dispatch'");
  });

  it("baja las capturas de todas las partes antes de commitear", () => {
    const download = stepUsing("accept", "actions/download-artifact");

    expect(download.with?.pattern).toBe("baseline-*");
    expect(runLines("accept")).toMatch(/tests\/ui\.spec\.ts-snapshots/);
  });

  // Las partes y el commit tienen que salir del mismo commit de la rama. Si
  // alguien empuja mientras se acepta, el push tiene que rechazarse en vez de
  // dejar capturas de un commit encima de otro.
  it.each(["regenerate", "accept"])(
    "el job %s parte del commit que se lanzó, no de la punta de la rama",
    (jobName) => {
      const checkout = stepUsing(jobName, "actions/checkout");

      expect(checkout.with?.ref).toBe("${{ github.sha }}");
    },
  );

  it("empuja a la rama lanzada sin forzar, para que un push ajeno lo rechace", () => {
    const runs = runLines("accept");

    expect(runs).toContain('git push origin "HEAD:${GITHUB_REF}"');
    expect(runs).not.toMatch(/--force/);
  });

  it("el job que regenera no puede escribir en el repositorio", () => {
    const regenerate = parseWorkflow().jobs.regenerate;

    expect(regenerate?.permissions?.contents).toBe("read");
    expect(runLines("regenerate")).not.toMatch(/git push/);
  });

  it("el job que empuja no recibe ninguna credencial de Supabase", () => {
    const credentials = new Set(developmentCredentials());
    const leaked = stepsOf("accept").flatMap((step) =>
      Object.keys(step.env ?? {}).filter((key) => credentials.has(key)),
    );

    expect(leaked).toEqual([]);
  });
});

describe("aplicación compilada en CI (#255)", () => {
  it.each(SHARDED_JOBS)(
    "el job %s compila la aplicación antes de correr Playwright",
    (jobName) => {
      const names = stepsOf(jobName).map((step) => step.name);
      const build = stepNamed(jobName, "Compila la aplicación");

      expect(build.run).toBe("npm run build");
      expect(names.indexOf("Compila la aplicación")).toBeLessThan(
        names.indexOf(PLAYWRIGHT_STEP[jobName]),
      );
    },
  );
});

const VISUAL_PATHS_LIST = path.join(REPO_ROOT, ".github/visual-paths.txt");

/** Las rutas del archivo compartido, sin comentarios ni líneas vacías. */
function readVisualPathsList(): string[] {
  return readFileSync(VISUAL_PATHS_LIST, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

// El Stop gate decide si corre Playwright con la misma lista que filtra este
// workflow (#415). Actions no sabe leer `paths` de un archivo, así que la
// lista vive en los dos sitios y este test impide que se separen.
describe("la lista de rutas visuales compartida con el Stop gate", () => {
  it("es la misma que filtra los pull requests", () => {
    const workflow = parseWorkflow() as {
      on: { pull_request?: { paths?: string[] } };
    };

    expect(readVisualPathsList()).toEqual(workflow.on.pull_request?.paths);
  });
});

const GATE_JOB = "arbol-ya-verificado";
const SKIP_UNLESS_VERIFIED = `needs.${GATE_JOB}.outputs.ya_verificado != 'true'`;

// Cada push a main repetía la visual entera sobre el árbol que su PR acababa
// de comparar en verde (#441). El job previo lo averigua en segundos.
describe("main no repite la visual que el PR ya pasó (#441)", () => {
  it("pregunta primero, en un job que expone ya_verificado", () => {
    const gate = parseWorkflow().jobs[GATE_JOB];

    expect(gate).toBeDefined();
    expect(Object.keys(gate?.outputs ?? {})).toContain("ya_verificado");
  });

  it("la pregunta sólo se hace en push, nunca en un PR ni en una aceptación", () => {
    expect(parseWorkflow().jobs[GATE_JOB]?.if).toBe(
      "github.event_name == 'push'",
    );
  });

  it("la responde el script compartido con checks.yml, apuntado a este workflow", () => {
    const step = stepsOf(GATE_JOB).find((candidate) =>
      candidate.run?.includes("checks-already-green-on-pr.sh"),
    );

    expect(step?.env?.WORKFLOW_FILE).toBe("visual-baselines.yml");
    expect(step?.env?.HEAD_COMMIT_MESSAGE).toBe(
      "${{ github.event.head_commit.message }}",
    );
  });

  it("la pregunta sólo pide permisos de lectura", () => {
    const permissions = parseWorkflow().jobs[GATE_JOB]?.permissions ?? {};

    expect(Object.values(permissions)).not.toContain("write");
    expect(permissions["pull-requests"]).toBe("read");
    expect(permissions.actions).toBe("read");
  });

  it("compare depende de la pregunta y se salta sólo cuando la respuesta es que sí", () => {
    const compare = parseWorkflow().jobs.compare;

    expect(compare?.needs).toContain(GATE_JOB);
    expect(compare?.if).toContain(SKIP_UNLESS_VERIFIED);
  });

  // En un pull request el job de la pregunta no arranca, y sin una función de
  // estado Actions saltaría también `compare`: todos los PRs sin visual. Tiene
  // que ser `!cancelled()` y no `always()`: al cancelar una corrida, GitHub no
  // corta un job cuyo `if` sigue dando true, y con `always()` un push nuevo al
  // PR dejaría las cuatro partes viejas contra `seadragons-dev` (#416).
  it("compare sigue corriendo en pull_request, donde la pregunta no se hace", () => {
    const condition = parseWorkflow().jobs.compare?.if ?? "";

    expect(condition).toMatch(/!cancelled\(\)/);
    expect(condition).not.toMatch(/always\(\)/);
    expect(condition).toMatch(/github\.event_name == 'pull_request'/);
    expect(condition).toMatch(/github\.event_name == 'push'/);
  });

  it("compare no arranca en una aceptación, igual que antes", () => {
    const condition = parseWorkflow().jobs.compare?.if ?? "";

    expect(condition).not.toMatch(/workflow_dispatch/);
  });

  // Un `compare` saltado deja su resultado en `skipped`, no en `failure`, así
  // que ni el incidente ni el diff tienen de qué partir.
  it.each(["report-incident", "visual-diff"])(
    "el job %s sólo reacciona a un compare que falló de verdad",
    (jobName) => {
      const condition = parseWorkflow().jobs[jobName]?.if ?? "";

      expect(condition).toMatch(/needs\.compare\.result\s*==\s*'failure'/);
    },
  );

  it("el reparto no se toca: sólo lista la suite, no la corre", () => {
    const reparto = parseWorkflow().jobs.reparto;

    expect(reparto?.needs).toBeUndefined();
  });

  it("la aceptación a mano no espera a la pregunta", () => {
    const { regenerate, accept } = parseWorkflow().jobs;

    expect(regenerate?.needs ?? []).not.toContain(GATE_JOB);
    expect(accept?.needs).toEqual("regenerate");
  });
});

function indexOfStep(
  jobName: string,
  predicate: (step: WorkflowStep) => boolean,
): number {
  return stepsOf(jobName).findIndex(predicate);
}

function needsOf(jobName: string): string[] {
  const needs = parseWorkflow().jobs[jobName]?.needs ?? [];
  return Array.isArray(needs) ? needs : [needs];
}

// Cada tanda es un runner distinto, así que cada una levanta el suyo (#537,
// E20). Ya no comparten `seadragons-dev`, ni con otras corridas ni entre sí.
describe("un Supabase local por tanda (#537)", () => {
  it.each(SHARDED_JOBS)(
    "el job %s sigue repartido en cuatro tandas",
    (jobName) => {
      expect(parseWorkflow().jobs[jobName]?.strategy?.matrix?.shard).toEqual([
        1, 2, 3, 4,
      ]);
    },
  );

  it.each(SHARDED_JOBS)(
    "el job %s levanta su Supabase con la acción del repositorio",
    (jobName) => {
      expect(stepUsing(jobName, LOCAL_SUPABASE_ACTION).if).toBeUndefined();
    },
  );

  // La acción arranca el CLI de `devDependencies`.
  it.each(SHARDED_JOBS)(
    "el job %s lo levanta después de instalar las dependencias",
    (jobName) => {
      const install = indexOfStep(jobName, (step) => step.run === "npm ci");
      const supabase = indexOfStep(
        jobName,
        (step) => step.uses === LOCAL_SUPABASE_ACTION,
      );

      expect(install).toBeGreaterThanOrEqual(0);
      expect(supabase).toBeGreaterThan(install);
    },
  );

  // El prerender lee la marca del club (#292): compilar sin base caería al
  // respaldo y fotografiaría un nombre que la base no tiene.
  it.each(SHARDED_JOBS)("el job %s lo levanta antes de compilar", (jobName) => {
    const supabase = indexOfStep(
      jobName,
      (step) => step.uses === LOCAL_SUPABASE_ACTION,
    );
    const build = indexOfStep(
      jobName,
      (step) => step.name === "Compila la aplicación",
    );

    expect(supabase).toBeLessThan(build);
  });

  it.each(SHARDED_JOBS)(
    "el job %s compila con lo que dejó la acción, sin secretos",
    (jobName) => {
      expect(stepNamed(jobName, "Compila la aplicación").env).toBeUndefined();
    },
  );

  it("no queda un job de turno en dev", () => {
    expect(parseWorkflow().jobs["turno-dev"]).toBeUndefined();
  });

  it.each(Object.keys(parseWorkflow().jobs))(
    "el job %s no espera turno en dev",
    (jobName) => {
      expect(needsOf(jobName)).not.toContain("turno-dev");
    },
  );

  // Esperar al `checks` del propio PR volvería a poner a la visual en fila.
  it.each(SHARDED_JOBS)(
    "el job %s no espera a ningún otro workflow",
    (jobName) => {
      expect(
        needsOf(jobName).every((need) => need in parseWorkflow().jobs),
      ).toBe(true);
      expect(runLines(jobName)).not.toMatch(/gh run (watch|list)/);
    },
  );
});
