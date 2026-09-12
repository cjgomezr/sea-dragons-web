import { describe, expect, it } from "vitest";
import {
  PASSWORD_RECOVERY_PATH,
  REGISTRATION_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import { decideSessionBoundary } from "@/lib/auth/session-boundary";

const WITHOUT_SESSION = { hasSession: false } as const;
const WITH_SESSION = { hasSession: true } as const;

describe("frontera de sesión", () => {
  it.each([SIGN_IN_PATH, REGISTRATION_PATH, PASSWORD_RECOVERY_PATH])(
    "deja pasar %s sin sesión, porque es una de las tres pantallas públicas",
    (pathname) => {
      const outcome = decideSessionBoundary({ pathname, ...WITHOUT_SESSION });

      expect(outcome).toEqual({ kind: "allow" });
    },
  );

  it("redirige a la entrada cualquier otra pantalla pedida sin sesión", () => {
    const outcome = decideSessionBoundary({
      pathname: "/calendario",
      ...WITHOUT_SESSION,
    });

    expect(outcome).toEqual({ kind: "redirect", to: SIGN_IN_PATH });
  });

  it("redirige también la raíz de la aplicación pedida sin sesión", () => {
    const outcome = decideSessionBoundary({
      pathname: "/",
      ...WITHOUT_SESSION,
    });

    expect(outcome).toEqual({ kind: "redirect", to: SIGN_IN_PATH });
  });

  it("deja pasar una pantalla de la aplicación cuando hay sesión", () => {
    const outcome = decideSessionBoundary({
      pathname: "/calendario",
      ...WITH_SESSION,
    });

    expect(outcome).toEqual({ kind: "allow" });
  });

  it("responde 401 a cualquier endpoint de la API pedido sin sesión", () => {
    const outcome = decideSessionBoundary({
      pathname: "/api/v1/evaluaciones",
      ...WITHOUT_SESSION,
    });

    expect(outcome).toEqual({ kind: "unauthenticated" });
  });

  it("deja pasar un endpoint de la API cuando hay sesión", () => {
    const outcome = decideSessionBoundary({
      pathname: "/api/v1/evaluaciones",
      ...WITH_SESSION,
    });

    expect(outcome).toEqual({ kind: "allow" });
  });

  it("deja público el endpoint de salud, porque lo consulta el monitoreo sin autenticarse", () => {
    const outcome = decideSessionBoundary({
      pathname: "/api/v1/health",
      ...WITHOUT_SESSION,
    });

    expect(outcome).toEqual({ kind: "allow" });
  });

  it("deja público el endpoint de la sesión, que es con el que se consigue una", () => {
    const outcome = decideSessionBoundary({
      pathname: "/api/v1/auth/session",
      ...WITHOUT_SESSION,
    });

    expect(outcome).toEqual({ kind: "allow" });
  });

  it("no confunde un endpoint que solo empieza igual que el de salud", () => {
    const outcome = decideSessionBoundary({
      pathname: "/api/v1/healthcheck",
      ...WITHOUT_SESSION,
    });

    expect(outcome).toEqual({ kind: "unauthenticated" });
  });

  it("no confunde una pantalla que solo empieza igual que una pública", () => {
    const outcome = decideSessionBoundary({
      pathname: "/registros",
      ...WITHOUT_SESSION,
    });

    expect(outcome).toEqual({ kind: "redirect", to: SIGN_IN_PATH });
  });

  it("protege lo que cuelga de un endpoint público, que no hereda nada", () => {
    const outcome = decideSessionBoundary({
      pathname: "/api/v1/auth/session/loquesea",
      ...WITHOUT_SESSION,
    });

    expect(outcome).toEqual({ kind: "unauthenticated" });
  });

  it("deja pasar las rutas hijas de una pantalla pública", () => {
    const outcome = decideSessionBoundary({
      pathname: `${REGISTRATION_PATH}/tutor`,
      ...WITHOUT_SESSION,
    });

    expect(outcome).toEqual({ kind: "allow" });
  });
});
