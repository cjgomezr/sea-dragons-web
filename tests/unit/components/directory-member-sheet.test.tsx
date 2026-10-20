import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type {
  AdminDirectoryMember,
  DirectoryListing,
} from "@/lib/directory/directory";
import { formatCalendarDay } from "@/lib/i18n/format";
import { QUIET_CLUB_SUMMARY } from "../helpers/club-summary";
import { GOALKEEPER, asDirectoryPosition } from "../helpers/seeded-positions";

/**
 * El directorio en el móvil, la ficha que sube y las acciones al deslizar
 * (#554, RF-8 del PRD de E21). Por debajo de 768px, tocar una fila sube la
 * ficha del socio desde abajo en vez de abrir el panel lateral, y deslizar
 * la fila a la izquierda enseña el correo, la llamada y la emergencia.
 *
 * El ancho lo dice `matchMedia`, que aquí se simula. Cómo se ve a 375 px y
 * el `touch-action` lo prueba Playwright; aquí, lo que hace cada gesto y lo
 * que ve cada rol (FR-090, D4).
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
    phone: "+61 488 222 333",
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
  currentRole: "Player",
  requestedRole: "Coach",
  justification: "Entreno a los juveniles los jueves.",
  createdAt: "2026-09-17T08:30:00.000Z",
};

const DIRECTORY_PATH = "/api/v1/directory";
const PENDING_REQUESTS_PATH = "/api/v1/role-requests?status=pending";
const ROLE_PATH = `/api/v1/members/${NEREA_ID}/role`;

/** El ancho del móvil, como lo pregunta la pantalla. */
const PHONE_QUERY = "(width < 768px)";

type ApiCall = { readonly url: string; readonly method: string };

