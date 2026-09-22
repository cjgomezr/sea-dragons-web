import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/i18n/format";
import { createTranslator } from "@/lib/i18n/translator";
import { describeNotification } from "@/lib/notifications/notification-text";
import { NOTIFICATION_TYPES } from "@/lib/notifications/notify-member";

// #266: la pantalla arma el texto de cada aviso con su tipo y sus datos, en
// el idioma en que se mira, no en el que tenía la aplicación al crearlo.

const DATA_FOR_EVERY_TYPE = {
  role_changed: { newRole: "Coach" },
  role_request_rejected: { requestedRole: "Committee" },
  role_request_received: { requesterName: "Ana Ruiz", requestedRole: "Coach" },
} as const;

describe("textos de los avisos", () => {
  for (const locale of ["en", "es"] as const) {
    for (const type of NOTIFICATION_TYPES) {
      it(`el tipo ${type} tiene título y cuerpo en ${locale}`, () => {
        const text = describeNotification(createTranslator(locale), {
          type,
          data: DATA_FOR_EVERY_TYPE[type],
        });

        expect(text.title).not.toBe("");
        expect(text.body).not.toBe("");
        expect(text).not.toEqual(
          describeNotification(createTranslator(locale), {
            type: "unknown",
            data: {},
          }),
        );
      });
    }
  }

  it("cuenta el cambio de rol con el rol nuevo en inglés", () => {
    const text = describeNotification(createTranslator("en"), {
      type: "role_changed",
      data: { newRole: "Committee" },
    });

    expect(text).toEqual({
      title: "Your role changed",
      body: "You are now Committee.",
    });
  });

  it("cuenta el mismo aviso en español, con el rol traducido", () => {
    const text = describeNotification(createTranslator("es"), {
      type: "role_changed",
      data: { newRole: "Committee" },
    });

    expect(text).toEqual({
      title: "Tu rol cambió",
      body: "Ahora eres Comité.",
    });
  });

  it("nombra a quien pide un rol en el aviso que recibe el Admin", () => {
    const text = describeNotification(createTranslator("en"), {
      type: "role_request_received",
      data: { requesterName: "Ana Ruiz", requestedRole: "Coach" },
    });

    expect(text.body).toBe("Ana Ruiz asked to be Coach.");
  });

  it("da un texto genérico a un tipo que la pantalla no reconoce", () => {
    const text = describeNotification(createTranslator("en"), {
      type: "event_created",
      data: { eventName: "Training" },
    });

    expect(text).toEqual({
      title: "New notification",
      body: "Something changed in your account.",
    });
  });

  it("da el texto genérico cuando los datos no encajan con el tipo", () => {
    const text = describeNotification(createTranslator("es"), {
      type: "role_changed",
      data: { newRole: "Capitán" },
    });

    expect(text).toEqual({
      title: "Aviso nuevo",
      body: "Algo cambió en tu cuenta.",
    });
  });

  it("da el texto genérico cuando falta un dato", () => {
    const text = describeNotification(createTranslator("en"), {
      type: "role_request_received",
      data: { requestedRole: "Coach" },
    });

    expect(text.title).toBe("New notification");
  });
});

describe("tiempo relativo", () => {
  const now = new Date("2026-09-22T10:00:00.000Z");

  it("escribe hace cuántos minutos en inglés", () => {
    const instant = new Date("2026-09-22T09:55:00.000Z");

    expect(formatRelativeTime("en", instant, now)).toBe("5 minutes ago");
  });

  it("escribe lo mismo en español", () => {
    const instant = new Date("2026-09-22T09:55:00.000Z");

    expect(formatRelativeTime("es", instant, now)).toBe("hace 5 minutos");
  });

  it("cuenta en horas pasada la hora", () => {
    const instant = new Date("2026-09-22T07:00:00.000Z");

    expect(formatRelativeTime("en", instant, now)).toBe("3 hours ago");
  });

  it("cuenta en días pasado el día", () => {
    const instant = new Date("2026-09-19T10:00:00.000Z");

    expect(formatRelativeTime("es", instant, now)).toBe("hace 3 días");
  });

  it("cuenta en semanas pasada la semana", () => {
    const instant = new Date("2026-09-08T10:00:00.000Z");

    expect(formatRelativeTime("en", instant, now)).toBe("2 weeks ago");
  });

  it("cuenta en meses pasados los treinta días", () => {
    const instant = new Date("2026-06-22T10:00:00.000Z");

    expect(formatRelativeTime("en", instant, now)).toBe("3 months ago");
  });

  it("cuenta en años pasado el año", () => {
    const instant = new Date("2024-09-01T10:00:00.000Z");

    expect(formatRelativeTime("es", instant, now)).toBe("hace 2 años");
  });

  it("dice ahora para lo que llegó hace menos de un minuto", () => {
    const instant = new Date("2026-09-22T09:59:30.000Z");

    expect(formatRelativeTime("en", instant, now)).toBe("now");
    expect(formatRelativeTime("es", instant, now)).toBe("ahora");
  });

  it("no escribe un futuro cuando el reloj del navegador va atrasado", () => {
    const instant = new Date("2026-09-22T10:02:00.000Z");

    expect(formatRelativeTime("en", instant, now)).toBe("now");
  });
});
