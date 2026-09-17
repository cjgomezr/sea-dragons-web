import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github/workflows/claude-backlog.yml",
);

const GITHUB_JOB_HARD_CAP_MINUTES = 360;

const LABEL_TRIGGER_MAX_TURNS = 200;
const LABEL_TRIGGER_TIMEOUT_MINUTES = 120;
const SCHEDULE_MAX_TURNS = 1000;
const SCHEDULE_TIMEOUT_MINUTES = 350;

/** Modos en los que Bash no pide aprobación. Es la condición que importa: el
 * ciclo de vida es casi todo Bash (`gh issue edit`, `git push`, `gh pr create`,
 * `npm test`), así que `acceptEdits` NO entra en la lista aunque suene
 * permisivo, porque solo auto-aprueba escrituras de archivos y dejaría al
 * worker igual de bloqueado que el 11 de septiembre de 2026.
 *
 * `auto` sí trabaja, y es el que usa `scripts/process-backlog.sh` en una
 * máquina con alguien delante. En un runner headless su pausa ante una acción
 * que considera peligrosa equivale a una denegación silenciosa a mitad de
 * ticket, más difícil de diagnosticar que el fallo original. */
const PERMISSION_MODES_WITHOUT_BASH_PROMPTS = ["bypassPermissions", "auto"];

/** El guardia que convierte en rojo una corrida que no tocó el issue. */
const CLAIM_GUARD_STEP_NAME = "Comprueba que el worker dejó rastro en el issue";
const CLAIM_GUARD_SCRIPT = "scripts/check-worker-claimed.sh";

/** El paso que lanza al worker: el que escribe la transcripción, y el que
 * murió con el código 143 en las dos corridas nocturnas. */
const WORKER_STEP_ID = "worker";

/** La transcripción de la sesión, con el nombre que le pone la acción dentro
 * del runner. */
const TRANSCRIPT_FILENAME = "claude-execution-output.json";
const TRANSCRIPT_UPLOAD_ACTION = "actions/upload-artifact";
const TRANSCRIPT_ARTIFACT_NAME = "claude-transcript";

/** Siete días: cubren de sobra una corrida nocturna que alguien mira el lunes.
 * No más, porque este repositorio es público y el artefacto lo puede
 * descargar cualquiera. */
const TRANSCRIPT_RETENTION_DAYS = 7;

interface WorkflowStep {
  id?: string;
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: {
    claude_args?: string;
    name?: string;
    path?: string;
    "retention-days"?: number;
  };
}

interface WorkflowFile {
  jobs: {
    implement: {
      "timeout-minutes": number | string;
      steps: WorkflowStep[];
    };
  };
}

function readWorkflowSource(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

function parseWorkflow(): WorkflowFile {
  return load(readWorkflowSource()) as WorkflowFile;
}

function findClaudeArgs(workflow: WorkflowFile): string {
  const step = workflow.jobs.implement.steps.find(
    (candidate) => candidate.with?.claude_args !== undefined,
  );
  if (!step?.with?.claude_args) {
    throw new Error("no se encontró el paso con claude_args");
  }
  return step.with.claude_args;
}

function extractMaxTurnsExpression(claudeArgs: string): string {
  const match = claudeArgs.match(/--max-turns\s+(\$\{\{[^}]*\}\})/);
  const expression = match?.[1];
  if (!expression) {
    throw new Error(`no se encontró --max-turns en: ${claudeArgs}`);
  }
  return expression;
}

/**
 * Las expresiones de GitHub Actions (`${{ cond && a || b }}`) no las evalúa
 * js-yaml: para el parser son un escalar de texto más. Extraemos las dos
 * ramas numéricas a mano para confirmar que ninguna quedó vacía, que es el
 * modo de fallo real de un ternario mal armado (criterio "se resuelven a
 * números, no a cadenas vacías").
 */
