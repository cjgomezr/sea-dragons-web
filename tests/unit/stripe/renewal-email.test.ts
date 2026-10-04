// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";
import type { EmailDeliveryAvailabilityCheck } from "@/lib/email/email-delivery-availability";
import type { EmailSender } from "@/lib/email/resend-email-sender";
import {
  type RenewalEmailRecipients,
  createRenewalEmailGateway,
} from "@/lib/stripe/renewal-notice";
import type { RenewalNotice } from "@/lib/stripe/webhook-events";

/**
 * El correo del aviso de renovación (#470): al socio, en su idioma, por el
 * cupo de correos del club. Cualquier cosa que impida mandarlo lanza, y quien
 * avisa lo anota en el log.
 */

const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const PAYMENTS_URL = "https://victoria-seadragons.vercel.app/pagos";
const NOW = new Date("2026-10-21T14:15:00Z");

const NOTICE: RenewalNotice = {
  userId: USER_ID,
  clubId: CLUB_ID,
  amountCents: 4500,
  chargeAt: new Date("2026-10-28T14:15:00Z"),
  card: { brand: "visa", last4: "4242" },
};

const sendEmail = vi.fn<EmailSender["sendEmail"]>();
const checkAvailability =
  vi.fn<EmailDeliveryAvailabilityCheck["checkAvailability"]>();
const availabilityForClub = vi.fn<
  (clubId: string) => EmailDeliveryAvailabilityCheck
>(() => ({ checkAvailability }));
const findRecipient = vi.fn<RenewalEmailRecipients["findRecipient"]>();

function gateway(connected = true) {
  return createRenewalEmailGateway({
    emails: connected
      ? { kind: "connected", sender: { sendEmail } }
      : { kind: "not_connected", reason: "faltan RESEND_API_KEY" },
    availabilityForClub,
    recipients: { findRecipient },
    readClubBrand: () => Promise.resolve(DEFAULT_CLUB_BRAND),
    paymentsUrl: PAYMENTS_URL,
    now: () => NOW,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue({ id: "email_1" });
  checkAvailability.mockResolvedValue({ kind: "available" });
  findRecipient.mockResolvedValue({
    email: "socia@example.test",
    emailLocale: "en",
  });
});

describe("createRenewalEmailGateway", () => {
  it("manda al socio el correo en su idioma con el importe, el día y el enlace a Pagos", async () => {
    await gateway().sendRenewalEmail(NOTICE);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [email] = sendEmail.mock.calls[0] ?? [];
    expect(email?.to).toBe("socia@example.test");
    expect(email?.text).toContain("$45.00");
    expect(email?.text).toContain("29 October 2026");
    expect(email?.text).toContain("Visa ending in 4242");
    expect(email?.text).toContain(PAYMENTS_URL);
  });

  it("pasa por el cupo de correos del club del socio", async () => {
    await gateway().sendRenewalEmail(NOTICE);

    expect(availabilityForClub).toHaveBeenCalledWith(CLUB_ID);
    expect(checkAvailability).toHaveBeenCalledWith(NOW);
  });

  it("sale en español cuando el idioma guardado no es ninguno", async () => {
    findRecipient.mockResolvedValue({
      email: "socia@example.test",
      emailLocale: null,
    });

    await gateway().sendRenewalEmail(NOTICE);

    expect(sendEmail.mock.calls[0]?.[0].text).toContain("45,00");
  });

  it("lanza con el motivo y no manda nada si el cupo está agotado", async () => {
    checkAvailability.mockResolvedValue({
      kind: "unavailable",
      reason: "Se agotó el cupo propio de correos",
    });

    await expect(gateway().sendRenewalEmail(NOTICE)).rejects.toThrow(
      "Se agotó el cupo propio de correos",
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("lanza sin consultar el cupo si el correo no está configurado", async () => {
    await expect(gateway(false).sendRenewalEmail(NOTICE)).rejects.toThrow(
      "faltan RESEND_API_KEY",
    );
    expect(checkAvailability).not.toHaveBeenCalled();
  });

  it("lanza si el socio ya no tiene fila", async () => {
    findRecipient.mockResolvedValue(null);

    await expect(gateway().sendRenewalEmail(NOTICE)).rejects.toThrow(USER_ID);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
