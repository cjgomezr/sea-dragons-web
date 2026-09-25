import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubSignInTextsSection } from "@/components/club/ClubSignInTextsSection";
import { NO_SIGN_IN_TEXTS, type SignInTexts } from "@/lib/club/sign-in-texts";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La sección de los textos del inicio de sesión en la configuración del club
 * (#301, RF-5 del PRD de E18a): el Admin escribe el lema y el párrafo en cada
 * idioma, un texto demasiado largo se rechaza junto a su campo con el límite,
 * y vaciar un campo lo devuelve al texto de la aplicación. El servidor es un
 * doble que guarda en memoria.
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

async function renderSection(locale: Locale = "en"): Promise<void> {
  render(<ClubSignInTextsSection translate={createTranslator(locale)} />);
  await screen.findByRole("button", {
    name: locale === "en" ? "Save sign-in texts" : "Guardar los textos",
  });
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

async function save(): Promise<void> {
  await userEvent.click(
    screen.getByRole("button", { name: "Save sign-in texts" }),
  );
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
  it("enseña los guardados del club en cada idioma", async () => {
    stored = {
      en: { tagline: "Dive in.", welcome: null },
      es: { tagline: null, welcome: "Entrena con nosotros." },
    };

    await renderSection();

    expect(field("Tagline in English")).toHaveValue("Dive in.");
    expect(field("Welcome paragraph in Spanish")).toHaveValue(
      "Entrena con nosotros.",
    );
    expect(field("Tagline in Spanish")).toHaveValue("");
  });

  it("enseña en cada campo vacío el texto de la aplicación que saldrá", async () => {
    await renderSection();

    expect(field("Tagline in English")).toHaveAttribute(
      "placeholder",
      "Your club, beneath the surface.",
    );
    expect(field("Tagline in Spanish")).toHaveAttribute(
      "placeholder",
      "Tu club, bajo la superficie.",
    );
  });

  it("guarda el lema y el párrafo en los dos idiomas", async () => {
    await renderSection();

    await write("Tagline in English", "Dive in.");
    await write("Welcome paragraph in English", "Train with us.");
    await write("Tagline in Spanish", "Al agua.");
    await write("Welcome paragraph in Spanish", "Entrena con nosotros.");
    await save();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Sign-in texts saved.",
    );
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

    await write("Tagline in English", "");
    await save();

    await screen.findByRole("status");
    expect(puts).toEqual([NO_SIGN_IN_TEXTS]);
  });

  it("rechaza junto al campo un lema de más de 140 caracteres, con el límite", async () => {
    await renderSection();

    await userEvent.click(field("Tagline in Spanish"));
    await userEvent.paste("a".repeat(141));
    await save();

    expect(field("Tagline in Spanish")).toHaveAttribute("aria-invalid", "true");
    expect(field("Tagline in Spanish")).toHaveAccessibleDescription(
      /at most 140 characters/,
    );
    expect(puts).toEqual([]);
  });

  it("rechaza junto al campo un párrafo de más de 320 caracteres, con el límite", async () => {
    await renderSection();

    await userEvent.click(field("Welcome paragraph in English"));
    await userEvent.paste("b".repeat(321));
    await save();

    expect(field("Welcome paragraph in English")).toHaveAccessibleDescription(
      /at most 320 characters/,
    );
    expect(puts).toEqual([]);
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

    await write("Welcome paragraph in Spanish", "Hola");
    await save();

    expect(
      await screen.findByText(/at most 320 characters/),
    ).toBeInTheDocument();
    expect(field("Welcome paragraph in Spanish")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("avisa a quien ya no es Admin de que no puede cambiarlos", async () => {
    nextPutResponse = () =>
      jsonResponse(403, { error: { code: "forbidden", message: "x" } });
    await renderSection();

    await write("Tagline in English", "Dive in.");
    await save();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("habla español a quien eligió español", async () => {
    await renderSection("es");

    expect(field("Lema en español")).toBeInTheDocument();
    expect(field("Párrafo de bienvenida en inglés")).toBeInTheDocument();
  });
});
