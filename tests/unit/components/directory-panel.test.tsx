import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type {
  AdminDirectoryMember,
  DirectoryListing,
} from "@/lib/directory/directory";
import { formatCalendarDay } from "@/lib/i18n/format";
import { GOALKEEPER, asDirectoryPosition } from "../helpers/seeded-positions";

/**
 * El panel lateral del directorio con la ficha rápida del socio (#550, RF-5
 * del PRD de E21): seleccionar una fila la abre, y el Admin cambia el rol
 * ahí, con una franja que confirma antes de guardar.
 *
 * Lo que se prueba es lo que ve y hace cada rol: la ficha según FR-090 y D4,
 * que nada se guarda sin confirmar, que la fila sólo cambia cuando el
 * servidor lo confirma y que un doble clic manda una sola petición.
 */

const NEREA_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const ANA_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const ALEX_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
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
  attendance: { kind: "rate", percent: 81, sessions: 16 },
  aufNumber: "AUF-20502",
  aufExpiry: "2027-05-31",
  isAufVerified: true,
  isAufExpired: false,
  isAufExpiring: false,
  isEvaluated: true,
  membershipStatus: "active",
  email: "nerea@club.test",
  phone: "0466 108 221",
  emergencyContact: {
    name: "Iñaki Ruiz",
    phone: "0488 222 333",
    relationship: "Father",
  },
};

const ANA: AdminDirectoryMember = {
  ...NEREA,
  userId: ANA_ID,
  fullName: "Ana Admin",
  country: "AU",
  role: "Admin",
  email: "ana@club.test",
  phone: null,
  emergencyContact: null,
  aufNumber: null,
  aufExpiry: null,
  isAufVerified: false,
  membershipStatus: "past_due",
};

const ALEX: AdminDirectoryMember = {
  ...NEREA,
  userId: ALEX_ID,
  fullName: "Alex Kim",
  status: "incomplete",
  invitedOn: "2026-10-05",
  email: "alex@club.test",
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
const ROLE_PATH = `/api/v1/members/${NEREA_ID}/role`;
const INVITATION_PATH = `/api/v1/members/${ALEX_ID}/invitation`;
const DECISION_PATH = `/api/v1/role-requests/${REQUEST_ID}/decision`;

type ApiCall = { readonly url: string; readonly method: string };

type Respond = () => Promise<Response>;

type ApiStub = {
  readonly kind?: DirectoryListing["kind"];
  readonly members?: readonly AdminDirectoryMember[];
  readonly requests?: readonly PendingRoleRequest[];
  readonly roleChange?: Respond;
};

const calls: ApiCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Cada vista recibe sólo lo suyo, como la manda el servidor. */
function memberView(
  kind: DirectoryListing["kind"],
  member: AdminDirectoryMember,
): Record<string, unknown> {
  const base = {
    userId: member.userId,
    fullName: member.fullName,
    country: member.country,
    experienceLevel: member.experienceLevel,
    role: member.role,
    position: member.position,
    status: member.status,
    invitedOn: member.invitedOn,
    photoUrl: member.photoUrl,
    attendance: member.attendance,
  };
  const contact = {
    email: member.email,
    phone: member.phone,
    emergencyContact: member.emergencyContact,
  };
  switch (kind) {
    case "admin":
      return { ...member };
    case "committee":
      return { ...base, ...contact };
    case "coach":
      return {
        ...base,
        isEvaluated: member.isEvaluated,
        emergencyContact: member.emergencyContact,
      };
    case "member":
      return base;
  }
}

function readResponse(stub: ApiStub, url: string): Response {
  const kind = stub.kind ?? "admin";
  if (url.startsWith(DIRECTORY_PATH)) {
    const members = stub.members ?? [NEREA, ANA];
    return jsonResponse(200, {
      data: {
        kind,
        members: members.map((member) => memberView(kind, member)),
        total: members.length,
        availableFilters: kind === "admin" ? ["position"] : [],
      },
    });
  }
  if (url === "/api/v1/club/positions") {
    return jsonResponse(200, { data: { positions: [] } });
  }
  if (url === "/api/v1/groups") {
    return jsonResponse(200, { data: { groups: [] } });
  }
  if (url === PENDING_REQUESTS_PATH) {
    return jsonResponse(200, { data: { requests: stub.requests ?? [] } });
  }
  throw new Error(`Petición inesperada: ${url}`);
}

function writeResponse(stub: ApiStub, url: string): Promise<Response> {
  if (url === INVITATION_PATH) {
    return Promise.resolve(jsonResponse(200, { data: { invitation: "sent" } }));
  }
  if (url === DECISION_PATH) {
    return Promise.resolve(
      jsonResponse(200, {
        data: {
          id: REQUEST_ID,
          status: "approved",
          decidedBy: ANA_ID,
          decidedAt: "2026-09-18T01:00:00.000Z",
        },
      }),
    );
  }
  return (
    stub.roleChange?.() ??
    Promise.resolve(
      jsonResponse(200, {
        data: { userId: NEREA_ID, previousRole: "Player", role: "Committee" },
      }),
    )
  );
}

function stubApi(stub: ApiStub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      return method === "GET"
        ? readResponse(stub, url)
        : writeResponse(stub, url);
    }),
  );
}

