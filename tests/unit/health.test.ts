import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DATABASE_PROBE_TIMEOUT_MS,
  type DatabaseProbeResult,
  buildHealthReport,
  probeWithinTimeout,
} from "@/lib/health";

const DEPLOYMENT = {
  supabaseProjectRef: "ejemplo123",
  commit: "9f1c0de",
} as const;

describe("buildHealthReport", () => {
  it("reports ok when the database answers", () => {
    expect(
      buildHealthReport({ probe: { kind: "reachable" }, ...DEPLOYMENT }),
    ).toEqual({
      status: "ok",
      database: "ok",
      detail: "database reachable",
      supabaseProjectRef: "ejemplo123",
      commit: "9f1c0de",
    });
  });

  it("reports degraded and names the missing variables when Supabase is unconfigured", () => {
    const report = buildHealthReport({
      probe: {
        kind: "unconfigured",
        missingKeys: ["NEXT_PUBLIC_SUPABASE_URL"],
      },
      ...DEPLOYMENT,
    });

    expect(report.status).toBe("degraded");
    expect(report.database).toBe("unconfigured");
    expect(report.detail).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("reports degraded and keeps the driver reason when the database rejects the probe", () => {
    const report = buildHealthReport({
      probe: { kind: "unreachable", reason: "relation does not exist" },
      ...DEPLOYMENT,
    });

    expect(report.status).toBe("degraded");
    expect(report.database).toBe("error");
    expect(report.detail).toBe("relation does not exist");
  });

  it("informa el ref del proyecto y el sha del commit desplegado", () => {
    const report = buildHealthReport({
      probe: { kind: "reachable" },
      ...DEPLOYMENT,
    });

    expect(report.supabaseProjectRef).toBe("ejemplo123");
    expect(report.commit).toBe("9f1c0de");
  });

  it("informa null en el ref y el sha que no se pueden averiguar, en vez de inventarlos", () => {
    const report = buildHealthReport({
      probe: { kind: "reachable" },
      supabaseProjectRef: null,
      commit: null,
    });

    expect(report.supabaseProjectRef).toBeNull();
    expect(report.commit).toBeNull();
  });
});

describe("probeWithinTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("devuelve el resultado de la sonda cuando contesta a tiempo", async () => {
    const result = await probeWithinTimeout(
      async () => ({ kind: "reachable" }),
      DATABASE_PROBE_TIMEOUT_MS,
    );

    expect(result).toEqual({ kind: "reachable" });
  });

  it("da la base por inalcanzable cuando la sonda no contesta dentro del plazo", async () => {
    vi.useFakeTimers();

    const pending = probeWithinTimeout(
      () => new Promise<DatabaseProbeResult>(() => {}),
      DATABASE_PROBE_TIMEOUT_MS,
    );
    await vi.advanceTimersByTimeAsync(DATABASE_PROBE_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({
      kind: "unreachable",
      reason: expect.stringContaining(String(DATABASE_PROBE_TIMEOUT_MS)),
    });
  });

  // Una sonda que tarda 4,9 s sigue siendo una sonda sana. El plazo solo puede
  // vencer cuando de verdad se agota, o el endpoint reportaría caídas falsas.
  it("no vence el plazo si la sonda contesta un instante antes", async () => {
    vi.useFakeTimers();
    const ALMOST_TIMEOUT_MS = DATABASE_PROBE_TIMEOUT_MS - 1;

    const pending = probeWithinTimeout(
      () =>
        new Promise<DatabaseProbeResult>((resolve) => {
          setTimeout(() => resolve({ kind: "reachable" }), ALMOST_TIMEOUT_MS);
        }),
      DATABASE_PROBE_TIMEOUT_MS,
    );
    await vi.advanceTimersByTimeAsync(DATABASE_PROBE_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ kind: "reachable" });
  });
});
