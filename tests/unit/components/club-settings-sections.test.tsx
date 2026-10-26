import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubSettingsScreen } from "@/components/club/ClubSettingsScreen";
import type { ClubSettings } from "@/lib/club/club-settings";
import type { Locale } from "@/lib/i18n/locale";
import { visit } from "../../support/location-search-params";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * Las secciones de la configuración del club (#718, RF-1 del PRD de E26):
 * pestañas en escritorio y una lista que abre cada sección en el móvil, con
 * la sección en `?tab=`. El Committee sólo tiene Packs, sin barra ni lista.
 * El ancho lo dice `matchMedia`, que aquí se simula; cómo se ve lo prueba
 * Playwright.
 */

const { refresh, back, push } = vi.hoisted(() => ({
  refresh: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", async () => ({
  ...(await import("../../support/location-search-params")),
  useRouter: () => ({ refresh, back, push }),
}));

const SETTINGS_PATH = "/api/v1/club/settings";
const POSITIONS_PATH = `${SETTINGS_PATH}/positions`;
const SIGN_IN_TEXTS_PATH = `${SETTINGS_PATH}/sign-in-texts`;
const SESSION_PACKS_PATH = "/api/v1/club/session-packs";

const CLUB = {
  name: "Victoria Seadragons",
  initials: "VS",
  logoUrl: null,
} as const;

const SETTINGS: ClubSettings = {
  name: CLUB.name,
  initials: CLUB.initials,
  accentColor: "#33a1e0",
  logoUrl: "https://logos.example.test/club.png",
  seasonStartsOn: null,
};

const POSITION_NAMES = [
  "Goalkeeper",
  "Full back",
  "Half back",
  "Centre",
  "Forward",
  "Utility",
  "Sweeper",
];

/** Seis activas y la última archivada. */
const POSITIONS = POSITION_NAMES.map((name, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  names: { en: name, es: null },
  isArchived: index === POSITION_NAMES.length - 1,
  coverage: null,
  minPerTeam: 0,
  shortNames: { en: null, es: null },
}));

const SIGN_IN_TEXTS = {
  en: { tagline: null, welcome: null },
  es: { tagline: "Bajo la superficie", welcome: null },
};

const SESSION_PACKS = {
  packs: [5, 10, 20, 8].map((sessions) => ({ sessions })),
  sessionPrice: { amountCents: null, reason: "not_configured" },
};

const TAB_NAMES = ["General", "Sign-in page", "Positions", "Session packs"];

type FailingPath = typeof SETTINGS_PATH | typeof POSITIONS_PATH;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PAYLOADS: Readonly<Record<string, unknown>> = {
  [SETTINGS_PATH]: SETTINGS,
  [POSITIONS_PATH]: { positions: POSITIONS },
  [SIGN_IN_TEXTS_PATH]: SIGN_IN_TEXTS,
  [SESSION_PACKS_PATH]: SESSION_PACKS,
};

const requested: string[] = [];

function stubApi(failing: FailingPath | null = null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      if (url === failing) {
        return jsonResponse(500, { error: { code: "internal", message: "x" } });
      }
      if (!(url in PAYLOADS)) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      return jsonResponse(200, { data: PAYLOADS[url] });
    }),
  );
}

function renderScreen({
  canManageClub = true,
  locale = "en",
}: { canManageClub?: boolean; locale?: Locale } = {}): void {
  render(
    <ClubSettingsScreen
      locale={locale}
      canManageClub={canManageClub}
      club={CLUB}
    />,
  );
}

function tab(name: string): HTMLElement {
  return screen.getByRole("tab", { name });
}

async function expectGeneralOpen(): Promise<void> {
  expect(await screen.findByLabelText("Club name")).toHaveValue(CLUB.name);
}

