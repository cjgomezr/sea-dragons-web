import { describe, expect, it } from "vitest";
import {
  JOURNEY_PHASE,
  SIGN_IN_PHASE,
  TEAM_BALANCE_PHASE,
  VIRTUAL_USERS,
} from "../../../../scripts/load-test/load-test-config";
import {
  type LoadTestRun,
  type RequestSample,
  parseK6Results,
  renderLoadTestSummary,
  summarizeLoadTest,
} from "../../../../scripts/load-test/load-report";

const START = Date.parse("2026-10-09T10:00:00Z");
const MINUTE_MS = 60_000;
const FAST_REQUEST = "GET /api/v1/news";
const SLOW_REQUEST = "GET /api/v1/directory";
const EXPECTED = [FAST_REQUEST, SLOW_REQUEST];

type SampleOverrides = Partial<RequestSample>;

function sample(overrides: SampleOverrides = {}): RequestSample {
  return {
    name: FAST_REQUEST,
    phase: JOURNEY_PHASE,
    durationMs: 100,
    isFailure: false,
    timeMs: START,
    ...overrides,
  };
}

/** `count` peticiones de `name`, repartidas a lo largo de `minutes`. */
function spread(
  count: number,
  minutes: number,
  overrides: SampleOverrides = {},
): RequestSample[] {
  return Array.from({ length: count }, (_, index) =>
    sample({
      timeMs: START + (index * minutes * MINUTE_MS) / (count - 1),
      ...overrides,
    }),
  );
}

function healthyRun(extra: readonly RequestSample[] = []): LoadTestRun {
  return {
    samples: [
      ...spread(100, 6),
      ...spread(100, 6, { name: SLOW_REQUEST, durationMs: 200 }),
      ...extra,
    ],
    maxVirtualUsers: VIRTUAL_USERS,
  };
}

function k6Point(metric: string, value: number, tags: object): string {
  return JSON.stringify({
    metric,
    type: "Point",
    data: { time: "2026-10-09T10:00:01.5+00:00", value, tags },
  });
}

describe("parseK6Results", () => {
  it("reads each request's name, phase, duration and outcome", () => {
    const ndjson = [
      JSON.stringify({ metric: "http_req_duration", type: "Metric", data: {} }),
      k6Point("http_req_duration", 812.5, {
        name: SLOW_REQUEST,
        phase: JOURNEY_PHASE,
        expected_response: "false",
      }),
    ].join("\n");

    const run = parseK6Results(ndjson);

    expect(run.samples).toEqual([
      {
        name: SLOW_REQUEST,
        phase: JOURNEY_PHASE,
        durationMs: 812.5,
        isFailure: true,
        timeMs: Date.parse("2026-10-09T10:00:01.5Z"),
      },
    ]);
  });

  it("keeps the highest number of virtual users seen", () => {
    const ndjson = [
      k6Point("vus", 12, {}),
      k6Point("vus", 50, {}),
      k6Point("vus", 3, {}),
    ].join("\n");

    expect(parseK6Results(ndjson).maxVirtualUsers).toBe(50);
  });

  it("ignores the other metrics", () => {
    const ndjson = k6Point("http_req_waiting", 80, { name: FAST_REQUEST });

    expect(parseK6Results(ndjson).samples).toEqual([]);
  });

  it("says the results are cut short when a line is not JSON", () => {
    const ndjson = `${k6Point("vus", 50, {})}\n{"metric":"http_req_dur`;

    expect(() => parseK6Results(ndjson)).toThrow(/línea 2/);
  });
});

