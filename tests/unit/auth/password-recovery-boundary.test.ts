import { describe, expect, it } from "vitest";
import {
  PASSWORD_RECOVERY_API_PATH,
  PASSWORD_RESET_API_PATH,
  PASSWORD_RESET_PATH,
} from "@/lib/auth/routes";
import { decideSessionBoundary } from "@/lib/auth/session-boundary";

// Los tres caminos de la recuperación de contraseña los recorre alguien que,
// por definición, no puede iniciar sesión. Una pantalla pública cuyo
// formulario escribe en un endpoint protegido sólo sabe responder 401: ya
// pasó con el registro (#146).
describe("frontera de sesión: recuperación de contraseña", () => {
  it.each([
    PASSWORD_RESET_PATH,
    PASSWORD_RECOVERY_API_PATH,
    PASSWORD_RESET_API_PATH,
  ])("deja pasar %s sin sesión", (pathname) => {
    expect(
      decideSessionBoundary({ pathname, session: { kind: "anonymous" } }),
    ).toEqual({
      kind: "allow",
    });
  });
});
