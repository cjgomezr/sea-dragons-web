import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubSettingsScreen } from "@/components/club/ClubSettingsScreen";
import {
  DEFAULT_ACCENT_COLOR,
  evaluateAccentColor,
  SUGGESTED_ACCENT_COLORS,
} from "@/lib/club/accent-color";
import type { ClubSettings } from "@/lib/club/club-settings";
import { NO_SIGN_IN_TEXTS } from "@/lib/club/sign-in-texts";
import { visit } from "../../support/location-search-params";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * La pestaña General rehecha (#720, RF-3 del PRD de E26): IDENTIDAD y MARCA
 * a la izquierda y la vista previa a la derecha, con cinco colores
 * sugeridos. El logo se sigue guardando al momento, fuera del borrador.
 */

const SETTINGS_PATH = "/api/v1/club/settings";
const LOGO_PATH = `${SETTINGS_PATH}/logo`;
const POSITIONS_PATH = `${SETTINGS_PATH}/positions`;
const SIGN_IN_TEXTS_PATH = `${SETTINGS_PATH}/sign-in-texts`;
const SESSION_PACKS_PATH = "/api/v1/club/session-packs";
const NEW_LOGO_URL = "https://storage.example.test/club-logos/club/nuevo.png";

const STORED: ClubSettings = {
  name: "Harbour Hammerheads",
  initials: null,
  accentColor: "#1c6ea4",
  logoUrl: null,
};

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", async () => ({
  ...(await import("../../support/location-search-params")),
  useRouter: () => ({ refresh }),
}));

const patches: unknown[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubApi(settings: ClubSettings = STORED): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === POSITIONS_PATH) {
        return jsonResponse(200, { data: { positions: [] } });
      }
      if (url === SIGN_IN_TEXTS_PATH) {
        return jsonResponse(200, { data: NO_SIGN_IN_TEXTS });
      }
      if (url === SESSION_PACKS_PATH) {
        return jsonResponse(200, {
          data: {
            packs: [],
            sessionPrice: { amountCents: null, reason: "not_configured" },
          },
        });
      }
      if (url === LOGO_PATH) {
        return jsonResponse(200, { data: { logoUrl: NEW_LOGO_URL } });
      }
      if (url !== SETTINGS_PATH) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Partial<ClubSettings>;
        patches.push(body);
        return jsonResponse(200, { data: { ...settings, ...body } });
      }
      return jsonResponse(200, { data: settings });
    }),
  );
}

async function renderScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(
    <ClubSettingsScreen
      locale={locale}
      canManageClub
      club={{ name: STORED.name, initials: "HH", logoUrl: null }}
    />,
  );
  await screen.findByLabelText(/^(Club name|Nombre del club)$/);
}

function nameField(): HTMLElement {
  return screen.getByLabelText("Club name");
}

function hexField(): HTMLElement {
  return screen.getByRole("textbox", { name: "Accent colour" });
}

function suggestedColours(): HTMLElement {
  return screen.getByRole("radiogroup", { name: "Suggested colours" });
}

function suggestedColour(code: string): HTMLElement {
  return within(suggestedColours()).getByRole("radio", { name: code });
}

function preview(): HTMLElement {
  return screen.getByRole("figure", { name: "Preview" });
}

function unsavedBar(): HTMLElement | null {
  return screen.queryByText("Unsaved changes to the club details");
}

/** Los colores con los que la vista previa pinta un acento en cada tema. */
function previewVariablesOf(color: string): Record<string, string> {
  const evaluation = evaluateAccentColor(color);
  if (evaluation.kind !== "accepted") {
    throw new Error(`${color} debería valer como acento.`);
  }
  const { light, dark } = evaluation.palette;
  return {
    "--club-preview-accent-light": light.accent,
    "--club-preview-on-accent-light": light.onAccent,
    "--club-preview-accent-dark": dark.accent,
    "--club-preview-on-accent-dark": dark.onAccent,
    "--club-accent-link-light": light.accentText,
    "--club-accent-link-dark": dark.accentText,
  };
}