describe("summarizeLoadTest", () => {
  it("passes a full run inside every limit", () => {
    const report = summarizeLoadTest(healthyRun(), EXPECTED);

    expect(report.verdict).toEqual({ kind: "passed" });
  });

  it("gives p50, p95 and p99 per endpoint", () => {
    const durations = Array.from({ length: 101 }, (_, index) => index * 10);
    const run: LoadTestRun = {
      samples: durations.map((durationMs, index) =>
        sample({ durationMs, timeMs: START + index * 4 * MINUTE_MS }),
      ),
      maxVirtualUsers: VIRTUAL_USERS,
    };

    const [endpoint] = summarizeLoadTest(run, [FAST_REQUEST]).endpoints;

    expect(endpoint).toMatchObject({
      name: FAST_REQUEST,
      count: 101,
      p50: 500,
      p95: 950,
      p99: 990,
    });
  });

  it("fails when the journey p95 passes one second, naming the slowest", () => {
    const slow = spread(100, 6, { name: SLOW_REQUEST, durationMs: 2500 });
    const run: LoadTestRun = {
      samples: [...spread(100, 6), ...slow],
      maxVirtualUsers: VIRTUAL_USERS,
    };

    const report = summarizeLoadTest(run, EXPECTED);

    expect(report.verdict.kind).toBe("failed");
    expect(report.slowest[0]?.name).toBe(SLOW_REQUEST);
    expect(renderLoadTestSummary(report)).toMatch(
      /p95 de 2500 ms[\s\S]*GET \/api\/v1\/directory/,
    );
  });

  it("fails when more than one percent of the journey fails", () => {
    const failures = spread(5, 6, { isFailure: true });

    const report = summarizeLoadTest(healthyRun(failures), EXPECTED);

    expect(report.verdict.kind === "failed" && report.verdict.reasons).toEqual([
      expect.stringMatching(/errores/),
    ]);
  });

  it("leaves sign-in and team balance out of the journey limits", () => {
    const signIns = spread(50, 1, { phase: SIGN_IN_PHASE, durationMs: 5000 });
    const balances = spread(10, 6, {
      name: "POST /api/v1/teams/[eventId]/auto-balance",
      phase: TEAM_BALANCE_PHASE,
      durationMs: 1500,
    });

    const report = summarizeLoadTest(
      healthyRun([...signIns, ...balances]),
      EXPECTED,
    );

    expect(report.verdict).toEqual({ kind: "passed" });
  });

  it("fails when the team balance p95 passes two seconds", () => {
    const balances = spread(10, 6, {
      name: "POST /api/v1/teams/[eventId]/auto-balance",
      phase: TEAM_BALANCE_PHASE,
      durationMs: 2600,
    });

    const report = summarizeLoadTest(healthyRun(balances), EXPECTED);

    expect(report.verdict.kind === "failed" && report.verdict.reasons).toEqual([
      expect.stringMatching(/reparto/),
    ]);
  });

  it("fails when the run measured less than five minutes", () => {
    const run: LoadTestRun = {
      samples: [...spread(100, 3), ...spread(100, 3, { name: SLOW_REQUEST })],
      maxVirtualUsers: VIRTUAL_USERS,
    };

    const report = summarizeLoadTest(run, EXPECTED);

    expect(report.verdict.kind === "failed" && report.verdict.reasons).toEqual([
      expect.stringMatching(/minutos/),
    ]);
  });

  it("fails when fewer virtual users than asked ran at once", () => {
    const run: LoadTestRun = { ...healthyRun(), maxVirtualUsers: 20 };

    const report = summarizeLoadTest(run, EXPECTED);

    expect(report.verdict.kind === "failed" && report.verdict.reasons).toEqual([
      expect.stringMatching(/usuarios virtuales/),
    ]);
  });

  it("fails when an expected endpoint was never measured", () => {
    const report = summarizeLoadTest(healthyRun(), [
      ...EXPECTED,
      "GET /api/v1/notifications",
    ]);

    expect(report.verdict.kind === "failed" && report.verdict.reasons).toEqual([
      expect.stringContaining("GET /api/v1/notifications"),
    ]);
  });

  it("fails an empty run instead of passing it", () => {
    const report = summarizeLoadTest(
      { samples: [], maxVirtualUsers: 0 },
      EXPECTED,
    );

    expect(report.verdict.kind).toBe("failed");
  });
});

describe("renderLoadTestSummary", () => {
  it("shows a row per endpoint with its percentiles", () => {
    const summary = renderLoadTestSummary(
      summarizeLoadTest(healthyRun(), EXPECTED),
    );

    expect(summary).toContain("| p50 | p95 | p99 |");
    expect(summary).toMatch(/\| GET \/api\/v1\/news \| journey \| 100 \| 0 \|/);
  });

  it("opens with the verdict", () => {
    const summary = renderLoadTestSummary(
      summarizeLoadTest(healthyRun(), EXPECTED),
    );

    expect(summary.split("\n")[0]).toMatch(/cumple/);
  });
});
