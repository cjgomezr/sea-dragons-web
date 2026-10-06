import { describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";
import {
  DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH,
  DIRECTORY_EMAIL_QUOTA,
  DIRECTORY_EMAIL_SUBJECT_MAX_LENGTH,
  type DirectoryEmailGateways,
  type DirectoryEmailRecipient,
  type DirectoryEmailReservationRequest,
  DirectoryEmailDuplicateError,
  DirectoryEmailForbiddenError,
  DirectoryEmailInvalidError,
  DirectoryEmailNoRecipientsError,
  DirectoryEmailQuotaExceededError,
  DirectoryEmailUnavailableError,
  checkDirectoryEmailDraft,
  readDirectoryEmailQuota,
  sendDirectoryEmail,
} from "@/lib/directory/directory-email";
import type { EmailProviderStatus } from "@/lib/email/email-delivery-availability";
import {
  type BatchEmailDelivery,
  EmailDeliveryError,
  type ReplyableEmail,
} from "@/lib/email/resend-email-sender";

/**
 * El correo del directorio (#501, RF-6 y RF-7 del PRD de E19, D7 y D8),
 * contado sin Supabase ni Resend delante: quién puede mandarlo, a quién le
 * llega, cuánto cupo gasta y qué queda en la bitácora.
 */

const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const REQUEST_ID = "7e7e7e7e-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-07T09:00:00.000Z");
const HOUR_MS = 3_600_000;

const SENDER: DirectoryEmailRecipient = {
  userId: CALLER_ID,
  fullName: "Ana Admin",
  email: "ana@club.test",
  status: "active",
  locale: "es",
};

function recipient(
  index: number,
  overrides: Partial<DirectoryEmailRecipient> = {},
): DirectoryEmailRecipient {
  const suffix = String(index).padStart(12, "0");
  return {
    userId: `b0b0b0b0-0000-4000-8000-${suffix}`,
    fullName: `Socio ${index}`,
    email: `socio${index}@club.test`,
    status: "active" as AccountStatus,
    locale: "en",
    ...overrides,
  };
}

const DRAFT = {
  subject: "Entrenamiento del sábado",
  message: "Hola:\n\nEl sábado entrenamos a las 8.\n<b>Traed aletas</b>",
};

/** Un registro del cupo en memoria que reserva de una vez, como la función
 * de la base con su bloqueo. */
function memoryQuota(alreadySent: readonly { at: Date; count: number }[] = []) {
  const sends: {
    id: string;
    at: Date;
    reserved: number;
    sent: number | null;
  }[] = alreadySent.map((send, index) => ({
    id: `previo-${index}`,
    at: send.at,
    reserved: send.count,
    sent: send.count,
  }));
  const requestIds = new Set<string>();
  function countSince(windowStart: Date): number {
    return sends
      .filter((send) => send.at.getTime() >= windowStart.getTime())
      .reduce((total, send) => total + (send.sent ?? send.reserved), 0);
  }
  return {
    sends,
    gateway: {
      countSentSince: async (windowStart: Date) => countSince(windowStart),
      reserve: async (request: DirectoryEmailReservationRequest) => {
        if (requestIds.has(request.requestId)) {
          return { kind: "duplicate" } as const;
        }
        const remaining = request.limit - countSince(request.windowStart);
        if (request.recipientCount > remaining) {
          return { kind: "exceeded", remaining } as const;
        }
        requestIds.add(request.requestId);
        const id = `envio-${sends.length}`;
        sends.push({
          id,
          at: NOW,
          reserved: request.recipientCount,
          sent: null,
        });
        return { kind: "reserved", sendId: id } as const;
      },
      settle: async (sendId: string, deliveredCount: number) => {
        const send = sends.find((candidate) => candidate.id === sendId);
        if (send === undefined) {
          throw new Error(`no existe ${sendId}`);
        }
        send.sent = deliveredCount;
      },
    },
  };
}

type Scenario = {
  readonly callerRole?: Role;
  readonly members?: readonly DirectoryEmailRecipient[];
  readonly alreadySent?: readonly { at: Date; count: number }[];
  readonly isConnected?: boolean;
  readonly provider?: EmailProviderStatus;
  readonly deliver?: (
    emails: readonly ReplyableEmail[],
  ) => readonly BatchEmailDelivery[];
};

