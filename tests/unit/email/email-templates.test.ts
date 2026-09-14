import { describe, expect, it } from "vitest";
import {
  CLUB_NAME,
  type RenderedEmail,
  renderAccountConfirmationEmail,
  renderPasswordRecoveryEmail,
} from "@/lib/email/email-templates";

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