type ApiStub = {
  readonly kind?: DirectoryListing["kind"];
  readonly members?: readonly AdminDirectoryMember[];
  readonly requests?: readonly PendingRoleRequest[];
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
  switch (kind) {
    case "admin":
      return { ...member };
    case "committee":
      return {
        ...base,
        email: member.email,
        phone: member.phone,
        emergencyContact: member.emergencyContact,
      };
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
    // El rol filtra como en el servidor: así una fila puede salir de la lista.
    const role = new URL(url, "http://localhost").searchParams.get("role");
    const members = (stub.members ?? [NEREA, ANA]).filter(
      (member) => role === null || member.role === role,
    );
    return jsonResponse(200, {
      data: {
        kind,
        members: members.map((member) => memberView(kind, member)),
        total: members.length,
        availableFilters: kind === "admin" ? ["position"] : [],
        ...(kind === "admin" ? { summary: QUIET_CLUB_SUMMARY } : {}),
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

function roleSavedResponse(): Response {
  return jsonResponse(200, {
    data: { userId: NEREA_ID, previousRole: "Player", role: "Committee" },
  });
}

function stubApi(stub: ApiStub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      return method === "GET" ? readResponse(stub, url) : roleSavedResponse();
    }),
  );
}

function stubScreen(isPhone: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: isPhone && query === PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
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
  }
}

function row(name: string): HTMLElement {
  return screen.getByRole("row", { name });
}

function sheet(name: string): HTMLElement {
  return screen.getByRole("dialog", { name });
}

function roleRadio(card: HTMLElement, role: string): HTMLElement {
  return within(within(card).getByRole("group", { name: "Role" })).getByRole(
    "radio",
    { name: role },
  );
}

/** Lo que deja un dedo al pasar por la fila: bajar, moverse y levantarse,
 * y el clic que el navegador manda después si no hubo desplazamiento. */
function swipe(
  element: HTMLElement,
  move: { readonly dx: number; readonly dy?: number },
): void {
  const start = { clientX: 300, clientY: 200, pointerId: 1 };
  const end = {
    clientX: start.clientX + move.dx,
    clientY: start.clientY + (move.dy ?? 0),
    pointerId: 1,
  };
  fireEvent.pointerDown(element, start);
  fireEvent.pointerMove(element, end);
  fireEvent.pointerUp(element, end);
  fireEvent.click(element, end);
}

function rowActions(name: string): HTMLElement | null {
  return within(row(name)).queryByRole("group", {
    name: `Actions for ${name}`,
  });
}

beforeEach(() => {
  calls.length = 0;
  stubScreen(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("la ficha que sube: abrir y cerrar", () => {
  it("al tocar una fila sube la ficha del socio en vez del panel lateral", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    await user.click(row("Nerea Ruiz"));

    const card = sheet("Nerea Ruiz");
    expect(card).toBeVisible();
    expect(within(card).getByText("Spain · Beginner")).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Details of Nerea Ruiz" }),
    ).toBeNull();
  });

  it("con el teclado, Enter sobre la fila sube la ficha", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    row("Nerea Ruiz").focus();
    await user.keyboard("{Enter}");

    expect(sheet("Nerea Ruiz")).toBeVisible();
  });

  it("Esc la cierra y devuelve el foco a la fila", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Nerea Ruiz" })).toBeNull();
    expect(row("Nerea Ruiz")).toHaveFocus();
    expect(row("Nerea Ruiz")).not.toHaveAttribute("aria-current");
  });

  it("un toque fuera de la ficha la cierra y devuelve el foco a la fila", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog", { name: "Nerea Ruiz" })).toBeNull();
    expect(row("Nerea Ruiz")).toHaveFocus();
  });

  it("arrastrar el asa hacia abajo la cierra y devuelve el foco a la fila", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const grip = within(sheet("Nerea Ruiz")).getByRole("button", {
      name: "Close the sheet",
    });

    fireEvent.pointerDown(grip, { clientX: 180, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 182, clientY: 520, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: 182, clientY: 520, pointerId: 1 });

    expect(screen.queryByRole("dialog", { name: "Nerea Ruiz" })).toBeNull();
    expect(row("Nerea Ruiz")).toHaveFocus();
  });

  it("arrastrar desde la cabecera más allá del umbral cierra la hoja y devuelve el foco a la fila", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const name = within(sheet("Nerea Ruiz")).getByRole("heading", {
      name: "Nerea Ruiz",
    });

    fireEvent.pointerDown(name, { clientX: 180, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(name, { clientX: 182, clientY: 480, pointerId: 1 });
    fireEvent.pointerMove(name, { clientX: 182, clientY: 560, pointerId: 1 });
    fireEvent.pointerUp(name, { clientX: 182, clientY: 560, pointerId: 1 });

    expect(screen.queryByRole("dialog", { name: "Nerea Ruiz" })).toBeNull();
    expect(row("Nerea Ruiz")).toHaveFocus();
  });

  it("abierta con el dedo, el foco no se queda en el asa", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();

    await user.click(row("Nerea Ruiz"));

    expect(
      within(sheet("Nerea Ruiz")).getByRole("button", {
        name: "Close the sheet",
      }),
    ).not.toHaveFocus();
  });

  it("abrir con el teclado deja el foco en un control de la hoja", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    row("Nerea Ruiz").focus();

    await user.keyboard("{Enter}");

    // Un control al que llega Tab, no el panel, que sólo recibe el foco
    // cuando la abre un dedo.
    const focused = document.activeElement as HTMLElement;
    expect(sheet("Nerea Ruiz")).toContainElement(focused);
    expect(focused.tabIndex).toBeGreaterThanOrEqual(0);
    expect(focused.matches(":focus-visible")).toBe(true);
  });

  it("abierta con el teclado, el foco que sale vuelve a un control de la hoja", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    row("Nerea Ruiz").focus();
    await user.keyboard("{Enter}");

    row("Ana Admin").focus();

    const focused = document.activeElement as HTMLElement;
    expect(sheet("Nerea Ruiz")).toContainElement(focused);
    expect(focused.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it("abierta con el teclado, el foco sigue atrapado y Escape lo devuelve a la fila", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    row("Nerea Ruiz").focus();
    await user.keyboard("{Enter}");
    const grip = within(sheet("Nerea Ruiz")).getByRole("button", {
      name: "Close the sheet",
    });

    await user.tab({ shift: true });

    expect(sheet("Nerea Ruiz")).toContainElement(
      document.activeElement as HTMLElement,
    );
    expect(grip).not.toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Nerea Ruiz" })).toBeNull();
    expect(row("Nerea Ruiz")).toHaveFocus();
  });

  it("desde 768px la fila sigue abriendo el panel lateral", async () => {
    const user = userEvent.setup();
    stubScreen(false);
    stubApi();
    await renderDirectory();

    await user.click(row("Nerea Ruiz"));

    expect(
      screen.getByRole("region", { name: "Details of Nerea Ruiz" }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Nerea Ruiz" })).toBeNull();
  });
});

describe("la ficha que sube: los botones de contacto", () => {
  it("al Admin le da correo, llamada y emergencia con su mailto: y su tel:", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const contact = within(sheet("Nerea Ruiz")).getByRole("group", {
      name: "Contact",
    });

    expect(
      within(contact).getByRole("link", { name: "Email Nerea Ruiz" }),
    ).toHaveAttribute("href", "mailto:nerea@club.test");
    expect(
      within(contact).getByRole("link", { name: "Call Nerea Ruiz" }),
    ).toHaveAttribute("href", "tel:0466108221");
    expect(
      within(contact).getByRole("link", {
        name: "Call Nerea Ruiz's emergency contact",
      }),
    ).toHaveAttribute("href", "tel:+61488222333");
  });

  it("cada botón de solo icono lleva el mismo texto en aria-label y title", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const contact = within(sheet("Nerea Ruiz")).getByRole("group", {
      name: "Contact",
    });

    for (const link of within(contact).getAllByRole("link")) {
      expect(link.getAttribute("title")).toBe(link.getAttribute("aria-label"));
    }
  });

  it("un dato que falta sale como botón desactivado que lo dice", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Ana Admin"));
    const contact = within(sheet("Ana Admin")).getByRole("group", {
      name: "Contact",
    });

    expect(
      within(contact).getByRole("button", { name: "Ana Admin has no phone" }),
    ).toBeDisabled();
    expect(
      within(contact).getByRole("button", {
        name: "Ana Admin has no emergency contact",
      }),
    ).toBeDisabled();
    expect(
      within(contact).queryByRole("link", { name: "Call Ana Admin" }),
    ).toBeNull();
  });

  it("al Committee le da correo, llamada y emergencia con su mailto: y su tel:", async () => {
    const user = userEvent.setup();
    stubApi({ kind: "committee" });
    await renderDirectory({ isAdmin: false });
    await user.click(row("Nerea Ruiz"));
    const contact = within(sheet("Nerea Ruiz")).getByRole("group", {
      name: "Contact",
    });

    expect(
      within(contact).getByRole("link", { name: "Email Nerea Ruiz" }),
    ).toHaveAttribute("href", "mailto:nerea@club.test");
    expect(
      within(contact).getByRole("link", { name: "Call Nerea Ruiz" }),
    ).toHaveAttribute("href", "tel:0466108221");
    expect(
      within(contact).getByRole("link", {
        name: "Call Nerea Ruiz's emergency contact",
      }),
    ).toHaveAttribute("href", "tel:+61488222333");
  });

  it("al Coach sólo le da el botón de emergencia", async () => {
    const user = userEvent.setup();
    stubApi({ kind: "coach" });
    await renderDirectory({ isAdmin: false });
    await user.click(row("Nerea Ruiz"));
    const contact = within(sheet("Nerea Ruiz")).getByRole("group", {
      name: "Contact",
    });

    expect(within(contact).getAllByRole("link")).toHaveLength(1);
    expect(
      within(contact).getByRole("link", {
        name: "Call Nerea Ruiz's emergency contact",
      }),
    ).toBeVisible();
    expect(within(contact).queryByRole("button")).toBeNull();
  });

  it("al Player no le da contacto", async () => {
    const user = userEvent.setup();
    stubApi({ kind: "member" });
    await renderDirectory({ isAdmin: false });
    await user.click(row("Nerea Ruiz"));

    expect(
      within(sheet("Nerea Ruiz")).queryByRole("group", { name: "Contact" }),
    ).toBeNull();
  });
});

