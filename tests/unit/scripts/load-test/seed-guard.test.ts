import { describe, expect, it } from "vitest";
import { checkSeedTarget } from "../../../../scripts/load-test/seed-guard";
import {
  DEVELOPMENT_SUPABASE_PROJECT_REF,
  PRODUCTION_SUPABASE_PROJECT_REF,
} from "@/lib/supabase/environment-guard";

describe("checkSeedTarget", () => {
  it("accepts the local Supabase on 127.0.0.1", () => {
    expect(checkSeedTarget("http://127.0.0.1:54321")).toEqual({
      kind: "local",
    });
  });

  it("accepts the local Supabase on localhost", () => {
    expect(checkSeedTarget("http://localhost:54321")).toEqual({
      kind: "local",
    });
  });

  it("treats a missing url as the local Supabase", () => {
    expect(checkSeedTarget(undefined)).toEqual({ kind: "local" });
  });

  it("refuses the development project and names it", () => {
    const check = checkSeedTarget(
      `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`,
    );

    expect(check.kind).toBe("refused");
    expect(check.kind === "refused" && check.message).toContain(
      "seadragons-dev",
    );
  });

  it("refuses the production project and names it", () => {
    const check = checkSeedTarget(
      `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
    );

    expect(check.kind).toBe("refused");
    expect(check.kind === "refused" && check.message).toContain("PRODUCCIÓN");
  });

  it("refuses any other host", () => {
    const check = checkSeedTarget("https://supabase.example.com");

    expect(check.kind).toBe("refused");
    expect(check.kind === "refused" && check.message).toContain(
      "supabase.example.com",
    );
  });

  it("refuses a host that only starts with localhost", () => {
    expect(checkSeedTarget("http://localhost.evil.com:54321").kind).toBe(
      "refused",
    );
  });

  it("refuses a value that is not a url", () => {
    expect(checkSeedTarget("not a url").kind).toBe("refused");
  });
});
