import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type {
  AdminDirectoryMember,
  DirectoryListing,
} from "@/lib/directory/directory";
import { GOALKEEPER, asDirectoryPosition } from "../helpers/seeded-positions";

/**
 * El directorio en el móvil (#553, RF-7 del PRD de E21): la cabecera con
 * "⋯", la hoja que ordena, la hoja del "⋯" con el correo y el CSV, y el
 * aviso de solicitudes que abre su propia pantalla.
 *
 * Qué se ve en cada ancho lo decide la hoja de estilos, que jsdom no aplica:
 * aquí los controles del móvil conviven con los de escritorio, y lo que se
 * prueba es lo que hacen y a quién se le ofrecen. Cómo se ven a 375 px lo
 * prueba Playwright.
 */

const NEREA_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const REQUEST_ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const SECOND_REQUEST_ID = "1f0e0d0c-0b0a-4908-8706-050403020101";

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
  aufNumber: "AUF-7",
  aufExpiry: "2020-01-31",
  isAufVerified: true,
  isAufExpired: true,
  isAufExpiring: false,
  isEvaluated: true,
  membershipStatus: "active",
  email: "nerea@club.test",
  phone: null,
  emergencyContact: null,
};

const COACH_REQUEST: PendingRoleRequest = {
  id: REQUEST_ID,
  userId: NEREA_ID,
  fullName: "Nerea Ruiz",
  currentRole: "Player",
  requestedRole: "Coach",
  justification: "Entreno a los juveniles los jueves.",
  // 18:30 en Melbourne.
  createdAt: "2026-09-17T08:30:00.000Z",
};

const COMMITTEE_REQUEST: PendingRoleRequest = {
  id: SECOND_REQUEST_ID,
  userId: "c2c2c2c2-0000-4000-8000-00000000000c",
  fullName: "Tomás Errekondo",
  currentRole: "Coach",
  requestedRole: "Committee",
  justification: null,
  createdAt: "2026-09-18T02:00:00.000Z",
};

const DIRECTORY_PATH = "/api/v1/directory";
const EXPORT_PATH = "/api/v1/directory/export";
const PENDING_REQUESTS_PATH = "/api/v1/role-requests?status=pending";

type Kind = DirectoryListing["kind"];

type ApiStub = {
  readonly kind?: Kind;
  readonly requests?: readonly PendingRoleRequest[];
  /** Lo que contesta el servidor al decidir; por defecto, que sí. */
  readonly decision?: () => Promise<Response>;
};

type ApiCall = { readonly url: string; readonly method: string };

const calls: ApiCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function decidedResponse(): Response {
  return jsonResponse(200, {
    data: {
      id: REQUEST_ID,
      status: "approved",
      decidedBy: "a0a0a0a0-0000-4000-8000-00000000000a",
      decidedAt: "2026-09-18T01:00:00.000Z",
    },
  });
}

function csvResponse(): Response {
  return new Response("﻿Nombre\r\nNerea Ruiz\r\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="directorio.csv"',
    },
  });
}

function readResponse(stub: ApiStub, url: string): Response {
  if (url.startsWith(EXPORT_PATH)) {
    return csvResponse();
  }
  if (url.startsWith(DIRECTORY_PATH)) {
    return jsonResponse(200, {
      data: {
        kind: stub.kind ?? "admin",
        members: [NEREA],
        availableFilters: ["position"],
        total: 1,
      },
    });
  }
  if (url === PENDING_REQUESTS_PATH) {
    return jsonResponse(200, {
      data: { requests: stub.requests ?? [COACH_REQUEST] },
    });
  }
  if (url === "/api/v1/club/positions") {
    return jsonResponse(200, { data: { positions: [] } });
  }
  throw new Error(`Petición inesperada: ${url}`);
}

function stubApi(stub: ApiStub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (method === "POST") {
        return stub.decision?.() ?? decidedResponse();
      }
      return readResponse(stub, url);
    }),
  );
}

function directoryRequests(): readonly URLSearchParams[] {
  return calls
    .filter(
      ({ url }) =>
        url.startsWith(DIRECTORY_PATH) && !url.startsWith(EXPORT_PATH),
    )
    .map(({ url }) => new URL(url, "http://localhost").searchParams);
}

function lastDirectoryRequest(): URLSearchParams | undefined {
  return directoryRequests().at(-1);
}

async function renderDirectory(locale: "en" | "es" = "en"): Promise<void> {
  render(<DirectoryScreen locale={locale} />);
  await screen.findByRole("region", {
    name: locale === "en" ? "Club members" : "Miembros del club",
  });
}