beforeEach(() => {
  patches.length = 0;
  refresh.mockClear();
  visit("/club");
  stubScreenWidth(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("General: identidad", () => {
  it("cuenta los caracteres del nombre sobre el máximo", async () => {
    stubApi();
    await renderScreen();

    expect(nameField()).toHaveAccessibleDescription("19 / 60");

    await userEvent.type(nameField(), " FC");

    expect(nameField()).toHaveAccessibleDescription("22 / 60");
  });

  it("dice que el club necesita un nombre y no deja guardar sin él", async () => {
    stubApi();
    await renderScreen();

    await userEvent.clear(nameField());

    expect(nameField()).toHaveAccessibleDescription(/^The club needs a name\./);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("enseña las iniciales automáticas de marcador y la ayuda", async () => {
    stubApi();
    await renderScreen();

    const initials = screen.getByLabelText("Initials · optional");
    expect(initials).toHaveValue("");
    expect(initials).toHaveAttribute("placeholder", "HH");
    expect(initials).toHaveAccessibleDescription(
      "Shown when there's no logo. Up to 3 letters.",
    );
  });

  it("las iniciales de marcador siguen al nombre escrito", async () => {
    stubApi();
    await renderScreen();

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "Bay Sharks");

    expect(screen.getByLabelText("Initials · optional")).toHaveAttribute(
      "placeholder",
      "BS",
    );
  });

  it("habla en español", async () => {
    stubApi();
    await renderScreen("es");

    expect(
      screen.getByRole("heading", { name: "Identidad" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Marca" })).toBeInTheDocument();
    expect(
      screen.getByLabelText("Iniciales · opcional"),
    ).toHaveAccessibleDescription("Se ven cuando no hay logo. Hasta 3 letras.");
    expect(
      screen.getByRole("radiogroup", { name: "Colores sugeridos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("figure", { name: "Vista previa" }),
    ).toBeInTheDocument();
  });
});

describe("General: colores sugeridos", () => {
  it("ofrece los cinco sugeridos, sin ninguno marcado con otro color", async () => {
    stubApi();
    await renderScreen();

    const radios = within(suggestedColours()).getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("value"))).toEqual(
      SUGGESTED_ACCENT_COLORS,
    );
    for (const radio of radios) {
      expect(radio).not.toBeChecked();
    }
  });

  it("marca el sugerido que coincide con el color guardado", async () => {
    stubApi({ ...STORED, accentColor: "#8c7ae6" });
    await renderScreen();

    expect(suggestedColour("#8C7AE6")).toBeChecked();
  });

  it("elegir un sugerido lo pone en el campo y en la vista previa, sin guardar", async () => {
    stubApi();
    await renderScreen();

    await userEvent.click(suggestedColour("#E0A33A"));

    expect(suggestedColour("#E0A33A")).toBeChecked();
    expect(hexField()).toHaveValue("#E0A33A");
    expect(preview()).toHaveStyle(previewVariablesOf("#E0A33A"));
    expect(unsavedBar()).toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it("se elige con las flechas del teclado", async () => {
    stubApi({ ...STORED, accentColor: "#33a1e0" });
    const user = userEvent.setup();
    await renderScreen();

    suggestedColour("#33A1E0").focus();
    await user.keyboard("{ArrowRight}");

    expect(suggestedColour("#2E9E86")).toBeChecked();
    expect(suggestedColour("#2E9E86")).toHaveFocus();
    expect(hexField()).toHaveValue("#2E9E86");
  });

  it("escribir el código de un sugerido lo marca", async () => {
    stubApi();
    await renderScreen();

    await userEvent.clear(hexField());
    await userEvent.type(hexField(), "d9667a");

    expect(suggestedColour("#D9667A")).toBeChecked();
  });

  it("guarda el sugerido elegido con la barra", async () => {
    stubApi();
    await renderScreen();

    await userEvent.click(suggestedColour("#2E9E86"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Saved");
    expect(patches).toMatchObject([{ accentColor: "#2e9e86" }]);
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("General: vista previa", () => {
  it("enseña la cabecera con la marca y el nombre, un botón y un enlace", async () => {
    stubApi();
    await renderScreen();

    const card = preview();
    expect(within(card).getByText("Harbour Hammerheads")).toBeInTheDocument();
    expect(within(card).getByText("HH")).toBeInTheDocument();
    expect(within(card).getByText("Primary button")).toBeInTheDocument();
    expect(within(card).getByText("a link")).toBeInTheDocument();
    expect(card).toHaveStyle(previewVariablesOf("#1c6ea4"));
  });

  it("sigue al nombre y a las iniciales escritos", async () => {
    stubApi();
    await renderScreen();

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "Bay Sharks");
    await userEvent.type(screen.getByLabelText("Initials · optional"), "BAY");

    expect(within(preview()).getByText("Bay Sharks")).toBeInTheDocument();
    expect(within(preview()).getByText("BAY")).toBeInTheDocument();
  });

  it("con un código que no vale, se queda en el color guardado", async () => {
    stubApi();
    await renderScreen();

    await userEvent.clear(hexField());
    await userEvent.type(hexField(), "#12");

    expect(hexField()).toHaveAccessibleDescription("Use a code like #33A1E0.");
    expect(preview()).toHaveStyle(previewVariablesOf("#1c6ea4"));
  });

  it("con un acento guardado sin texto legible, carga con el de por defecto", async () => {
    stubApi({ ...STORED, accentColor: "#777777" });
    await renderScreen();

    expect(hexField()).toHaveValue("#777777");
    expect(preview()).toHaveStyle(previewVariablesOf(DEFAULT_ACCENT_COLOR));
  });

  it("con un color sin texto legible encima, se queda en el guardado", async () => {
    stubApi();
    await renderScreen();

    await userEvent.clear(hexField());
    await userEvent.type(hexField(), "#777777");

    expect(hexField()).toHaveAccessibleDescription(
      /^No text colour reaches the minimum contrast/,
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(preview()).toHaveStyle(previewVariablesOf("#1c6ea4"));
  });
});

describe("General: el logo", () => {
  it("dice cómo tiene que ser el logo y que se guarda al momento", async () => {
    stubApi();
    await renderScreen();

    expect(screen.getByText("No logo yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "PNG or WebP, square, at least 256 px, up to 512 KB. Saves right away.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  it("subir un logo no toca el borrador ni lo da por guardado", async () => {
    stubApi();
    await renderScreen();
    await userEvent.type(nameField(), " FC");

    await userEvent.upload(
      screen.getByLabelText("Choose a logo"),
      new File([new Uint8Array(64)], "logo.png", { type: "image/png" }),
    );

    expect(await screen.findByText("Logo updated.")).toBeInTheDocument();
    expect(nameField()).toHaveValue("Harbour Hammerheads FC");
    expect(unsavedBar()).toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it("subir un logo sin borrador no saca la barra", async () => {
    stubApi();
    await renderScreen();

    await userEvent.upload(
      screen.getByLabelText("Choose a logo"),
      new File([new Uint8Array(64)], "logo.png", { type: "image/png" }),
    );

    expect(await screen.findByText("Logo updated.")).toBeInTheDocument();
    expect(unsavedBar()).not.toBeInTheDocument();
  });

  it("en el móvil el logo va antes que el nombre", async () => {
    stubScreenWidth(true);
    visit("/club?tab=general");
    stubApi();
    await renderScreen();

    const upload = screen.getByRole("button", { name: "Upload" });
    expect(
      upload.compareDocumentPosition(nameField()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("en escritorio el logo va después del color", async () => {
    stubApi();
    await renderScreen();

    const upload = screen.getByRole("button", { name: "Upload" });
    expect(
      hexField().compareDocumentPosition(upload) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
