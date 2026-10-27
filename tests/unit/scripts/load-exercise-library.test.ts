// @vitest-environment node
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * `npm run training:load-library` sin credenciales (#897): dice qué falta y
 * sale con error antes de descargar nada ni tocar ninguna base.
 */

const SCRIPT = "scripts/training/load-exercise-library.ts";
const TSX_CLI = "node_modules/tsx/dist/cli.mjs";

function runWithEnv(env: Record<string, string>): {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
} {
  const result = spawnSync(process.execPath, [TSX_CLI, SCRIPT], {
    // Sin `process.env`: ni la URL ni la llave del entorno de quien corre los
    // tests. Sólo lo que Node necesita para arrancar.
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      ...env,
    },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("load-exercise-library", () => {
  it("sin la llave de servicio, la nombra y sale con error", () => {
    const result = runWithEnv({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(result.stderr).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(result.stdout).toBe("");
  });

  it("sin la URL ni la llave, nombra las dos", () => {
    const result = runWithEnv({});

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(result.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
