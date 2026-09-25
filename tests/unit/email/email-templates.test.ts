import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ClubBrand, DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";
import { NO_SIGN_IN_TEXTS } from "@/lib/club/sign-in-texts";
import type { Locale } from "@/lib/i18n/locale";
import { contrastRatio } from "../helpers/wcag-contrast";
import {
  type RenderedEmail,
  renderAccountConfirmationEmail,
  renderMemberInvitationEmail,
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
const INVITATION_URL =
  "https://victoria-seadragons.vercel.app/recuperar-contrasena/nueva?token_hash=inv";
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
      locale: "es",
      brand: DEFAULT_CLUB_BRAND,
    }),
    url: RESET_URL,
  },
  confirmación: {
    email: renderAccountConfirmationEmail({
      confirmUrl: CONFIRM_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
      locale: "es",
      brand: DEFAULT_CLUB_BRAND,
    }),
    url: CONFIRM_URL,
  },
  invitación: {
    email: renderMemberInvitationEmail({
      acceptUrl: INVITATION_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
      locale: "es",
      brand: DEFAULT_CLUB_BRAND,
    }),
    url: INVITATION_URL,
  },
} as const;

const ENGLISH_TEMPLATES = {
  recovery: {
    email: renderPasswordRecoveryEmail({
      resetUrl: RESET_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
      locale: "en",
      brand: DEFAULT_CLUB_BRAND,
    }),
    url: RESET_URL,
  },
  confirmation: {
    email: renderAccountConfirmationEmail({
      confirmUrl: CONFIRM_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
      locale: "en",
      brand: DEFAULT_CLUB_BRAND,
    }),
    url: CONFIRM_URL,
  },
  invitation: {
    email: renderMemberInvitationEmail({
      acceptUrl: INVITATION_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
      locale: "en",
      brand: DEFAULT_CLUB_BRAND,
    }),
    url: INVITATION_URL,
  },
} as const;

/** El formato no puede depender del idioma: cada caso de forma corre sobre
 * las cuatro plantillas. */
