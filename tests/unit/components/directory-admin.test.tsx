import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type {
  AdminDirectoryMember,
  DirectoryMember,
} from "@/lib/directory/directory";
import {
  DEFENDER,
  GOALKEEPER,
  asDirectoryPosition,
} from "../helpers/seeded-positions";

/**
 * Lo que el directorio le enseña a un Admin además de la lista (#240, RF-8 del
 * PRD de E5): la bandeja de solicitudes de rol y el cambio de rol de cada
 * miembro, mudados tal cual desde la pantalla de administración de E3 (#212).
 *
 * Las escrituras ya existían (#210 y #211). Lo que se prueba aquí es que el
 * directorio refleja su resultado sin recargar, que no da por hecho ningún
 * cambio que el servidor no confirmó, y que nada de esto le sale a quien no
 * es Admin.
 */

const NEREA_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const REQUEST_ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

const NEREA: AdminDirectoryMember = {
  userId: NEREA_ID,
  fullName: "Nerea Ruiz",
  country: "ES",
  experienceLevel: "Beginner",
  role: "Player",
  position: asDirectoryPosition(GOALKEEPER),
  status: "active",
  invitedOn: null,
  photoUrl: null,
  attendance: { kind: "no_data" },
  aufNumber: null,
  aufExpiry: null,
  isAufVerified: false,
  isAufExpired: false,
  isAufExpiring: false,
  isEvaluated: true,
  membershipStatus: "active",
  email: "nerea@club.test",
  phone: null,
  emergencyContact: null,
};

const ANA: AdminDirectoryMember = {
  userId: ADMIN_ID,
  fullName: "Ana Admin",
  country: "AU",
  experienceLevel: "Advanced",
  role: "Admin",
  position: asDirectoryPosition(DEFENDER),
  status: "active",
  invitedOn: null,
  photoUrl: null,
  attendance: { kind: "no_data" },
  aufNumber: "AUF-1",
  aufExpiry: "2030-06-30",
  isAufVerified: true,
  isAufExpired: false,
  isAufExpiring: false,
  isEvaluated: true,
  membershipStatus: "active",
  email: "ana@club.test",
  phone: null,
  emergencyContact: null,
};

const COACH_REQUEST: PendingRoleRequest = {
  id: REQUEST_ID,
  userId: NEREA_ID,
  fullName: "Nerea Ruiz",
  requestedRole: "Coach",
  justification: "Entreno a los juveniles los jueves.",
  // 18:30 en Melbourne.
  createdAt: "2026-09-17T08:30:00.000Z",
};

const DIRECTORY_PATH = "/api/v1/directory";
const PENDING_REQUESTS_PATH = "/api/v1/role-requests?status=pending";
const POSITIONS_PATH = "/api/v1/club/positions";
const GROUPS_PATH = "/api/v1/groups";

type ApiCall = {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
};

type Respond = () => Promise<Response>;

type ApiStub = {
  /** Quién mira: sólo a un Admin le llega la lista marcada `admin`. */
  readonly kind?: "admin" | "member";
  readonly members?: readonly (AdminDirectoryMember | DirectoryMember)[];
  readonly requests?: readonly PendingRoleRequest[];
  readonly loadRequests?: Respond;
  readonly decision?: Respond;
  readonly roleChange?: Respond;
};

const calls: ApiCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(
  status: number,
  code: string,
  reason?: string,
): Response {
  return jsonResponse(status, { error: { code, message: "x", reason } });
}

function readResponse(stub: ApiStub, url: string): Promise<Response> {
  if (url.startsWith(DIRECTORY_PATH)) {
    return Promise.resolve(
      jsonResponse(200, {
        data: {
          kind: stub.kind ?? "admin",
          members: stub.members ?? [NEREA],
          total: (stub.members ?? [NEREA]).length,
          availableFilters:
            (stub.kind ?? "admin") === "admin"
              ? ["position", "group", "auf", "membership"]
              : ["position"],
        },
      }),
    );
  }
  // Las opciones de los filtros (#497) se prueban en
  // `directory-screen.test.tsx`: aquí llegan vacías.
  if (url === POSITIONS_PATH) {
    return Promise.resolve(jsonResponse(200, { data: { positions: [] } }));
  }
  if (url === GROUPS_PATH) {
    return Promise.resolve(jsonResponse(200, { data: { groups: [] } }));
  }
  if (url === PENDING_REQUESTS_PATH) {
    return (
      stub.loadRequests?.() ??
      Promise.resolve(
        jsonResponse(200, {
          data: { requests: stub.requests ?? [COACH_REQUEST] },
        }),
      )
    );
  }
  throw new Error(`Petición inesperada: ${url}`);
}