function writesTo(url: string): readonly ApiCall[] {
  return calls.filter((call) => call.url === url && call.method !== "GET");
}

async function renderDirectory(
  options: { readonly locale?: "en" | "es"; readonly isAdmin?: boolean } = {},
): Promise<void> {
  const locale = options.locale ?? "en";
  render(<DirectoryScreen locale={locale} />);
  await screen.findByRole("table");
  if (options.isAdmin ?? true) {
    await waitFor(() =>
      expect(calls.map((call) => call.url)).toContain(PENDING_REQUESTS_PATH),
    );
    await screen.findByRole("heading", {
      name: locale === "en" ? "Pending requests" : "Solicitudes pendientes",
    });
  }
}

function row(name: string): HTMLElement {
  return screen.getByRole("row", { name });
}

function panel(name: string): HTMLElement {
  return screen.getByRole("region", { name: `Details of ${name}` });
}

function panelToggle(): HTMLElement {
  return screen.getByRole("button", { name: "Side panel" });
}

function roleRadio(card: HTMLElement, role: string): HTMLElement {
  return within(within(card).getByRole("group", { name: "Role" })).getByRole(
    "radio",
    { name: role },
  );
}

/** La primera celda de datos: la del rol. El nombre va en la cabecera de
 * la fila. */
function roleCellOf(name: string): HTMLElement {
  const [roleCell] = within(row(name)).getAllByRole("cell");
  if (roleCell === undefined) {
    throw new Error(`La fila de ${name} no tiene celdas`);
  }
  return roleCell;
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el panel lateral: seleccionar y deseleccionar", () => {
  it("al pulsar una fila la marca seleccionada y abre su ficha rápida", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    await user.click(row("Nerea Ruiz"));

    expect(row("Nerea Ruiz")).toHaveAttribute("aria-current", "true");
    expect(row("Ana Admin")).not.toHaveAttribute("aria-current");
    expect(panel("Nerea Ruiz")).toBeVisible();
    expect(panelToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("con el teclado, Enter sobre la fila la selecciona", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    row("Nerea Ruiz").focus();
    await user.keyboard("{Enter}");

    expect(panel("Nerea Ruiz")).toBeVisible();
  });

  it("al pulsar otra vez la fila seleccionada la deselecciona y deja el foco en ella", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));

    await user.click(row("Nerea Ruiz"));

    expect(row("Nerea Ruiz")).not.toHaveAttribute("aria-current");
    expect(
      screen.queryByRole("region", { name: "Details of Nerea Ruiz" }),
    ).toBeNull();
    expect(row("Nerea Ruiz")).toHaveFocus();
  });

  it("la ✕ del panel la deselecciona y devuelve el foco a la fila", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));

    await user.click(
      within(panel("Nerea Ruiz")).getByRole("button", {
        name: "Close the panel",
      }),
    );

    expect(
      screen.queryByRole("region", { name: "Details of Nerea Ruiz" }),
    ).toBeNull();
    expect(row("Nerea Ruiz")).not.toHaveAttribute("aria-current");
    expect(row("Nerea Ruiz")).toHaveFocus();
  });

  it("Esc dentro del panel la deselecciona y devuelve el foco a la fila", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    within(panel("Nerea Ruiz"))
      .getByRole("button", { name: "Close the panel" })
      .focus();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("region", { name: "Details of Nerea Ruiz" }),
    ).toBeNull();
    expect(row("Nerea Ruiz")).toHaveFocus();
  });

  it("Esc sobre la fila seleccionada también la deselecciona", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));

    await user.keyboard("{Escape}");

    expect(row("Nerea Ruiz")).not.toHaveAttribute("aria-current");
    expect(row("Nerea Ruiz")).toHaveFocus();
  });
});

