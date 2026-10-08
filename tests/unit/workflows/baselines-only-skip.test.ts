import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github/workflows");

const GATE_JOB = "solo-lineas-base";
const GATE_SCRIPT = "scripts/baselines-only-after-green.sh";
const SKIPPED_CONDITION = `needs.${GATE_JOB}.outputs.ya_verificado != 'true'`;
const BASELINE_TESTS_JOB = "tests-lineas-base";

const SNAPSHOTS_DIR = "tests/ui.spec.ts-snapshots";

interface Step {
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Job {
  name?: string;
  if?: string;
  needs?: string | string[];
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  jobs: Record<string, Job>;
}

function readWorkflow(fileName: string): Workflow {
  return load(
    readFileSync(path.join(WORKFLOWS_DIR, fileName), "utf8"),
  ) as Workflow;
}

function jobOf(fileName: string, jobName: string): Job {
  const job = readWorkflow(fileName).jobs[jobName];
  if (!job) {
    throw new Error(`${fileName} no tiene el job ${jobName}`);
  }
  return job;
}

function needsOf(job: Job): string[] {
  return typeof job.needs === "string" ? [job.needs] : (job.needs ?? []);
}

function gateStep(fileName: string): Step {
  const step = (jobOf(fileName, GATE_JOB).steps ?? []).find((candidate) =>
    candidate.run?.includes(GATE_SCRIPT),
  );
  if (!step) {
    throw new Error(
      `${fileName}: el job ${GATE_JOB} no llama a ${GATE_SCRIPT}`,
    );
  }
  return step;
}

function toRepoPath(nativePath: string): string {
  return nativePath.split(path.sep).join("/");
}

/** Los tests que listan el directorio de líneas base. Se descubren leyendo
 * el código y no con una lista escrita a mano: un test nuevo que lea ese
 * directorio tiene que correr también en el camino del salto. */
function testsThatListBaselines(): string[] {
  const testsDir = path.join(REPO_ROOT, "tests");
  const thisFile = toRepoPath(path.relative(REPO_ROOT, __filename));
  return readdirSync(testsDir, { recursive: true })
    .map((entry) => toRepoPath(path.join("tests", String(entry))))
    .filter((file) => file.endsWith(".test.ts") && file !== thisFile)
    .filter((file) => {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      return source.includes(SNAPSHOTS_DIR) && source.includes("ls-files");
    });
}

/** Cada workflow, con el job que corre de verdad su suite. */
const GATED: ReadonlyArray<[string, string]> = [
  ["checks.yml", "checks"],
  ["migrations.yml", "migraciones"],
];

describe("un empujón de PR que solo trae líneas base no repite la suite (#494)", () => {
  describe.each(GATED)("%s", (workflow, heavyJob) => {
    it("pregunta solo en un pull_request synchronize, que es el único que trae commit anterior", () => {
      const condition = jobOf(workflow, GATE_JOB).if ?? "";

      expect(condition).toContain("github.event_name == 'pull_request'");
      expect(condition).toContain("github.event.action == 'synchronize'");
    });

    it("la pregunta la responde el script, con el commit anterior y la cabeza nueva", () => {
      const env = gateStep(workflow).env ?? {};

      expect(env.BEFORE_SHA).toBe("${{ github.event.before }}");
      expect(env.HEAD_SHA).toBe("${{ github.event.pull_request.head.sha }}");
    });

    it("busca la corrida verde en este mismo workflow y en el job que corre la suite", () => {
      const env = gateStep(workflow).env ?? {};

      expect(env.WORKFLOW_FILE).toBe(workflow);
      expect(env.HEAVY_JOB).toBe(heavyJob);
      // La API identifica el job por su nombre visible: con un `name:` propio
      // la consulta no lo encontraría y el salto no llegaría nunca.
      expect(jobOf(workflow, heavyJob).name).toBeUndefined();
    });

    it("expone la respuesta como salida del job", () => {
      expect(Object.keys(jobOf(workflow, GATE_JOB).outputs ?? {})).toContain(
        "ya_verificado",
      );
    });

    it("la pregunta solo pide permisos de lectura", () => {
      const permissions = jobOf(workflow, GATE_JOB).permissions ?? {};

      expect(Object.values(permissions)).not.toContain("write");
      expect(permissions.actions).toBe("read");
      expect(permissions.contents).toBe("read");
    });

    it("la suite se salta solo cuando la respuesta es que sí", () => {
      const job = jobOf(workflow, heavyJob);

      expect(needsOf(job)).toContain(GATE_JOB);
      expect(job.if).toContain(SKIPPED_CONDITION);
    });

    // Sin función de estado, Actions exige que la pregunta haya terminado en
    // success, y en un push a main (o un PR recién abierto) ni arranca.
    it("la suite corre igual cuando la pregunta no llegó a hacerse", () => {
      const condition = jobOf(workflow, heavyJob).if ?? "";

      expect(condition).toMatch(/!cancelled\(\)/);
      expect(condition).not.toMatch(/always\(\)/);
    });
  });

  // Levantar Supabase cuesta minutos de runner; el camino del salto solo lee
  // PNG del repositorio (#536).
  it("checks no levanta Supabase cuando la suite se salta", () => {
    const uses = (jobOf("checks.yml", BASELINE_TESTS_JOB).steps ?? []).map(
      (step) => step.uses ?? "",
    );

    expect(uses.join("\n")).not.toMatch(/supabase-local/);
  });

  it("checks sigue preguntando en el push a main si el árbol ya pasó en el PR", () => {
    const checks = jobOf("checks.yml", "checks");

    expect(needsOf(checks)).toContain("arbol-ya-verificado");
    expect(checks.if).toContain(
      "needs.arbol-ya-verificado.outputs.ya_verificado != 'true'",
    );
  });

  describe("en el camino del salto", () => {
    it("hay tests que listan el directorio de líneas base", () => {
      expect(testsThatListBaselines().length).toBeGreaterThan(0);
    });

    it("corre solo cuando la suite se salta", () => {
      const job = jobOf("checks.yml", BASELINE_TESTS_JOB);

      expect(needsOf(job)).toContain(GATE_JOB);
      expect(job.if).toContain(
        `needs.${GATE_JOB}.outputs.ya_verificado == 'true'`,
      );
    });

    // Un PNG nuevo puede romperlos: una captura huérfana, o un estado en
    // español al que le falta una de sus seis.
    it.each(testsThatListBaselines())(
      "corre %s, que lee las líneas base",
      (testFile) => {
        const runs = (jobOf("checks.yml", BASELINE_TESTS_JOB).steps ?? [])
          .map((step) => step.run ?? "")
          .join("\n");

        expect(runs).toContain(testFile);
      },
    );
  });
});
