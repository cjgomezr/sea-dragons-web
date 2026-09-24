import {
  type AccentPair,
  DEFAULT_ACCENT_COLOR,
  evaluateAccentColor,
} from "@/lib/club/accent-color";
import type { ClubBrand } from "@/lib/club/club-brand";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";

/**
 * Las plantillas del correo transaccional (INT-006). Son funciones puras: dan
 * el asunto, el HTML y el texto plano, y no saben nada de quién los manda.
 *
 * Cada correo se escribe una sola vez, como contenido, y el HTML y el texto
 * salen los dos de ahí. Así un cliente que no pinta HTML lee exactamente lo
 * mismo, y no hay dos versiones que se puedan separar con el tiempo.
 */

export type RenderedEmail = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

type EmailContent = {
  readonly subject: string;
  readonly intro: readonly string[];
  readonly action: {
    /** El texto corto del botón. Sólo va en el HTML: en texto plano no hay
     * botón, y ahí manda la frase de `label`. */
    readonly buttonLabel: string;
    readonly label: string;
    readonly url: string;
  };
  readonly outro: readonly string[];
};

/** Los tokens del tema claro de `design-system.md`, salvo la cabecera, que usa
 * los de la barra lateral (no cambian con el tema). El correo no tiene
 * `data-theme`, y los clientes de correo no leen variables CSS, así que van
 * copiados a mano. El acento no está aquí: es el del club, y llega con la
 * marca (E18a, RF-8). */
const COLOR = {
  background: "#EFF3F7",
  panel: "#FFFFFF",
  text: "#1C3245",
  textSecondary: "#5A7086",
  border: "#DEE6ED",
  headerBackground: "#163A55",
  headerText: "#CFDEEA",
} as const;

/** Archivo y Space Grotesk no llegan al correo: no se cargan fuentes de
 * fuera, porque los clientes las bloquean. */
const FONT_STACK = "Arial, Helvetica, sans-serif";
const MAX_WIDTH_PX = 600;
const LOGO_HEIGHT_PX = 40;
const HEADER_ACCENT_BORDER_PX = 4;

const BODY_STYLE = `margin: 0; padding: 0; background-color: ${COLOR.background};`;
const PARAGRAPH_STYLE = `margin: 0 0 16px; font-family: ${FONT_STACK}; font-size: 16px; line-height: 1.5; color: ${COLOR.text};`;
const SIGNATURE_STYLE = `margin: 0; font-family: ${FONT_STACK}; font-size: 14px; line-height: 1.5; color: ${COLOR.textSecondary};`;
const HEADER_TEXT_STYLE = `font-family: ${FONT_STACK}; font-size: 20px; font-weight: bold; color: ${COLOR.headerText};`;
const CONTENT_STYLE = `padding: 32px; background-color: ${COLOR.panel};`;
const FOOTER_STYLE = `padding: 16px 32px; background-color: ${COLOR.panel}; border-top: 1px solid ${COLOR.border};`;
const BUTTON_TEXT_STYLE = `display: inline-block; font-family: ${FONT_STACK}; font-size: 16px; font-weight: bold; line-height: 1.25; text-decoration: none;`;

function headerStyle(accent: AccentPair): string {
  return `padding: 20px 32px; background-color: ${COLOR.headerBackground}; border-bottom: ${HEADER_ACCENT_BORDER_PX}px solid ${accent.accent}; ${HEADER_TEXT_STYLE}`;
}

function buttonCellStyle(accent: AccentPair): string {
  return `padding: 12px 24px; border-radius: 6px; background-color: ${accent.accent};`;
}

function buttonStyle(accent: AccentPair): string {
  return `${BUTTON_TEXT_STYLE} color: ${accent.onAccent};`;
}

function writtenLinkStyle(accent: AccentPair): string {
  return `color: ${accent.accent}; word-break: break-all;`;
}

/** Lo que la plantilla pinta de la marca, ya comprobado. Un acento guardado
 * que no llegue a AA no debería existir, pero si llega no puede dejar el
 * botón ilegible: se pinta el de siempre. */
type EmailBrand = {
  readonly name: string;
  readonly accent: AccentPair;
  readonly logoUrl: string | null;
};

const HTTPS_URL_PATTERN = /^https:\/\//i;

