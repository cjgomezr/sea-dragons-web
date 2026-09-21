import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import {
  MEMBERS_API_PATH,
  MEMBER_ROLE_API_PATH,
  RESTRICTED_ROUTES,
  ROLE_REQUESTS_API_PATH,
  ROLE_REQUEST_DECISION_API_PATH,
} from "@/lib/auth/routes";
import { decideSessionBoundary } from "@/lib/auth/session-boundary";
import type { Role } from "@/lib/auth/roles";

/**
 * La pantalla de administración de E3 se mudó al directorio (#240, RF-8 del
 * PRD de E5). Lo que se prueba aquí es la mudanza en sí: la ruta vieja ya no
 * es una pantalla, quien la pida acaba en el directorio, y los endpoints que
 * la pantalla usaba conservan exactamente quién puede llamarlos.
 */

const RETIRED_PATH = "/administracion";
const DIRECTORY_PATH = "/directorio";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const REQUEST_ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

const NON_ADMIN_ROLES = ["Coach", "Committee", "Player"] as const;

function activeAs(role: Role): {
  readonly session: { readonly kind: "active"; readonly role: Role };
} {
  return { session: { kind: "active", role } };
}

async function declaredRedirects() {
  if (nextConfig.redirects === undefined) {
    throw new Error("next.config no declara redirecciones");
  }
  return nextConfig.redirects();
}

describe("frontera", () => {
  it("ya no declara la pantalla de administración", () => {
    const pageDirectory = path.resolve(
      __dirname,
      "../../src/app/(app)/administracion",
    );

    expect(existsSync(pageDirectory)).toBe(false);
  });

  it("ya no restringe una ruta que no existe", () => {
    expect(RESTRICTED_ROUTES.map((route) => route.path)).not.toContain(
      RETIRED_PATH,
    );
  });

  it("lleva al directorio a quien pide la ruta vieja", async () => {
    const redirects = await declaredRedirects();

    expect(redirects).toContainEqual({
      source: RETIRED_PATH,
      destination: DIRECTORY_PATH,
      permanent: true,
    });
  });

  it.each([
    ["decidir una solicitud", ROLE_REQUEST_DECISION_API_PATH, REQUEST_ID],
    ["cambiar un rol", MEMBER_ROLE_API_PATH, MEMBER_ID],
  ])(
    "sigue reservando %s a quien gestiona usuarios y roles",
    (_action, template, id) => {
      const pathname = template.replace("[id]", id);

      for (const role of NON_ADMIN_ROLES) {
        expect(decideSessionBoundary({ pathname, ...activeAs(role) })).toEqual({
          kind: "missingCapability",
        });
      }
      expect(decideSessionBoundary({ pathname, ...activeAs("Admin") })).toEqual(
        { kind: "allow" },
      );
    },
  );

  it("sigue reservando la lista de miembros de E3 a quien gestiona usuarios y roles", () => {
    expect(
      decideSessionBoundary({
        pathname: MEMBERS_API_PATH,
        ...activeAs("Player"),
      }),
    ).toEqual({ kind: "missingCapability" });
  });

  it("deja la bandeja de solicitudes en manos de su handler, como antes", () => {
    expect(RESTRICTED_ROUTES.map((route) => route.path)).not.toContain(
      ROLE_REQUESTS_API_PATH,
    );
  });
});
