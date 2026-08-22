export type DatabaseProbeResult =
  | { readonly kind: "reachable" }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] }
  | { readonly kind: "unreachable"; readonly reason: string };

export type HealthReport = {
  readonly status: "ok" | "degraded";
  readonly database: "ok" | "unconfigured" | "error";
  readonly detail: string;
};

const DEGRADED_HTTP_STATUS = 503;
const HEALTHY_HTTP_STATUS = 200;

export function buildHealthReport(probe: DatabaseProbeResult): HealthReport {
  switch (probe.kind) {
    case "reachable":
      return { status: "ok", database: "ok", detail: "database reachable" };
    case "unconfigured":
      return {
        status: "degraded",
        database: "unconfigured",
        detail: `missing environment variables: ${probe.missingKeys.join(", ")}`,
      };
    case "unreachable":
      return { status: "degraded", database: "error", detail: probe.reason };
  }
}

export function healthHttpStatus(report: HealthReport): number {
  return report.status === "ok" ? HEALTHY_HTTP_STATUS : DEGRADED_HTTP_STATUS;
}
