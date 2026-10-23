import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { DIRECTORY_PATH, NEW_MEMBER_PATH } from "@/lib/auth/routes";
import { INVITE_QUERY } from "@/lib/directory/directory-query";

/**
 * El alta dejó de ser una pantalla propia y es un panel del Directorio (#862,
 * D11 del PRD de E33). La dirección vieja lleva al Directorio con el panel
 * abierto, para que ningún enlace guardado se rompa.
 */

async function declaredRedirects() {
  if (nextConfig.redirects === undefined) {
    throw new Error("next.config no declara redirecciones");
  }
  return nextConfig.redirects();
}

describe("la dirección vieja del alta", () => {
  it("lleva al Directorio con el panel de invitar abierto", async () => {
    const redirects = await declaredRedirects();

    expect(redirects).toContainEqual({
      source: NEW_MEMBER_PATH,
      destination: `${DIRECTORY_PATH}?${INVITE_QUERY}`,
      permanent: true,
    });
    expect(INVITE_QUERY).toBe("invite=1");
  });

  it("ya no es una pantalla", () => {
    const pageDirectory = path.resolve(
      __dirname,
      "../../src/app/(app)/directorio/nuevo",
    );

    expect(existsSync(pageDirectory)).toBe(false);
  });
});