function setUp(scenario: Scenario = {}) {
  const members = scenario.members ?? [SENDER, recipient(1), recipient(2)];
  const quota = memoryQuota(scenario.alreadySent);
  const batches: {
    emails: readonly ReplyableEmail[];
    idempotencyKey: string;
  }[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  const lookups: { clubId: string; userIds: readonly string[] }[] = [];
  const gateways: DirectoryEmailGateways = {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: SENDER.fullName,
        role: scenario.callerRole ?? "Admin",
      }),
    },
    recipients: {
      findEmailRecipients: async (clubId, userIds) => {
        lookups.push({ clubId, userIds });
        return members.filter((member) => userIds.includes(member.userId));
      },
    },
    quota: quota.gateway,
    delivery: {
      connection:
        scenario.isConnected === false
          ? { kind: "not_connected", reason: "faltan RESEND_API_KEY" }
          : {
              kind: "connected",
              sender: {
                sendBatch: async (emails, idempotencyKey) => {
                  batches.push({ emails, idempotencyKey });
                  return scenario.deliver === undefined
                    ? emails.map(() => ({ kind: "sent" }) as const)
                    : scenario.deliver(emails);
                },
              },
            },
      provider: {
        probeProvider: async () => scenario.provider ?? { kind: "reachable" },
      },
    },
    brand: { readClubBrand: async () => DEFAULT_CLUB_BRAND },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
    log: () => undefined,
  };
  return { gateways, quota, batches, auditRows, lookups };
}

function sendTo(
  gateways: DirectoryEmailGateways,
  recipientIds: readonly string[],
  overrides: { draft?: typeof DRAFT; requestId?: string; now?: Date } = {},
) {
  return sendDirectoryEmail(gateways, {
    callerId: CALLER_ID,
    requestId: overrides.requestId ?? REQUEST_ID,
    draft: overrides.draft ?? DRAFT,
    recipientIds,
    now: overrides.now ?? NOW,
  });
}

function recipients(count: number): DirectoryEmailRecipient[] {
  return Array.from({ length: count }, (_, index) => recipient(index + 1));
}

describe("checkDirectoryEmailDraft", () => {
  it("acepta un asunto y un mensaje con texto, dentro de sus límites", () => {
    expect(checkDirectoryEmailDraft(DRAFT)).toEqual({
      subject: null,
      message: null,
    });
  });

  it("pide el asunto y el mensaje cuando están vacíos o son sólo espacios", () => {
    expect(checkDirectoryEmailDraft({ subject: "  ", message: "" })).toEqual({
      subject: "required",
      message: "required",
    });
  });

  it("acepta el asunto de 150 caracteres y rechaza el de 151", () => {
    const atLimit = "a".repeat(DIRECTORY_EMAIL_SUBJECT_MAX_LENGTH);

    expect(
      checkDirectoryEmailDraft({ ...DRAFT, subject: atLimit }).subject,
    ).toBeNull();
    expect(
      checkDirectoryEmailDraft({ ...DRAFT, subject: `${atLimit}a` }).subject,
    ).toBe("too_long");
  });

  it("acepta el mensaje de 5.000 caracteres y rechaza el de 5.001", () => {
    const atLimit = "a".repeat(DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH);

    expect(
      checkDirectoryEmailDraft({ ...DRAFT, message: atLimit }).message,
    ).toBeNull();
    expect(
      checkDirectoryEmailDraft({ ...DRAFT, message: `${atLimit}a` }).message,
    ).toBe("too_long");
  });
});

