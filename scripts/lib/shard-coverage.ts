import { load } from "js-yaml";

/** Los jobs de visual-baselines.yml que reparten la suite (#255). Comparar y
 * aceptar tienen que partirla igual: si no, la aceptación regeneraría tramos
 * que no son los que la comparación vio fallar. */
const SHARDED_JOBS = ["compare", "regenerate"] as const;

const LISTED_TOTAL = /^Total: (\d+) tests? in \d+ files?$/m;

export type ShardCoverage =
  | { readonly kind: "complete"; readonly total: number }
  | {
      readonly kind: "mismatch";
      readonly total: number;
      readonly covered: number;
    };

/** Cuántas pruebas lista `playwright test --list`, leído de su última línea. */
export function parseListedTestCount(listOutput: string): number {
  const match = LISTED_TOTAL.exec(listOutput);
  if (!match?.[1]) {
    throw new Error(
      `playwright test --list no imprimió la línea "Total: N tests". Salida:\n${listOutput}`,
    );
  }
  return Number(match[1]);
}

export function compareShardCoverage(
  total: number,
  shardCounts: readonly number[],
): ShardCoverage {
  const covered = shardCounts.reduce((sum, count) => sum + count, 0);
  return covered === total
    ? { kind: "complete", total }
    : { kind: "mismatch", total, covered };
}

type WorkflowWithShards = {
  jobs?: Record<string, { strategy?: { matrix?: { shard?: unknown } } }>;
};

function shardsOf(workflow: WorkflowWithShards, jobName: string): number[] {
  const shards = workflow.jobs?.[jobName]?.strategy?.matrix?.shard;
  if (
    !Array.isArray(shards) ||
    !shards.every((shard) => Number.isInteger(shard))
  ) {
    throw new Error(`El job "${jobName}" no declara una matriz "shard".`);
  }
  return shards as number[];
}

function isOneToN(shards: readonly number[]): boolean {
  return shards.every((shard, index) => shard === index + 1);
}

/**
 * Las partes en que visual-baselines.yml reparte la suite. Falla si la matriz
 * no es 1..n, porque `--shard=i/n` con un hueco deja una parte sin correr, o
 * si comparar y aceptar no se reparten igual.
 */
export function readShardMatrix(workflowSource: string): number[] {
  const workflow = load(workflowSource) as WorkflowWithShards;
  const [reference, ...others] = SHARDED_JOBS;
  const shards = shardsOf(workflow, reference);

  if (!isOneToN(shards)) {
    throw new Error(
      `La matriz de "${reference}" tiene que ser 1..${shards.length}, y es [${shards.join(", ")}].`,
    );
  }
  for (const jobName of others) {
    const theirs = shardsOf(workflow, jobName);
    if (theirs.join(",") !== shards.join(",")) {
      throw new Error(
        `"${jobName}" se reparte en [${theirs.join(", ")}] y "${reference}" en [${shards.join(", ")}].`,
      );
    }
  }
  return shards;
}