const APPROVED_DECISION = {
  data: {
    id: REQUEST_ID,
    status: "approved",
    decidedBy: ADMIN_ID,
    decidedAt: "2026-09-18T01:00:00.000Z",
  },
};

function stubApi(stub: ApiStub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body =
        init?.body === undefined ? null : JSON.parse(String(init.body));
      calls.push({ url, method, body });
      if (method === "GET") {
        return readResponse(stub, url);
      }
      if (method === "POST") {
        return stub.decision?.() ?? jsonResponse(200, APPROVED_DECISION);
      }
      return (
        stub.roleChange?.() ??
        jsonResponse(200, {
          data: { userId: NEREA_ID, previousRole: "Player", role: "Committee" },
        })
      );
    }),
  );
}

const TRAY_LOADING = {
  en: "Loading the pending requests…",
  es: "Cargando las solicitudes pendientes…",
} as const;

/** Espera a que el directorio y la bandeja hayan pintado lo que leyeron. */
async function renderAdminDirectory(locale: "en" | "es" = "en"): Promise<void> {
  render(<DirectoryScreen locale={locale} />);
  await screen.findByRole("region", {
    name: locale === "en" ? "Club members" : "Miembros del club",
  });
  await screen.findByRole("region", {
    name: locale === "en" ? "Pending requests" : "Solicitudes pendientes",
  });
  await waitFor(() =>
    expect(screen.queryByText(TRAY_LOADING[locale])).toBeNull(),
  );
}

function trayItem(): HTMLElement {
  return screen.getByRole("listitem", { name: /Nerea Ruiz/ });
}

/** La celda del rol de un miembro, que desde #549 es sólo texto. Sin
 * solicitud pendiente, su nombre es el rol y nada más. */
function roleCell(name: string, role: string): HTMLElement {
  return within(screen.getByRole("row", { name })).getByRole("cell", {
    name: role,
  });
}

function approveButton(): HTMLElement {
  return screen.getByRole("button", {
    name: "Approve the request from Nerea Ruiz",
  });
}

function emptyTray(): HTMLElement {
  return screen.getByText("No requests are waiting for an answer.");
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("directorio para Admin: bandeja de solicitudes", () => {
  it("lista cada solicitud con el miembro, el rol pedido, la fecha y la justificación", async () => {
    stubApi();

    await renderAdminDirectory();

    const item = trayItem();
    expect(
      within(item).getByText(/Nerea Ruiz asked to be Coach/),
    ).toBeVisible();
    expect(
      within(item).getByText("Asked on 17 September 2026 at 6:30 pm"),
    ).toBeVisible();
    expect(
      within(item).getByText("Entreno a los juveniles los jueves."),
    ).toBeVisible();
  });

  it("dice con una frase que no hay ninguna, en vez de una lista vacía", async () => {
    stubApi({ requests: [] });

    await renderAdminDirectory();

    expect(emptyTray()).toBeVisible();
    expect(screen.queryByRole("listitem", { name: /Nerea Ruiz/ })).toBeNull();
  });

  it("al aprobar, la solicitud sale de la bandeja y la lista enseña el rol nuevo", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderAdminDirectory();

    await user.click(approveButton());

    await waitFor(() => expect(emptyTray()).toBeVisible());
    expect(roleCell("Nerea Ruiz", "Coach")).toBeVisible();
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      {
        url: `/api/v1/role-requests/${REQUEST_ID}/decision`,
        method: "POST",
        body: { decision: "approved" },
      },
    ]);
  });

  it("al rechazar, la solicitud sale de la bandeja y el rol no cambia", async () => {
    const user = userEvent.setup();
    stubApi({
      decision: async () =>
        jsonResponse(200, {
          data: { ...APPROVED_DECISION.data, status: "rejected" },
        }),
    });
    await renderAdminDirectory();

    await user.click(
      screen.getByRole("button", {
        name: "Reject the request from Nerea Ruiz",
      }),
    );

    await waitFor(() => expect(emptyTray()).toBeVisible());
    expect(roleCell("Nerea Ruiz", "Player")).toBeVisible();
    expect(calls.at(-1)?.body).toEqual({ decision: "rejected" });
  });

  it("una solicitud que otro Admin ya resolvió lo dice y sale de la bandeja", async () => {
    const user = userEvent.setup();
    stubApi({ decision: async () => errorResponse(409, "conflict") });
    await renderAdminDirectory();

    await user.click(approveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Another Admin already answered this request.",
    );
    expect(screen.queryByRole("listitem", { name: /Nerea Ruiz/ })).toBeNull();
    expect(roleCell("Nerea Ruiz", "Player")).toBeVisible();
  });

  it("con un error de red muestra el aviso y deja volver a intentar", async () => {
    const user = userEvent.setup();
    stubApi({
      decision: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await renderAdminDirectory();

    await user.click(approveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server",
    );
    expect(trayItem()).toBeVisible();

    stubApi();
    await user.click(approveButton());
    await waitFor(() => expect(emptyTray()).toBeVisible());
  });

  it("desactiva aprobar y rechazar mientras la decisión está en curso", async () => {
    const user = userEvent.setup();
    let answer: (response: Response) => void = () => undefined;
    stubApi({
      decision: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await renderAdminDirectory();

    await user.click(approveButton());

    expect(approveButton()).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Reject the request from Nerea Ruiz",
      }),
    ).toBeDisabled();
    await act(async () => {
      answer(jsonResponse(200, APPROVED_DECISION));
    });
  });

  it("un doble clic manda una sola decisión", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderAdminDirectory();

    await user.dblClick(approveButton());

    await waitFor(() => expect(emptyTray()).toBeVisible());
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("si la bandeja no carga, lo dice y deja volver a intentar sin perder la lista", async () => {
    const user = userEvent.setup();
    stubApi({ loadRequests: async () => errorResponse(500, "internal_error") });
    render(<DirectoryScreen locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the pending requests.",
    );
    expect(roleCell("Nerea Ruiz", "Player")).toBeVisible();

    stubApi();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("listitem", { name: /Nerea Ruiz/ })).toBe(
      trayItem(),
    );
  });
});

