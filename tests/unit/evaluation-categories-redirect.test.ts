import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import {
  EVALUATIONS_PATH,
  EVALUATION_CATEGORIES_PATH,
} from "@/lib/auth/routes";
import { decideSessionBoundary } from "@/lib/auth/session-boundary";

/**
 * Las categorías de evaluación dejaron de ser una pantalla propia y son una
 * pestaña de Evaluaciones (#821, D1 del PRD de E31). La dirección vieja lleva
 * a la pestaña, para que ningún enlace guardado se rompa, y quién entra no
 * cambia (D2).
 */

async function declaredRedirects() {
  if (nextConfig.redirects === undefined) {
    throw new Error("next.config no declara redirecciones");
  }
  return nextConfig.redirects();
}

describe("la dirección vieja de las categorías", () => {
  it("lleva a la pestaña Categorías de Evaluaciones", async () => {
    const redirects = await declaredRedirects();

    expect(redirects).toContainEqual({
      source: EVALUATION_CATEGORIES_PATH,
      destination: `${EVALUATIONS_PATH}?tab=categories`,
      permanent: true,
    });
  });

  it("ya no es una pantalla", () => {
    const pageDirectory = path.resolve(
      __dirname,
      "../../src/app/(app)/evaluaciones/categorias",
    );

    expect(existsSync(pageDirectory)).toBe(false);
  });

  it.each(["Committee", "Player"] as const)(
    "sigue mandando al panel a un %s que pide la pestaña",
    (role) => {
      const decision = decideSessionBoundary({
        pathname: EVALUATIONS_PATH,
        session: { kind: "active", role, membershipCurrent: true },
      });

      expect(decision).toEqual({ kind: "redirect", to: "/dashboard" });
    },
  );
});
