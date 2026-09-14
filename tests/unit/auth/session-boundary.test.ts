import { describe, expect, it } from "vitest";
import {
  ACCOUNT_API_PATH,
  COMPLETE_REGISTRATION_PATH,
  CONFIRMATION_EMAIL_API_PATH,
  DASHBOARD_PATH,
  EMAIL_CONFIRMATION_PATH,
  GUARDIAN_CONSENT_API_PATH,
  PASSWORD_RECOVERY_PATH,
  REGISTER_API_PATH,
  REGISTRATION_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import { decideSessionBoundary } from "@/lib/auth/session-boundary";

const ANONYMOUS = { session: "anonymous" } as const;
const INCOMPLETE = { session: "incomplete" } as const;
const ACTIVE = { session: "active" } as const;

describe("frontera de sesión: sin sesión", () => {
  it.each([SIGN_IN_PATH, REGISTRATION_PATH, PASSWORD_RECOVERY_PATH])(
    "deja pasar %s, porque es una de las tres pantallas públicas",
    (pathname) => {
      expect(decideSessionBoundary({ pathname, ...ANONYMOUS })).toEqual({
        kind: "allow",
      });
    },
  );

  it("redirige a la entrada cualquier otra pantalla", () => {
    expect(
      decideSessionBoundary({ pathname: "/calendario", ...ANONYMOUS }),
    ).toEqual({ kind: "redirect", to: SIGN_IN_PATH });
  });

  it("redirige también la raíz de la aplicación", () => {
    expect(decideSessionBoundary({ pathname: "/", ...ANONYMOUS })).toEqual({
      kind: "redirect",
      to: SIGN_IN_PATH,
    });
  });

  it("responde 401 a cualquier endpoint de la API", () => {
    expect(
      decideSessionBoundary({ pathname: "/api/v1/evaluaciones", ...ANONYMOUS }),
    ).toEqual({ kind: "unauthenticated" });
  });

  it("deja público el endpoint de salud, porque lo consulta el monitoreo sin autenticarse", () => {
    expect(
      decideSessionBoundary({ pathname: "/api/v1/health", ...ANONYMOUS }),
    ).toEqual({ kind: "allow" });
  });

  it("deja público el endpoint de la sesión, que es con el que se consigue una", () => {
    expect(
      decideSessionBoundary({ pathname: "/api/v1/auth/session", ...ANONYMOUS }),
    ).toEqual({ kind: "allow" });
  });

  it("deja público el endpoint del registro, que nadie puede pedir con sesión", () => {
    expect(
      decideSessionBoundary({ pathname: REGISTER_API_PATH, ...ANONYMOUS }),
    ).toEqual({ kind: "allow" });
  });

  it("deja público el reenvío de la confirmación, que se pide desde el registro", () => {
    expect(
      decideSessionBoundary({
        pathname: CONFIRMATION_EMAIL_API_PATH,
        ...ANONYMOUS,
      }),
    ).toEqual({ kind: "allow" });
  });

  // El tercer camino de quien todavía no tiene cuenta, y el único que no es un
  // endpoint. Los otros dos están justo arriba. Si esta pantalla queda detrás
  // de la frontera, el enlace del correo nunca canjea su token: pasó en
  // producción y lo arregló el #146.
  it("deja pasar el destino del enlace de confirmación, que se abre sin sesión", () => {
    expect(
      decideSessionBoundary({
        pathname: EMAIL_CONFIRMATION_PATH,
        ...ANONYMOUS,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("no confunde un endpoint que solo empieza igual que el de salud", () => {
    expect(
      decideSessionBoundary({ pathname: "/api/v1/healthcheck", ...ANONYMOUS }),
    ).toEqual({ kind: "unauthenticated" });
  });

  it("no confunde una pantalla que solo empieza igual que una pública", () => {
    expect(
      decideSessionBoundary({ pathname: "/registros", ...ANONYMOUS }),
    ).toEqual({ kind: "redirect", to: SIGN_IN_PATH });
  });

  it("protege lo que cuelga de un endpoint público, que no hereda nada", () => {
    expect(
      decideSessionBoundary({
        pathname: "/api/v1/auth/session/loquesea",
        ...ANONYMOUS,
      }),
    ).toEqual({ kind: "unauthenticated" });
  });

  it("deja pasar las rutas hijas de una pantalla pública", () => {
    expect(
      decideSessionBoundary({
        pathname: `${REGISTRATION_PATH}/tutor`,
        ...ANONYMOUS,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("redirige a la entrada, no a completar registro, la pantalla de completar registro", () => {
    expect(
      decideSessionBoundary({
        pathname: COMPLETE_REGISTRATION_PATH,
        ...ANONYMOUS,
      }),
    ).toEqual({ kind: "redirect", to: SIGN_IN_PATH });
  });
});

describe("frontera de sesión: cuenta activa", () => {
  it("deja pasar una pantalla de la aplicación", () => {
    expect(
      decideSessionBoundary({ pathname: "/calendario", ...ACTIVE }),
    ).toEqual({ kind: "allow" });
  });

  it("deja pasar un endpoint de la API", () => {
    expect(
      decideSessionBoundary({ pathname: "/api/v1/evaluaciones", ...ACTIVE }),
    ).toEqual({ kind: "allow" });
  });

  it("manda al panel a quien pide a mano la pantalla de completar registro", () => {
    expect(
      decideSessionBoundary({
        pathname: COMPLETE_REGISTRATION_PATH,
        ...ACTIVE,
      }),
    ).toEqual({ kind: "redirect", to: DASHBOARD_PATH });
  });

  it("manda al panel también lo que cuelgue de esa pantalla", () => {
    expect(
      decideSessionBoundary({
        pathname: `${COMPLETE_REGISTRATION_PATH}/tutor`,
        ...ACTIVE,
      }),
    ).toEqual({ kind: "redirect", to: DASHBOARD_PATH });
  });

  it("deja pasar el endpoint de la cuenta, que responde por sí mismo que no falta nada", () => {
    expect(
      decideSessionBoundary({ pathname: ACCOUNT_API_PATH, ...ACTIVE }),
    ).toEqual({ kind: "allow" });
  });
});

describe("frontera de sesión: cuenta incompleta", () => {
  it("redirige a completar registro cualquier pantalla de la aplicación", () => {
    expect(
      decideSessionBoundary({ pathname: "/calendario", ...INCOMPLETE }),
    ).toEqual({ kind: "redirect", to: COMPLETE_REGISTRATION_PATH });
  });

  it("redirige también la raíz de la aplicación", () => {
    expect(decideSessionBoundary({ pathname: "/", ...INCOMPLETE })).toEqual({
      kind: "redirect",
      to: COMPLETE_REGISTRATION_PATH,
    });
  });

  it("deja pasar la pantalla de completar registro, que es su único destino", () => {
    expect(
      decideSessionBoundary({
        pathname: COMPLETE_REGISTRATION_PATH,
        ...INCOMPLETE,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("deja pasar lo que cuelgue de esa pantalla, porque crecerá por pasos", () => {
    expect(
      decideSessionBoundary({
        pathname: `${COMPLETE_REGISTRATION_PATH}/tutor`,
        ...INCOMPLETE,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("responde 403 a cualquier endpoint de la API, que es el caso que la redirección esconde", () => {
    expect(
      decideSessionBoundary({
        pathname: "/api/v1/evaluaciones",
        ...INCOMPLETE,
      }),
    ).toEqual({ kind: "forbidden" });
  });

  it("deja pasar el endpoint del consentimiento del tutor, que es uno de sus pendientes", () => {
    expect(
      decideSessionBoundary({
        pathname: GUARDIAN_CONSENT_API_PATH,
        ...INCOMPLETE,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("deja pasar el endpoint con el que completa su registro", () => {
    expect(
      decideSessionBoundary({ pathname: ACCOUNT_API_PATH, ...INCOMPLETE }),
    ).toEqual({ kind: "allow" });
  });

  it("deja pasar el endpoint de la sesión, o no podría cerrar la suya", () => {
    expect(
      decideSessionBoundary({
        pathname: "/api/v1/auth/session",
        ...INCOMPLETE,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("deja pasar el reenvío de la confirmación, que es uno de sus pendientes", () => {
    expect(
      decideSessionBoundary({
        pathname: CONFIRMATION_EMAIL_API_PATH,
        ...INCOMPLETE,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("no deja colar un endpoint que solo cuelga del suyo", () => {
    expect(
      decideSessionBoundary({
        pathname: `${ACCOUNT_API_PATH}/loquesea`,
        ...INCOMPLETE,
      }),
    ).toEqual({ kind: "forbidden" });
  });
});