describe("la ficha que sube: lo del Admin", () => {
  it("lleva el rol, la asistencia, el AUF, la membresía y Abrir ficha completa", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const card = sheet("Nerea Ruiz");
    const facts = within(card).getByRole("list", { name: "Facts" });

    expect(roleRadio(card, "Player")).toBeChecked();
    expect(within(facts).getByText("81%")).toBeVisible();
    expect(
      within(facts).getByText(
        `AUF-20502 · ${formatCalendarDay("en", "2027-05-31")}`,
      ),
    ).toBeVisible();
    expect(within(facts).getByText("Membership")).toBeVisible();
    expect(
      within(card).getByRole("link", { name: "Open full record" }),
    ).toHaveAttribute("href", expect.stringContaining(NEREA_ID));
  });

  it("elegir otro rol enseña la franja y guardar cambia la fila", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));
    const card = sheet("Nerea Ruiz");

    await user.click(roleRadio(card, "Committee"));
    expect(within(card).getByText("Player → Committee")).toBeVisible();
    expect(calls.filter((call) => call.url === ROLE_PATH)).toHaveLength(0);
    await user.click(within(card).getByRole("button", { name: "Save role" }));

    expect(await within(card).findByText("Role saved")).toBeVisible();
    expect(calls.filter((call) => call.url === ROLE_PATH)).toEqual([
      { url: ROLE_PATH, method: "PATCH" },
    ]);
  });

  it("de un invitado lleva el recuadro de la invitación", async () => {
    const user = userEvent.setup();
    stubApi({ members: [ALEX, NEREA] });
    await renderDirectory();
    await user.click(row("Alex Kim"));

    expect(
      within(sheet("Alex Kim")).getByRole("button", {
        name: "Resend invitation",
      }),
    ).toBeVisible();
  });

  it("de quien pidió un rol lleva el recuadro de la solicitud", async () => {
    const user = userEvent.setup();
    stubApi({ requests: [COACH_REQUEST] });
    await renderDirectory();
    await user.click(row("Nerea Ruiz"));

    expect(
      within(sheet("Nerea Ruiz")).getByRole("group", { name: "Role request" }),
    ).toHaveTextContent("Entreno a los juveniles los jueves.");
  });

  it("a quien no es Admin no le enseña rol, AUF ni membresía", async () => {
    const user = userEvent.setup();
    stubApi({ kind: "committee" });
    await renderDirectory({ isAdmin: false });
    await user.click(row("Nerea Ruiz"));
    const card = sheet("Nerea Ruiz");

    expect(within(card).queryByRole("group", { name: "Role" })).toBeNull();
    expect(within(card).queryByText(/AUF/)).toBeNull();
    expect(within(card).queryByText("Membership")).toBeNull();
    expect(within(card).getByText("81%")).toBeVisible();
  });

  it.each(["committee", "coach"] as const)(
    "a la vista %s le lleva a la ficha completa en lectura (#776)",
    async (kind) => {
      const user = userEvent.setup();
      stubApi({ kind });
      await renderDirectory({ isAdmin: false });
      await user.click(row("Nerea Ruiz"));

      expect(
        within(sheet("Nerea Ruiz")).getByRole("link", {
          name: "Open full record",
        }),
      ).toHaveAttribute("href", `/directorio/${NEREA_ID}`);
    },
  );

  it("a un Player no le lleva a la ficha completa", async () => {
    const user = userEvent.setup();
    stubApi({ kind: "member" });
    await renderDirectory({ isAdmin: false });
    await user.click(row("Nerea Ruiz"));

    expect(
      within(sheet("Nerea Ruiz")).queryByRole("link", { name: /record/ }),
    ).toBeNull();
  });
});

