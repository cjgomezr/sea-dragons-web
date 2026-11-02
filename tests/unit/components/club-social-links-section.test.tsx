import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubSocialLinksSection } from "@/components/club/ClubSocialLinksSection";
import {
  NO_SOCIAL_LINKS,
  type SocialLinks,
  validateSocialLinks,
} from "@/lib/club/social-links";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La sección Redes de la configuración del club (#963, RF-1 del PRD de
 * E37): seis campos, uno por red, cada uno con su icono. Un enlace que no
 * vale se rechaza junto a su campo, y vaciar un campo quita la red. El
 * servidor es un doble que guarda en memoria y valida como el de verdad.
 */

const LINKS_PATH = "/api/v1/club/settings/social-links";
const INSTAGRAM = "https://www.instagram.com/victoriaseadragons";

let stored: SocialLinks;
let puts: SocialLinks[];
let nextPutResponse: (() => Response) | null;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function respondToPut(body: SocialLinks): Response {
  const validation = validateSocialLinks(body);
  if (validation.kind === "invalid") {
    const [first] = validation.issues;
    return jsonResponse(400, {
      error: {
        code: "validation_error",
        message: "no",
        reason: `${first?.network}.${first?.code}`,
        issues: validation.issues,
      },
    });
  }
  stored = validation.links;
  return jsonResponse(200, { data: stored });
}

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== LINKS_PATH) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      if (init?.method !== "PUT") {
        return jsonResponse(200, { data: stored });
      }
      const body = JSON.parse(String(init.body)) as SocialLinks;
      puts.push(body);
      const response = nextPutResponse;
      nextPutResponse = null;
      return response === null ? respondToPut(body) : response();
    }),
  );
}

async function renderSection(locale: Locale = "en"): Promise<void> {
  render(
    <ClubSocialLinksSection
      translate={createTranslator(locale)}
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

async function save(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

beforeEach(() => {
  stored = NO_SOCIAL_LINKS;
  puts = [];
  nextPutResponse = null;
  stubApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClubSocialLinksSection", () => {
  it("pinta los seis campos en orden, vacíos y con el icono de su red", async () => {
    await renderSection();

    const fields = screen.getAllByRole("textbox");
    expect(fields.map((input) => (input as HTMLInputElement).value)).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    for (const [index, name] of [
      "Instagram",
      "TikTok",
      "YouTube",
      "Facebook",
      "WhatsApp",
      "Website",
    ].entries()) {
      expect(field(name)).toBe(fields[index]);
      const label = document.querySelector(`label[for="${field(name).id}"]`);
      expect(label?.querySelector("svg")).not.toBeNull();
    }
  });

  it("enseña en español los nombres y la web del club", async () => {
    await renderSection("es");

    expect(field("Web del club")).toBeDefined();
    expect(
      screen.getByText(
        "Cualquiera que abra la página de inicio de sesión verá este número.",
      ),
    ).toBeDefined();
  });

  it("enseña lo guardado al cargar", async () => {
    stored = { ...NO_SOCIAL_LINKS, instagram: INSTAGRAM };

    await renderSection();

    expect(field("Instagram")).toHaveProperty("value", INSTAGRAM);
  });

  it("lleva la ayuda de WhatsApp debajo de su campo", async () => {
    await renderSection();

    expect(field("WhatsApp")).toHaveAccessibleDescription(
      "Anyone who opens the sign-in page will see this number.",
    );
  });

  it("saca la barra de cambios sin guardar al escribir", async () => {
    await renderSection();

    await userEvent.type(field("Instagram"), "h");

    expect(screen.getByText("Unsaved changes to social links")).toBeDefined();
  });

  it("guardar manda las seis redes a la API", async () => {
    await renderSection();

    await write("Instagram", INSTAGRAM);
    await save();

    expect(puts).toEqual([{ ...NO_SOCIAL_LINKS, instagram: INSTAGRAM }]);
    expect(await screen.findByText("Saved")).toBeDefined();
  });

  it("vaciar un campo y guardar quita esa red", async () => {
    stored = { ...NO_SOCIAL_LINKS, instagram: INSTAGRAM };
    await renderSection();

    await write("Instagram", "");
    await save();

    expect(puts).toEqual([NO_SOCIAL_LINKS]);
  });

  it.each([
    [
      "Instagram",
      "https://instagram.com.evil.example/x",
      "Paste a link to instagram.com.",
    ],
    ["TikTok", "https://youtube.com/x", "Paste a link to tiktok.com."],
    [
      "WhatsApp",
      "https://chat.whatsapp.com/AbC",
      "Group invite links aren't allowed here: anyone could join. Use a wa.me number or a channel.",
    ],
    [
      "Website",
      "http://seadragons.example",
      "Paste a link that starts with https://.",
    ],
    [
      "Website",
      `https://example.com/${"a".repeat(300)}`,
      "A link can have at most 300 characters.",
    ],
  ])(
    "no guarda %s con %s y lo dice en el campo",
    async (name, url, message) => {
      await renderSection();

      await write(name, url);
      await save();

      expect(puts).toEqual([]);
      expect(field(name)).toHaveAttribute("aria-invalid", "true");
      expect(field(name)).toHaveAccessibleDescription(
        expect.stringContaining(message),
      );
    },
  );

  it("enseña en español el error de dominio", async () => {
    await renderSection("es");

    await write("Instagram", "https://tiktok.com/x");
    await userEvent.click(
      screen.getByRole("button", { name: "Guardar cambios" }),
    );

    expect(screen.getByText("Pega un enlace de instagram.com.")).toBeDefined();
  });

  it("borra el error de un campo al corregirlo", async () => {
    await renderSection();
    await write("Instagram", "https://tiktok.com/x");
    await save();

    await write("Instagram", INSTAGRAM);

    expect(field("Instagram")).toHaveAttribute("aria-invalid", "false");
  });

  it("enseña junto a su campo el error que devuelve el servidor", async () => {
    nextPutResponse = () =>
      jsonResponse(400, {
        error: {
          code: "validation_error",
          message: "no",
          reason: "youtube.wrong_domain",
        },
      });
    await renderSection();

    await write("YouTube", "https://youtu.be/abc");
    await save();

    expect(field("YouTube")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Paste a link to youtube.com.")).toBeDefined();
  });
});