describe("sendDirectoryEmail", () => {
  describe("quién puede mandarlo", () => {
    it.each(["Coach", "Player"] as const)(
      "rechaza a un %s sin leer a nadie ni mandar nada",
      async (callerRole) => {
        const { gateways, batches, lookups } = setUp({ callerRole });

        await expect(
          sendTo(gateways, [recipient(1).userId]),
        ).rejects.toBeInstanceOf(DirectoryEmailForbiddenError);
        expect(lookups).toEqual([]);
        expect(batches).toEqual([]);
      },
    );

    it("deja mandarlo a un Committee", async () => {
      const { gateways, batches } = setUp({ callerRole: "Committee" });

      await sendTo(gateways, [recipient(1).userId]);

      expect(batches).toHaveLength(1);
    });
  });

  it("rechaza un borrador inválido con el problema de cada campo", async () => {
    const { gateways, batches } = setUp();

    const sending = sendTo(gateways, [recipient(1).userId], {
      draft: { subject: "", message: "a".repeat(5_001) },
    });

    await expect(sending).rejects.toBeInstanceOf(DirectoryEmailInvalidError);
    await expect(sending).rejects.toMatchObject({
      problems: { subject: "required", message: "too_long" },
    });
    expect(batches).toEqual([]);
  });

  describe("a quién le llega", () => {
    it("manda un correo propio a cada socio, desde el club y con respuesta a quien escribe", async () => {
      const { gateways, batches } = setUp();

      await sendTo(gateways, [recipient(1).userId, recipient(2).userId]);

      expect(batches).toHaveLength(1);
      expect(batches[0]?.emails.map((email) => email.to)).toEqual([
        "socio1@club.test",
        "socio2@club.test",
      ]);
      expect(
        batches[0]?.emails.every((email) => email.replyTo === SENDER.email),
      ).toBe(true);
    });

    it("usa el id de la petición como clave del envío al proveedor", async () => {
      const { gateways, batches } = setUp();

      await sendTo(gateways, [recipient(1).userId]);

      expect(batches[0]?.idempotencyKey).toBe(REQUEST_ID);
    });

    it("deja fuera a las cuentas dadas de baja aunque se hayan pedido", async () => {
      const inactive = recipient(3, { status: "inactive" });
      const { gateways, batches } = setUp({
        members: [SENDER, recipient(1), inactive],
      });

      const result = await sendTo(gateways, [
        recipient(1).userId,
        inactive.userId,
      ]);

      expect(batches[0]?.emails.map((email) => email.to)).toEqual([
        "socio1@club.test",
      ]);
      expect(result.sentCount).toBe(1);
    });

    it("manda a una cuenta incompleta, que ya es del club", async () => {
      const invited = recipient(4, { status: "incomplete" });
      const { gateways, batches } = setUp({ members: [SENDER, invited] });

      await sendTo(gateways, [invited.userId]);

      expect(batches[0]?.emails.map((email) => email.to)).toEqual([
        invited.email,
      ]);
    });

    it("busca a los destinatarios sólo en el club de quien escribe y sin repetir", async () => {
      const { gateways, lookups } = setUp();

      await sendTo(gateways, [recipient(1).userId, recipient(1).userId]);

      expect(lookups[0]).toEqual({
        clubId: CLUB_ID,
        userIds: [recipient(1).userId],
      });
    });

    it("rechaza una lista que se queda sin nadie a quien mandar", async () => {
      const inactive = recipient(3, { status: "inactive" });
      const { gateways, batches, quota } = setUp({
        members: [SENDER, inactive],
      });

      await expect(sendTo(gateways, [inactive.userId])).rejects.toBeInstanceOf(
        DirectoryEmailNoRecipientsError,
      );
      expect(batches).toEqual([]);
      expect(quota.sends).toEqual([]);
    });

    it("pone el pie en el idioma de cada destinatario y el texto tal como se escribió", async () => {
      const english = recipient(1, { locale: "en" });
      const spanish = recipient(2, { locale: "es" });
      const { gateways, batches } = setUp({
        members: [SENDER, english, spanish],
      });

      await sendTo(gateways, [english.userId, spanish.userId]);

      const [toEnglish, toSpanish] = batches[0]?.emails ?? [];
      expect(toEnglish?.subject).toBe(DRAFT.subject);
      expect(toEnglish?.text).toContain(DRAFT.message);
      expect(toEnglish?.text).toContain(
        "Ana Admin, Admin at Victoria Seadragons, wrote to you",
      );
      expect(toSpanish?.text).toContain(
        "Te escribe Ana Admin, Admin de Victoria Seadragons.",
      );
    });
  });

  describe("el cupo de 50 en 24 horas", () => {
    it("deja mandar justo hasta el límite", async () => {
      const members = recipients(DIRECTORY_EMAIL_QUOTA - 10);
      const { gateways, batches } = setUp({
        members: [SENDER, ...members],
        alreadySent: [{ at: new Date(NOW.getTime() - HOUR_MS), count: 10 }],
      });

      const result = await sendTo(
        gateways,
        members.map((member) => member.userId),
      );

      expect(batches[0]?.emails).toHaveLength(DIRECTORY_EMAIL_QUOTA - 10);
      expect(result.remaining).toBe(0);
    });

    it("con uno más de los que caben no manda ninguno y dice cuántos caben", async () => {
      const members = recipients(DIRECTORY_EMAIL_QUOTA - 9);
      const { gateways, batches, quota } = setUp({
        members: [SENDER, ...members],
        alreadySent: [{ at: new Date(NOW.getTime() - HOUR_MS), count: 10 }],
      });

      const sending = sendTo(
        gateways,
        members.map((member) => member.userId),
      );

      await expect(sending).rejects.toBeInstanceOf(
        DirectoryEmailQuotaExceededError,
      );
      await expect(sending).rejects.toMatchObject({
        remaining: DIRECTORY_EMAIL_QUOTA - 10,
      });
      expect(batches).toEqual([]);
      expect(quota.sends).toHaveLength(1);
    });

    it("no cuenta lo que se mandó hace más de 24 horas", async () => {
      const members = recipients(DIRECTORY_EMAIL_QUOTA);
      const { gateways, batches } = setUp({
        members: [SENDER, ...members],
        alreadySent: [
          { at: new Date(NOW.getTime() - 24 * HOUR_MS - 1), count: 30 },
        ],
      });

      await sendTo(
        gateways,
        members.map((member) => member.userId),
      );

      expect(batches[0]?.emails).toHaveLength(DIRECTORY_EMAIL_QUOTA);
    });

    it("cuenta lo que se mandó justo hace 24 horas", async () => {
      const { gateways } = setUp({
        alreadySent: [
          { at: new Date(NOW.getTime() - 24 * HOUR_MS), count: 50 },
        ],
      });

      await expect(
        sendTo(gateways, [recipient(1).userId]),
      ).rejects.toBeInstanceOf(DirectoryEmailQuotaExceededError);
    });

    it("dice cuántos quedan hoy", async () => {
      const { gateways } = setUp({
        alreadySent: [{ at: new Date(NOW.getTime() - HOUR_MS), count: 12 }],
      });

      await expect(
        readDirectoryEmailQuota(gateways, { callerId: CALLER_ID, now: NOW }),
      ).resolves.toEqual({
        limit: DIRECTORY_EMAIL_QUOTA,
        remaining: DIRECTORY_EMAIL_QUOTA - 12,
      });
    });

    it.each(["Coach", "Player"] as const)(
      "no le dice el cupo a un %s",
      async (callerRole) => {
        const { gateways } = setUp({ callerRole });

        await expect(
          readDirectoryEmailQuota(gateways, { callerId: CALLER_ID, now: NOW }),
        ).rejects.toBeInstanceOf(DirectoryEmailForbiddenError);
      },
    );
  });

  describe("el proveedor", () => {
    it("sin configurar, no manda nada ni gasta cupo", async () => {
      const { gateways, quota } = setUp({ isConnected: false });

      await expect(
        sendTo(gateways, [recipient(1).userId]),
      ).rejects.toBeInstanceOf(DirectoryEmailUnavailableError);
      expect(quota.sends).toEqual([]);
    });

    it("caído, no manda nada ni gasta cupo", async () => {
      const { gateways, batches, quota } = setUp({
        provider: { kind: "unreachable", reason: "Resend respondió 500" },
      });

      await expect(
        sendTo(gateways, [recipient(1).userId]),
      ).rejects.toBeInstanceOf(DirectoryEmailUnavailableError);
      expect(batches).toEqual([]);
      expect(quota.sends).toEqual([]);
    });

    it("si el lote entero falla, dice que no está disponible y no gasta cupo", async () => {
      const { gateways, quota } = setUp({
        deliver: () => {
          throw new EmailDeliveryError("Resend rechazó el envío con 500", {
            status: 500,
          });
        },
      });

      await expect(
        sendTo(gateways, [recipient(1).userId]),
      ).rejects.toBeInstanceOf(DirectoryEmailUnavailableError);
      expect(quota.sends[0]?.sent).toBe(0);
    });
  });

  it("si falla a medias, dice a quiénes no llegó y sólo cuenta los que salieron", async () => {
    const { gateways, quota } = setUp({
      deliver: (emails) =>
        emails.map((email) =>
          email.to === "socio2@club.test"
            ? { kind: "failed", reason: "dirección rechazada" }
            : { kind: "sent" },
        ),
    });

    const result = await sendTo(gateways, [
      recipient(1).userId,
      recipient(2).userId,
    ]);

    expect(result).toEqual({
      sentCount: 1,
      failed: [{ userId: recipient(2).userId, fullName: "Socio 2" }],
      remaining: DIRECTORY_EMAIL_QUOTA - 1,
    });
    expect(quota.sends[0]?.sent).toBe(1);
  });

  it("la misma petición dos veces se manda una sola vez", async () => {
    const { gateways, batches } = setUp();

    await sendTo(gateways, [recipient(1).userId]);
    const second = sendTo(gateways, [recipient(1).userId]);

    await expect(second).rejects.toBeInstanceOf(DirectoryEmailDuplicateError);
    expect(batches).toHaveLength(1);
  });

  it("deja en la bitácora quién, el asunto y a cuántos, sin el cuerpo", async () => {
    const { gateways, auditRows } = setUp();

    await sendTo(gateways, [recipient(1).userId, recipient(2).userId]);

    expect(auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: CALLER_ID,
        action: "directory.email_sent",
        entity_type: "directory_email",
        entity_id: "envio-0",
        result: "success",
        metadata: { subject: DRAFT.subject, recipientCount: 2, sentCount: 2 },
      },
    ]);
    expect(JSON.stringify(auditRows)).not.toContain("aletas");
  });
});