describe("deslizar la fila", () => {
  it("menos de 30 px a la izquierda no enseña nada", async () => {
    stubApi();
    await renderDirectory();

    swipe(row("Nerea Ruiz"), { dx: -20 });

    expect(rowActions("Nerea Ruiz")).toBeNull();
  });

  it("más de 30 px a la izquierda enseña correo, llamada y emergencia sin subir la ficha", async () => {
    stubApi();
    await renderDirectory();

    swipe(row("Nerea Ruiz"), { dx: -60 });

    const actions = rowActions("Nerea Ruiz");
    if (actions === null) {
      throw new Error("La fila no enseña sus acciones");
    }
    expect(
      within(actions).getByRole("link", { name: "Email Nerea Ruiz" }),
    ).toHaveAttribute("href", "mailto:nerea@club.test");
    expect(
      within(actions).getByRole("link", { name: "Call Nerea Ruiz" }),
    ).toHaveAttribute("title", "Call Nerea Ruiz");
    expect(
      within(actions).getByRole("link", {
        name: "Call Nerea Ruiz's emergency contact",
      }),
    ).toHaveAttribute("href", "tel:+61488222333");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["committee", "coach"] as const)(
    "a un %s la fila sin deslizar no le enseña contacto bajo el rol",
    async (kind) => {
      stubApi({ kind });
      await renderDirectory({ isAdmin: false });

      const contactLinks = within(row("Nerea Ruiz"))
        .queryAllByRole("link")
        .filter((link) =>
          /^(tel|mailto):/.test(link.getAttribute("href") ?? ""),
        );
      expect(contactLinks).toEqual([]);
      expect(
        within(row("Nerea Ruiz")).queryByText(/Emergency contact/),
      ).toBeNull();
    },
  );

  it("deslizar a la derecha las cierra", async () => {
    stubApi();
    await renderDirectory();
    swipe(row("Nerea Ruiz"), { dx: -60 });

    swipe(row("Nerea Ruiz"), { dx: 60 });

    expect(rowActions("Nerea Ruiz")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tras un gesto sin clic, el clic de un lector de pantalla sube la ficha", async () => {
    stubApi();
    await renderDirectory();
    swipe(row("Nerea Ruiz"), { dx: -60 });
    // En el táctil un deslizamiento acaba sin clic.
    const start = { clientX: 300, clientY: 200, pointerId: 1 };
    const end = { clientX: 360, clientY: 200, pointerId: 1 };
    fireEvent.pointerDown(row("Nerea Ruiz"), start);
    fireEvent.pointerMove(row("Nerea Ruiz"), end);
    fireEvent.pointerUp(row("Nerea Ruiz"), end);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    // TalkBack y VoiceOver activan con un clic sin puntero antes.
    fireEvent.click(row("Nerea Ruiz"));

    expect(sheet("Nerea Ruiz")).toBeVisible();
  });

  it("tocar fuera las cierra", async () => {
    stubApi();
    await renderDirectory();
    swipe(row("Nerea Ruiz"), { dx: -60 });

    fireEvent.pointerDown(document.body);

    expect(rowActions("Nerea Ruiz")).toBeNull();
  });

  it("sólo una fila las tiene abiertas a la vez", async () => {
    stubApi();
    await renderDirectory();
    swipe(row("Nerea Ruiz"), { dx: -60 });

    swipe(row("Ana Admin"), { dx: -60 });

    expect(rowActions("Nerea Ruiz")).toBeNull();
    expect(rowActions("Ana Admin")).not.toBeNull();
  });

  it("tocar otra fila con unas acciones abiertas sólo las cierra", async () => {
    stubApi();
    await renderDirectory();
    swipe(row("Nerea Ruiz"), { dx: -60 });

    swipe(row("Ana Admin"), { dx: 0 });

    expect(rowActions("Nerea Ruiz")).toBeNull();
    expect(rowActions("Ana Admin")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("si la fila abierta sale de la lista, el siguiente toque sube la ficha", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory();
    swipe(row("Nerea Ruiz"), { dx: -60 });

    // Con el teclado: un toque fuera ya cerraría las acciones por sí solo.
    screen.getByRole("radio", { name: "Admin" }).focus();
    await user.keyboard(" ");
    await waitFor(() =>
      expect(screen.queryByRole("row", { name: "Nerea Ruiz" })).toBeNull(),
    );
    swipe(row("Ana Admin"), { dx: 0 });

    expect(sheet("Ana Admin")).toBeVisible();
  });

  it("un movimiento en vertical no abre nada", async () => {
    stubApi();
    await renderDirectory();

    swipe(row("Nerea Ruiz"), { dx: -40, dy: 120 });

    expect(rowActions("Nerea Ruiz")).toBeNull();
  });

  it("un dato que falta sale desactivado en la fila", async () => {
    stubApi();
    await renderDirectory();

    swipe(row("Ana Admin"), { dx: -60 });

    const actions = rowActions("Ana Admin");
    if (actions === null) {
      throw new Error("La fila no enseña sus acciones");
    }
    expect(
      within(actions).getByRole("button", { name: "Ana Admin has no phone" }),
    ).toBeDisabled();
    expect(
      within(actions).getByRole("link", { name: "Email Ana Admin" }),
    ).toBeVisible();
  });

  it("al Coach sólo le enseña la emergencia", async () => {
    stubApi({ kind: "coach" });
    await renderDirectory({ isAdmin: false });

    swipe(row("Nerea Ruiz"), { dx: -60 });

    const actions = rowActions("Nerea Ruiz");
    if (actions === null) {
      throw new Error("La fila no enseña sus acciones");
    }
    expect(within(actions).getAllByRole("link")).toHaveLength(1);
    expect(
      within(actions).getByRole("link", {
        name: "Call Nerea Ruiz's emergency contact",
      }),
    ).toBeVisible();
  });

  it("al Player no le enseña acciones", async () => {
    stubApi({ kind: "member" });
    await renderDirectory({ isAdmin: false });

    swipe(row("Nerea Ruiz"), { dx: -60 });

    expect(rowActions("Nerea Ruiz")).toBeNull();
  });

  it("desde 768px la fila no tiene acciones al deslizar", async () => {
    stubScreen(false);
    stubApi();
    await renderDirectory();

    swipe(row("Nerea Ruiz"), { dx: -60 });

    expect(rowActions("Nerea Ruiz")).toBeNull();
  });
});

describe("la ficha que sube en español", () => {
  it("nombra los botones como el diseño", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderDirectory({ locale: "es" });
    await user.click(row("Nerea Ruiz"));
    const card = sheet("Nerea Ruiz");

    expect(
      within(card).getByRole("link", { name: "Llamar a Nerea Ruiz" }),
    ).toBeVisible();
    expect(
      within(card).getByRole("link", {
        name: "Llamar al contacto de emergencia de Nerea Ruiz",
      }),
    ).toBeVisible();
    expect(
      within(card).getByRole("link", { name: "Escribir a Nerea Ruiz" }),
    ).toBeVisible();
    expect(
      within(card).getByRole("button", { name: "Cerrar la ficha" }),
    ).toBeVisible();
  });
});
