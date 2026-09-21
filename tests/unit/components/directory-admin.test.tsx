import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type {
  AdminDirectoryMember,
  DirectoryMember,
} from "@/lib/directory/directory";

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
  position: "Goalkeeper",
  status: "active",
  aufNumber: null,
  aufExpiry: null,
  isAufExpired: false,
};

const ANA: AdminDirectoryMember = {
  userId: ADMIN_ID,
  fullName: "Ana Admin",
  country: "AU",
  experienceLevel: "Advanced",
  role: "Admin",
  position: "Defender",
  status: "active",
  aufNumber: "AUF-1",
  aufExpiry: "2030-06-30",
  isAufExpired: false,
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
        data: { kind: stub.kind ?? "admin", members: stub.members ?? [NEREA] },
      }),
    );
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

function memberRole(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Role for Nerea Ruiz" });
}

function approveButton(): HTMLElement {
  return screen.getByRole("button", {
    name: "Approve the request from Nerea Ruiz",
  });
}

function saveButton(name = "Nerea Ruiz"): HTMLElement {
  return screen.getByRole("button", { name: `Save the role for ${name}` });
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
    expect(memberRole()).toHaveValue("Coach");
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
    expect(memberRole()).toHaveValue("Player");
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
    expect(memberRole()).toHaveValue("Player");
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
    expect(memberRole()).toHaveValue("Player");

    stubApi();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("listitem", { name: /Nerea Ruiz/ })).toBe(
      trayItem(),
    );
  });
});

