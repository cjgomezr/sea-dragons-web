import { describe, expect, it } from "vitest";
import {
  ACCOUNT_API_PATH,
  ACCOUNT_PAGE_PATH,
  ADMINISTRATION_PATH,
  COMPLETE_REGISTRATION_PATH,
  CONFIRMATION_EMAIL_API_PATH,
  DASHBOARD_PATH,
  EMAIL_CONFIRMATION_PATH,
  EVALUATIONS_PATH,
  GROUPS_API_PATH,
  GUARDIAN_CONSENT_API_PATH,
  MEMBERS_API_PATH,
  MEMBER_ROLE_API_PATH,
  PASSWORD_RECOVERY_PATH,
  REGISTER_API_PATH,
  REGISTRATION_PATH,
  ROLE_REQUESTS_API_PATH,
  ROLE_REQUEST_DECISION_API_PATH,
  SIGN_IN_PATH,
  TEAMS_PATH,
} from "@/lib/auth/routes";
import { ROLES, type Role } from "@/lib/auth/roles";
import {
  type SessionBoundaryOutcome,
  decideSessionBoundary,
} from "@/lib/auth/session-boundary";

const ANONYMOUS = { session: { kind: "anonymous" } } as const;
const INCOMPLETE = { session: { kind: "incomplete" } } as const;
const ACTIVE = { session: { kind: "active", role: "Player" } } as const;

function activeAs(role: Role): {
  readonly session: { readonly kind: "active"; readonly role: Role };
} {
  return { session: { kind: "active", role } };
}

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

/** Las cinco pantallas que la matriz abre a todos (la fila de funciones de
 * socio) más el panel, que es el destino de toda redirección por rol. */
const PAGES_OPEN_TO_EVERY_ROLE = [
  DASHBOARD_PATH,
  "/calendario",
  "/directorio",
  "/noticias",
  "/pagos",
  // Mi cuenta (#209): pedir un rol no es una fila de la matriz.
  ACCOUNT_PAGE_PATH,
] as const;

const TO_DASHBOARD: SessionBoundaryOutcome = {
  kind: "redirect",
  to: DASHBOARD_PATH,
};
const ALLOW: SessionBoundaryOutcome = { kind: "allow" };

describe("frontera por rol en páginas", () => {
  const roleByPage: readonly (readonly [
    Role,
    string,
    SessionBoundaryOutcome,
  ])[] = [
    ["Player", TEAMS_PATH, TO_DASHBOARD],
    ["Player", EVALUATIONS_PATH, TO_DASHBOARD],
    ["Committee", TEAMS_PATH, TO_DASHBOARD],
    ["Committee", EVALUATIONS_PATH, TO_DASHBOARD],
    ["Coach", TEAMS_PATH, ALLOW],
    ["Coach", EVALUATIONS_PATH, ALLOW],
    ["Admin", TEAMS_PATH, ALLOW],
    ["Admin", EVALUATIONS_PATH, ALLOW],
    ...ROLES.flatMap((role) =>
      PAGES_OPEN_TO_EVERY_ROLE.map(
        (pathname) => [role, pathname, ALLOW] as const,
      ),
    ),
  ];

  it.each(roleByPage)(
    "un %s que pide %s recibe %o",
    (role, pathname, outcome) => {
      expect(decideSessionBoundary({ pathname, ...activeAs(role) })).toEqual(
        outcome,
      );
    },
  );

  it("niega también lo que cuelga de una pantalla restringida", () => {
    expect(
      decideSessionBoundary({
        pathname: `${EVALUATIONS_PATH}/nueva`,
        ...activeAs("Player"),
      }),
    ).toEqual(TO_DASHBOARD);
  });

  it("no confunde una pantalla que solo empieza igual que una restringida", () => {
    expect(
      decideSessionBoundary({
        pathname: `${TEAMS_PATH}x`,
        ...activeAs("Player"),
      }),
    ).toEqual(ALLOW);
  });
});

describe("Mi cuenta con la cuenta incompleta o sin sesión", () => {
  it("manda a completar registro a una cuenta incompleta", () => {
    expect(
      decideSessionBoundary({ pathname: ACCOUNT_PAGE_PATH, ...INCOMPLETE }),
    ).toEqual({ kind: "redirect", to: COMPLETE_REGISTRATION_PATH });
  });

  it("manda a la entrada a quien no tiene sesión", () => {
    expect(
      decideSessionBoundary({ pathname: ACCOUNT_PAGE_PATH, ...ANONYMOUS }),
    ).toEqual({ kind: "redirect", to: SIGN_IN_PATH });
  });
});

describe("orden de las fronteras en páginas", () => {
  it("manda a la entrada, no al panel, una pantalla restringida pedida sin sesión", () => {
    expect(
      decideSessionBoundary({ pathname: EVALUATIONS_PATH, ...ANONYMOUS }),
    ).toEqual({ kind: "redirect", to: SIGN_IN_PATH });
  });

  it("manda a completar registro, no al panel, una pantalla restringida pedida con la cuenta incompleta", () => {
    expect(
      decideSessionBoundary({ pathname: TEAMS_PATH, ...INCOMPLETE }),
    ).toEqual({ kind: "redirect", to: COMPLETE_REGISTRATION_PATH });
  });
});