// #549: la fila ya no cambia el rol. Los casos del cambio (confirmar, último
// Admin, red caída, doble clic, miembro que ya no está, regla desconocida)
// viven en `member-record-screen.test.tsx`, porque hasta el panel de #550 el
// Admin lo cambia desde la ficha; el de los borradores compartidos, en
// `member-role-control.test.tsx`.
describe("directorio para Admin: el rol en la fila (#549)", () => {
  it("pone el rol de cada miembro como texto, sin selector ni botón Guardar", async () => {
    stubApi({ members: [NEREA, ANA], requests: [] });

    await renderAdminDirectory();

    expect(roleCell("Nerea Ruiz", "Player")).toBeVisible();
    expect(roleCell("Ana Admin", "Admin")).toBeVisible();
    expect(
      within(screen.getByRole("table")).queryByRole("combobox"),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Save the role/ })).toBeNull();
  });

  it("pone debajo del rol la píldora con el rol que el miembro pidió", async () => {
    stubApi({ members: [NEREA, ANA] });

    await renderAdminDirectory();

    const pill = within(memberRow("Nerea Ruiz")).getByText("→ Coach");
    expect(pill).toBeVisible();
    expect(pill.closest("[title]")).toHaveAttribute(
      "title",
      "Asked to be Coach",
    );
    expect(within(memberRow("Ana Admin")).queryByText(/→/)).toBeNull();
  });

  it("dice a un lector de pantalla qué rol pidió", async () => {
    stubApi({ members: [NEREA] });

    await renderAdminDirectory();

    expect(
      within(memberRow("Nerea Ruiz")).getByRole("cell", {
        name: "Player Asked to be Coach",
      }),
    ).toBeVisible();
  });

  it("quita la píldora al aprobar la solicitud, y el rol pasa a ser el pedido", async () => {
    stubApi({ members: [NEREA] });
    await renderAdminDirectory();

    await userEvent.setup().click(approveButton());

    await waitFor(() => expect(emptyTray()).toBeVisible());
    expect(roleCell("Nerea Ruiz", "Coach")).toBeVisible();
    expect(within(memberRow("Nerea Ruiz")).queryByText(/→/)).toBeNull();
  });

  it("escribe la píldora en español", async () => {
    stubApi({ members: [NEREA] });

    await renderAdminDirectory("es");

    const pill = within(memberRow("Nerea Ruiz")).getByText("→ Coach");
    expect(pill.closest("[title]")).toHaveAttribute("title", "Pidió ser Coach");
  });
});
describe("directorio para Admin: lecturas", () => {
  it("pide la lista y la bandeja a la API v1, no a la base", async () => {
    stubApi();

    await renderAdminDirectory();

    const urls = calls.map((call) => call.url);
    expect(urls.some((url) => url.startsWith(DIRECTORY_PATH))).toBe(true);
    expect(urls).toContain(PENDING_REQUESTS_PATH);
    expect(urls).not.toContain("/api/v1/members");
  });
});

