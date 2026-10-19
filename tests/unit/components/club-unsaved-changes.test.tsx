import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubSettingsScreen } from "@/components/club/ClubSettingsScreen";
import { SAVED_NOTICE_DURATION_MS } from "@/components/club/use-club-draft";
import type { ClubSettings } from "@/lib/club/club-settings";
import { NO_SIGN_IN_TEXTS } from "@/lib/club/sign-in-texts";
import { visit } from "../../support/location-search-params";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * Los cambios sin guardar de la configuración del club (#719, RF-2, D10 y
 * D11 del PRD de E26). General, Inicio de sesión y Packs juntan un
 * borrador, lo guardan con la barra fija de abajo, marcan su pestaña (o su
 * fila en el móvil) y preguntan antes de salir de la página con él.
 */

const SETTINGS_PATH = "/api/v1/club/settings";
const POSITIONS_PATH = `${SETTINGS_PATH}/positions`;
const SIGN_IN_TEXTS_PATH = `${SETTINGS_PATH}/sign-in-texts`;
const SESSION_PACKS_PATH = "/api/v1/club/session-packs";
const NO_PRICE = { amountCents: null, reason: "not_configured" } as const;

const STORED: ClubSettings = {
  name: "Harbour Hammerheads",
  initials: "HH",
  accentColor: "#1c6ea4",
  logoUrl: null,
  seasonStartsOn: null,
};

const CLUB = { name: STORED.name, initials: "HH", logoUrl: null } as const;

vi.mock("next/navigation", async () => ({
  ...(await import("../../support/location-search-params")),
  useRouter: () => ({ refresh: () => undefined }),
}));

type Save = (body: unknown) => Response | Promise<Response>;

type Stub = {
  readonly saveSettings?: Save;
  readonly saveSignInTexts?: Save;
  readonly savePacks?: Save;
};

const sentBodies: unknown[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, code: string, reason?: string) {
  return jsonResponse(status, { error: { code, message: "x", reason } });
}

function packsCatalog(sizes: readonly number[]): Response {
  return jsonResponse(200, {
    data: {
      packs: sizes.map((sessions) => ({ sessions, price: NO_PRICE })),
      sessionPrice: NO_PRICE,
    },
  });
}

function savedSettings(body: unknown): Response {
  const identity = body as Pick<
    ClubSettings,
    "name" | "initials" | "accentColor"
  >;
  return jsonResponse(200, {
    data: {
      ...STORED,
      name: identity.name,
      initials: identity.initials,
      accentColor: identity.accentColor,
    },
  });
}

function respondToWrite(url: string, body: unknown, stub: Stub) {
  sentBodies.push(body);
  switch (url) {
    case SETTINGS_PATH:
      return stub.saveSettings?.(body) ?? savedSettings(body);
    case SIGN_IN_TEXTS_PATH:
      return stub.saveSignInTexts?.(body) ?? jsonResponse(200, { data: body });
    case SESSION_PACKS_PATH:
      return (
        stub.savePacks?.(body) ??
        packsCatalog((body as { sessions: number[] }).sessions)
      );
    default:
      throw new Error(`Guardado inesperado: ${url}`);
  }
}

function respondToRead(url: string): Response {
  switch (url) {
    case SETTINGS_PATH:
      return jsonResponse(200, { data: STORED });
    case POSITIONS_PATH:
      return jsonResponse(200, { data: { positions: [] } });
    case SIGN_IN_TEXTS_PATH:
      return jsonResponse(200, { data: NO_SIGN_IN_TEXTS });
    case SESSION_PACKS_PATH:
      return packsCatalog([5, 10]);
    default:
      throw new Error(`Petición inesperada: ${url}`);
  }
}

function stubApi(stub: Stub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return respondToRead(url);
      }
      return respondToWrite(url, JSON.parse(String(init?.body)), stub);
    }),
  );
}