describe("el panel lateral: el botón de la barra", () => {
  it("empieza cerrado, sin selección", async () => {
    stubApi();
    await renderDirectory();

    expect(panelToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Side panel" })).toBeNull();
  });

  it("lo abre y lo cierra", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    await user.click(panelToggle());
    expect(panelToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Side panel" })).toBeVisible();

    await user.click(panelToggle());
    expect(panelToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Side panel" })).toBeNull();
  });

  it("abierto sin nadie, Esc lo cierra y devuelve el foco al botón", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(panelToggle());
    within(screen.getByRole("region", { name: "Side panel" }))
      .getByRole("button", { name: "Close the panel" })
      .focus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: "Side panel" })).toBeNull();
    expect(panelToggle()).toHaveFocus();
  });

  it("cerrarlo con alguien seleccionado quita la ficha; seleccionar lo vuelve a abrir", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));

    await user.click(panelToggle());
    expect(
      screen.queryByRole("region", { name: "Details of Nerea Ruiz" }),
    ).toBeNull();

    await user.click(row("Ana Admin"));
    expect(panelToggle()).toHaveAttribute("aria-expanded", "true");
    expect(panel("Ana Admin")).toBeVisible();
  });
});

describe("la ficha rápida de un Admin", () => {
  it("lleva el nombre que enlaza a la ficha completa, el país y el nivel y el botón de la ficha", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");

    expect(
      within(card).getByRole("link", { name: "Open Nerea Ruiz's record" }),
    ).toHaveAttribute("href", `/directorio/${NEREA_ID}`);
    expect(within(card).getByText("Spain · Beginner")).toBeVisible();
    expect(
      within(card).getByRole("link", { name: "Open full record" }),
    ).toHaveAttribute("href", `/directorio/${NEREA_ID}`);
  });

  it("enseña el contacto con un botón de copiar por línea", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");

    expect(within(card).getByText("nerea@club.test")).toBeVisible();
    expect(within(card).getByText("0466 108 221")).toBeVisible();
    expect(
      within(card).getByText("Iñaki Ruiz (Father) · 0488 222 333"),
    ).toBeVisible();
    for (const field of ["email", "phone", "emergency contact"]) {
      expect(
        within(card).getByRole("button", { name: `Copy the ${field}` }),
      ).toBeVisible();
    }
  });

  it("enseña la asistencia, la posición, el AUF y la membresía", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    await user.click(row("Nerea Ruiz"));
    const facts = within(panel("Nerea Ruiz")).getByRole("list", {
      name: "Facts",
    });

    expect(within(facts).getByText("81%")).toBeVisible();
    expect(within(facts).getByText("Goalkeeper")).toBeVisible();
    expect(
      within(facts).getByText(
        `AUF-20502 · ${formatCalendarDay("en", "2027-05-31")}`,
      ),
    ).toBeVisible();
    expect(within(facts).getByText("Membership active")).toBeVisible();
  });

  it("enseña las etiquetas enteras que en la fila son puntos", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    await user.click(row("Ana Admin"));
    const tags = within(panel("Ana Admin")).getByRole("list", {
      name: "Tags",
    });

    expect(within(tags).getByText("Membership past due")).toBeVisible();
    expect(within(tags).getByText("No AUF number")).toBeVisible();
  });

  it("un dato de contacto que falta sale como aviso con un enlace Añadir a la ficha", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    await user.click(row("Ana Admin"));
    const card = panel("Ana Admin");

    expect(within(card).getByText("No phone")).toBeVisible();
    expect(within(card).getByText("No emergency contact")).toBeVisible();
    expect(
      within(card).getByRole("link", { name: "Add Ana Admin's phone" }),
    ).toHaveAttribute("href", `/directorio/${ANA_ID}`);
    expect(
      within(card).getByRole("link", {
        name: "Add Ana Admin's emergency contact",
      }),
    ).toHaveAttribute("href", `/directorio/${ANA_ID}`);
    expect(
      within(card).queryByRole("button", { name: "Copy the phone" }),
    ).toBeNull();
  });
});