/** Una solicitud cualquiera: la frontera no mira qué id trae, sólo que ocupa
 * el segmento dinámico de la ruta declarada. */
const DECISION_PATH = ROLE_REQUEST_DECISION_API_PATH.replace(
  "[id]",
  "0f0e0d0c-0b0a-4908-8706-050403020100",
);

describe("frontera por rol en la decisión de una solicitud (#210)", () => {
  it.each(["Coach", "Committee", "Player"] as const)(
    "niega a un %s decidir una solicitud",
    (role) => {
      expect(
        decideSessionBoundary({ pathname: DECISION_PATH, ...activeAs(role) }),
      ).toEqual({ kind: "missingCapability" });
    },
  );

  it("deja pasar a un Admin", () => {
    expect(
      decideSessionBoundary({ pathname: DECISION_PATH, ...activeAs("Admin") }),
    ).toEqual(ALLOW);
  });

  it("sigue dejando a cualquier rol pedir un rol, aunque la decisión cuelgue del mismo endpoint", () => {
    expect(
      decideSessionBoundary({
        pathname: ROLE_REQUESTS_API_PATH,
        ...activeAs("Player"),
      }),
    ).toEqual(ALLOW);
  });

  it("no confunde con la decisión otra ruta que cuelgue de una solicitud", () => {
    expect(
      decideSessionBoundary({
        pathname: DECISION_PATH.replace("/decision", "/decisiones"),
        ...activeAs("Player"),
      }),
    ).toEqual(ALLOW);
  });
});

/** El `user_id` de un socio cualquiera, en el segmento dinámico. */
const MEMBER_ROLE_PATH = MEMBER_ROLE_API_PATH.replace(
  "[id]",
  "b1b1b1b1-0000-4000-8000-00000000000b",
);

describe("frontera por rol en el cambio de rol de un socio (#211)", () => {
  it.each(["Coach", "Committee", "Player"] as const)(
    "niega a un %s cambiar un rol",
    (role) => {
      expect(
        decideSessionBoundary({
          pathname: MEMBER_ROLE_PATH,
          ...activeAs(role),
        }),
      ).toEqual({ kind: "missingCapability" });
    },
  );

  it("deja pasar a un Admin", () => {
    expect(
      decideSessionBoundary({
        pathname: MEMBER_ROLE_PATH,
        ...activeAs("Admin"),
      }),
    ).toEqual(ALLOW);
  });
});

describe("frontera por rol en la administración del club (#212)", () => {
  it.each(["Coach", "Committee", "Player"] as const)(
    "manda al panel a un %s que pide la pantalla de administración",
    (role) => {
      expect(
        decideSessionBoundary({
          pathname: ADMINISTRATION_PATH,
          ...activeAs(role),
        }),
      ).toEqual(TO_DASHBOARD);
    },
  );

  it("deja entrar a un Admin en la pantalla de administración", () => {
    expect(
      decideSessionBoundary({
        pathname: ADMINISTRATION_PATH,
        ...activeAs("Admin"),
      }),
    ).toEqual(ALLOW);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "niega a un %s leer la lista de socios",
    (role) => {
      expect(
        decideSessionBoundary({
          pathname: MEMBERS_API_PATH,
          ...activeAs(role),
        }),
      ).toEqual({ kind: "missingCapability" });
    },
  );

  it("deja pasar a un Admin a la lista de socios", () => {
    expect(
      decideSessionBoundary({
        pathname: MEMBERS_API_PATH,
        ...activeAs("Admin"),
      }),
    ).toEqual(ALLOW);
  });
});

/** Un grupo cualquiera, en el segmento dinámico de renombrar y borrar. */
const GROUP_PATH = `${GROUPS_API_PATH}/9a9a9a9a-0000-4000-8000-000000000009`;

describe("frontera de grupos", () => {
  it.each([GROUPS_API_PATH, GROUP_PATH])("niega a un Player %s", (pathname) => {
    expect(decideSessionBoundary({ pathname, ...activeAs("Player") })).toEqual({
      kind: "missingCapability",
    });
  });

  it.each(
    (["Admin", "Coach", "Committee"] as const).flatMap((role) =>
      [GROUPS_API_PATH, GROUP_PATH].map(
        (pathname) => [role, pathname] as const,
      ),
    ),
  )("deja pasar a un %s a %s", (role, pathname) => {
    expect(decideSessionBoundary({ pathname, ...activeAs(role) })).toEqual(
      ALLOW,
    );
  });

  it("responde 401 sin sesión", () => {
    expect(
      decideSessionBoundary({ pathname: GROUPS_API_PATH, ...ANONYMOUS }),
    ).toEqual({ kind: "unauthenticated" });
  });

  it("responde 403 a una cuenta incompleta", () => {
    expect(
      decideSessionBoundary({ pathname: GROUP_PATH, ...INCOMPLETE }),
    ).toEqual({ kind: "forbidden" });
  });
});