const VENCIDA: AdminDirectoryMember = {
  ...NEREA,
  userId: "c2c2c2c2-0000-4000-8000-00000000000c",
  fullName: "Vera Vencida",
  aufNumber: "AUF-7",
  aufExpiry: "2020-01-31",
  isAufVerified: true,
  isAufExpired: true,
  isAufExpiring: false,
  isEvaluated: true,
  membershipStatus: "active",
  email: "vencida@club.test",
  phone: null,
  emergencyContact: null,
};

function memberRow(name: string): HTMLElement {
  return screen.getByRole("row", { name });
}

describe("directorio para Admin: alta de un miembro (#243)", () => {
  it("ofrece dar de alta a un miembro desde la cabecera", async () => {
    stubApi({ members: [NEREA, ANA], requests: [] });

    await renderAdminDirectory();

    expect(screen.getByRole("link", { name: "Invite member" })).toHaveAttribute(
      "href",
      "/directorio/nuevo",
    );
  });
});

// Desde #549 el AUF de la fila es un punto: de peligro si venció, de aviso si
// falta el número o vence en 30 días. El número, el vencimiento y la
// verificación (#274) están en la ficha, que los prueba en
// `member-record-screen.test.tsx`.
describe("directorio para Admin: ficha reservada (#242)", () => {
  function dotsOf(name: string): readonly (string | null)[] {
    return within(memberRow(name))
      .queryAllByRole("img")
      .map((dot) => dot.getAttribute("title"));
  }

  it("enlaza cada miembro con su ficha", async () => {
    stubApi({ members: [NEREA, ANA], requests: [] });

    await renderAdminDirectory();

    expect(
      screen.getByRole("link", { name: "Open Nerea Ruiz's record" }),
    ).toHaveAttribute("href", `/directorio/${NEREA_ID}`);
    expect(
      screen.getByRole("link", { name: "Open Ana Admin's record" }),
    ).toHaveAttribute("href", `/directorio/${ADMIN_ID}`);
  });

  it("no señala un AUF con número y vencimiento lejano", async () => {
    stubApi({ members: [ANA], requests: [] });

    await renderAdminDirectory();

    expect(dotsOf("Ana Admin")).toEqual([]);
    expect(within(memberRow("Ana Admin")).queryByText(/AUF-1/)).toBeNull();
  });

  it("señala con un punto de aviso a quien no tiene AUF", async () => {
    stubApi({ members: [NEREA], requests: [] });

    await renderAdminDirectory();

    expect(dotsOf("Nerea Ruiz")).toEqual(["No AUF number"]);
  });

  it("no señala un AUF que no tiene vencimiento", async () => {
    stubApi({ members: [{ ...ANA, aufExpiry: null }], requests: [] });

    await renderAdminDirectory();

    expect(dotsOf("Ana Admin")).toEqual([]);
  });

  it("señala con un punto de peligro el vencimiento pasado", async () => {
    stubApi({ members: [VENCIDA], requests: [] });

    await renderAdminDirectory();

    expect(dotsOf("Vera Vencida")).toEqual(["AUF expired"]);
  });

  it("no lleva a la fila la verificación del AUF (#274): la dice la ficha", async () => {
    stubApi({
      members: [{ ...ANA, isAufVerified: false }, VENCIDA],
      requests: [],
    });

    await renderAdminDirectory();

    expect(screen.queryByText(/AUF (not )?verified/)).toBeNull();
    expect(dotsOf("Ana Admin")).toEqual([]);
    expect(dotsOf("Vera Vencida")).toEqual(["AUF expired"]);
  });

  it("escribe el enlace y los puntos del AUF en español", async () => {
    stubApi({ members: [NEREA, VENCIDA], requests: [] });

    await renderAdminDirectory("es");

    expect(
      screen.getByRole("link", { name: "Abrir la ficha de Nerea Ruiz" }),
    ).toBeVisible();
    expect(dotsOf("Nerea Ruiz")).toEqual(["Sin número de AUF"]);
    expect(dotsOf("Vera Vencida")).toEqual(["AUF vencido"]);
  });
});
describe("directorio para quien no es Admin", () => {
  it.each(["Coach", "Committee", "Player"] as const)(
    "a un %s no le enseña la bandeja ni el control de rol",
    async (role) => {
      stubApi({ kind: "member", members: [{ ...NEREA, role }] });

      render(<DirectoryScreen locale="en" />);
      await screen.findByRole("region", { name: "Club members" });

      expect(
        screen.queryByRole("region", { name: "Pending requests" }),
      ).toBeNull();
      // El control de rol vive en la fila; los filtros de #497 quedan fuera.
      expect(
        within(screen.getByRole("table")).queryByRole("combobox"),
      ).toBeNull();
      expect(screen.queryByRole("link", { name: /record/ })).toBeNull();
      expect(screen.queryByText(/AUF/)).toBeNull();
      expect(
        within(screen.getByRole("row", { name: "Nerea Ruiz" })).getByRole(
          "cell",
          { name: role },
        ),
      ).toBeVisible();
      expect(calls.map((call) => call.url)).not.toContain(
        PENDING_REQUESTS_PATH,
      );
    },
  );
});

