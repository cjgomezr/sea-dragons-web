import { describe, expect, it, vi } from "vitest";
import { runSeed } from "../../../../scripts/load-test/seed-runner";
import { DEVELOPMENT_SUPABASE_PROJECT_REF } from "@/lib/supabase/environment-guard";

const ANCHOR_DATE = "2026-10-08";

function fakeDependencies(env: Record<string, string | undefined>) {
  return {
    env,
    today: () => ANCHOR_DATE,
    runSql: vi.fn(async () => ""),
    log: vi.fn(),
  };
}

describe("runSeed", () => {
  it("refuses a non-local Supabase before writing anything", async () => {
    const dependencies = fakeDependencies({
      NEXT_PUBLIC_SUPABASE_URL: `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`,
    });

    const outcome = await runSeed(dependencies);

    expect(outcome.kind).toBe("refused");
    expect(dependencies.runSql).not.toHaveBeenCalled();
  });

  it("explains the refusal", async () => {
    const dependencies = fakeDependencies({
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
    });

    const outcome = await runSeed(dependencies);

    expect(outcome.kind === "refused" && outcome.message).toContain(
      "supabase.example.com",
    );
  });

  it("runs the whole seed in one call against the local Supabase", async () => {
    const dependencies = fakeDependencies({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    });

    const outcome = await runSeed(dependencies);

    expect(outcome.kind).toBe("seeded");
    expect(dependencies.runSql).toHaveBeenCalledOnce();
  });

  it("uses the anchor date from the environment when given", async () => {
    const dependencies = fakeDependencies({ SEED_ANCHOR_DATE: "2026-01-15" });

    const outcome = await runSeed(dependencies);

    expect(outcome.kind === "seeded" && outcome.anchorDate).toBe("2026-01-15");
  });

  it("rejects an anchor date that does not exist", async () => {
    const dependencies = fakeDependencies({ SEED_ANCHOR_DATE: "2026-02-30" });

    const outcome = await runSeed(dependencies);

    expect(outcome.kind).toBe("refused");
    expect(dependencies.runSql).not.toHaveBeenCalled();
  });

  it("rejects an anchor date that is not YYYY-MM-DD", async () => {
    const dependencies = fakeDependencies({ SEED_ANCHOR_DATE: "15/01/2026" });

    const outcome = await runSeed(dependencies);

    expect(outcome.kind).toBe("refused");
    expect(dependencies.runSql).not.toHaveBeenCalled();
  });
});