describe("la ficha rápida: copiar", () => {
  function stubClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  }

  it("copia el dato y dice que lo copió", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));

    await user.click(
      within(panel("Nerea Ruiz")).getByRole("button", {
        name: "Copy the email",
      }),
    );

    expect(writeText).toHaveBeenCalledWith("nerea@club.test");
    expect(
      await within(panel("Nerea Ruiz")).findByRole("status"),
    ).toHaveTextContent("Copied the email.");
  });

  it("si el navegador no deja copiar, avisa de que no pudo", async () => {
    const user = userEvent.setup();
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));

    await user.click(
      within(panel("Nerea Ruiz")).getByRole("button", {
        name: "Copy the phone",
      }),
    );

    expect(
      await within(panel("Nerea Ruiz")).findByRole("alert"),
    ).toHaveTextContent("couldn't copy");
  });

  it("si el navegador no tiene portapapeles, avisa de que no pudo", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    await user.click(
      within(panel("Nerea Ruiz")).getByRole("button", {
        name: "Copy the email",
      }),
    );

    expect(
      await within(panel("Nerea Ruiz")).findByRole("alert"),
    ).toHaveTextContent("couldn't copy");
  });
});

describe("la ficha rápida: el cambio de rol confirmado", () => {
  it("elegir otro rol no guarda nada: enseña la franja con Cancelar y Guardar rol", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");

    await user.click(roleRadio(card, "Committee"));

    expect(writesTo(ROLE_PATH)).toHaveLength(0);
    expect(within(card).getByText("Player → Committee")).toBeVisible();
    expect(within(card).getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(
      within(card).getByRole("button", { name: "Save role" }),
    ).toBeVisible();
  });

  it("Cancelar quita la franja y vuelve al rol que tiene", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");
    await user.click(roleRadio(card, "Committee"));

    await user.click(within(card).getByRole("button", { name: "Cancel" }));

    expect(within(card).queryByText("Player → Committee")).toBeNull();
    expect(roleRadio(card, "Player")).toBeChecked();
    expect(writesTo(ROLE_PATH)).toHaveLength(0);
  });

  it("al guardar y confirmar el servidor, dice Rol guardado y la fila cambia de rol", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");
    await user.click(roleRadio(card, "Committee"));

    await user.click(within(card).getByRole("button", { name: "Save role" }));

    expect(await within(card).findByText("Role saved")).toBeVisible();
    expect(roleCellOf("Nerea Ruiz")).toHaveTextContent("Committee");
    expect(roleRadio(card, "Committee")).toBeChecked();
    expect(writesTo(ROLE_PATH)).toEqual([{ url: ROLE_PATH, method: "PATCH" }]);
  });

  it("si es el último Admin, el error sale en la franja y el rol no cambia", async () => {
    const user = userEvent.setup();
    stubApi({
      roleChange: async () =>
        jsonResponse(422, {
          error: { code: "business_rule", message: "x", reason: "last_admin" },
        }),
    });
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");
    await user.click(roleRadio(card, "Committee"));

    await user.click(within(card).getByRole("button", { name: "Save role" }));

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "last Admin",
    );
    expect(roleRadio(card, "Player")).toBeChecked();
    expect(roleCellOf("Nerea Ruiz")).toHaveTextContent("Player");
  });

  it("con la red caída, el error sale en la franja, la fila no cambia y se puede reintentar", async () => {
    const user = userEvent.setup();
    stubApi({
      roleChange: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");
    await user.click(roleRadio(card, "Committee"));

    await user.click(within(card).getByRole("button", { name: "Save role" }));

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "couldn't reach the server",
    );
    expect(roleCellOf("Nerea Ruiz")).toHaveTextContent("Player");
    expect(
      within(card).getByRole("button", { name: "Save role" }),
    ).toBeEnabled();
  });

  it("un doble clic en Guardar rol manda una sola petición", async () => {
    const user = userEvent.setup();
    let settle: (response: Response) => void = () => undefined;
    stubApi({
      roleChange: () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    });
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");
    await user.click(roleRadio(card, "Committee"));

    await user.dblClick(within(card).getByRole("button", { name: /Sav/ }));

    expect(writesTo(ROLE_PATH)).toHaveLength(1);
    await act(async () => {
      settle(
        jsonResponse(200, {
          data: { userId: NEREA_ID, previousRole: "Player", role: "Committee" },
        }),
      );
    });
  });
});

