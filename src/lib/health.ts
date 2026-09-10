export type DatabaseProbeResult =
  | { readonly kind: "reachable" }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] }
  | { readonly kind: "unreachable"; readonly reason: string };

export type HealthReport = {
  readonly status: "ok" | "degraded";
  readonly database: "ok" | "unconfigured" | "error";
  readonly detail: string;
  /** Ref del proyecto de Supabase configurado, público por naturaleza. */
  readonly supabaseProjectRef: string | null;
  /** Sha del commit desplegado, para saber qué versión está sirviendo. */
  readonly commit: string | null;
};

type HealthReportInput = {
  readonly probe: DatabaseProbeResult;
  readonly supabaseProjectRef: string | null;
  readonly commit: string | null;
};

type DatabaseHealth = Pick<HealthReport, "status" | "database" | "detail">;

function describeDatabase(probe: DatabaseProbeResult): DatabaseHealth {
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

export function buildHealthReport(input: HealthReportInput): HealthReport {
  return {
    ...describeDatabase(input.probe),
    supabaseProjectRef: input.supabaseProjectRef,
    commit: input.commit,
  };
}