describe("directorio para Admin en español", () => {
  it("escribe títulos, roles y estados vacíos en español", async () => {
    stubApi({ requests: [] });

    await renderAdminDirectory("es");

    expect(
      screen.getByRole("heading", { name: "Solicitudes pendientes" }),
    ).toBeVisible();
    expect(
      screen.getByText("No hay solicitudes esperando respuesta."),
    ).toBeVisible();
    expect(roleCell("Nerea Ruiz", "Jugador")).toBeVisible();
  });

  it("escribe en español la fecha y el rol pedido de una solicitud", async () => {
    stubApi();

    await renderAdminDirectory("es");

    const item = screen.getByRole("listitem", { name: /Nerea Ruiz/ });
    expect(within(item).getByText(/Nerea Ruiz pidió ser Coach/)).toBeVisible();
    expect(within(item).getByText(/17 de septiembre de 2026/)).toBeVisible();
  });

  it("traduce al español el aviso de un error del servidor", async () => {
    const user = userEvent.setup();
    stubApi({ decision: async () => errorResponse(409, "conflict") });
    await renderAdminDirectory("es");

    await user.click(
      screen.getByRole("button", {
        name: "Aprobar la solicitud de Nerea Ruiz",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Otro Admin ya respondió esta solicitud.",
    );
  });

  it("traduce al español que la bandeja no cargó", async () => {
    stubApi({ loadRequests: async () => errorResponse(500, "internal_error") });

    render(<DirectoryScreen locale="es" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos cargar las solicitudes pendientes.",
    );
  });
});
// #548: la línea de estado de las solicitudes, en la cabecera del directorio.
describe("directorio para Admin: solicitudes en la cabecera", () => {
  const SECOND_REQUEST: PendingRoleRequest = {
    ...COACH_REQUEST,
    id: "1f1e1d1c-1b1a-4918-8716-151413121110",
    userId: ADMIN_ID,
    fullName: "Ana Admin",
    requestedRole: "Committee",
  };

  it("dice que no hay solicitudes pendientes cuando no hay ninguna", async () => {
    stubApi({ requests: [] });

    await renderAdminDirectory();

    expect(screen.getByText("No pending requests")).toBeVisible();
    expect(screen.queryByRole("link", { name: /waiting/ })).toBeNull();
  });

  it("con una, lleva a la bandeja con la frase en singular", async () => {
    stubApi({ requests: [COACH_REQUEST] });

    await renderAdminDirectory();

    expect(
      screen.getByRole("link", { name: "1 role request waiting" }),
    ).toHaveAttribute("href", "#solicitudes-pendientes");
    expect(screen.queryByText("No pending requests")).toBeNull();
  });

  it("con dos, lo dice en plural", async () => {
    stubApi({ requests: [COACH_REQUEST, SECOND_REQUEST] });

    await renderAdminDirectory();

    expect(
      screen.getByRole("link", { name: "2 role requests waiting" }),
    ).toBeVisible();
  });

  it("al aprobar la última, pasa a no tener ninguna pendiente", async () => {
    stubApi({ requests: [COACH_REQUEST] });
    await renderAdminDirectory();

    await userEvent.setup().click(approveButton());

    expect(await screen.findByText("No pending requests")).toBeVisible();
    expect(screen.queryByRole("link", { name: /waiting/ })).toBeNull();
  });

  it.each([
    [[], "No hay solicitudes pendientes"],
    [[COACH_REQUEST], "1 solicitud de rol esperando"],
    [[COACH_REQUEST, SECOND_REQUEST], "2 solicitudes de rol esperando"],
  ] as const)("lo dice en español (%#)", async (requests, expected) => {
    stubApi({ requests });

    await renderAdminDirectory("es");

    expect(screen.getByText(expected)).toBeVisible();
  });

  it("a quien no es Admin no le dice nada de solicitudes", async () => {
    stubApi({ kind: "member", members: [NEREA] });

    render(<DirectoryScreen locale="en" />);
    await screen.findByRole("region", { name: "Club members" });

    expect(screen.queryByText("No pending requests")).toBeNull();
    expect(screen.queryByRole("link", { name: /waiting/ })).toBeNull();
  });
});
