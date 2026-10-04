// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationWriter } from "@/lib/notifications/notify-member";
import {
  type RenewalEmailGateway,
  createRenewalNoticeSender,
} from "@/lib/stripe/renewal-notice";
import type { RenewalNotice } from "@/lib/stripe/webhook-events";

/**
 * El aviso de renovación (#470, RF-8 del PRD de E13, D3): uno en la campana y
 * un correo. Un correo que no sale no toca el aviso ni sube como error: el
 * webhook ya apuntó el evento y Stripe no lo va a reintentar.
 */

const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";

const NOTICE: RenewalNotice = {
  userId: USER_ID,
  clubId: CLUB_ID,
  amountCents: 4500,
  // La 01:15 del 29 en Melbourne: el día del cobro es el del club.
  chargeAt: new Date("2026-10-28T14:15:00Z"),
  card: { brand: "visa", last4: "4242" },
};

const findRecipient = vi.fn<NotificationWriter["findRecipient"]>();
const insertNotification = vi.fn<NotificationWriter["insertNotification"]>();
const pruneNotifications = vi.fn<NotificationWriter["pruneNotifications"]>();
const runAfterResponse = vi.fn<NotificationWriter["runAfterResponse"]>();
const sendRenewalEmail = vi.fn<RenewalEmailGateway["sendRenewalEmail"]>();
const log = vi.fn<(line: string) => void>();

function sender() {
  return createRenewalNoticeSender({
    notifications: {
      findRecipient,
      insertNotification,
      pruneNotifications,
      runAfterResponse,
    },
    email: { sendRenewalEmail },
    log,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findRecipient.mockResolvedValue({ clubId: CLUB_ID, accountStatus: "active" });
  insertNotification.mockResolvedValue(undefined);
  sendRenewalEmail.mockResolvedValue(undefined);
});

describe("createRenewalNoticeSender", () => {
  it("deja en la campana el importe, el día del cobro en Melbourne y la tarjeta", async () => {
    await sender().notifyUpcomingRenewal(NOTICE);

    expect(insertNotification).toHaveBeenCalledWith({
      type: "membership_renewal_upcoming",
      data: {
        amountCents: 4500,
        chargeOn: "2026-10-29",
        card: { brand: "visa", last4: "4242" },
      },
      clubId: CLUB_ID,
      userId: USER_ID,
    });
  });

  it("manda el correo con el mismo aviso", async () => {
    await sender().notifyUpcomingRenewal(NOTICE);

    expect(sendRenewalEmail).toHaveBeenCalledWith(NOTICE);
  });

  it("si el correo falla, el aviso queda, no lanza y lo deja en el log", async () => {
    sendRenewalEmail.mockRejectedValue(new Error("Resend rechazó el envío"));

    await expect(sender().notifyUpcomingRenewal(NOTICE)).resolves.toBe(
      undefined,
    );

    expect(insertNotification).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Resend rechazó el envío"),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining(USER_ID));
  });

  it("manda el correo aunque el aviso de la campana no se guarde", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    insertNotification.mockRejectedValue(new Error("la base no contesta"));

    await sender().notifyUpcomingRenewal(NOTICE);

    expect(sendRenewalEmail).toHaveBeenCalledTimes(1);
  });
});
