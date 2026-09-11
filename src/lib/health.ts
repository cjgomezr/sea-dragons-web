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

/** Cuánto espera la sonda a la base antes de darla por caída. Una función de
 * Vercel en plan Hobby se corta a los 10 s, así que el plazo tiene que vencer
 * antes: si se corta la función, el monitoreo recibe un error de la plataforma
 * en vez del 503 que este endpoint sabe explicar. */
export const DATABASE_PROBE_TIMEOUT_MS = 5_000;

/** La sonda con un plazo. Una base que no contesta no devuelve un error: deja
 * la petición colgada, y un endpoint de salud que espera indefinidamente no
 * reporta la caída. La ve el socio que abre la web, que es exactamente lo que
 * el monitoreo existe para evitar. */
export async function probeWithinTimeout(
  runProbe: () => Promise<DatabaseProbeResult>,
  timeoutMs: number,
): Promise<DatabaseProbeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<DatabaseProbeResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          kind: "unreachable",
          reason: `database did not answer within ${timeoutMs}ms`,
        }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([runProbe(), expiry]);
  } finally {
    clearTimeout(timer);
  }
}
