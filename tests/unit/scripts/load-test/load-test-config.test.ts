import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOURNEY_PHASE,
  MAX_ERROR_RATE,
  MINIMUM_MEASURED_MINUTES,
  P95_LIMIT_MS,
  TEAM_BALANCE_P95_LIMIT_MS,
  TEAM_BALANCE_PHASE,
  VIRTUAL_USERS,
  buildLoadTestOptions,
  signInIdentityOf,
} from "../../../../scripts/load-test/load-test-config";
import {
  LOAD_TEST_PASSWORD,
  LOGIN_IDENTITY_COUNT,
} from "../../../../scripts/load-test/seed-dataset";

const JOURNEY_SCRIPT = path.resolve(
  __dirname,
  "../../../../scripts/load-test/club-journey.ts",
);

type ConstantVusScenario = {
  readonly executor: string;
  readonly vus: number;
  readonly duration: string;
};

function onlyScenario(): ConstantVusScenario {
  const scenarios = Object.values(buildLoadTestOptions().scenarios ?? {});
  expect(scenarios).toHaveLength(1);
  return scenarios[0] as ConstantVusScenario;
}

function durationInMinutes(duration: string): number {
  const match = /^(\d+)m$/.exec(duration);
  if (!match) throw new Error(`duración sin minutos: ${duration}`);
  return Number(match[1]);
}

describe("load test thresholds", () => {
  it("names the NFR-001 and NFR-002 limits", () => {
    expect(VIRTUAL_USERS).toBe(50);
    expect(MINIMUM_MEASURED_MINUTES).toBe(5);
    expect(P95_LIMIT_MS).toBe(1000);
    expect(MAX_ERROR_RATE).toBe(0.01);
    expect(TEAM_BALANCE_P95_LIMIT_MS).toBe(2000);
  });

  it("runs every virtual user at once for at least the minimum minutes", () => {
    const scenario = onlyScenario();

    expect(scenario.executor).toBe("constant-vus");
    expect(scenario.vus).toBe(VIRTUAL_USERS);
    expect(durationInMinutes(scenario.duration)).toBeGreaterThan(
      MINIMUM_MEASURED_MINUTES,
    );
  });

  it("fails the journey when its p95 or its error rate pass the limits", () => {
    const thresholds = buildLoadTestOptions().thresholds ?? {};

    expect(thresholds[`http_req_duration{phase:${JOURNEY_PHASE}}`]).toEqual([
      `p(95)<${P95_LIMIT_MS}`,
    ]);
    expect(thresholds[`http_req_failed{phase:${JOURNEY_PHASE}}`]).toEqual([
      `rate<${MAX_ERROR_RATE}`,
    ]);
  });

  it("gives the team balance its own two-second p95", () => {
    const thresholds = buildLoadTestOptions().thresholds ?? {};

    expect(
      thresholds[`http_req_duration{phase:${TEAM_BALANCE_PHASE}}`],
    ).toEqual([`p(95)<${TEAM_BALANCE_P95_LIMIT_MS}`]);
  });

  it("is the configuration the k6 script exports", () => {
    const script = readFileSync(JOURNEY_SCRIPT, "utf8");

    expect(script).toMatch(
      /export const options[^=]*= buildLoadTestOptions\(\);/,
    );
  });
});

describe("signInIdentityOf", () => {
  it("gives the first virtual user the first seeded identity", () => {
    expect(signInIdentityOf(1)).toEqual({
      email: "socio-001@carga.seadragons.test",
      password: LOAD_TEST_PASSWORD,
      role: "Admin",
    });
  });

  it("gives the last virtual user a Player", () => {
    expect(signInIdentityOf(VIRTUAL_USERS)).toMatchObject({
      email: "socio-050@carga.seadragons.test",
      role: "Player",
    });
  });

  it("includes Coaches among the virtual users", () => {
    const roles = Array.from(
      { length: VIRTUAL_USERS },
      (_, index) => signInIdentityOf(index + 1).role,
    );

    expect(roles).toContain("Coach");
  });

  it("refuses a virtual user without a seeded identity", () => {
    expect(() => signInIdentityOf(LOGIN_IDENTITY_COUNT + 1)).toThrow(
      /identidad/,
    );
  });
});
