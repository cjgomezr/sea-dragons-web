import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClubIdentity } from "@/components/club/ClubSettingsList";
import { ClubSignInTextsSection } from "@/components/club/ClubSignInTextsSection";
import { NO_SIGN_IN_TEXTS, type SignInTexts } from "@/lib/club/sign-in-texts";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La sección de los textos del inicio de sesión en la configuración del club
 * (#301, RF-5 del PRD de E18a; rehecha en #721, RF-4 del de E26): el Admin
 * escribe el titular y el párrafo de un idioma a la vez, con contadores y una
 * vista previa; un texto demasiado largo se rechaza junto a su campo con el
 * límite, y vaciar un campo lo devuelve al texto de la aplicación. El
 * servidor es un doble que guarda en memoria.
 */

const TEXTS_PATH = "/api/v1/club/settings/sign-in-texts";

let stored: SignInTexts;
let puts: unknown[];
let nextPutResponse: (() => Response) | null;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function normalize(texts: SignInTexts): SignInTexts {
  const blankAsNull = (text: string | null): string | null =>
    text === null || text.trim() === "" ? null : text.trim();
  return {
    en: {
      tagline: blankAsNull(texts.en.tagline),
      welcome: blankAsNull(texts.en.welcome),
    },
    es: {
      tagline: blankAsNull(texts.es.tagline),
      welcome: blankAsNull(texts.es.welcome),
    },
  };
}

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== TEXTS_PATH) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as SignInTexts;
        puts.push(body);
        const response = nextPutResponse;
        nextPutResponse = null;
        if (response !== null) {
          return response();
        }
        stored = normalize(body);
        return jsonResponse(200, { data: stored });
      }
      return jsonResponse(200, { data: stored });
    }),
  );
}

const CLUB: ClubIdentity = {
  name: "Victoria Seadragons",
  initials: "VS",
  logoUrl: null,
};

async function renderSection(locale: Locale = "en"): Promise<void> {
  render(
    <ClubSignInTextsSection
      locale={locale}
      translate={createTranslator(locale)}
      club={CLUB}
      onHasDraftChange={() => undefined}
    />,
  );
  await screen.findAllByRole("textbox");
}

function field(name: string): HTMLElement {
  return screen.getByRole("textbox", { name });
}

async function write(name: string, text: string): Promise<void> {
  await userEvent.clear(field(name));
  if (text !== "") {
    await userEvent.type(field(name), text);
  }
}

/** El control Inglés | Español de la sección (RF-4 del PRD de E26). */
async function chooseLanguage(name: string): Promise<void> {
  await userEvent.click(screen.getByRole("radio", { name }));
}

/** La tarjeta de la vista previa, por su rótulo. */
function preview(caption: RegExp): HTMLElement {
  return screen.getByRole("figure", { name: caption });
}

/** Guardar cambios, en la barra que sale con un cambio (#719). */
function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save changes" });
}

async function save(): Promise<void> {
  await userEvent.click(saveButton());
}

