import {
  JOURNEY_PHASE,
  MAX_ERROR_RATE,
  MINIMUM_MEASURED_MINUTES,
  P95_LIMIT_MS,
  TEAM_BALANCE_P95_LIMIT_MS,
  TEAM_BALANCE_PHASE,
  VIRTUAL_USERS,
} from "./load-test-config.ts";

/**
 * Convierte los resultados de k6 (`--out json`, una línea por punto) en el
 * veredicto y el resumen de la prueba de carga (#525). Calcula los
 * percentiles por su cuenta en lugar de leer el resumen de k6: el formato de
 * ese resumen cambió entre versiones, el de los puntos no.
 *
 * Sale en rojo también cuando la prueba midió menos de lo pedido: menos
 * minutos, menos usuarios o algún endpoint sin medir. Un runner sin memoria
 * corta k6 a medias, y eso no puede pasar por un verde.
 */

const MINUTE_MS = 60_000;
const SLOWEST_SHOWN = 5;
const PERCENT = 100;

export type RequestSample = {
  readonly name: string;
  readonly phase: string;
  readonly durationMs: number;
  readonly isFailure: boolean;
  readonly timeMs: number;
};

export type LoadTestRun = {
  readonly samples: readonly RequestSample[];
  readonly maxVirtualUsers: number;
};

export type EndpointStats = {
  readonly name: string;
  readonly phase: string;
  readonly count: number;
  readonly failures: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
};

export type LoadTestVerdict =
  | { readonly kind: "passed" }
  | { readonly kind: "failed"; readonly reasons: readonly string[] };

export type LoadTestReport = {
  readonly verdict: LoadTestVerdict;
  readonly endpoints: readonly EndpointStats[];
  readonly slowest: readonly EndpointStats[];
  readonly journey: EndpointStats;
  readonly measuredMinutes: number;
  readonly maxVirtualUsers: number;
};

type K6Point = {
  readonly metric: string;
  readonly value: number;
  readonly time: string;
  readonly tags: Readonly<Record<string, string>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPoint(line: string, lineNumber: number): K6Point | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(
      `Los resultados de k6 están cortados en la línea ${lineNumber}: k6 no terminó de escribirlos.`,
    );
  }
  if (!isRecord(parsed) || parsed.type !== "Point") return null;
  const data = parsed.data;
  if (!isRecord(data) || typeof parsed.metric !== "string") return null;
  return {
    metric: parsed.metric,
    value: Number(data.value),
    time: String(data.time),
    tags: isRecord(data.tags) ? (data.tags as Record<string, string>) : {},
  };
}

function toSample(point: K6Point): RequestSample {
  return {
    name: point.tags.name ?? "(sin nombre)",
    phase: point.tags.phase ?? "(sin fase)",
    durationMs: point.value,
    isFailure: point.tags.expected_response === "false",
    timeMs: Date.parse(point.time),
  };
}

/** Lee la salida `--out json` de k6: las duraciones de las peticiones y el
 * máximo de usuarios virtuales a la vez. */
export function parseK6Results(ndjson: string): LoadTestRun {
  const samples: RequestSample[] = [];
  let maxVirtualUsers = 0;
  ndjson.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const point = readPoint(line, index + 1);
    if (point?.metric === "http_req_duration") samples.push(toSample(point));
    if (point?.metric === "vus") {
      maxVirtualUsers = Math.max(maxVirtualUsers, point.value);
    }
  });
  return { samples, maxVirtualUsers };
}