describe("la ficha rápida: invitación y solicitud", () => {
  it("de un invitado enseña el recuadro de la invitación y la reenvía", async () => {
    const user = userEvent.setup();
    stubApi({ members: [ALEX, NEREA] });
    await renderDirectory();
    await user.click(row("Alex Kim"));
    const card = panel("Alex Kim");

    expect(
      within(card).getByText(
        `Invitation sent on ${formatCalendarDay("en", "2026-10-05")} · not accepted yet`,
      ),
    ).toBeVisible();
    await user.click(
      within(card).getByRole("button", { name: "Resend invitation" }),
    );

    expect(
      await within(card).findByText("Sent again to alex@club.test"),
    ).toBeVisible();
    expect(writesTo(INVITATION_PATH)).toHaveLength(1);
  });

  it("de quien no es invitado no enseña el recuadro", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));

    expect(
      within(panel("Nerea Ruiz")).queryByRole("button", {
        name: "Resend invitation",
      }),
    ).toBeNull();
  });

  it("de quien pidió un rol enseña la solicitud con su justificación", async () => {
    const user = userEvent.setup();
    stubApi({ requests: [COACH_REQUEST] });
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const request = within(panel("Nerea Ruiz")).getByRole("group", {
      name: "Role request",
    });

    expect(request).toHaveTextContent(
      `Asked to be Coach · ${formatCalendarDay("en", "2026-09-17")}`,
    );
    expect(
      within(request).getByText("“Entreno a los juveniles los jueves.”"),
    ).toBeVisible();
  });

  it("al aprobar con doble clic sale una sola decisión, y la fila pasa al rol pedido", async () => {
    const user = userEvent.setup();
    stubApi({ requests: [COACH_REQUEST] });
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");

    await user.dblClick(
      within(card).getByRole("button", {
        name: "Approve the request from Nerea Ruiz",
      }),
    );

    await waitFor(() =>
      expect(roleCellOf("Nerea Ruiz")).toHaveTextContent("Coach"),
    );
    expect(writesTo(DECISION_PATH)).toHaveLength(1);
    expect(
      within(card).queryByRole("group", { name: "Role request" }),
    ).toBeNull();
  });
});