beforeEach(() => {
  requested.length = 0;
  visit("/club");
  stubApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("las pestañas de un Admin en escritorio", () => {
  beforeEach(() => stubScreenWidth(false));

  it("enseña el título, la entrada y las cuatro pestañas, y abre en General", async () => {
    renderScreen();

    expect(
      screen.getByRole("heading", { level: 1, name: "Club settings" }),
    ).toBeVisible();
    expect(
      screen.getByText("What members see and how the club is set up."),
    ).toBeVisible();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((item) => item.textContent)).toEqual(TAB_NAMES);
    expect(tab("General")).toHaveAttribute("aria-selected", "true");
    await expectGeneralOpen();
  });

  it("cada pestaña dice qué panel controla y el panel lleva su nombre", () => {
    renderScreen();

    const general = tab("General");
    const panel = document.getElementById(
      general.getAttribute("aria-controls") ?? "",
    );
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(screen.getByRole("tabpanel", { name: "General" })).toBe(panel);
  });

  it("sólo la pestaña abierta entra en el orden del tabulador", () => {
    renderScreen();

    expect(tab("General")).toHaveAttribute("tabindex", "0");
    expect(tab("Positions")).toHaveAttribute("tabindex", "-1");
  });

  it("cambiar de pestaña pone la sección en la dirección y la abre", async () => {
    renderScreen();

    await userEvent.click(tab("Positions"));

    expect(window.location.search).toBe("?tab=positions");
    expect(tab("Positions")).toHaveAttribute("aria-selected", "true");
    expect(tab("General")).toHaveAttribute("aria-selected", "false");
    expect(
      await screen.findByRole("region", { name: "Positions" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Club name" }),
    ).not.toBeInTheDocument();
  });

  it("lo escrito en una sección sigue ahí al volver a su pestaña", async () => {
    renderScreen();
    const name = await screen.findByLabelText("Club name");
    await userEvent.clear(name);
    await userEvent.type(name, "Borrador");

    await userEvent.click(tab("Session packs"));
    // Con borrador, la pestaña dice también "Unsaved" (#719).
    await userEvent.click(tab("General Unsaved"));

    expect(screen.getByLabelText("Club name")).toHaveValue("Borrador");
  });

  it("abre la sección que dice la dirección", async () => {
    visit("/club?tab=packs");

    renderScreen();

    expect(tab("Session packs")).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByRole("region", { name: "Session packs" }),
    ).toBeVisible();
  });

  it("con un tab que no existe abre General", async () => {
    visit("/club?tab=billing");

    renderScreen();

    expect(tab("General")).toHaveAttribute("aria-selected", "true");
    await expectGeneralOpen();
  });

  it("volver atrás abre la pestaña de antes", async () => {
    renderScreen();
    await userEvent.click(tab("Sign-in page"));

    act(() => {
      window.history.back();
    });

    await waitFor(() =>
      expect(tab("General")).toHaveAttribute("aria-selected", "true"),
    );
  });

  it("no pide otra vez una sección ya abierta al volver a ella", async () => {
    renderScreen();
    await expectGeneralOpen();

    await userEvent.click(tab("Session packs"));
    await userEvent.click(tab("General"));

    await expectGeneralOpen();
    expect(requested.filter((url) => url === SETTINGS_PATH)).toHaveLength(1);
  });

  it("sale en español", () => {
    renderScreen({ locale: "es" });

    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((item) => item.textContent)).toEqual([
      "General",
      "Página de inicio de sesión",
      "Posiciones",
      "Packs de sesiones",
    ]);
    expect(
      screen.getByText("Lo que ven los miembros y cómo está montado el club."),
    ).toBeVisible();
  });
});

describe("el teclado en las pestañas", () => {
  beforeEach(() => stubScreenWidth(false));

  it("→ pasa a la siguiente", async () => {
    renderScreen();
    tab("General").focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(tab("Sign-in page")).toHaveFocus();
    expect(tab("Sign-in page")).toHaveAttribute("aria-selected", "true");
  });

  it("→ en la última vuelve a la primera", async () => {
    visit("/club?tab=packs");
    renderScreen();
    tab("Session packs").focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(tab("General")).toHaveFocus();
  });

  it("← en la primera va a la última", async () => {
    renderScreen();
    tab("General").focus();

    await userEvent.keyboard("{ArrowLeft}");

    expect(tab("Session packs")).toHaveFocus();
    expect(window.location.search).toBe("?tab=packs");
  });

  it("Fin va a la última e Inicio a la primera", async () => {
    renderScreen();
    tab("General").focus();

    await userEvent.keyboard("{End}");
    expect(tab("Session packs")).toHaveFocus();

    await userEvent.keyboard("{Home}");
    expect(tab("General")).toHaveFocus();
  });
});

describe("una sección que falla al cargar", () => {
  beforeEach(() => stubScreenWidth(false));

  it("enseña su error y las demás siguen funcionando", async () => {
    stubApi(SETTINGS_PATH);
    renderScreen();

    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeVisible();

    await userEvent.click(tab("Session packs"));

    expect(
      await screen.findByRole("region", { name: "Session packs" }),
    ).toBeVisible();
    expect(await screen.findByText("5 sessions")).toBeVisible();
  });
});

describe("el Committee", () => {
  it.each([false, true])(
    "ve Packs sin pestañas y sin pedir lo del Admin (móvil: %s)",
    async (isPhone) => {
      stubScreenWidth(isPhone);
      visit("/club?tab=general");

      renderScreen({ canManageClub: false });

      expect(
        await screen.findByRole("region", { name: "Session packs" }),
      ).toBeVisible();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^General/ }),
      ).not.toBeInTheDocument();
      expect(requested).not.toContain(SETTINGS_PATH);
      expect(requested).not.toContain(POSITIONS_PATH);
    },
  );
});