/** Espera además a la bandeja, que llega después de la lista. */
async function renderAdminDirectory(): Promise<void> {
  await renderDirectory();
  await waitFor(() =>
    expect(screen.queryByText("Loading the pending requests…")).toBeNull(),
  );
}

function moreButton(): HTMLElement {
  return screen.getByRole("button", { name: "More actions" });
}

function sortButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Sort:/ });
}

function requestsBanner(): HTMLElement {
  return screen.getByRole("button", { name: /role requests? waiting/ });
}

async function openRequestsScreen(): Promise<HTMLElement> {
  await userEvent.setup().click(requestsBanner());
  return screen.getByRole("region", { name: "Role requests" });
}

beforeEach(() => {
  calls.length = 0;
  window.history.replaceState(null, "", "/directorio");
  // jsdom no implementa las direcciones de un Blob.
  URL.createObjectURL = vi.fn(() => "blob:http://localhost/csv");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la cabecera del móvil", () => {
  it.each(["admin", "committee"] as const)(
    "ofrece el menú ⋯ a quien recibe la lista de %s",
    async (kind) => {
      stubApi({ kind, requests: [] });

      await renderDirectory();

      expect(moreButton()).toHaveAttribute("aria-haspopup", "dialog");
    },
  );

  it.each(["coach", "member"] as const)(
    "no ofrece el menú ⋯ a quien recibe la lista de %s: no escribe ni exporta",
    async (kind) => {
      stubApi({ kind });

      await renderDirectory();

      expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    },
  );
});