function extractTernaryBranches(expression: string): {
  whenTrue: string;
  whenFalse: string;
} {
  const match = expression.match(/&&\s*(\S+)\s*\|\|\s*(\S+)\s*}}/);
  const whenTrue = match?.[1];
  const whenFalse = match?.[2];
  if (!whenTrue || !whenFalse) {
    throw new Error(`no se encontró un ternario en: ${expression}`);
  }
  return { whenTrue, whenFalse };
}

describe("claude-backlog.yml", () => {
  it("parsea como YAML válido", () => {
    expect(() => parseWorkflow()).not.toThrow();
  });

  it("usa 200 turnos y 120 minutos en el disparo por etiqueta", () => {
    const workflow = parseWorkflow();
    const claudeArgs = findClaudeArgs(workflow);

    const { whenFalse: maxTurnsOnLabel } = extractTernaryBranches(
      extractMaxTurnsExpression(claudeArgs),
    );
    expect(Number(maxTurnsOnLabel)).toBe(LABEL_TRIGGER_MAX_TURNS);

    const timeoutExpression = String(
      workflow.jobs.implement["timeout-minutes"],
    );
    const { whenFalse: timeoutOnLabel } =
      extractTernaryBranches(timeoutExpression);
    expect(Number(timeoutOnLabel)).toBe(LABEL_TRIGGER_TIMEOUT_MINUTES);
  });

  it("usa 1000 turnos y 350 minutos en el disparo por schedule", () => {
    const workflow = parseWorkflow();
    const claudeArgs = findClaudeArgs(workflow);

    const { whenTrue: maxTurnsOnSchedule } = extractTernaryBranches(
      extractMaxTurnsExpression(claudeArgs),
    );
    expect(Number(maxTurnsOnSchedule)).toBe(SCHEDULE_MAX_TURNS);

    const timeoutExpression = String(
      workflow.jobs.implement["timeout-minutes"],
    );
    const { whenTrue: timeoutOnSchedule } =
      extractTernaryBranches(timeoutExpression);
    expect(Number(timeoutOnSchedule)).toBe(SCHEDULE_TIMEOUT_MINUTES);
  });

  it("mantiene el timeout del cron por debajo del tope de 6 horas de GitHub", () => {
    expect(SCHEDULE_TIMEOUT_MINUTES).toBeLessThan(GITHUB_JOB_HARD_CAP_MINUTES);
  });
});

// El 11 de septiembre de 2026 la primera corrida real de este workflow terminó
// en verde sin hacer absolutamente nada: 11 denegaciones de permiso, 18 turnos,
// 74 segundos, y el issue intacto. Le faltaba el modo de permisos que el script
// local sí pasa. Sin él, cada escritura espera una aprobación que en un runner
// no va a llegar nunca.
describe("claude-backlog.yml · permisos del worker", () => {
  it("le pasa un modo de permisos en el que Bash no pide aprobación", () => {
    const claudeArgs = findClaudeArgs(parseWorkflow());

    const mode = claudeArgs.match(/--permission-mode\s+(\S+)/)?.[1];

    expect(
      mode,
      `claude_args no declara --permission-mode: ${claudeArgs}`,
    ).toBeDefined();
    expect(PERMISSION_MODES_WITHOUT_BASH_PROMPTS).toContain(mode);
  });
});