const ALL_TEMPLATES = { ...TEMPLATES, ...ENGLISH_TEMPLATES } as const;

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

  it.each(Object.entries(ALL_TEMPLATES))(
    "la de %s dice quién la manda, en el asunto y en el cuerpo",
    (_name, { email }) => {
      expect(email.subject).toContain(DEFAULT_CLUB_BRAND.name);
      expect(email.text).toContain(DEFAULT_CLUB_BRAND.name);
      expect(email.html).toContain(DEFAULT_CLUB_BRAND.name);
    },
  );

  it.each(Object.entries(ALL_TEMPLATES))(
    "la de %s tiene versión en texto plano, sin una sola etiqueta",
    (_name, { email }) => {
      expect(email.text.length).toBeGreaterThan(0);
      expect(email.text).not.toMatch(/<[a-z!/][^>]*>/i);
    },
  );

  // "Se lee igual" no es que el texto exista: es que no le falte nada a quien
  // sólo ve el texto, ni al revés.
  it.each(Object.entries(ALL_TEMPLATES))(
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
      locale: "es",
      brand: DEFAULT_CLUB_BRAND,
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("invitación", () => {
  it("sale en español con su asunto, el enlace y la vigencia", () => {
    const { email } = TEMPLATES.invitación;

    expect(email.subject).toBe("Te invitaron a Victoria Seadragons");
    expect(email.text).toContain(INVITATION_URL);
    expect(email.text).toContain(`${LIFETIME_MINUTES} minutos`);
    expect(email.html).toContain(`href="${INVITATION_URL}"`);
    expect(email.html).toContain("Activar mi cuenta");
  });

  it("sale en inglés con su asunto, el enlace y la vigencia", () => {
    const { email } = ENGLISH_TEMPLATES.invitation;

    expect(email.subject).toBe("You're invited to Victoria Seadragons");
    expect(email.text).toContain(INVITATION_URL);
    expect(email.text).toContain(`${LIFETIME_MINUTES} minutes`);
    expect(email.html).toContain("Activate my account");
    expect(email.text).not.toContain("contraseña");
  });

  it("explica que el enlace lleva a elegir contraseña y a completar el registro", () => {
    const { email } = TEMPLATES.invitación;

    expect(email.text).toMatch(/elige una contraseña/i);
    expect(email.text).toMatch(/completa tu registro/i);
  });

  it("dice a quién pedir otro enlace si caduca", () => {
    expect(TEMPLATES.invitación.email.text).toMatch(
      /pide al club que te reenvíe la invitación/i,
    );
    expect(ENGLISH_TEMPLATES.invitation.email.text).toMatch(
      /ask the club to resend your invitation/i,
    );
  });
});

describe("plantillas en dos idiomas", () => {
  it("la de recuperación sale en inglés, asunto incluido", () => {
    const { email } = ENGLISH_TEMPLATES.recovery;

    expect(email.subject).toBe("Reset your Victoria Seadragons password");
    expect(email.text).toContain(`${LIFETIME_MINUTES} minutes`);
    expect(email.html).toContain("Choose a new password");
    expect(email.text).not.toContain("contraseña");
  });

  it("la de confirmación sale en inglés, asunto incluido", () => {
    const { email } = ENGLISH_TEMPLATES.confirmation;

    expect(email.subject).toBe("Confirm your email for Victoria Seadragons");
    expect(email.text).toContain(`${LIFETIME_MINUTES} minutes`);
    expect(email.html).toContain("Confirm my email");
    expect(email.text).not.toContain("correo");
  });

  it("las de español conservan el asunto de siempre", () => {
    expect(TEMPLATES.recuperación.email.subject).toBe(
      "Recupera tu contraseña de Victoria Seadragons",
    );
    expect(TEMPLATES.confirmación.email.subject).toBe(
      "Confirma tu correo en Victoria Seadragons",
    );
  });

  it.each(Object.entries(ENGLISH_TEMPLATES))(
    "la de %s en inglés lleva el enlace intacto, en el botón y escrito",
    (_name, { email, url }) => {
      expect(email.text).toContain(url);
      expect(linksTo(parseHtml(email.html), url)).toHaveLength(2);
    },
  );

  it("la de confirmación en inglés nombra el botón de reenviar con su nombre en inglés", () => {
    const { email } = ENGLISH_TEMPLATES.confirmation;

    expect(email.text).toContain(RESEND_BUTTON_LABEL.en);
    expect(readableTextOf(email.html)).toContain(RESEND_BUTTON_LABEL.en);
    expectNoneMatch(
      email.text,
      REGISTERING_AGAIN_SENDS_A_LINK,
      "el correo de confirmación en inglés",
    );
  });

  it("la firma del club sale en el idioma del correo", () => {
    expect(ENGLISH_TEMPLATES.recovery.email.text).toContain(
      "Victoria Seadragons, underwater rugby club in Melbourne.",
    );
    expect(TEMPLATES.recuperación.email.text).toContain(
      "Victoria Seadragons, club de rugby subacuático de Melbourne.",
    );
  });

  it.each([
    ["es", TEMPLATES.recuperación.email],
    ["en", ENGLISH_TEMPLATES.recovery.email],
  ] as const)(
    "el documento declara el idioma en que está escrito (%s)",
    (locale, email) => {
      expect(parseHtml(email.html).documentElement.lang).toBe(locale);
    },
  );
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
  it.each(Object.entries(ALL_TEMPLATES))(
    "la de %s abre con una cabecera que lleva el nombre del club",
    (_name, { email }) => {
      expect(
        readableTextOf(email.html).startsWith(DEFAULT_CLUB_BRAND.name),
      ).toBe(true);
    },
  );

  it.each(Object.entries(ALL_TEMPLATES))(
    "la de %s lleva un botón con la acción que apunta al enlace",
    (_name, { email, url }) => {
      const button = buttonOf(email, url);

      expect(flatten(button.textContent).length).toBeGreaterThan(0);
    },
  );

  // Outlook de escritorio pinta con el motor de Word e ignora `max-width`:
  // sólo un ancho fijo en una tabla que sólo él lee le pone el tope.
  it.each(Object.entries(ALL_TEMPLATES))(
    "la de %s limita el ancho a 600 píxeles también en Outlook",
    (_name, { email }) => {
      expect(email.html).toMatch(
        new RegExp(
          `<!--\\[if mso\\]><table[^>]*\\bwidth="${MAX_EMAIL_WIDTH_PX}"[^>]*>`,
        ),
      );
    },
  );

  it.each(Object.entries(ALL_TEMPLATES))(
    "el relleno del botón de la de %s va en la celda, que Outlook sí respeta",
    (_name, { email, url }) => {
      const cell = buttonOf(email, url).closest("td");

      expect(cell?.getAttribute("style")).toMatch(/\bpadding\s*:/);
    },
  );

  it.each(Object.entries(ALL_TEMPLATES))(
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

  it.each(Object.entries(ALL_TEMPLATES))(
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

  it.each(Object.entries(ALL_TEMPLATES))(
    "sin logo, la de %s no carga nada de fuera",
    (_name, { email }) => {
      expect(email.html).not.toMatch(/<link\b/i);
      expect(email.html).not.toMatch(/@import/i);
      expect(email.html).not.toMatch(
        /<img\b[^>]*\bsrc\s*=\s*["']?(https?:)?\/\//i,
      );
      expect(email.html).not.toMatch(/url\s*\(/i);
    },
  );

  it.each(Object.entries(ALL_TEMPLATES))(
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
      locale: "es",
      brand: DEFAULT_CLUB_BRAND,
    });

    expect(
      email.html.match(/&quot;&gt;&lt;script&gt;/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(parseHtml(email.html).querySelector("script")).toBeNull();
  });
});

const STORED_BRAND: ClubBrand = {
  name: "Hobart Orcas",
  initials: "HO",
  accentColor: "#7A2E8C",
  logoUrl: null,
  signInTexts: NO_SIGN_IN_TEXTS,
};
const PUBLIC_LOGO_URL =
  "https://abc.supabase.co/storage/v1/object/public/club-logos/club/logo.png";
const ACCENT_ON_WHITE = "#FFFFFF";

type BrandedRender = (brand: ClubBrand, locale: Locale) => RenderedEmail;

const BRANDED_RENDERS: Readonly<Record<string, BrandedRender>> = {
  recuperación: (brand, locale) =>
    renderPasswordRecoveryEmail({
      resetUrl: RESET_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
      locale,
      brand,
    }),
  confirmación: (brand, locale) =>
    renderAccountConfirmationEmail({
      confirmUrl: CONFIRM_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
      locale,
      brand,
    }),
  invitación: (brand, locale) =>
    renderMemberInvitationEmail({
      acceptUrl: INVITATION_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
      locale,
      brand,
    }),
};

const BRANDED_CASES = Object.entries(BRANDED_RENDERS).flatMap(
  ([name, render]) =>
    (["es", "en"] as const).map((locale) => [name, locale, render] as const),
);

function headerOf(email: RenderedEmail): HTMLTableCellElement {
  const header = parseHtml(email.html).querySelector("td");
  if (header === null) {
    throw new Error("El correo no tiene cabecera");
  }
  // La primera celda es la del fondo; la cabecera es la primera de la tarjeta.
  const card = header.querySelector("table td");
  if (card === null) {
    throw new Error("El correo no tiene tarjeta");
  }
  return card as HTMLTableCellElement;
}

function buttonCellOf(email: RenderedEmail): Element {
  const cell = buttonOf(email, CONFIRM_URL).closest("td");
  if (cell === null) {
    throw new Error("El botón no va en una celda");
  }
  return cell;
}

describe("la marca en los correos", () => {
  it.each(BRANDED_CASES)(
    "la de %s en %s lleva el nombre guardado en el asunto, la cabecera y la firma",
    (_name, locale, render) => {
      const email = render(STORED_BRAND, locale);

      expect(email.subject).toContain(STORED_BRAND.name);
      expect(flatten(headerOf(email).textContent)).toBe(STORED_BRAND.name);
      expect(textLines(email).at(-1)).toContain(STORED_BRAND.name);
      expect(email.html).not.toContain(DEFAULT_CLUB_BRAND.name);
      expect(email.text).not.toContain(DEFAULT_CLUB_BRAND.name);
    },
  );

  it("la cabecera y el botón usan el acento del club", () => {
    const email = BRANDED_RENDERS.confirmación?.(STORED_BRAND, "es");
    if (email === undefined) {
      throw new Error("Falta la plantilla de confirmación");
    }
    const cell = buttonCellOf(email);

    expect(headerOf(email).getAttribute("style")).toContain(
      STORED_BRAND.accentColor.toLowerCase(),
    );
    expect(inlineColor(cell, "background-color")).toBe(
      STORED_BRAND.accentColor,
    );
    expect(cell.getAttribute("bgcolor")?.toUpperCase()).toBe(
      STORED_BRAND.accentColor,
    );
    expect(inlineColor(buttonOf(email, CONFIRM_URL), "color")).toBe(
      ACCENT_ON_WHITE,
    );
  });

  it.each(BRANDED_CASES)(
    "con logo, la cabecera de la de %s en %s lo enseña con el nombre como texto alternativo",
    (_name, locale, render) => {
      const email = render(
        { ...STORED_BRAND, logoUrl: PUBLIC_LOGO_URL },
        locale,
      );
      const logo = headerOf(email).querySelector("img");

      expect(logo?.getAttribute("src")).toBe(PUBLIC_LOGO_URL);
      expect(logo?.getAttribute("alt")).toBe(STORED_BRAND.name);
    },
  );

  it("con logo, lo único que se carga de fuera es el logo", () => {
    const email = renderPasswordRecoveryEmail({
      resetUrl: RESET_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
      locale: "es",
      brand: { ...STORED_BRAND, logoUrl: PUBLIC_LOGO_URL },
    });
    const sources = [...parseHtml(email.html).querySelectorAll("img")].map(
      (image) => image.getAttribute("src"),
    );

    expect(sources).toEqual([PUBLIC_LOGO_URL]);
    expect(email.html).not.toMatch(/<link\b/i);
    expect(email.html).not.toMatch(/url\s*\(/i);
  });

  it("sin logo, la cabecera enseña el nombre y ninguna imagen", () => {
    const email = BRANDED_RENDERS.invitación?.(STORED_BRAND, "en");
    if (email === undefined) {
      throw new Error("Falta la plantilla de invitación");
    }

    expect(headerOf(email).querySelector("img")).toBeNull();
    expect(readableTextOf(email.html).startsWith(STORED_BRAND.name)).toBe(true);
  });

  // Un cliente de correo no resuelve una ruta relativa ni inicia sesión, y
  // `http:` lo bloquean casi todos: sin dirección pública se pinta el nombre.
  it.each(["/storage/club/logo.png", "http://abc.supabase.co/logo.png"])(
    "con un logo que no es una dirección https absoluta (%s), la cabecera enseña el nombre",
    (logoUrl) => {
      const email = renderPasswordRecoveryEmail({
        resetUrl: RESET_URL,
        linkLifetimeMinutes: LIFETIME_MINUTES,
        locale: "es",
        brand: { ...STORED_BRAND, logoUrl },
      });

      expect(headerOf(email).querySelector("img")).toBeNull();
      expect(flatten(headerOf(email).textContent)).toBe(STORED_BRAND.name);
    },
  );

  // #341: el amarillo del prototipo rellena el botón, pero sobre la tarjeta
  // blanca el enlace escrito lleva su variante oscurecida.
  it("con un acento claro, el botón lleva el color tal cual y el enlace escrito uno que se lee", () => {
    const lightAccent = "#FFC94A";
    const email = renderAccountConfirmationEmail({
      confirmUrl: CONFIRM_URL,
      linkLifetimeMinutes: LIFETIME_MINUTES,
      locale: "es",
      brand: { ...STORED_BRAND, accentColor: lightAccent },
    });
    const writtenLink = linksTo(parseHtml(email.html), CONFIRM_URL).find(
      (link) => flatten(link.textContent) === CONFIRM_URL,
    );
    const linkColor = writtenLink && inlineColor(writtenLink, "color");

    expect(inlineColor(buttonCellOf(email), "background-color")).toBe(
      lightAccent,
    );
    expect(linkColor).toBeDefined();
    expect(linkColor).not.toBe(lightAccent);
    expect(contrastRatio(linkColor ?? "", "#FFFFFF")).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    );
  });

  it.each(["no-es-un-color", "#7A7A7A"])(
    "con un acento que no se puede pintar (%s), usa el acento por defecto",
    (accentColor) => {
      const email = renderAccountConfirmationEmail({
        confirmUrl: CONFIRM_URL,
        linkLifetimeMinutes: LIFETIME_MINUTES,
        locale: "es",
        brand: { ...STORED_BRAND, accentColor },
      });
      const cell = buttonCellOf(email);

      expect(inlineColor(cell, "background-color")).toBe(
        DEFAULT_CLUB_BRAND.accentColor.toUpperCase(),
      );
      expect(email.html.toLowerCase()).not.toContain(accentColor.toLowerCase());
    },
  );
});
