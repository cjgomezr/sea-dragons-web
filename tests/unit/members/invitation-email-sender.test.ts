import { describe, expect, it } from "vitest";
import type {
  RecoveryTokenIssue,
  RecoveryTokenIssuer,
} from "@/lib/auth/password-recovery";
import {
  EmailDeliveryError,
  type EmailSenderConnection,
  type OutgoingEmail,
} from "@/lib/email/resend-email-sender";
import { createInvitationEmailGateway } from "@/lib/members/invitation-email-sender";

/**
 * El correo de la invitación (#243, FR-021): emite el enlace de elegir
 * contraseña y lo manda en el idioma guardado en la fila del miembro, que es
 * el del Admin que lo dio de alta.
 */

const EMAIL = "nerea.silva@example.com";
const USER_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
const APP_URL = "https://club.example/api/v1/members";

type Harness = {
  readonly sent: OutgoingEmail[];
  readonly issued: string[];
};

function harness(options: {
  readonly issue?: () => Promise<RecoveryTokenIssue>;
  readonly connection?: "connected" | "not_connected";
  readonly sendError?: EmailDeliveryError;
  readonly storedLocale?: string | null;
}): Harness & {
  readonly gateway: ReturnType<typeof createInvitationEmailGateway>;
} {
  const sent: OutgoingEmail[] = [];
  const issued: string[] = [];
  const tokens: RecoveryTokenIssuer = {
    issueRecoveryToken: async (email) => {
      issued.push(email);
      return options.issue
        ? options.issue()
        : { kind: "issued", tokenHash: "hash-1", userId: USER_ID };
    },
  };
  const emails: EmailSenderConnection =
    options.connection === "not_connected"
      ? { kind: "not_connected", reason: "falta RESEND_API_KEY" }
      : {
          kind: "connected",
          sender: {
            sendEmail: async (email) => {
              if (options.sendError) {
                throw options.sendError;
              }
              sent.push(email);
              return { id: "email-1" };
            },
          },
        };
  return {
    sent,
    issued,
    gateway: createInvitationEmailGateway({
      tokens,
      emails,
      emailLocales: {
        findStoredEmailLocale: async () =>
          options.storedLocale === undefined ? "en" : options.storedLocale,
      },
    }),
  };
}

describe("invitación", () => {
  it("sends a link to choose a password on the same deployment", async () => {
    const { gateway, sent } = harness({});

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome).toEqual({ kind: "requested" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(EMAIL);
    expect(sent[0]?.text).toContain(
      "https://club.example/recuperar-contrasena/nueva?token_hash=hash-1",
    );
  });

  it("writes the invitation in the locale stored for the member", async () => {
    const { gateway, sent } = harness({ storedLocale: "es" });

    await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(sent[0]?.subject).toBe("Te invitaron a Victoria Seadragons");
  });

  it("does not issue a link when email is not connected", async () => {
    const { gateway, issued } = harness({ connection: "not_connected" });

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome).toEqual({ kind: "failed", reason: "falta RESEND_API_KEY" });
    expect(issued).toEqual([]);
  });

  it("requests nothing when the identity no longer exists", async () => {
    const { gateway, sent } = harness({
      issue: async () => ({ kind: "no_account" }),
    });

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome).toEqual({ kind: "not_requested" });
    expect(sent).toEqual([]);
  });

  it("reports a link that Supabase could not issue as a failure", async () => {
    const { gateway } = harness({
      issue: async () => {
        throw new Error(`Supabase Auth no respondió para ${EMAIL}`);
      },
    });

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome.kind).toBe("failed");
    expect(JSON.stringify(outcome)).not.toContain(EMAIL);
  });

  it("reports the provider's rate limit apart from other failures", async () => {
    const { gateway } = harness({
      sendError: new EmailDeliveryError("too many", { status: 429 }),
    });

    const outcome = await gateway.requestConfirmationEmail(EMAIL, APP_URL);

    expect(outcome).toEqual({ kind: "rate_limited", reason: "429: too many" });
  });
});
