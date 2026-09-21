import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdministrationScreen } from "@/components/administration/AdministrationScreen";
import type {
  ClubMember,
  PendingRoleRequest,
} from "@/lib/auth/club-administration";

/**
 * La pantalla de administración (#212, RF-8 del PRD de E3): la bandeja de
 * solicitudes pendientes y la lista de socios con su rol. Las escrituras ya
 * existían (#210 y #211); lo que se prueba aquí es que la pantalla refleja su
 * resultado sin recargar y que no da por hecho ningún cambio que el servidor
 * no confirmó.
 */

const NEREA_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const REQUEST_ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

const NEREA: ClubMember = {
  userId: NEREA_ID,
  fullName: "Nerea Ruiz",
  email: "nerea@example.test",
  role: "Player",
};

const ANA: ClubMember = {
  userId: ADMIN_ID,
  fullName: "Ana Admin",
  email: "ana@example.test",
  role: "Admin",
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

type ApiCall = {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
};

type Respond = () => Promise<Response>;

type ApiStub = {
  readonly members?: readonly ClubMember[];
  readonly requests?: readonly PendingRoleRequest[];
  readonly decision?: Respond;
  readonly roleChange?: Respond;
  readonly load?: Respond;
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

function stubApi(stub: ApiStub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body =
        init?.body === undefined ? null : JSON.parse(String(init.body));
      calls.push({ url, method, body });
      if (method === "GET" && stub.load !== undefined) {
        return stub.load();
      }
      if (method === "GET") {
        return url.startsWith("/api/v1/members")
          ? jsonResponse(200, { data: { members: stub.members ?? [NEREA] } })
          : jsonResponse(200, {
              data: { requests: stub.requests ?? [COACH_REQUEST] },
            });
      }
      if (method === "POST") {
        return (
          stub.decision?.() ??
          jsonResponse(200, {
            data: {
              id: REQUEST_ID,
              status: "approved",
              decidedBy: ADMIN_ID,
              decidedAt: "2026-09-18T01:00:00.000Z",
            },
          })
        );
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

/** Espera a que las dos lecturas hayan pintado la pantalla. */
async function renderScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(<AdministrationScreen locale={locale} />);
  await screen.findByRole("heading", {
    name: locale === "en" ? "Club members" : "Miembros del club",
  });
}

function trayItem(): HTMLElement {
  return screen.getByRole("listitem", { name: /Nerea Ruiz/ });
}

function memberRole(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Role for Nerea Ruiz" });
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bandeja de solicitudes", () => {
  it("lista cada solicitud con el socio, el rol pedido, la fecha y la justificación", async () => {
    stubApi();

    await renderScreen();

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

  it("dice con una frase que no hay ninguna, en vez de una tabla vacía", async () => {
    stubApi({ requests: [] });

    await renderScreen();

    expect(
      screen.getByText("No requests are waiting for an answer."),
    ).toBeVisible();
    expect(screen.queryByRole("listitem", { name: /Nerea Ruiz/ })).toBeNull();
  });

  it("al aprobar, la solicitud sale de la bandeja y el socio cambia de rol", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderScreen();

    await user.click(
      screen.getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("No requests are waiting for an answer."),
      ).toBeVisible(),
    );
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
          data: {
            id: REQUEST_ID,
            status: "rejected",
            decidedBy: ADMIN_ID,
            decidedAt: "2026-09-18T01:00:00.000Z",
          },
        }),
    });
    await renderScreen();

    await user.click(
      screen.getByRole("button", {
        name: "Reject the request from Nerea Ruiz",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("No requests are waiting for an answer."),
      ).toBeVisible(),
    );
    expect(memberRole()).toHaveValue("Player");
    expect(calls.at(-1)?.body).toEqual({ decision: "rejected" });
  });

  it("una solicitud que otro Admin ya resolvió lo dice y sale de la bandeja", async () => {
    const user = userEvent.setup();
    stubApi({ decision: async () => errorResponse(409, "conflict") });
    await renderScreen();

    await user.click(
      screen.getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    );

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
    await renderScreen();

    await user.click(
      screen.getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server",
    );
    expect(trayItem()).toBeVisible();

    stubApi();
    await user.click(
      screen.getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("No requests are waiting for an answer."),
      ).toBeVisible(),
    );
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
    await renderScreen();

    await user.click(
      screen.getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    );

    expect(
      screen.getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Reject the request from Nerea Ruiz",
      }),
    ).toBeDisabled();
    await act(async () => {
      answer(
        jsonResponse(200, {
          data: {
            id: REQUEST_ID,
            status: "approved",
            decidedBy: ADMIN_ID,
            decidedAt: "2026-09-18T01:00:00.000Z",
          },
        }),
      );
    });
  });

  it("un doble clic manda una sola decisión", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderScreen();

    await user.dblClick(
      screen.getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("No requests are waiting for an answer."),
      ).toBeVisible(),
    );
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });
});

