import { describe, expect, it } from "vitest";
import {
  type HealthReport,
  buildHealthReport,
  healthHttpStatus,
} from "@/lib/health";

const DEPLOYMENT = {
  supabaseProjectRef: "ejemplo123",
  commit: "9f1c0de",
} as const;

function reportWith(status: HealthReport["status"]): HealthReport {
  return {
    status,
    database: status === "ok" ? "ok" : "unconfigured",
    detail: "",
    ...DEPLOYMENT,
  };
}

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

describe("healthHttpStatus", () => {
  it("answers 200 for a healthy report", () => {
    expect(healthHttpStatus(reportWith("ok"))).toBe(200);
  });

  it("answers 503 for a degraded report", () => {
    expect(healthHttpStatus(reportWith("degraded"))).toBe(503);
  });
});