async function renderScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(<ClubSettingsScreen locale={locale} canManageClub club={CLUB} />);
  await screen.findByLabelText(/^(Club name|Nombre del club)$/);
}

async function typeName(name: string): Promise<void> {
  const field = screen.getByLabelText("Club name");
  await userEvent.clear(field);
  if (name !== "") {
    await userEvent.type(field, name);
  }
}

function saveChangesButton(): HTMLElement {
  return screen.getByRole("button", { name: /^(Save changes|Saving…)$/ });
}

function discardButton(): HTMLElement {
  return screen.getByRole("button", { name: "Discard" });
}

function queryBar(text: string): HTMLElement | null {
  return screen.queryByText(text);
}

async function openTab(name: RegExp): Promise<void> {
  await userEvent.click(screen.getByRole("tab", { name }));
}

async function openPacksWithOneRemoved(): Promise<void> {
  await openTab(/^Session packs/);
  await screen.findByRole("list", { name: "Session packs" });
  await userEvent.click(
    screen.getByRole("button", { name: "Remove the 10 sessions pack" }),
  );
}

beforeEach(() => {
  sentBodies.length = 0;
  visit("/club");
  stubScreenWidth(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la barra de cambios sin guardar", () => {
  it("no sale sin cambios, y la sección no tiene botón de guardar propio", async () => {
    stubApi();

    await renderScreen();

    expect(queryBar("Unsaved changes to the club details")).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("sale con un cambio, con Descartar y Guardar cambios", async () => {
    stubApi();
    await renderScreen();

    await typeName("Bay Barracudas");

    expect(queryBar("Unsaved changes to the club details")).toBeInTheDocument();
    expect(discardButton()).toBeEnabled();
    expect(saveChangesButton()).toBeEnabled();
  });

  it("se va al deshacer el cambio a mano", async () => {
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");

    await typeName(STORED.name);

    expect(queryBar("Unsaved changes to the club details")).toBeNull();
  });

  it("nombra cada sección", async () => {
    stubApi();
    await renderScreen();

    await openTab(/^Sign-in page/);
    await userEvent.type(
      await screen.findByLabelText("Headline"),
      "Under the surface",
    );
    expect(queryBar("Unsaved changes to the sign-in page")).toBeInTheDocument();

    await openPacksWithOneRemoved();
    expect(queryBar("Unsaved changes to session packs")).toBeInTheDocument();
  });

  it("desactiva Guardar cambios con el borrador inválido y dice el error en su campo", async () => {
    stubApi();
    await renderScreen();

    await typeName("");

    expect(saveChangesButton()).toBeDisabled();
    expect(screen.getByLabelText("Club name")).toHaveAccessibleDescription(
      /^The club needs a name\./,
    );
  });

  it("sale en español", async () => {
    stubApi();
    await renderScreen("es");

    await userEvent.type(screen.getByLabelText("Nombre del club"), " II");

    expect(
      queryBar("Cambios sin guardar en los datos del club"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Descartar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeInTheDocument();
  });
});

describe("guardar desde la barra", () => {
  it("guarda, quita la barra y dice Guardado", async () => {
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");

    await userEvent.click(saveChangesButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(queryBar("Unsaved changes to the club details")).toBeNull();
    expect(sentBodies).toMatchObject([{ name: "Bay Barracudas" }]);
  });

  it("lleva el foco al título de la sección al guardar", async () => {
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");

    await userEvent.click(saveChangesButton());

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Identity" })).toHaveFocus(),
    );
  });

  it("quita el aviso de guardado a los 2,5 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");
    await userEvent.click(saveChangesButton());
    await screen.findByText("Saved");

    act(() => vi.advanceTimersByTime(SAVED_NOTICE_DURATION_MS));

    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("desactiva los dos botones mientras guarda", async () => {
    stubApi({ saveSettings: () => new Promise<Response>(() => undefined) });
    await renderScreen();
    await typeName("Bay Barracudas");

    await userEvent.click(saveChangesButton());

    expect(saveChangesButton()).toBeDisabled();
    expect(saveChangesButton()).toHaveTextContent("Saving…");
    expect(discardButton()).toBeDisabled();
  });

  it("no manda dos veces con un doble clic", async () => {
    stubApi({ saveSettings: () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await renderScreen();
    await typeName("Bay Barracudas");

    await user.dblClick(saveChangesButton());

    expect(sentBodies).toHaveLength(1);
  });

  it("con un error de red conserva el borrador y la barra, y dice el error", async () => {
    stubApi({
      saveSettings: () => Promise.reject(new TypeError("fetch failed")),
    });
    await renderScreen();
    await typeName("Bay Barracudas");

    await userEvent.click(saveChangesButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server.",
    );
    expect(screen.getByLabelText("Club name")).toHaveValue("Bay Barracudas");
    expect(queryBar("Unsaved changes to the club details")).toBeInTheDocument();
    expect(saveChangesButton()).toBeEnabled();
  });

  it("con un 409 conserva la barra y ofrece cargar lo último", async () => {
    stubApi({
      saveSettings: () =>
        errorResponse(409, "conflict", "club_settings_changed"),
    });
    await renderScreen();
    await typeName("Bay Barracudas");

    await userEvent.click(saveChangesButton());

    expect(
      await screen.findByRole("button", { name: "Load the latest settings" }),
    ).toBeInTheDocument();
    expect(queryBar("Unsaved changes to the club details")).toBeInTheDocument();
  });

  it("guarda los packs y quita su barra", async () => {
    stubApi();
    await renderScreen();
    await openPacksWithOneRemoved();

    await userEvent.click(saveChangesButton());

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(sentBodies).toEqual([{ sessions: [5] }]);
    expect(queryBar("Unsaved changes to session packs")).toBeNull();
  });

  it("con un error al guardar los packs conserva la lista del borrador", async () => {
    stubApi({ savePacks: () => errorResponse(500, "internal_error") });
    await renderScreen();
    await openPacksWithOneRemoved();

    await userEvent.click(saveChangesButton());

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(queryBar("Unsaved changes to session packs")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Session packs" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
  });
});

describe("descartar", () => {
  it("vuelve a lo guardado y quita la barra", async () => {
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");

    await userEvent.click(discardButton());

    expect(screen.getByLabelText("Club name")).toHaveValue(STORED.name);
    expect(queryBar("Unsaved changes to the club details")).toBeNull();
  });

  it("lleva el foco al título de la sección, no a la página", async () => {
    stubApi();
    await renderScreen();
    await openPacksWithOneRemoved();

    await userEvent.click(discardButton());

    expect(
      screen.getByRole("heading", { name: "Session packs" }),
    ).toHaveFocus();
  });

  it("no mueve el foco al deshacer el cambio a mano", async () => {
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");

    await typeName(STORED.name);

    expect(screen.getByLabelText("Club name")).toHaveFocus();
  });

  it("devuelve el pack quitado", async () => {
    stubApi();
    await renderScreen();
    await openPacksWithOneRemoved();

    await userEvent.click(discardButton());

    expect(
      within(screen.getByRole("list", { name: "Session packs" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(2);
  });
});

describe("el punto de la pestaña", () => {
  it("marca la pestaña con borrador, con texto para el lector de pantalla", async () => {
    stubApi();
    await renderScreen();

    await typeName("Bay Barracudas");

    expect(
      screen.getByRole("tab", { name: "General Unsaved" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Positions" })).toBeInTheDocument();
  });

  it("se va al guardar", async () => {
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");

    await userEvent.click(saveChangesButton());
    await screen.findByText("Saved");

    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
  });

  it("el borrador sigue ahí al cambiar de pestaña y volver", async () => {
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");

    await openTab(/^Positions/);
    expect(
      screen.getByRole("tab", { name: "General Unsaved" }),
    ).toBeInTheDocument();
    await openTab(/^General/);

    expect(screen.getByLabelText("Club name")).toHaveValue("Bay Barracudas");
    expect(queryBar("Unsaved changes to the club details")).toBeInTheDocument();
  });
});

describe("la fila del móvil", () => {
  beforeEach(() => {
    stubScreenWidth(true);
    visit("/club?tab=packs");
  });

  it("dice Sin guardar en la fila y conserva el borrador al volver a entrar", async () => {
    stubApi();
    render(<ClubSettingsScreen locale="en" canManageClub club={CLUB} />);
    await screen.findByRole("list", { name: "Session packs" });
    await userEvent.click(
      screen.getByRole("button", { name: "Remove the 10 sessions pack" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    const row = await screen.findByRole("button", { name: /^Session packs/ });
    expect(row).toHaveTextContent(/Unsaved/);
    await userEvent.click(row);

    expect(
      within(screen.getByRole("list", { name: "Session packs" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
    expect(queryBar("Unsaved changes to session packs")).toBeInTheDocument();
  });
});

describe("salir con un borrador", () => {
  function dispatchBeforeUnload(): Event {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  /** Un enlace de la app fuera de la pantalla, como los de la barra
   * lateral. Su `onClick` hace de `Link` de Next.js, que navega aunque el
   * clic ya llegue con `defaultPrevented`. */
  function renderWithAppLink(followLink: () => void = () => undefined) {
    render(
      <>
        <a href="/dashboard" onClick={followLink}>
          Dashboard
        </a>
        <ClubSettingsScreen locale="en" canManageClub club={CLUB} />
      </>,
    );
    return screen.getByRole("link", { name: "Dashboard" });
  }

  function clickLink(link: HTMLElement): MouseEvent {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    link.dispatchEvent(event);
    return event;
  }

  it("no pide confirmación al cerrar sin borrador", async () => {
    stubApi();
    await renderScreen();

    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("pide confirmación al cerrar o recargar con borrador", async () => {
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");

    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
  });

  it("deja de pedirla tras guardar", async () => {
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");
    await userEvent.click(saveChangesButton());
    await screen.findByText("Saved");

    // La sección avisa a la pantalla en un efecto: bajo carga llega un
    // pintado después del aviso de guardado.
    await waitFor(() =>
      expect(dispatchBeforeUnload().defaultPrevented).toBe(false),
    );
  });

  it("pregunta al seguir un enlace de la app, y cancelar deja todo como estaba", async () => {
    stubApi();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const followLink = vi.fn();
    const link = renderWithAppLink(followLink);
    await screen.findByLabelText("Club name");
    await typeName("Bay Barracudas");

    const click = clickLink(link);

    expect(confirm).toHaveBeenCalledWith("Leave without saving?");
    expect(click.defaultPrevented).toBe(true);
    expect(followLink).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Club name")).toHaveValue("Bay Barracudas");
  });

  it("deja seguir el enlace si se acepta", async () => {
    stubApi();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const followLink = vi.fn();
    const link = renderWithAppLink(followLink);
    await screen.findByLabelText("Club name");
    await typeName("Bay Barracudas");

    clickLink(link);

    expect(followLink).toHaveBeenCalledOnce();
  });

  it("no pregunta al seguir un enlace sin borrador", async () => {
    stubApi();
    const confirm = vi.spyOn(window, "confirm");
    const link = renderWithAppLink();
    await screen.findByLabelText("Club name");

    clickLink(link);

    expect(confirm).not.toHaveBeenCalled();
  });

  it("no pregunta al cambiar de pestaña con borrador", async () => {
    stubApi();
    const confirm = vi.spyOn(window, "confirm");
    await renderScreen();
    await typeName("Bay Barracudas");

    await openTab(/^Positions/);

    expect(confirm).not.toHaveBeenCalled();
  });
});