beforeEach(() => {
  stored = NO_SIGN_IN_TEXTS;
  puts = [];
  nextPutResponse = null;
  stubApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("textos del inicio de sesión en la configuración", () => {
  it("abre en el idioma de la pantalla, con el control Inglés | Español", async () => {
    await renderSection("es");

    expect(
      screen.getByRole("radiogroup", { name: "Idioma de los textos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Español" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Inglés" })).not.toBeChecked();
  });

  it("enseña sólo los campos del idioma elegido, con lo guardado", async () => {
    stored = {
      en: { tagline: "Dive in.", welcome: null },
      es: { tagline: null, welcome: "Entrena con nosotros." },
    };
    await renderSection();

    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(field("Headline")).toHaveValue("Dive in.");
    expect(field("Welcome paragraph")).toHaveValue("");

    await chooseLanguage("Spanish");

    expect(field("Headline")).toHaveValue("");
    expect(field("Welcome paragraph")).toHaveValue("Entrena con nosotros.");
  });

  it("pone de marcador el texto de la aplicación en el idioma elegido", async () => {
    await renderSection();

    expect(field("Headline")).toHaveAttribute(
      "placeholder",
      "Your club, beneath the surface.",
    );

    await chooseLanguage("Spanish");

    expect(field("Headline")).toHaveAttribute(
      "placeholder",
      "Tu club, bajo la superficie.",
    );
    expect(field("Welcome paragraph")).toHaveAttribute(
      "placeholder",
      expect.stringMatching(/^Entrenamientos, equipos/),
    );
  });

  it("da al párrafo cinco filas", async () => {
    await renderSection();

    expect(field("Welcome paragraph")).toHaveAttribute("rows", "5");
  });

  it("cuenta los caracteres de cada campo contra su límite", async () => {
    stored = {
      en: { tagline: "Dive in.", welcome: null },
      es: { tagline: null, welcome: null },
    };
    await renderSection();

    expect(field("Headline")).toHaveAccessibleDescription("8 / 140");
    expect(field("Welcome paragraph")).toHaveAccessibleDescription("0 / 320");

    await userEvent.type(field("Welcome paragraph"), "Hola 🤿");

    expect(field("Welcome paragraph")).toHaveAccessibleDescription("6 / 320");
  });

  it("dice si el otro idioma usa el texto de la aplicación", async () => {
    await renderSection();

    expect(
      screen.getByText("Spanish uses the app's text."),
    ).toBeInTheDocument();
  });

  it("dice si el otro idioma tiene su propio texto, también sin guardar", async () => {
    await renderSection();
    await chooseLanguage("Spanish");
    await write("Welcome paragraph", "Entrena con nosotros.");

    await chooseLanguage("English");

    expect(screen.getByText("Spanish has its own text.")).toBeInTheDocument();
  });

  it("habla del inglés cuando el elegido es el español", async () => {
    stored = {
      en: { tagline: "Dive in.", welcome: null },
      es: { tagline: null, welcome: null },
    };
    await renderSection("es");

    expect(
      screen.getByText("Inglés tiene su propio texto."),
    ).toBeInTheDocument();
  });

  it("conserva el borrador de los dos idiomas al cambiar de uno a otro", async () => {
    await renderSection();
    await write("Headline", "Dive in.");

    await chooseLanguage("Spanish");
    await write("Headline", "Al agua.");
    await chooseLanguage("English");

    expect(field("Headline")).toHaveValue("Dive in.");
    await chooseLanguage("Spanish");
    expect(field("Headline")).toHaveValue("Al agua.");
  });

  it("enseña en la vista previa la marca del club y el texto de la aplicación sin texto propio", async () => {
    await renderSection();

    const card = preview(/^Sign-in page · EN$/);

    expect(within(card).getByText("VS")).toBeInTheDocument();
    expect(
      within(card).getByText("Your club, beneath the surface."),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/^Training, teams, assessments and fees\./),
    ).toBeInTheDocument();
  });

  it("enseña en la vista previa lo que se escribe, en el idioma elegido", async () => {
    await renderSection();
    await chooseLanguage("Spanish");

    await write("Headline", "Al agua.");

    const card = preview(/^Sign-in page · ES$/);
    expect(within(card).getByText("Al agua.")).toBeInTheDocument();
    expect(
      within(card).getByText(/^Entrenamientos, equipos/),
    ).toBeInTheDocument();
  });

  it("guarda el lema y el párrafo en los dos idiomas", async () => {
    await renderSection();

    await write("Headline", "Dive in.");
    await write("Welcome paragraph", "Train with us.");
    await chooseLanguage("Spanish");
    await write("Headline", "Al agua.");
    await write("Welcome paragraph", "Entrena con nosotros.");
    await save();

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(puts).toEqual([
      {
        en: { tagline: "Dive in.", welcome: "Train with us." },
        es: { tagline: "Al agua.", welcome: "Entrena con nosotros." },
      },
    ]);
  });

  it("manda un campo vaciado como ninguno, para que vuelva el de la aplicación", async () => {
    stored = {
      en: { tagline: "Dive in.", welcome: null },
      es: { tagline: null, welcome: null },
    };
    await renderSection();

    await write("Headline", "");
    await save();

    await screen.findByText("Saved");
    expect(puts).toEqual([NO_SIGN_IN_TEXTS]);
  });

  it("rechaza junto al campo un titular de más de 140 caracteres, con el límite", async () => {
    await renderSection();
    await chooseLanguage("Spanish");

    await userEvent.click(field("Headline"));
    await userEvent.paste("a".repeat(141));

    expect(saveButton()).toBeDisabled();
    expect(field("Headline")).toHaveAttribute("aria-invalid", "true");
    expect(field("Headline")).toHaveAccessibleDescription(
      /^The headline can have at most 140 characters\. 141 \/ 140$/,
    );
    expect(puts).toEqual([]);
  });

  it("rechaza junto al campo un párrafo de más de 320 caracteres, con el límite", async () => {
    await renderSection();

    await userEvent.click(field("Welcome paragraph"));
    await userEvent.paste("b".repeat(321));

    expect(saveButton()).toBeDisabled();
    expect(field("Welcome paragraph")).toHaveAccessibleDescription(
      /at most 320 characters/,
    );
    expect(puts).toEqual([]);
  });

  it("no deja guardar con el idioma oculto por encima del límite", async () => {
    await renderSection();
    await userEvent.click(field("Headline"));
    await userEvent.paste("a".repeat(141));

    await chooseLanguage("Spanish");

    expect(saveButton()).toBeDisabled();
  });

  it("avisa de que el idioma oculto se pasa del límite", async () => {
    await renderSection();
    await userEvent.click(field("Headline"));
    await userEvent.paste("a".repeat(141));

    await chooseLanguage("Spanish");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "English has a text over the limit.",
    );
  });

  it("avisa del límite que rechazó el servidor en el idioma oculto", async () => {
    nextPutResponse = () =>
      jsonResponse(400, {
        error: {
          code: "validation_error",
          message: "x",
          reason: "es.welcome_too_long",
        },
      });
    await renderSection();

    await write("Headline", "Dive in.");
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Spanish has a text over the limit.",
    );
  });

  it("pone junto a su campo el límite que rechazó el servidor", async () => {
    nextPutResponse = () =>
      jsonResponse(400, {
        error: {
          code: "validation_error",
          message: "x",
          reason: "es.welcome_too_long",
        },
      });
    await renderSection();
    await chooseLanguage("Spanish");

    await write("Welcome paragraph", "Hola");
    await save();

    expect(
      await screen.findByText(/at most 320 characters/),
    ).toBeInTheDocument();
    expect(field("Welcome paragraph")).toHaveAttribute("aria-invalid", "true");
  });

  it("avisa a quien ya no es Admin de que no puede cambiarlos", async () => {
    nextPutResponse = () =>
      jsonResponse(403, { error: { code: "forbidden", message: "x" } });
    await renderSection();

    await write("Headline", "Dive in.");
    await save();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("habla español a quien eligió español", async () => {
    await renderSection("es");

    expect(field("Titular")).toBeInTheDocument();
    expect(field("Párrafo de bienvenida")).toBeInTheDocument();
    expect(preview(/^Página de inicio de sesión · ES$/)).toBeInTheDocument();
  });
});