describe("directorio para Admin: cambio de rol", () => {
  it("pone en la fila de cada miembro un control con su rol", async () => {
    stubApi({ members: [NEREA, ANA], requests: [] });

    await renderAdminDirectory();

    expect(
      within(screen.getByRole("row", { name: "Nerea Ruiz" })).getByRole(
        "combobox",
        { name: "Role for Nerea Ruiz" },
      ),
    ).toHaveValue("Player");
    expect(
      screen.getByRole("combobox", { name: "Role for Ana Admin" }),
    ).toHaveValue("Admin");
  });

  it("al confirmar otro rol, la lista muestra el rol nuevo", async () => {
    const user = userEvent.setup();
    stubApi({ requests: [] });
    await renderAdminDirectory();

    await user.selectOptions(memberRole(), "Committee");
    await user.click(saveButton());

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Nerea Ruiz is now Committee.",
      ),
    );
    expect(memberRole()).toHaveValue("Committee");
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([
      {
        url: `/api/v1/members/${NEREA_ID}/role`,
        method: "PATCH",
        body: { role: "Committee" },
      },
    ]);
  });

  it("con el último Admin explica por qué no se puede y deja el rol igual", async () => {
    const user = userEvent.setup();
    stubApi({
      members: [ANA],
      requests: [],
      roleChange: async () => errorResponse(422, "business_rule", "last_admin"),
    });
    await renderAdminDirectory();
    const role = screen.getByRole("combobox", { name: "Role for Ana Admin" });

    await user.selectOptions(role, "Player");
    await user.click(saveButton("Ana Admin"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This is the club's last Admin.",
    );
    expect(role).toHaveValue("Admin");
  });

  it("con un error de red muestra el aviso y deja volver a intentar", async () => {
    const user = userEvent.setup();
    stubApi({
      requests: [],
      roleChange: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await renderAdminDirectory();

    await user.selectOptions(memberRole(), "Coach");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server",
    );

    stubApi({
      requests: [],
      roleChange: async () =>
        jsonResponse(200, {
          data: { userId: NEREA_ID, previousRole: "Player", role: "Coach" },
        }),
    });
    await user.click(saveButton());
    await waitFor(() => expect(memberRole()).toHaveValue("Coach"));
  });

  it("desactiva el botón del miembro mientras el cambio está en curso", async () => {
    const user = userEvent.setup();
    let answer: (response: Response) => void = () => undefined;
    stubApi({
      requests: [],
      roleChange: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await renderAdminDirectory();

    await user.selectOptions(memberRole(), "Coach");
    await user.click(saveButton());

    expect(saveButton()).toBeDisabled();
    await act(async () => {
      answer(
        jsonResponse(200, {
          data: { userId: NEREA_ID, previousRole: "Player", role: "Coach" },
        }),
      );
    });
  });

  it("un doble clic manda un solo cambio", async () => {
    const user = userEvent.setup();
    stubApi({ requests: [] });
    await renderAdminDirectory();

    await user.selectOptions(memberRole(), "Committee");
    await user.dblClick(saveButton());

    await waitFor(() => expect(memberRole()).toHaveValue("Committee"));
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  });

  it("con un miembro que ya no está en el club lo dice del miembro, no de una solicitud", async () => {
    const user = userEvent.setup();
    stubApi({
      requests: [],
      roleChange: async () => errorResponse(404, "not_found"),
    });
    await renderAdminDirectory();

    await user.selectOptions(memberRole(), "Coach");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That member is no longer in the club.",
    );
  });

  it("con una regla de negocio que no conoce da el aviso genérico", async () => {
    const user = userEvent.setup();
    stubApi({
      requests: [],
      roleChange: async () =>
        errorResponse(422, "business_rule", "regla_desconocida"),
    });
    await renderAdminDirectory();

    await user.selectOptions(memberRole(), "Coach");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't finish that. Try again in a moment.",
    );
    expect(memberRole()).toHaveValue("Player");
  });

  it("desactiva el botón de los demás miembros mientras un cambio está en curso", async () => {
    const user = userEvent.setup();
    let answer: (response: Response) => void = () => undefined;
    stubApi({
      members: [NEREA, ANA],
      requests: [],
      roleChange: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await renderAdminDirectory();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Role for Ana Admin" }),
      "Committee",
    );

    await user.selectOptions(memberRole(), "Coach");
    await user.click(saveButton());

    expect(saveButton("Ana Admin")).toBeDisabled();
    await act(async () => {
      answer(
        jsonResponse(200, {
          data: { userId: NEREA_ID, previousRole: "Player", role: "Coach" },
        }),
      );
    });
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
  isAufExpired: true,
};

function memberRow(name: string): HTMLElement {
  return screen.getByRole("row", { name });
}

describe("directorio para Admin: ficha reservada (#242)", () => {
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

  it("enseña el número de AUF y su vencimiento", async () => {
    stubApi({ members: [ANA], requests: [] });

    await renderAdminDirectory();

    expect(
      within(memberRow("Ana Admin")).getByText(
        "AUF AUF-1 · expires 30 June 2030",
      ),
    ).toBeVisible();
  });

  it("dice que no tiene AUF quien no lo tiene", async () => {
    stubApi({ members: [NEREA], requests: [] });

    await renderAdminDirectory();

    expect(within(memberRow("Nerea Ruiz")).getByText("No AUF")).toBeVisible();
  });

  it("dice que un AUF no tiene vencimiento cuando no lo tiene", async () => {
    stubApi({ members: [{ ...ANA, aufExpiry: null }], requests: [] });

    await renderAdminDirectory();

    expect(
      within(memberRow("Ana Admin")).getByText("AUF AUF-1 · no expiry date"),
    ).toBeVisible();
  });

  it("marca el vencimiento pasado junto al número", async () => {
    stubApi({ members: [VENCIDA], requests: [] });

    await renderAdminDirectory();

    const row = memberRow("Vera Vencida");
    expect(
      within(row).getByText("AUF AUF-7 · expires 31 January 2020"),
    ).toBeVisible();
    expect(within(row).getByText("AUF expired")).toBeVisible();
  });

  it("escribe el enlace y el AUF en español", async () => {
    stubApi({ members: [ANA], requests: [] });

    await renderAdminDirectory("es");

    expect(
      screen.getByRole("link", { name: "Abrir la ficha de Ana Admin" }),
    ).toBeVisible();
    expect(
      within(memberRow("Ana Admin")).getByText(
        "AUF AUF-1 · vence el 30 de junio de 2030",
      ),
    ).toBeVisible();
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
      expect(screen.queryByRole("combobox")).toBeNull();
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
    expect(
      screen.getByRole("combobox", { name: "Rol de Nerea Ruiz" }),
    ).toHaveValue("Player");
    expect(
      within(
        screen.getByRole("combobox", { name: "Rol de Nerea Ruiz" }),
      ).getByRole("option", { name: "Jugador" }),
    ).toBeInTheDocument();
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