describe("la hoja del orden", () => {
  it("dice por qué campo y en qué sentido está ordenada la lista", async () => {
    stubApi({ requests: [] });

    await renderDirectory();

    expect(sortButton()).toHaveAccessibleName("Sort: Name, ascending");
    expect(sortButton()).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("ofrece nombre, rol, posición y asistencia, con la activa marcada y su sentido", async () => {
    stubApi({ requests: [] });
    await renderDirectory();

    await userEvent.setup().click(sortButton());

    const sheet = screen.getByRole("dialog", { name: "Sort by" });
    const options = within(sheet).getAllByRole("button", { pressed: false });
    expect(options.map((option) => option.textContent)).toEqual([
      "Role",
      "Position",
      "Attendance",
    ]);
    expect(
      within(sheet).getByRole("button", { pressed: true }),
    ).toHaveAccessibleName("Name, ascending");
  });

  it("pide al servidor el campo que se elige, con su primer sentido, y se cierra", async () => {
    stubApi({ requests: [] });
    await renderDirectory();
    const user = userEvent.setup();
    await user.click(sortButton());

    await user.click(
      within(screen.getByRole("dialog", { name: "Sort by" })).getByRole(
        "button",
        { name: "Attendance" },
      ),
    );

    await waitFor(() => {
      expect(lastDirectoryRequest()?.get("sort")).toBe("attendance");
    });
    expect(lastDirectoryRequest()?.get("direction")).toBe("desc");
    expect(screen.queryByRole("dialog", { name: "Sort by" })).toBeNull();
    expect(sortButton()).toHaveAccessibleName("Sort: Attendance, descending");
    expect(sortButton()).toHaveFocus();
  });

  it("invierte el orden al tocar otra vez la opción activa", async () => {
    stubApi({ requests: [] });
    await renderDirectory();
    const user = userEvent.setup();
    await user.click(sortButton());

    await user.click(
      within(screen.getByRole("dialog", { name: "Sort by" })).getByRole(
        "button",
        { pressed: true },
      ),
    );

    await waitFor(() => {
      expect(lastDirectoryRequest()?.get("direction")).toBe("desc");
    });
    expect(lastDirectoryRequest()?.get("sort")).toBe("name");
    expect(sortButton()).toHaveAccessibleName("Sort: Name, descending");
  });

  it("se cierra con Escape y devuelve el foco al botón que la abrió", async () => {
    stubApi({ requests: [] });
    await renderDirectory();
    const user = userEvent.setup();
    await user.click(sortButton());

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Sort by" })).toBeNull();
    expect(sortButton()).toHaveFocus();
  });

  it("se cierra al tocar fuera y devuelve el foco al botón", async () => {
    stubApi({ requests: [] });
    await renderDirectory();
    const user = userEvent.setup();
    await user.click(sortButton());

    await user.click(document.body);

    expect(screen.queryByRole("dialog", { name: "Sort by" })).toBeNull();
    expect(sortButton()).toHaveFocus();
  });

  it("se escribe en español", async () => {
    stubApi({ requests: [] });
    await renderDirectory("es");

    expect(
      screen.getByRole("button", { name: /^Orden:/ }),
    ).toHaveAccessibleName("Orden: Nombre, ascendente");
  });
});

describe("la hoja del ⋯", () => {
  it("dice cuántos miembros tiene la vista y ofrece el correo y el CSV a un Admin", async () => {
    stubApi({ requests: [] });
    await renderDirectory();

    await userEvent.setup().click(moreButton());

    const sheet = screen.getByRole("dialog", { name: "1 member in this view" });
    expect(
      within(sheet).getByRole("button", { name: /^Email these members/ }),
    ).toHaveAccessibleDescription("Each one gets their own copy · 50/day");
    expect(
      within(sheet).getByRole("button", { name: /^Export CSV/ }),
    ).toHaveAccessibleDescription("Only the columns your role can see");
    expect(within(sheet).getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("abre el correo a los miembros de la vista y cierra la hoja", async () => {
    stubApi({ kind: "committee" });
    await renderDirectory();
    const user = userEvent.setup();
    await user.click(moreButton());

    await user.click(
      screen.getByRole("button", { name: /^Email these members/ }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Email members" }),
    ).toHaveFocus();
  });

  it("descarga la lista que se ve y cierra la hoja", async () => {
    stubApi({ requests: [] });
    await renderDirectory();
    const user = userEvent.setup();
    await user.click(moreButton());

    // jsdom no deja inerte lo de detrás del `<dialog>`: el botón de CSV de
    // la cabecera de escritorio también está ahí.
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Export CSV/,
      }),
    );

    await waitFor(() => {
      expect(calls.some(({ url }) => url.startsWith(EXPORT_PATH))).toBe(true);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancelar la cierra y devuelve el foco al ⋯", async () => {
    stubApi({ requests: [] });
    await renderDirectory();
    const user = userEvent.setup();
    await user.click(moreButton());

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(moreButton()).toHaveFocus();
  });

  it("se cierra con Escape y devuelve el foco al ⋯", async () => {
    stubApi({ requests: [] });
    await renderDirectory();
    const user = userEvent.setup();
    await user.click(moreButton());

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(moreButton()).toHaveFocus();
  });

  it("se escribe en español", async () => {
    stubApi({ requests: [] });
    await renderDirectory("es");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Más acciones" }));

    const sheet = screen.getByRole("dialog", {
      name: "1 miembro en esta vista",
    });
    expect(
      within(sheet).getByRole("button", { name: /^Escribir a estos miembros/ }),
    ).toHaveAccessibleDescription("Cada uno recibe su copia · 50 al día");
    expect(
      within(sheet).getByRole("button", { name: /^Exportar CSV/ }),
    ).toHaveAccessibleDescription("Solo las columnas que tu rol puede ver");
  });
});

describe("el aviso de solicitudes", () => {
  it("le dice a un Admin cuántas solicitudes esperan y lleva a revisarlas", async () => {
    stubApi({ requests: [COACH_REQUEST, COMMITTEE_REQUEST] });

    await renderAdminDirectory();

    expect(requestsBanner()).toHaveAccessibleName(
      "2 role requests waiting · Review",
    );
  });

  it("habla en singular de una sola solicitud", async () => {
    stubApi();

    await renderAdminDirectory();

    expect(requestsBanner()).toHaveAccessibleName(
      "1 role request waiting · Review",
    );
  });

  it("no sale sin solicitudes pendientes", async () => {
    stubApi({ requests: [] });

    await renderAdminDirectory();

    expect(
      screen.queryByRole("button", { name: /role requests? waiting/ }),
    ).toBeNull();
  });

  it.each(["committee", "coach", "member"] as const)(
    "no le sale a quien recibe la lista de %s, ni pide la bandeja (D4)",
    async (kind) => {
      stubApi({ kind });

      await renderDirectory();

      expect(
        screen.queryByRole("button", { name: /role requests? waiting/ }),
      ).toBeNull();
      expect(calls.some(({ url }) => url === PENDING_REQUESTS_PATH)).toBe(
        false,
      );
    },
  );
});

describe("la pantalla de solicitudes", () => {
  it("enseña una tarjeta por solicitud con el nombre, la fecha, el cambio y el motivo", async () => {
    stubApi();
    await renderAdminDirectory();

    const requestsScreen = await openRequestsScreen();

    const card = within(requestsScreen).getByRole("listitem", {
      name: "Nerea Ruiz",
    });
    expect(within(card).getByText("17 September 2026")).toBeVisible();
    expect(within(card).getByText("From Player to Coach")).toBeInTheDocument();
    expect(within(card).getByText("Reason")).toBeVisible();
    expect(
      within(card).getByText("Entreno a los juveniles los jueves."),
    ).toBeVisible();
    expect(
      within(card).getByRole("button", {
        name: "Reject the request from Nerea Ruiz",
      }),
    ).toBeEnabled();
  });

  it("tapa la lista mientras está abierta y pone el foco en su título", async () => {
    stubApi();
    await renderAdminDirectory();

    await openRequestsScreen();

    expect(screen.queryByRole("region", { name: "Club members" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Role requests" }),
    ).toHaveFocus();
  });

  it("aprueba una solicitud, la quita y lo cuenta", async () => {
    stubApi();
    await renderAdminDirectory();
    const requestsScreen = await openRequestsScreen();

    await userEvent.setup().click(
      within(requestsScreen).getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    );

    expect(
      await within(requestsScreen).findByText("Nerea Ruiz is now Coach."),
    ).toBeVisible();
    expect(
      within(requestsScreen).queryByRole("listitem", { name: "Nerea Ruiz" }),
    ).toBeNull();
    const decisions = calls.filter(({ method }) => method === "POST");
    expect(decisions).toEqual([
      {
        url: `/api/v1/role-requests/${REQUEST_ID}/decision`,
        method: "POST",
      },
    ]);
  });

  it("rechaza una solicitud y lo cuenta", async () => {
    stubApi();
    await renderAdminDirectory();
    const requestsScreen = await openRequestsScreen();

    await userEvent.setup().click(
      within(requestsScreen).getByRole("button", {
        name: "Reject the request from Nerea Ruiz",
      }),
    );

    expect(
      await within(requestsScreen).findByText(
        "The request from Nerea Ruiz was rejected.",
      ),
    ).toBeVisible();
  });

  it("no manda dos decisiones con un doble toque", async () => {
    let answer: (response: Response) => void = () => {};
    stubApi({
      decision: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await renderAdminDirectory();
    const requestsScreen = await openRequestsScreen();
    const approve = within(requestsScreen).getByRole("button", {
      name: "Approve the request from Nerea Ruiz",
    });

    await userEvent.setup().dblClick(approve);
    answer(decidedResponse());

    await within(requestsScreen).findByText("Nerea Ruiz is now Coach.");
    expect(calls.filter(({ method }) => method === "POST")).toHaveLength(1);
  });

  it("dice que está todo al día cuando no queda ninguna", async () => {
    stubApi();
    await renderAdminDirectory();
    const requestsScreen = await openRequestsScreen();

    await userEvent.setup().click(
      within(requestsScreen).getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    );

    expect(
      await within(requestsScreen).findByText("All caught up"),
    ).toBeVisible();
    expect(
      within(requestsScreen).getByText(
        "No requests are waiting for an answer.",
      ),
    ).toBeVisible();
  });

  it("vuelve a la lista con la flecha y deja el foco en el aviso", async () => {
    stubApi({ requests: [COACH_REQUEST, COMMITTEE_REQUEST] });
    await renderAdminDirectory();
    await openRequestsScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Back to the directory" }));

    expect(screen.queryByRole("region", { name: "Role requests" })).toBeNull();
    expect(screen.getByRole("region", { name: "Club members" })).toBeVisible();
    expect(requestsBanner()).toHaveFocus();
  });

  it("al volver sin solicitudes, el rol aprobado ya está en la fila", async () => {
    stubApi();
    await renderAdminDirectory();
    const requestsScreen = await openRequestsScreen();
    const user = userEvent.setup();
    await user.click(
      within(requestsScreen).getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    );
    await within(requestsScreen).findByText("Nerea Ruiz is now Coach.");

    await user.click(
      screen.getByRole("button", { name: "Back to the directory" }),
    );

    expect(
      within(screen.getByRole("row", { name: "Nerea Ruiz" })).getByRole(
        "cell",
        { name: "Coach" },
      ),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Directory" })).toHaveFocus();
  });

  it("se escribe en español", async () => {
    stubApi();
    await renderDirectory("es");
    await waitFor(() =>
      expect(
        screen.queryByText("Cargando las solicitudes pendientes…"),
      ).toBeNull(),
    );

    await userEvent.setup().click(
      screen.getByRole("button", {
        name: "1 solicitud de rol esperando · Revisar",
      }),
    );

    const requestsScreen = screen.getByRole("region", {
      name: "Solicitudes de rol",
    });
    expect(within(requestsScreen).getByText("Motivo")).toBeVisible();
    expect(
      within(requestsScreen).getByText("De Jugador a Coach"),
    ).toBeInTheDocument();
    expect(
      within(requestsScreen).getByRole("button", {
        name: "Volver al directorio",
      }),
    ).toBeVisible();
  });
});
