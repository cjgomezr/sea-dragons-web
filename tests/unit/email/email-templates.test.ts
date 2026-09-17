import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../helpers/wcag-contrast";
import {
  CLUB_NAME,
  type RenderedEmail,
  renderAccountConfirmationEmail,
  renderPasswordRecoveryEmail,
} from "@/lib/email/email-templates";
import {
  REGISTERING_AGAIN_SENDS_A_LINK,
  RESEND_BUTTON_LABEL,
  expectNoneMatch,
} from "../helpers/confirmation-copy";

const RESET_URL =
  "https://victoria-seadragons.vercel.app/recuperar-contrasena/nueva?token_hash=abc";
const CONFIRM_URL =
  "https://victoria-seadragons.vercel.app/auth/confirmar?token_hash=abc&type=signup";
const LIFETIME_MINUTES = 60;

/** Lo que ve alguien cuyo cliente no pinta HTML, sacado del propio HTML: sin
 * etiquetas, con las entidades resueltas y con los espacios aplanados. */
function readableTextOf(html: string): string {
  return flatten(
    html
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&amp;", "&"),
  );
}

function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textLines(email: RenderedEmail): string[] {
  return email.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const TEMPLATES = {
  recuperación: {
    email: renderPasswordRecoveryEmail({
      resetUrl: RESET_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
    }),
    url: RESET_URL,
  },
  confirmación: {
    email: renderAccountConfirmationEmail({
      confirmUrl: CONFIRM_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
    }),
    url: CONFIRM_URL,
  },
} as const;

describe("plantillas de correo", () => {
  it("la de recuperación lleva el enlace y la vigencia", () => {
    const { email } = TEMPLATES.recuperación;

    expect(email.text).toContain(RESET_URL);
    expect(email.text).toContain(`${LIFETIME_MINUTES} minutos`);
    expect(email.html).toContain(`href="${RESET_URL}"`);
    expect(email.html).toContain(`${LIFETIME_MINUTES} minutos`);
  });

  it("la de confirmación lleva el enlace y la vigencia", () => {
    const { email } = TEMPLATES.confirmación;

    expect(email.text).toContain(CONFIRM_URL);
    expect(email.text).toContain(`${LIFETIME_MINUTES} minutos`);
    expect(readableTextOf(email.html)).toContain(CONFIRM_URL);
    expect(email.html).toContain(`${LIFETIME_MINUTES} minutos`);
  });

  // Un enlace nuevo lo emite el botón de reenvío de la pantalla de
  // confirmación. Registrarse otra vez no emite ninguno: el servidor sale por
  // `already_registered` a propósito (#147), así que el correo que mandaba a
  // la pantalla de registro mandaba a ninguna parte (#179).
  it("la de confirmación nombra el botón de reenviar para pedir otro enlace", () => {
    const { email } = TEMPLATES.confirmación;

    expect(email.text).toContain(RESEND_BUTTON_LABEL.es);
    expect(readableTextOf(email.html)).toContain(RESEND_BUTTON_LABEL.es);
  });

  it("la de confirmación no promete que registrarse otra vez mande otro enlace", () => {
    const { email } = TEMPLATES.confirmación;

    expectNoneMatch(
      email.text,
      REGISTERING_AGAIN_SENDS_A_LINK,
      "el correo de confirmación",
    );
  });

  it.each(Object.entries(TEMPLATES))(
    "la de %s dice quién la manda, en el asunto y en el cuerpo",
    (_name, { email }) => {
      expect(email.subject).toContain(CLUB_NAME);
      expect(email.text).toContain(CLUB_NAME);
      expect(email.html).toContain(CLUB_NAME);
    },
  );

  it.each(Object.entries(TEMPLATES))(
    "la de %s tiene versión en texto plano, sin una sola etiqueta",
    (_name, { email }) => {
      expect(email.text.length).toBeGreaterThan(0);
      expect(email.text).not.toMatch(/<[a-z!/][^>]*>/i);
    },
  );

  // "Se lee igual" no es que el texto exista: es que no le falte nada a quien
  // sólo ve el texto, ni al revés.
  it.each(Object.entries(TEMPLATES))(
    "la de %s dice lo mismo en texto plano que en HTML",
    (_name, { email }) => {
      const htmlText = readableTextOf(email.html);

      for (const line of textLines(email)) {
        expect(htmlText, `falta en el HTML: ${line}`).toContain(flatten(line));
      }
    },
  );

  it("escapa el enlace dentro del HTML y lo deja tal cual en el texto", () => {
    const { email } = TEMPLATES.confirmación;

    expect(email.html).toContain("token_hash=abc&amp;type=signup");
    expect(email.html).not.toContain("token_hash=abc&type=signup");
    expect(email.text).toContain("token_hash=abc&type=signup");
  });

  it("no deja que un enlace con comillas rompa el atributo", () => {
    const email = renderPasswordRecoveryEmail({
      resetUrl: 'https://example.test/?x="><script>',
      linkLifetimeMinutes: LIFETIME_MINUTES,
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

const MAX_EMAIL_WIDTH_PX = 600;
const WCAG_AA_NORMAL_TEXT = 4.5;

/** El correo se lee en tema claro: los clientes de correo no saben del
 * `data-theme` de la aplicación. */
const lightThemeSection = readFileSync(
  join(process.cwd(), "design-system.md"),
  "utf-8",
)
  .split("#### Light theme")[1]
  ?.split("####")[0];

function lightThemeToken(role: string): string {
  if (lightThemeSection === undefined) {
    throw new Error("Light theme section not found in design-system.md");
  }
  const row = new RegExp(
    `^\\|\\s*${role}\\s*\\|\\s*\`(#[0-9A-Fa-f]{6})\``,
    "m",
  );
  const value = row.exec(lightThemeSection)?.[1];
  if (value === undefined) {
    throw new Error(`Missing light theme token: ${role}`);
  }
  return value;
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function linksTo(document: Document, url: string): HTMLAnchorElement[] {
  return [...document.querySelectorAll("a")].filter(
    (link) => link.getAttribute("href") === url,
  );
}

/** El botón es el enlace a la acción cuyo texto no es la propia URL. */
function buttonOf(email: RenderedEmail, url: string): HTMLAnchorElement {
  const button = linksTo(parseHtml(email.html), url).find(
    (link) => flatten(link.textContent) !== url,
  );
  if (button === undefined) {
    throw new Error("El HTML no tiene un botón que apunte al enlace");
  }
  return button;
}

function inlineColor(element: Element, property: string): string | undefined {
  const style = element.getAttribute("style") ?? "";
  const match = new RegExp(
    `(?:^|;)\\s*${property}\\s*:\\s*(#[0-9A-Fa-f]{6})`,
  ).exec(style);
  return match?.[1]?.toUpperCase();
}

describe("formato del correo", () => {
  it.each(Object.entries(TEMPLATES))(
    "la de %s abre con una cabecera que lleva el nombre del club",
    (_name, { email }) => {
      expect(readableTextOf(email.html).startsWith(CLUB_NAME)).toBe(true);
    },
  );

  it.each(Object.entries(TEMPLATES))(
    "la de %s lleva un botón con la acción que apunta al enlace",
    (_name, { email, url }) => {
      const button = buttonOf(email, url);

      expect(flatten(button.textContent).length).toBeGreaterThan(0);
    },
  );

  // Outlook de escritorio pinta con el motor de Word e ignora `max-width`:
  // sólo un ancho fijo en una tabla que sólo él lee le pone el tope.
  it.each(Object.entries(TEMPLATES))(
    "la de %s limita el ancho a 600 píxeles también en Outlook",
    (_name, { email }) => {
      expect(email.html).toMatch(
        new RegExp(
          `<!--\\[if mso\\]><table[^>]*\\bwidth="${MAX_EMAIL_WIDTH_PX}"[^>]*>`,
        ),
      );
    },
  );

  it.each(Object.entries(TEMPLATES))(
    "el relleno del botón de la de %s va en la celda, que Outlook sí respeta",
    (_name, { email, url }) => {
      const cell = buttonOf(email, url).closest("td");

      expect(cell?.getAttribute("style")).toMatch(/\bpadding\s*:/);
    },
  );

  it.each(Object.entries(TEMPLATES))(
    "la de %s deja debajo del botón el enlace escrito entero",
    (_name, { email, url }) => {
      const document = parseHtml(email.html);
      const button = buttonOf(email, url);
      const writtenLink = linksTo(document, url).find(
        (link) => flatten(link.textContent) === url,
      );

      expect(writtenLink).toBeDefined();
      expect(
        button.compareDocumentPosition(writtenLink as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it.each(Object.entries(TEMPLATES))(
    "la de %s se maqueta con tablas y estilos en línea, a 600 píxeles como mucho",
    (_name, { email }) => {
      const document = parseHtml(email.html);
      const widths = [...document.querySelectorAll("table")]
        .map((table) =>
          /max-width:\s*(\d+)px/.exec(table.getAttribute("style") ?? ""),
        )
        .flatMap((match) =>
          match?.[1] === undefined ? [] : [Number(match[1])],
        );

      expect(document.querySelectorAll("table").length).toBeGreaterThan(0);
      expect(document.querySelector("style")).toBeNull();
      expect(widths).toContain(MAX_EMAIL_WIDTH_PX);
      expect(Math.max(...widths)).toBeLessThanOrEqual(MAX_EMAIL_WIDTH_PX);
    },
  );

  it.each(Object.entries(TEMPLATES))(
    "la de %s no carga nada de fuera",
    (_name, { email }) => {
      expect(email.html).not.toMatch(/<link\b/i);
      expect(email.html).not.toMatch(/@import/i);
      expect(email.html).not.toMatch(
        /<img\b[^>]*\bsrc\s*=\s*["']?(https?:)?\/\//i,
      );
      expect(email.html).not.toMatch(/url\s*\(/i);
    },
  );

  it.each(Object.entries(TEMPLATES))(
    "el botón de la de %s usa el acento y el texto sobre acento del sistema de diseño",
    (_name, { email, url }) => {
      const button = buttonOf(email, url);
      const cell = button.closest("td");

      expect(cell).not.toBeNull();
      expect(inlineColor(cell as Element, "background-color")).toBe(
        lightThemeToken("Accent").toUpperCase(),
      );
      expect(cell?.getAttribute("bgcolor")?.toUpperCase()).toBe(
        lightThemeToken("Accent").toUpperCase(),
      );
      expect(inlineColor(button, "color")).toBe(
        lightThemeToken("Text on accent").toUpperCase(),
      );
    },
  );

  it("el texto del botón cumple AA sobre su fondo", () => {
    expect(
      contrastRatio(
        lightThemeToken("Text on accent"),
        lightThemeToken("Accent"),
      ),
    ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it("escapa un enlace con caracteres especiales en el botón y en el enlace escrito", () => {
    const { email } = TEMPLATES.confirmación;
    const escapedHref =
      'href="https://victoria-seadragons.vercel.app/auth/confirmar?token_hash=abc&amp;type=signup"';

    expect(email.html.split(escapedHref).length - 1).toBe(2);
    expect(linksTo(parseHtml(email.html), CONFIRM_URL)).toHaveLength(2);
  });

  it("no deja que un enlace con comillas rompa el botón", () => {
    const email = renderPasswordRecoveryEmail({
      resetUrl: 'https://example.test/?x="><script>',
      linkLifetimeMinutes: LIFETIME_MINUTES,
    });

    expect(
      email.html.match(/&quot;&gt;&lt;script&gt;/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(parseHtml(email.html).querySelector("script")).toBeNull();
  });
});