describe("la ficha rápida de quien no es Admin (D4)", () => {
  it.each(["committee", "coach", "member"] as const)(
    "a la vista %s no le enseña rol, solicitud, invitación, AUF ni membresía",
    async (kind) => {
      const user = userEvent.setup();
      stubApi({ kind, members: [ALEX, NEREA], requests: [COACH_REQUEST] });
      await renderDirectory({ isAdmin: false });

      await user.click(row("Alex Kim"));
      const card = panel("Alex Kim");

      expect(within(card).queryByRole("group", { name: "Role" })).toBeNull();
      expect(
        within(card).queryByRole("group", { name: "Role request" }),
      ).toBeNull();
      expect(
        within(card).queryByRole("button", { name: "Resend invitation" }),
      ).toBeNull();
      expect(within(card).queryByText(/AUF/)).toBeNull();
      expect(within(card).queryByText(/Membership/)).toBeNull();
      expect(within(card).queryByRole("link", { name: /record/ })).toBeNull();
      expect(within(card).getByText("Goalkeeper")).toBeVisible();
    },
  );

  it("al Committee le enseña todo el contacto", async () => {
    const user = userEvent.setup();
    stubApi({ kind: "committee" });
    await renderDirectory({ isAdmin: false });

    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");

    expect(within(card).getByText("nerea@club.test")).toBeVisible();
    expect(within(card).getByText("0466 108 221")).toBeVisible();
    expect(
      within(card).getByText("Iñaki Ruiz (Father) · 0488 222 333"),
    ).toBeVisible();
  });

  it("al Coach sólo le enseña el contacto de emergencia", async () => {
    const user = userEvent.setup();
    stubApi({ kind: "coach" });
    await renderDirectory({ isAdmin: false });

    await user.click(row("Nerea Ruiz"));
    const card = panel("Nerea Ruiz");

    expect(within(card).queryByText("nerea@club.test")).toBeNull();
    expect(within(card).queryByText("0466 108 221")).toBeNull();
    expect(
      within(card).getByText("Iñaki Ruiz (Father) · 0488 222 333"),
    ).toBeVisible();
  });

  it("al Player no le enseña contacto", async () => {
    const user = userEvent.setup();
    stubApi({ kind: "member" });
    await renderDirectory({ isAdmin: false });

    await user.click(row("Nerea Ruiz"));

    expect(
      within(panel("Nerea Ruiz")).queryByRole("group", { name: "Contact" }),
    ).toBeNull();
  });

  it("un dato que falta no lleva el enlace Añadir", async () => {
    const user = userEvent.setup();
    stubApi({ kind: "committee" });
    await renderDirectory({ isAdmin: false });

    await user.click(row("Ana Admin"));
    const card = panel("Ana Admin");

    expect(within(card).getByText("No phone")).toBeVisible();
    expect(within(card).queryByRole("link", { name: /Add/ })).toBeNull();
  });
});

describe("la ficha rápida en español", () => {
  it("escribe la ficha, la franja y la invitación en español", async () => {
    const user = userEvent.setup();
    stubApi({ members: [ALEX, NEREA] });
    await renderDirectory({ locale: "es" });

    await user.click(row("Alex Kim"));
    const card = screen.getByRole("region", { name: "Ficha de Alex Kim" });
    await user.click(
      within(within(card).getByRole("group", { name: "Rol" })).getByRole(
        "radio",
        { name: "Comité" },
      ),
    );

    expect(
      within(card).getByText(
        `Invitación enviada el ${formatCalendarDay("es", "2026-10-05")} · todavía sin aceptar`,
      ),
    ).toBeVisible();
    expect(within(card).getByText("Jugador → Comité")).toBeVisible();
    expect(
      within(card).getByRole("button", { name: "Guardar rol" }),
    ).toBeVisible();
    expect(
      within(card).getByRole("link", { name: "Abrir ficha completa" }),
    ).toBeVisible();
  });
});