describe("la lista de un Admin en el móvil", () => {
  beforeEach(() => stubScreenWidth(true));

  function sectionRow(name: string): HTMLElement {
    return screen.getByRole("button", { name: new RegExp(`^${name}`) });
  }

  it("enseña la cabecera, la fila del club y las cuatro secciones", () => {
    renderScreen();

    expect(
      screen.getByRole("heading", { level: 1, name: "Club settings" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
    expect(screen.getByText(CLUB.name)).toBeVisible();
    expect(screen.getByText("Only Admins see this.")).toBeVisible();
    for (const name of TAB_NAMES) {
      expect(sectionRow(name)).toBeVisible();
    }
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("resume cada sección con sus datos", async () => {
    renderScreen();

    expect(
      await screen.findByText("Name, initials, colour #33A1E0, logo"),
    ).toBeVisible();
    expect(
      await screen.findByText("English: app text · Español: custom"),
    ).toBeVisible();
    expect(await screen.findByText("6 positions · 1 archived")).toBeVisible();
    expect(
      await screen.findByText("4 packs · 5, 10, 20, 8 sessions"),
    ).toBeVisible();
  });

  it("los resúmenes salen en español", async () => {
    renderScreen({ locale: "es" });

    expect(
      await screen.findByText("Nombre, iniciales, color #33A1E0, logo"),
    ).toBeVisible();
    expect(
      await screen.findByText("Inglés: texto de la app · Español: propio"),
    ).toBeVisible();
    expect(await screen.findByText("6 posiciones · 1 archivada")).toBeVisible();
    expect(
      await screen.findByText("4 packs · 5, 10, 20, 8 sesiones"),
    ).toBeVisible();
    expect(screen.getByText("Solo los Admin ven esto.")).toBeVisible();
  });

  it("un resumen que no carga deja la fila y los demás resúmenes", async () => {
    stubApi(POSITIONS_PATH);
    renderScreen();

    expect(
      await screen.findByText("4 packs · 5, 10, 20, 8 sessions"),
    ).toBeVisible();
    expect(sectionRow("Positions")).toBeVisible();
    expect(screen.queryByText(/positions ·/)).not.toBeInTheDocument();
  });

  it("tocar una fila pone la sección en la dirección y abre su pantalla", async () => {
    renderScreen();

    await userEvent.click(sectionRow("Positions"));

    expect(window.location.search).toBe("?tab=positions");
    expect(
      screen.getByRole("heading", { level: 1, name: "Positions" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
    expect(
      await screen.findByRole("region", { name: "Positions" }),
    ).toBeVisible();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("con tab en la dirección abre la pantalla de esa sección", async () => {
    visit("/club?tab=packs");

    renderScreen();

    expect(
      screen.getByRole("heading", { level: 1, name: "Session packs" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("region", { name: "Session packs" }),
    ).toBeVisible();
  });

  it("Configuración vuelve a la lista y quita la sección de la dirección", async () => {
    visit("/club?tab=general");
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(window.location.search).toBe("");
    expect(
      screen.getByRole("heading", { level: 1, name: "Club settings" }),
    ).toBeVisible();
    expect(sectionRow("General")).toBeVisible();
  });

  // Volver reabría el menú de la cuenta, y desde él sólo se iba al perfil
  // o aquí otra vez: no había camino al inicio.
  describe("volver", () => {
    beforeEach(() => {
      back.mockReset();
      push.mockReset();
    });

    // Volver a la lista dejaba otra entrada de /club en la historia, y el
    // atrás de la lista caía en la sección que se acababa de dejar.
    it("tras abrir una sección y volver a la lista, sale del club sin pasar por la sección", async () => {
      window.history.pushState(null, "", "/dashboard");
      window.history.pushState(null, "", "/club");
      vi.stubGlobal("navigation", { canGoBack: true });
      back.mockImplementation(() => window.history.back());
      renderScreen();
      await userEvent.click(sectionRow("General"));
      await userEvent.click(screen.getByRole("button", { name: "Settings" }));
      await screen.findByRole("heading", { level: 1, name: "Club settings" });

      await userEvent.click(screen.getByRole("button", { name: "Back" }));

      await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));
    });

    it("con la sección en la dirección, volver a la lista no deja otra entrada en la historia", async () => {
      visit("/club?tab=general");
      const pushState = vi.spyOn(window.history, "pushState");
      renderScreen();

      await userEvent.click(screen.getByRole("button", { name: "Settings" }));

      expect(window.location.search).toBe("");
      expect(pushState).not.toHaveBeenCalled();
      pushState.mockRestore();
    });

    it("vuelve a la pantalla de la que se vino", async () => {
      vi.stubGlobal("navigation", { canGoBack: true });
      renderScreen();

      await userEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(back).toHaveBeenCalledOnce();
      expect(push).not.toHaveBeenCalled();
    });

    it("sin pantalla anterior lleva al inicio", async () => {
      vi.stubGlobal("navigation", { canGoBack: false });
      renderScreen();

      await userEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(push).toHaveBeenCalledWith("/dashboard");
      expect(back).not.toHaveBeenCalled();
    });
  });
});
