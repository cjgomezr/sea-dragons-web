import { describe, expect, it } from "vitest";
import { buildHealthReport, healthHttpStatus } from "@/lib/health";

describe("buildHealthReport", () => {
  it("reports ok when the database answers", () => {
    expect(buildHealthReport({ kind: "reachable" })).toEqual({
      status: "ok",
      database: "ok",
      detail: "database reachable",
    });
  });

  it("reports degraded and names the missing variables when Supabase is unconfigured", () => {
    const report = buildHealthReport({
      kind: "unconfigured",
      missingKeys: ["NEXT_PUBLIC_SUPABASE_URL"],
    });

    expect(report.status).toBe("degraded");
    expect(report.database).toBe("unconfigured");
    expect(report.detail).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("reports degraded and keeps the driver reason when the database rejects the probe", () => {
    const report = buildHealthReport({ kind: "unreachable", reason: "relation does not exist" });

    expect(report.status).toBe("degraded");
    expect(report.database).toBe("error");
    expect(report.detail).toBe("relation does not exist");
  });
});

describe("healthHttpStatus", () => {
  it("answers 200 for a healthy report", () => {
    expect(healthHttpStatus({ status: "ok", database: "ok", detail: "" })).toBe(200);
  });

  it("answers 503 for a degraded report", () => {
    expect(healthHttpStatus({ status: "degraded", database: "unconfigured", detail: "" })).toBe(503);
  });
});