// El segundo defecto de esa corrida, y el peor: el único aviso del workflow
// colgaba de `failure()`, así que un worker que sale limpio sin tocar nada no
// avisa a nadie. La cola parecía procesada. Este guardia convierte ese silencio
// en un job rojo.
describe("claude-backlog.yml · el silencio no puede pasar por éxito", () => {
  function findClaimGuard(): WorkflowStep {
    const step = parseWorkflow().jobs.implement.steps.find(
      (candidate) => candidate.name === CLAIM_GUARD_STEP_NAME,
    );
    if (!step) {
      throw new Error(
        `el workflow no tiene el paso '${CLAIM_GUARD_STEP_NAME}'`,
      );
    }
    return step;
  }

  it("comprueba, después del worker, que el issue quedó tocado", () => {
    // La lógica vive en un script porque ahí sí se puede ejecutar contra un
    // `gh` de mentira. Este test solo fija que el workflow la invoque.
    expect(findClaimGuard().run).toContain(CLAIM_GUARD_SCRIPT);
  });

  it("corre también cuando el worker sale en verde", () => {
    // `if: failure()` es justo lo que dejó pasar el fallo original: el worker
    // salió con éxito. Vale cualquier condición que no dependa del resultado
    // del paso anterior.
    const condition = findClaimGuard().if ?? "";

    expect(condition).toMatch(/always\(\)|!\s*cancelled\(\)/);
    expect(condition).not.toContain("failure()");
  });

  it("solo aplica al disparo por etiqueta, que trabaja un issue concreto", () => {
    // El turno nocturno procesa varios y puede terminar legítimamente sin
    // tocar ninguno si no hay nada elegible.
    expect(findClaimGuard().if ?? "").toContain("issues");
  });

  it("deja que el aviso del issue distinga cuál de los dos fracasos ocurrió", () => {
    // Sin esto, un worker que salió limpio recibe un comentario diciendo que
    // la corrida falló, y manda a buscar la causa donde no está.
    const note = parseWorkflow().jobs.implement.steps.find((candidate) =>
      candidate.if?.includes("failure()"),
    );

    expect(note?.run).toContain("CLAIM_GUARD");
  });
});

// Las dos corridas nocturnas que murieron con el código 143 (11 y 12 de
// septiembre de 2026) imprimieron en el log la línea "Log saved to
// /home/runner/work/_temp/claude-execution-output.json" justo antes del error,
// y el job se llevó el archivo consigo. Con `show_full_output: false` el log
// solo trae los mensajes `init` y `result` de la sesión, así que sin ese
// archivo no queda ni un rastro de lo que el worker hizo en sus últimos
// noventa segundos.
describe("claude-backlog.yml · la transcripción sobrevive al job", () => {
  function findTranscriptUpload(): { step: WorkflowStep; index: number } {
    const steps = parseWorkflow().jobs.implement.steps;
    const index = steps.findIndex((candidate) =>
      candidate.uses?.startsWith(TRANSCRIPT_UPLOAD_ACTION),
    );
    if (index === -1) {
      throw new Error(
        `el workflow no sube la transcripción con ${TRANSCRIPT_UPLOAD_ACTION}`,
      );
    }
    return { step: steps[index]!, index };
  }

  it("la sube con un nombre y una retención fijos", () => {
    const { step } = findTranscriptUpload();

    expect(step.with?.name).toBe(TRANSCRIPT_ARTIFACT_NAME);
    expect(step.with?.["retention-days"]).toBe(TRANSCRIPT_RETENTION_DAYS);
  });

  it("apunta al archivo donde la acción escribe la transcripción", () => {
    const { step } = findTranscriptUpload();

    expect(step.with?.path).toContain(TRANSCRIPT_FILENAME);
  });

  it("corre también cuando el paso del worker falla", () => {
    // `if: success()` o un paso sin condición son justo lo que dejó perderse
    // las dos transcripciones: el paso del worker salió en rojo y el job se
    // detuvo antes de subir nada.
    const condition = findTranscriptUpload().step.if ?? "";

    expect(condition).toMatch(/always\(\)|!\s*cancelled\(\)/);
    expect(condition).not.toContain("success()");
  });

  it("va después del paso del worker, que es quien escribe el archivo", () => {
    const steps = parseWorkflow().jobs.implement.steps;
    const workerIndex = steps.findIndex(
      (candidate) => candidate.id === WORKER_STEP_ID,
    );

    expect(workerIndex).toBeGreaterThanOrEqual(0);
    expect(findTranscriptUpload().index).toBeGreaterThan(workerIndex);
  });
});
