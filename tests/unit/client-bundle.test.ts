import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_KEY_PREFIX,
  findClientBundleLeaks,
  forbiddenNeedles,
} from "../../scripts/lib/client-bundle";
import { readEnvironmentManifest } from "../../scripts/lib/entornos-manifest";
import { SECRET_ENV_VARS } from "../support/env-vars";

const createdDirectories: string[] = [];

function createBundle(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "bundle-"));
  createdDirectories.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  }
  return root;
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("bundle de cliente", () => {
  it("no encuentra nada en un bundle que sólo usa variables públicas", () => {
    const bundleDir = createBundle({
      "chunks/page.js": 'const u="https://xcfrpcvomjjmfoztifuo.supabase.co";',
    });

    expect(
      findClientBundleLeaks({
        bundleDir,
        needles: forbiddenNeedles(readEnvironmentManifest()),
      }),
    ).toEqual([]);
  });

  it("nombra el archivo y la variable cuando un secreto llega al bundle", () => {
    const bundleDir = createBundle({
      "chunks/page.js": "const k=process.env.SUPABASE_SERVICE_ROLE_KEY;",
    });

    const leaks = findClientBundleLeaks({
      bundleDir,
      needles: forbiddenNeedles(readEnvironmentManifest()),
    });

    expect(leaks).toEqual([
      { file: "chunks/page.js", needle: "SUPABASE_SERVICE_ROLE_KEY" },
    ]);
  });

  it("caza una clave secreta pegada como literal, aunque no se nombre la variable", () => {
    const bundleDir = createBundle({
      "chunks/app.js": `const k="${FORBIDDEN_KEY_PREFIX}unaclavecualquiera";`,
    });

    const leaks = findClientBundleLeaks({
      bundleDir,
      needles: forbiddenNeedles(readEnvironmentManifest()),
    });

    expect(leaks).toEqual([
      { file: "chunks/app.js", needle: FORBIDDEN_KEY_PREFIX },
    ]);
  });

  it("busca en subdirectorios, no sólo en la raíz del bundle", () => {
    const bundleDir = createBundle({
      "chunks/app/nested/deep.js": "SUPABASE_ACCESS_TOKEN",
    });

    expect(
      findClientBundleLeaks({
        bundleDir,
        needles: forbiddenNeedles(readEnvironmentManifest()),
      }).map((leak) => leak.file),
    ).toEqual(["chunks/app/nested/deep.js"]);
  });

  it("ignora lo que no es JavaScript: los mapas de fuentes y el CSS no llegan a ejecutarse", () => {
    const bundleDir = createBundle({
      "chunks/page.css": "SUPABASE_SERVICE_ROLE_KEY",
    });

    expect(
      findClientBundleLeaks({
        bundleDir,
        needles: forbiddenNeedles(readEnvironmentManifest()),
      }),
    ).toEqual([]);
  });

  it("falla ruidosamente cuando el directorio del bundle no existe, en vez de dar el bundle por limpio", () => {
    expect(() =>
      findClientBundleLeaks({
        bundleDir: path.join(tmpdir(), "un-bundle-que-no-existe"),
        needles: ["lo-que-sea"],
      }),
    ).toThrowError(/un-bundle-que-no-existe/);
  });

  it("busca toda variable de la lista de secretos del manifiesto", () => {
    const needles = forbiddenNeedles(readEnvironmentManifest());

    for (const name of SECRET_ENV_VARS) {
      expect(needles).toContain(name);
    }
    expect(needles).toContain(FORBIDDEN_KEY_PREFIX);
  });
});