function accentPairFor(accentColor: string): AccentPair {
  const evaluation = evaluateAccentColor(accentColor);
  if (evaluation.kind === "accepted") {
    return evaluation.palette.light;
  }
  const fallback = evaluateAccentColor(DEFAULT_ACCENT_COLOR);
  if (fallback.kind === "rejected") {
    throw new Error(`El acento por defecto no se lee: ${DEFAULT_ACCENT_COLOR}`);
  }
  return fallback.palette.light;
}

/** Un cliente de correo no resuelve una ruta relativa ni inicia sesión, y
 * casi todos bloquean `http:`: sin una dirección https se pinta el nombre. */
function toEmailBrand(brand: ClubBrand): EmailBrand {
  const hasPublicLogo =
    brand.logoUrl !== null && HTTPS_URL_PATTERN.test(brand.logoUrl);
  return {
    name: brand.name,
    accent: accentPairFor(brand.accentColor),
    logoUrl: hasPublicLogo ? brand.logoUrl : null,
  };
}

/** Las tablas de maquetación no son datos: sin `role="presentation"` un
 * lector de pantalla anuncia filas y columnas que no existen. */
const LAYOUT_TABLE_ATTRIBUTES =
  'role="presentation" cellpadding="0" cellspacing="0" border="0"';

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function signatureIn(t: Translator, brand: EmailBrand): string {
  return t("email.signature", { clubName: brand.name });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPES[character] ?? character,
  );
}

function renderParagraph(text: string): string {
  return `<p style="${PARAGRAPH_STYLE}">${escapeHtml(text)}</p>`;
}

/** El color va en la celda y no sólo en el enlace: Outlook y Gmail respetan
 * el fondo de una `td`, y un `<a>` con `display: block` lo pierden. */
function renderButton(
  action: EmailContent["action"],
  accent: AccentPair,
): string {
  return [
    `<table ${LAYOUT_TABLE_ATTRIBUTES} style="margin: 0 0 16px;">`,
    `<tr><td bgcolor="${accent.accent}" style="${buttonCellStyle(accent)}">`,
    `<a href="${escapeHtml(action.url)}" style="${buttonStyle(accent)}">${escapeHtml(action.buttonLabel)}</a>`,
    "</td></tr>",
    "</table>",
  ].join("\n");
}

/** El botón no sustituye al enlace escrito entero: hay clientes que bloquean
 * los enlaces, y quien lo lee en texto plano tiene que poder copiarlo igual. */
function renderWrittenLink(
  action: EmailContent["action"],
  accent: AccentPair,
): string {
  const url = escapeHtml(action.url);
  return `<p style="${PARAGRAPH_STYLE}">${escapeHtml(action.label)}: <a href="${url}" style="${writtenLinkStyle(accent)}">${url}</a></p>`;
}

/** Con las imágenes bloqueadas, el cliente enseña el texto alternativo en su
 * lugar: por eso es el nombre del club y lleva el estilo del de la cabecera. */
function renderHeaderContent(brand: EmailBrand): string {
  const name = escapeHtml(brand.name);
  if (brand.logoUrl === null) {
    return name;
  }
  return `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="${LOGO_HEIGHT_PX}" style="display: block; height: ${LOGO_HEIGHT_PX}px; width: auto; border: 0; ${HEADER_TEXT_STYLE}">`;
}

function renderCard(
  t: Translator,
  brand: EmailBrand,
  content: EmailContent,
): string {
  return [
    `<table ${LAYOUT_TABLE_ATTRIBUTES} width="100%" style="width: 100%; max-width: ${MAX_WIDTH_PX}px;">`,
    `<tr><td style="${headerStyle(brand.accent)}">${renderHeaderContent(brand)}</td></tr>`,
    `<tr><td style="${CONTENT_STYLE}">`,
    ...content.intro.map(renderParagraph),
    renderButton(content.action, brand.accent),
    renderWrittenLink(content.action, brand.accent),
    ...content.outro.map(renderParagraph),
    "</td></tr>",
    `<tr><td style="${FOOTER_STYLE}"><p style="${SIGNATURE_STYLE}">${escapeHtml(signatureIn(t, brand))}</p></td></tr>`,
    "</table>",
  ].join("\n");
}

