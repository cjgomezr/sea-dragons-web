import { AuthApiError, AuthUnknownError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  isRejectedNewPassword,
  isUnknownIdentity,
  isUnusableLink,
} from "@/lib/auth/supabase-password-recovery";

// Estos tres predicados deciden entre "no hay cuenta", "el enlace no sirve",
// "la contraseña no se aceptó" y "el servicio falló". Confundir el último con
// cualquiera de los otros convierte una caída en un 200 silencioso o en un
// "pide otro enlace" a quien tiene uno bueno.
describe("recuperación de contraseña: errores de Supabase Auth", () => {
  it("reconoce la identidad inexistente por su código", () => {
    expect(
      isUnknownIdentity(
        new AuthApiError("User not found", 404, "user_not_found"),
      ),
    ).toBe(true);
  });

  it("reconoce la identidad inexistente por el 404 aunque no traiga código", () => {
    expect(
      isUnknownIdentity(new AuthApiError("Not found", 404, undefined)),
    ).toBe(true);
  });

  it("no toma una caída del servicio por una cuenta inexistente", () => {
    expect(
      isUnknownIdentity(new AuthApiError("boom", 500, "unexpected_failure")),
    ).toBe(false);
  });

  it("toma el token caducado o ya usado por un enlace que no sirve", () => {
    expect(
      isUnusableLink(
        new AuthApiError(
          "Email link is invalid or has expired",
          403,
          "otp_expired",
        ),
      ),
    ).toBe(true);
  });

  it("no toma el límite de peticiones del servicio por un enlace gastado", () => {
    expect(
      isUnusableLink(
        new AuthApiError("Too many requests", 429, "over_request_rate_limit"),
      ),
    ).toBe(false);
  });

  it("no toma una caída del servicio por un enlace gastado", () => {
    expect(
      isUnusableLink(new AuthApiError("boom", 500, "unexpected_failure")),
    ).toBe(false);
  });

  it("no toma un error sin estado HTTP por un enlace gastado", () => {
    expect(isUnusableLink(new AuthUnknownError("sin red", null))).toBe(false);
  });

  it.each(["same_password", "weak_password"])(
    "reconoce la contraseña que el servicio no acepta (%s)",
    (code) => {
      expect(
        isRejectedNewPassword(new AuthApiError("rechazada", 422, code)),
      ).toBe(true);
    },
  );

  it("no toma una caída del servicio por una contraseña rechazada", () => {
    expect(
      isRejectedNewPassword(
        new AuthApiError("boom", 500, "unexpected_failure"),
      ),
    ).toBe(false);
  });
});