/** Percentil con interpolación lineal, como k6. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const below = sorted[lower] ?? 0;
  const above = sorted[upper] ?? below;
  return Math.round(below + (above - below) * (position - lower));
}

function statsOf(
  name: string,
  phase: string,
  samples: readonly RequestSample[],
): EndpointStats {
  const durations = samples.map((sample) => sample.durationMs);
  const sorted = durations.sort((left, right) => left - right);
  return {
    name,
    phase,
    count: samples.length,
    failures: samples.filter((sample) => sample.isFailure).length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function statsByEndpoint(
  samples: readonly RequestSample[],
): readonly EndpointStats[] {
  const groups = new Map<string, RequestSample[]>();
  for (const sample of samples) {
    const key = `${sample.phase}\u0000${sample.name}`;
    const group = groups.get(key);
    if (group) group.push(sample);
    else groups.set(key, [sample]);
  }
  return [...groups.values()]
    .map((group) => statsOf(group[0]!.name, group[0]!.phase, group))
    .sort((left, right) => right.p95 - left.p95);
}

function measuredMinutesOf(samples: readonly RequestSample[]): number {
  if (samples.length === 0) return 0;
  // Sin `Math.max(...times)`: decenas de miles de argumentos desbordan la pila.
  const first = samples.reduce(
    (earliest, sample) => Math.min(earliest, sample.timeMs),
    Infinity,
  );
  const last = samples.reduce(
    (latest, sample) => Math.max(latest, sample.timeMs),
    -Infinity,
  );
  return (last - first) / MINUTE_MS;
}

function errorRateOf(stats: EndpointStats): number {
  return stats.count === 0 ? 0 : stats.failures / stats.count;
}

function formatPercent(rate: number): string {
  return `${(rate * PERCENT).toFixed(2)}%`;
}

type VerdictInput = {
  readonly report: Omit<LoadTestReport, "verdict">;
  readonly teamBalance: EndpointStats | null;
  readonly expectedRequests: readonly string[];
};

function completenessFailures(input: VerdictInput): string[] {
  const { report, expectedRequests } = input;
  const reasons: string[] = [];
  if (report.measuredMinutes < MINIMUM_MEASURED_MINUTES) {
    reasons.push(
      `Midió ${report.measuredMinutes.toFixed(1)} minutos de los ${MINIMUM_MEASURED_MINUTES} pedidos: k6 terminó antes de tiempo.`,
    );
  }
  if (report.maxVirtualUsers < VIRTUAL_USERS) {
    reasons.push(
      `Corrieron ${report.maxVirtualUsers} usuarios virtuales a la vez de los ${VIRTUAL_USERS} pedidos.`,
    );
  }
  const measured = new Set(report.endpoints.map((endpoint) => endpoint.name));
  const missing = expectedRequests.filter((name) => !measured.has(name));
  if (missing.length > 0) {
    reasons.push(`No se midieron: ${missing.join(", ")}.`);
  }
  return reasons;
}

function limitFailures(input: VerdictInput): string[] {
  const { report, teamBalance } = input;
  const reasons: string[] = [];
  if (report.journey.p95 >= P95_LIMIT_MS) {
    reasons.push(
      `El recorrido tiene un p95 de ${report.journey.p95} ms; el límite es ${P95_LIMIT_MS} ms.`,
    );
  }
  const errorRate = errorRateOf(report.journey);
  if (errorRate >= MAX_ERROR_RATE) {
    reasons.push(
      `El ${formatPercent(errorRate)} de las peticiones del recorrido dieron errores; el límite es ${formatPercent(MAX_ERROR_RATE)}.`,
    );
  }
  if (teamBalance && teamBalance.p95 >= TEAM_BALANCE_P95_LIMIT_MS) {
    reasons.push(
      `El reparto automático tiene un p95 de ${teamBalance.p95} ms; el límite es ${TEAM_BALANCE_P95_LIMIT_MS} ms.`,
    );
  }
  return reasons;
}

/** El veredicto de la prueba y las estadísticas por endpoint.
 * `expectedRequests` son los nombres que el recorrido tiene que haber medido
 * al menos una vez. */
export function summarizeLoadTest(
  run: LoadTestRun,
  expectedRequests: readonly string[],
): LoadTestReport {
  const journeySamples = run.samples.filter(
    (sample) => sample.phase === JOURNEY_PHASE,
  );
  const endpoints = statsByEndpoint(run.samples);
  const report = {
    endpoints,
    slowest: endpoints
      .filter((endpoint) => endpoint.phase === JOURNEY_PHASE)
      .slice(0, SLOWEST_SHOWN),
    journey: statsOf("recorrido", JOURNEY_PHASE, journeySamples),
    measuredMinutes: measuredMinutesOf(journeySamples),
    maxVirtualUsers: run.maxVirtualUsers,
  };
  const teamBalanceSamples = run.samples.filter(
    (sample) => sample.phase === TEAM_BALANCE_PHASE,
  );
  const input: VerdictInput = {
    report,
    expectedRequests,
    teamBalance:
      teamBalanceSamples.length === 0
        ? null
        : statsOf("reparto", TEAM_BALANCE_PHASE, teamBalanceSamples),
  };
  const reasons = [...completenessFailures(input), ...limitFailures(input)];
  const verdict: LoadTestVerdict =
    reasons.length === 0 ? { kind: "passed" } : { kind: "failed", reasons };
  return { ...report, verdict };
}

function endpointRow(endpoint: EndpointStats): string {
  return `| ${endpoint.name} | ${endpoint.phase} | ${endpoint.count} | ${endpoint.failures} | ${endpoint.p50} | ${endpoint.p95} | ${endpoint.p99} |`;
}

function verdictLines(report: LoadTestReport): string[] {
  const { journey } = report;
  const headline = `p95 de ${journey.p95} ms y ${formatPercent(errorRateOf(journey))} de errores en ${journey.count} peticiones, con ${report.maxVirtualUsers} usuarios virtuales durante ${report.measuredMinutes.toFixed(1)} minutos.`;
  if (report.verdict.kind === "passed") {
    return [`### ✅ La prueba de carga cumple NFR-001`, "", headline];
  }
  return [
    `### ❌ La prueba de carga no cumple NFR-001`,
    "",
    headline,
    "",
    ...report.verdict.reasons.map((reason) => `- ${reason}`),
    "",
    "Las peticiones más lentas del recorrido (p95):",
    "",
    ...report.slowest.map(
      (endpoint) => `- ${endpoint.name}: p95 de ${endpoint.p95} ms`,
    ),
  ];
}

/** El resumen en Markdown para `GITHUB_STEP_SUMMARY`: el veredicto primero y
 * después una fila por endpoint, de más lento a más rápido. Tiempos en ms. */
export function renderLoadTestSummary(report: LoadTestReport): string {
  return [
    ...verdictLines(report),
    "",
    "| Petición | Fase | Peticiones | Errores | p50 | p95 | p99 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...report.endpoints.map(endpointRow),
    "",
  ].join("\n");
}