function renderHtml(
  t: Translator,
  brand: EmailBrand,
  content: EmailContent,
): string {
  return [
    "<!doctype html>",
    `<html lang="${t.locale}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    `<body style="${BODY_STYLE}">`,
    `<table ${LAYOUT_TABLE_ATTRIBUTES} width="100%" bgcolor="${COLOR.background}" style="width: 100%; background-color: ${COLOR.background};">`,
    '<tr><td align="center" style="padding: 24px 12px;">',
    // Outlook de escritorio pinta con el motor de Word e ignora `max-width`:
    // esta tabla fija, que sólo él lee, le pone el mismo tope.
    `<!--[if mso]><table ${LAYOUT_TABLE_ATTRIBUTES} width="${MAX_WIDTH_PX}" align="center"><tr><td><![endif]-->`,
    renderCard(t, brand, content),
    "<!--[if mso]></td></tr></table><![endif]-->",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

function renderText(
  t: Translator,
  brand: EmailBrand,
  content: EmailContent,
): string {
  return `${[
    ...content.intro,
    `${content.action.label}: ${content.action.url}`,
    ...content.outro,
    signatureIn(t, brand),
  ].join("\n\n")}\n`;
}

function renderEmail(
  t: Translator,
  clubBrand: ClubBrand,
  content: EmailContent,
): RenderedEmail {
  const brand = toEmailBrand(clubBrand);
  return {
    subject: content.subject,
    html: renderHtml(t, brand, content),
    text: renderText(t, brand, content),
  };
}

type EmailLinkInput = {
  readonly linkLifetimeMinutes: number;
  /** El idioma guardado en la fila del socio, no el de quien navega: el
   * correo sale después de responder (E17, RF-6). */
  readonly locale: Locale;
  /** La lee quien manda el correo: así la plantilla sigue siendo pura. */
  readonly brand: ClubBrand;
};

export function renderPasswordRecoveryEmail(
  input: EmailLinkInput & { readonly resetUrl: string },
): RenderedEmail {
  const t = createTranslator(input.locale);
  const clubName = input.brand.name;
  return renderEmail(t, input.brand, {
    subject: t("email.recovery.subject", { clubName }),
    intro: [
      t("email.recovery.requested", { clubName }),
      t("email.recovery.linkLifetime", { count: input.linkLifetimeMinutes }),
    ],
    action: {
      buttonLabel: t("email.recovery.button"),
      label: t("email.recovery.linkLabel"),
      url: input.resetUrl,
    },
    outro: [t("email.recovery.notYou")],
  });
}

export function renderAccountConfirmationEmail(
  input: EmailLinkInput & { readonly confirmUrl: string },
): RenderedEmail {
  const t = createTranslator(input.locale);
  const clubName = input.brand.name;
  return renderEmail(t, input.brand, {
    subject: t("email.confirmation.subject", { clubName }),
    intro: [
      t("email.confirmation.registered", { clubName }),
      t("email.confirmation.linkLifetime", {
        count: input.linkLifetimeMinutes,
      }),
      // Registrarse otra vez no manda ningún enlace: con una dirección que ya
      // tiene identidad el registro sale sin emitirlo, a propósito (#147). El
      // que sí lo emite es el botón de la pantalla de confirmación, y a esa
      // pantalla se vuelve empezando el registro de nuevo (#179). El botón se
      // nombra desde su propia clave: si la pantalla lo renombra, el correo no
      // puede quedarse mandando a uno que no existe.
      t("email.confirmation.ifExpired", {
        resendButton: t("auth.registration.resend"),
      }),
    ],
    action: {
      buttonLabel: t("email.confirmation.button"),
      label: t("email.confirmation.linkLabel"),
      url: input.confirmUrl,
    },
    outro: [t("email.confirmation.notYou")],
  });
}

/** La invitación del alta por un Admin (#243, FR-021). El enlace es el de
 * elegir contraseña: canjearlo confirma el correo, y con esa contraseña el
 * miembro entra y termina su registro en la pantalla que ya existe. */
export function renderMemberInvitationEmail(
  input: EmailLinkInput & { readonly acceptUrl: string },
): RenderedEmail {
  const t = createTranslator(input.locale);
  const clubName = input.brand.name;
  return renderEmail(t, input.brand, {
    subject: t("email.invitation.subject", { clubName }),
    intro: [
      t("email.invitation.invited", { clubName }),
      t("email.invitation.nextSteps"),
      t("email.invitation.linkLifetime", { count: input.linkLifetimeMinutes }),
    ],
    action: {
      buttonLabel: t("email.invitation.button"),
      label: t("email.invitation.linkLabel"),
      url: input.acceptUrl,
    },
    outro: [t("email.invitation.ifExpired"), t("email.invitation.notYou")],
  });
}
