import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { type DatabaseProbeResult, buildHealthReport, healthHttpStatus } from "@/lib/health";
import { readSupabaseConfig } from "@/lib/supabase/config";

// The probe must reflect the database right now, never a cached answer.
export const dynamic = "force-dynamic";

const PROBED_TABLE = "clubs";

async function probeDatabase(): Promise<DatabaseProbeResult> {
  const config = readSupabaseConfig(process.env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }

  const supabase = createClient(config.url, config.anonKey);
  const { error } = await supabase.from(PROBED_TABLE).select("id", { head: true, count: "exact" });

  if (error) {
    return { kind: "unreachable", reason: error.message };
  }
  return { kind: "reachable" };
}

export async function GET(): Promise<NextResponse> {
  const report = buildHealthReport(await probeDatabase());
  return NextResponse.json(report, { status: healthHttpStatus(report) });
}
