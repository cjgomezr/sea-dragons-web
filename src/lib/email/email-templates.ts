/**
 * Las plantillas del correo transaccional (INT-006). Son funciones puras: dan
 * el asunto, el HTML y el texto plano, y no saben nada de quién los manda.
 *
 * Cada correo se escribe una sola vez, como contenido, y el HTML y el texto
 * salen los dos de ahí. Así un cliente que no pinta HTML lee exactamente lo
 * mismo, y no hay dos versiones que se puedan separar con el tiempo.
 */

export const CLUB_NAME = "Victoria Seadragons";

const CLUB_SIGNATURE = `${CLUB_NAME}, club de rugby subacuático de Melbourne.`;

export type RenderedEmail = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

type EmailContent = {
  readonly subject: string;
  readonly intro: readonly string[];
  readonly action: { readonly label: string; readonly url: string };
  readonly outro: readonly string[];
};

const BODY_STYLE =
  "font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.5; color: #1a1a1a;";
const PARAGRAPH_STYLE = "margin: 0 0 16px;";

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPES[character] ?? character,
  );
}

function renderParagraph(text: string): string {
  return `<p style="${PARAGRAPH_STYLE}">${escapeHtml(text)}</p>`;
}

/** El enlace va escrito entero y no detrás de un botón: hay clientes que
 * bloquean los enlaces, y quien lo lee en texto plano tiene que poder
 * copiarlo igual. */
function renderAction(action: EmailContent["action"]): string {
  const url = escapeHtml(action.url);
  return `<p style="${PARAGRAPH_STYLE}">${escapeHtml(action.label)}: <a href="${url}">${url}</a></p>`;
}

function renderHtml(content: EmailContent): string {
  return [
    "<!doctype html>",
    '<html lang="es">',
    '<head><meta charset="utf-8"></head>',
    `<body style="${BODY_STYLE}">`,
    ...content.intro.map(renderParagraph),
    renderAction(content.action),
    ...content.outro.map(renderParagraph),
    renderParagraph(CLUB_SIGNATURE),
    "</body>",
    "</html>",
  ].join("\n");
}

function renderText(content: EmailContent): string {
  return `${[
    ...content.intro,
    `${content.action.label}: ${content.action.url}`,
    ...content.outro,
    CLUB_SIGNATURE,
  ].join("\n\n")}\n`;
}

function renderEmail(content: EmailContent): RenderedEmail {
  return {
    subject: content.subject,
    html: renderHtml(content),
    text: renderText(content),
  };
}

export function renderPasswordRecoveryEmail(input: {
  readonly resetUrl: string;
  readonly linkLifetimeMinutes: number;
}): RenderedEmail {
  return renderEmail({
    subject: `Recupera tu contraseña de ${CLUB_NAME}`,
    intro: [
      `Alguien pidió cambiar la contraseña de tu cuenta de ${CLUB_NAME}.`,
      `El enlace sirve una sola vez y caduca en ${input.linkLifetimeMinutes} minutos.`,
    ],
    action: {
      label: "Para elegir una contraseña nueva, abre este enlace",
      url: input.resetUrl,
    },
    outro: [
      "Si no lo pediste tú, ignora este correo: tu contraseña no cambia.",
    ],
  });
}

export function renderAccountConfirmationEmail(input: {
  readonly confirmUrl: string;
  readonly linkLifetimeMinutes: number;
}): RenderedEmail {
  return renderEmail({
    subject: `Confirma tu correo en ${CLUB_NAME}`,
    intro: [
      `Te registraste en ${CLUB_NAME} con esta dirección.`,
      `El enlace caduca en ${input.linkLifetimeMinutes} minutos. Si caduca, puedes pedir otro desde la pantalla de registro.`,
    ],
    action: {
      label: "Para confirmar tu correo, abre este enlace",
      url: input.confirmUrl,
    },
    outro: [
      "Si no te registraste tú, ignora este correo: sin confirmar, la cuenta no se activa.",
    ],
  });
}