describe("lista de socios", () => {
  it("muestra el nombre, el correo y el rol de cada socio", async () => {
    stubApi({ members: [NEREA, ANA], requests: [] });

    await renderScreen();

    expect(screen.getByText("Nerea Ruiz")).toBeVisible();
    expect(screen.getByText("nerea@example.test")).toBeVisible();
    expect(memberRole()).toHaveValue("Player");
    expect(
      screen.getByRole("combobox", { name: "Role for Ana Admin" }),
    ).toHaveValue("Admin");
  });

  it("al confirmar otro rol, la lista muestra el rol nuevo", async () => {
    const user = userEvent.setup();
    stubApi({ requests: [] });
    await renderScreen();

    await user.selectOptions(memberRole(), "Committee");
    await user.click(
      screen.getByRole("button", { name: "Save the role for Nerea Ruiz" }),
    );

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
    await renderScreen();
    const role = screen.getByRole("combobox", { name: "Role for Ana Admin" });

    await user.selectOptions(role, "Player");
    await user.click(
      screen.getByRole("button", { name: "Save the role for Ana Admin" }),
    );

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
    await renderScreen();

    await user.selectOptions(memberRole(), "Coach");
    await user.click(
      screen.getByRole("button", { name: "Save the role for Nerea Ruiz" }),
    );

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
    await user.click(
      screen.getByRole("button", { name: "Save the role for Nerea Ruiz" }),
    );
    await waitFor(() => expect(memberRole()).toHaveValue("Coach"));
  });

  it("desactiva el botón del socio mientras el cambio está en curso", async () => {
    const user = userEvent.setup();
    let answer: (response: Response) => void = () => undefined;
    stubApi({
      requests: [],
      roleChange: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await renderScreen();

    await user.selectOptions(memberRole(), "Coach");
    await user.click(
      screen.getByRole("button", { name: "Save the role for Nerea Ruiz" }),
    );

    expect(
      screen.getByRole("button", { name: "Save the role for Nerea Ruiz" }),
    ).toBeDisabled();
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
    await renderScreen();

    await user.selectOptions(memberRole(), "Committee");
    await user.dblClick(
      screen.getByRole("button", { name: "Save the role for Nerea Ruiz" }),
    );

    await waitFor(() => expect(memberRole()).toHaveValue("Committee"));
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  });

  it("con un socio que ya no está en el club lo dice del socio, no de una solicitud", async () => {
    const user = userEvent.setup();
    stubApi({
      requests: [],
      roleChange: async () => errorResponse(404, "not_found"),
    });
    await renderScreen();

    await user.selectOptions(memberRole(), "Coach");
    await user.click(
      screen.getByRole("button", { name: "Save the role for Nerea Ruiz" }),
    );

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
    await renderScreen();

    await user.selectOptions(memberRole(), "Coach");
    await user.click(
      screen.getByRole("button", { name: "Save the role for Nerea Ruiz" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't finish that. Try again in a moment.",
    );
    expect(memberRole()).toHaveValue("Player");
  });

  it("desactiva el botón de los demás socios mientras un cambio está en curso", async () => {
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
    await renderScreen();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Role for Ana Admin" }),
      "Committee",
    );

    await user.selectOptions(memberRole(), "Coach");
    await user.click(
      screen.getByRole("button", { name: "Save the role for Nerea Ruiz" }),
    );

    expect(
      screen.getByRole("button", { name: "Save the role for Ana Admin" }),
    ).toBeDisabled();
    await act(async () => {
      answer(
        jsonResponse(200, {
          data: { userId: NEREA_ID, previousRole: "Player", role: "Coach" },
        }),
      );
    });
  });
});

describe("carga de la pantalla", () => {
  it("si una lectura falla, lo dice y deja volver a intentar", async () => {
    const user = userEvent.setup();
    stubApi({ load: async () => errorResponse(500, "internal_error") });
    render(<AdministrationScreen locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the club's requests and members.",
    );

    stubApi();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", { name: "Club members" }),
    ).toBeVisible();
  });

  it("pide las dos lecturas a la API v1, no a la base", async () => {
    stubApi();

    await renderScreen();

    expect(calls.map((call) => call.url).sort()).toEqual([
      "/api/v1/members",
      "/api/v1/role-requests?status=pending",
    ]);
  });
});

describe("la pantalla en español", () => {
  it("escribe títulos, roles, fechas y estados vacíos en español", async () => {
    stubApi({ requests: [] });

    await renderScreen("es");

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

    await renderScreen("es");

    const item = screen.getByRole("listitem", { name: /Nerea Ruiz/ });
    expect(within(item).getByText(/Nerea Ruiz pidió ser Coach/)).toBeVisible();
    expect(within(item).getByText(/17 de septiembre de 2026/)).toBeVisible();
  });

  it("traduce al español el aviso de un error del servidor", async () => {
    const user = userEvent.setup();
    stubApi({ decision: async () => errorResponse(409, "conflict") });
    await renderScreen("es");

    await user.click(
      screen.getByRole("button", {
        name: "Aprobar la solicitud de Nerea Ruiz",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Otro Admin ya respondió esta solicitud.",
    );
  });
});
