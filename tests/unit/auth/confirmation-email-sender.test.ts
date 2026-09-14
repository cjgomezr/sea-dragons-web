import { describe, expect, it } from "vitest";
import {
  type ConfirmationTokenIssue,
  createConfirmationEmailGateway,
} from "@/lib/auth/confirmation-email-sender";
import { EMAIL_CONFIRMATION_LINK_LIFETIME_MINUTES } from "@/lib/auth/email-confirmation";
import {
  EmailDeliveryError,
  type EmailSenderConnection,
  type OutgoingEmail,
} from "@/lib/email/resend-email-sender";

const EMAIL = "nerea@example.test";
const APP_URL = "https://victoria-seadragons.vercel.app/api/v1/auth/register";
const TOKEN_HASH = "hash-del-enlace";

type Doubles = {
  readonly issuedFor: string[];
  readonly sent: OutgoingEmail[];
};

function gatewayWith(options: {
  readonly issue?: ConfirmationTokenIssue;
  readonly emails?: EmailSenderConnection;
  readonly deliveryFailure?: Error;
}): { readonly doubles: Doubles } & ReturnType<
  typeof createConfirmationEmailGateway
> {
  const doubles: Doubles = { issuedFor: [], sent: [] };
  const gateway = createConfirmationEmailGateway({
    tokens: {
      async issueConfirmationToken(email) {
        doubles.issuedFor.push(email);
        return options.issue ?? { kind: "issued", tokenHash: TOKEN_HASH };
      },
    },
    emails: options.emails ?? {
      kind: "connected",
      sender: {
        async sendEmail(email) {
          if (options.deliveryFailure) {
            throw options.deliveryFailure;
          }
          doubles.sent.push(email);
          return { id: "id-del-envio" };
        },
      },
    },
  });
  return { ...gateway, doubles };
}

describe("correo de confirmación de cuenta", () => {
  it("manda la plantilla de confirmación con un enlace a la ruta que lo canjea", async () => {
    const gateway = gatewayWith({});

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome).toEqual({ kind: "requested" });
    expect(gateway.doubles.sent).toHaveLength(1);
    const [sent] = gateway.doubles.sent;
    expect(sent?.to).toBe(EMAIL);
    expect(sent?.text).toContain(
      `https://victoria-seadragons.vercel.app/auth/confirmar?token_hash=${TOKEN_HASH}&type=signup`,
    );
    expect(sent?.text).toContain(
      `${EMAIL_CONFIRMATION_LINK_LIFETIME_MINUTES} minutos`,
    );
  });

  // Emitir un enlace nuevo invalida el anterior. Si no hay con qué mandarlo,
  // emitirlo sólo le rompería a la persona el enlace que ya tenía.
  it("sin proveedor conectado no emite ningún enlace, y el motivo nombra lo que falta", async () => {
    const gateway = gatewayWith({
      emails: {
        kind: "not_connected",
        reason: "faltan RESEND_API_KEY",
      },
    });

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome).toEqual({
      kind: "failed",
      reason: "faltan RESEND_API_KEY",
    });
    expect(gateway.doubles.issuedFor).toEqual([]);
  });

  it("no manda nada cuando la dirección no tiene una confirmación pendiente", async () => {
    const gateway = gatewayWith({ issue: { kind: "no_pending_confirmation" } });

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome).toEqual({ kind: "not_requested" });
    expect(gateway.doubles.sent).toEqual([]);
  });

  it("un fallo al emitir el enlace se devuelve clasificado y sin la dirección", async () => {
    const gateway = gatewayWith({
      issue: {
        kind: "failed",
        error: { status: 500, message: `no pude con ${EMAIL}` },
      },
    });

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome).toEqual({
      kind: "failed",
      reason: "500: no pude con <correo>",
    });
    expect(gateway.doubles.sent).toEqual([]);
  });

  it("un límite del proveedor se devuelve como límite, no como fallo genérico", async () => {
    const gateway = gatewayWith({
      deliveryFailure: new EmailDeliveryError("Resend respondió 429", {
        status: 429,
      }),
    });

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome.kind).toBe("rate_limited");
  });

  it("un error del proveedor se devuelve con su motivo y sin la dirección", async () => {
    const gateway = gatewayWith({
      deliveryFailure: new EmailDeliveryError(
        `Resend respondió 422: ${EMAIL} no vale`,
        { status: 422 },
      ),
    });

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome.kind).toBe("failed");
    expect(JSON.stringify(outcome)).toContain("Resend respondió 422");
    expect(JSON.stringify(outcome)).not.toContain(EMAIL);
  });

  // Sólo los fallos de entrega son un resultado. Cualquier otra cosa es un bug
  // de este código, y convertirla en "no salió el correo" la escondería.
  it("un error que no es de entrega sube tal cual", async () => {
    const bug = new TypeError("undefined is not a function");
    const gateway = gatewayWith({ deliveryFailure: bug });

    await expect(gateway.requestConfirmationEmail(EMAIL, APP_URL)).rejects.toBe(
      bug,
    );
  });
});
