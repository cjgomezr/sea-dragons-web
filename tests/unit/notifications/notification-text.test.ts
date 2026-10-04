import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/i18n/format";
import { createTranslator } from "@/lib/i18n/translator";
import {
  ACCOUNT_PAGE_PATH,
  CALENDAR_PATH,
  DIRECTORY_PATH,
  NEWS_POST_PATH,
  PAYMENTS_PATH,
} from "@/lib/auth/routes";
import {
  describeNotification,
  notificationDestination,
} from "@/lib/notifications/notification-text";
import { NOTIFICATION_TYPES } from "@/lib/notifications/notify-member";

// #266: la pantalla arma el texto de cada aviso con su tipo y sus datos, en
// el idioma en que se mira, no en el que tenía la aplicación al crearlo.

const DATA_FOR_EVERY_TYPE = {
  role_changed: { newRole: "Coach" },
  role_request_rejected: { requestedRole: "Committee" },
  role_request_received: { requesterName: "Ana Ruiz", requestedRole: "Coach" },
  news_post_published: {
    postId: "d4000000-0000-4000-8000-000000000004",
    category: "announcement",
    title: "Cambia la piscina",
  },
  event_created: {
    eventId: "e0000000-0000-4000-8000-00000000000e",
    title: "Liga estatal",
    eventType: "competition",
    startsOn: "2027-07-10",
    startTime: "10:00",
  },
  event_series_created: {
    seriesId: "c2c2c2c2-0000-4000-8000-00000000000c",
    title: "Entrenamiento",
    eventType: "training",
    weekdays: [2, 4],
    startsOn: "2027-07-01",
    endsOn: "2027-08-31",
    startTime: "19:00",
  },
  event_changed: {
    eventId: "e0000000-0000-4000-8000-00000000000e",
    title: "Liga estatal",
    startsOn: "2027-07-11",
    startTime: "11:30",
    location: "Aquatic Centre",
  },
  event_cancelled: {
    eventId: "e0000000-0000-4000-8000-00000000000e",
    title: "Liga estatal",
    startsOn: "2027-07-10",
    startTime: "10:00",
  },
  event_series_changed: {
    seriesId: "c2c2c2c2-0000-4000-8000-00000000000c",
    title: "Entrenamiento",
    weekdays: [2, 4],
    startTime: "18:00",
    location: "Aquatic Centre",
  },
  event_series_cancelled: {
    seriesId: "c2c2c2c2-0000-4000-8000-00000000000c",
    title: "Entrenamiento",
    weekdays: [2, 4],
    startTime: "19:00",
  },
  team_assigned: {
    eventId: "e1e1e1e1-0000-4000-8000-00000000000e",
    title: "Scrimmage",
    startsOn: "2027-07-10",
    startTime: "10:00",
    teamName: "Team Kelp",
    teamColor: "#1C6EA4",
  },
  team_unassigned: {
    eventId: "e1e1e1e1-0000-4000-8000-00000000000e",
    title: "Scrimmage",
    startsOn: "2027-07-10",
    startTime: "10:00",
  },
  membership_renewal_upcoming: {
    amountCents: 4500,
    chargeOn: "2026-10-29",
    card: { brand: "visa", last4: "4242" },
  },
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

// #338: abrir un aviso lleva a la pantalla donde se actúa sobre él.
describe("destino de cada aviso", () => {
  it("lleva una solicitud de rol recibida al directorio, donde se decide", () => {
    expect(
      notificationDestination({
        type: "role_request_received",
        data: DATA_FOR_EVERY_TYPE.role_request_received,
      }),
    ).toBe(DIRECTORY_PATH);
  });

  it("lleva un cambio de rol a Mi cuenta", () => {
    expect(
      notificationDestination({
        type: "role_changed",
        data: DATA_FOR_EVERY_TYPE.role_changed,
      }),
    ).toBe(ACCOUNT_PAGE_PATH);
  });

  it("lleva una solicitud de rol rechazada a Mi cuenta", () => {
    expect(
      notificationDestination({
        type: "role_request_rejected",
        data: DATA_FOR_EVERY_TYPE.role_request_rejected,
      }),
    ).toBe(ACCOUNT_PAGE_PATH);
  });

  it("no lleva a ninguna parte un tipo que la pantalla no reconoce", () => {
    expect(
      notificationDestination({ type: "event_exploded", data: {} }),
    ).toBeNull();
  });

  // Cuando E7 o E11 añadan tipos, este test pide decir a dónde llevan.
  for (const type of NOTIFICATION_TYPES) {
    it(`el tipo ${type} del catálogo declara su destino`, () => {
      expect(
        notificationDestination({ type, data: DATA_FOR_EVERY_TYPE[type] }),
      ).toMatch(/^\//);
    });
  }
});

// #332: el aviso de una publicación nueva.
describe("el texto del aviso", () => {
  const PUBLISHED = {
    type: "news_post_published",
    data: DATA_FOR_EVERY_TYPE.news_post_published,
  } as const;

  it("dice la categoría y el título en inglés", () => {
    const text = describeNotification(createTranslator("en"), PUBLISHED);

    expect(text).toEqual({
      title: "New post: Announcement",
      body: "Cambia la piscina",
    });
  });

  it("dice la categoría traducida y el título en español", () => {
    const text = describeNotification(createTranslator("es"), PUBLISHED);

    expect(text).toEqual({
      title: "Nueva publicación: Aviso",
      body: "Cambia la piscina",
    });
  });

  it("da el texto genérico cuando la categoría no es del catálogo", () => {
    const text = describeNotification(createTranslator("en"), {
      type: "news_post_published",
      data: { ...PUBLISHED.data, category: "gossip" },
    });

    expect(text.title).toBe("New notification");
  });

  it("lleva a la publicación", () => {
    expect(notificationDestination(PUBLISHED)).toBe(
      NEWS_POST_PATH.replace("[id]", PUBLISHED.data.postId),
    );
  });

  it("no lleva a ninguna parte cuando falta la publicación", () => {
    expect(
      notificationDestination({
        type: "news_post_published",
        data: { category: "news", title: "Sin id" },
      }),
    ).toBeNull();
  });
});

// #310: el aviso de un evento o una serie nuevos.
describe("texto de los avisos de evento", () => {
  const EVENT = {
    type: "event_created",
    data: DATA_FOR_EVERY_TYPE.event_created,
  } as const;
  const SERIES = {
    type: "event_series_created",
    data: DATA_FOR_EVERY_TYPE.event_series_created,
  } as const;

  it("dice el tipo, el título, la fecha y la hora del evento en inglés", () => {
    const text = describeNotification(createTranslator("en"), EVENT);

    expect(text).toEqual({
      title: "New event: Competition",
      body: "Liga estatal: 10 July 2027 at 10:00 am",
    });
  });

  it("dice el tipo, el título, la fecha y la hora del evento en español", () => {
    const text = describeNotification(createTranslator("es"), EVENT);

    expect(text).toEqual({
      title: "Nuevo evento: Competición",
      body: "Liga estatal: 10 de julio de 2027, 10:00",
    });
  });

  it("dice los días de la semana y el rango de la serie en inglés", () => {
    const text = describeNotification(createTranslator("en"), SERIES);

    expect(text).toEqual({
      title: "New series: Training",
      body: "Entrenamiento: Tuesday and Thursday at 7:00 pm, from 1 July 2027 to 31 August 2027",
    });
  });

  it("dice los días de la semana y el rango de la serie en español", () => {
    const text = describeNotification(createTranslator("es"), SERIES);

    expect(text).toEqual({
      title: "Nueva serie: Entrenamiento",
      body: "Entrenamiento: martes y jueves, 19:00, del 1 de julio de 2027 al 31 de agosto de 2027",
    });
  });

  it.each([
    ["un tipo de evento que no es del catálogo", { eventType: "party" }],
    ["una fecha que no existe", { startsOn: "2027-02-30" }],
    ["una hora que no es HH:MM", { startTime: "7pm" }],
  ])("da el texto genérico con %s", (_case, broken) => {
    const text = describeNotification(createTranslator("en"), {
      type: "event_created",
      data: { ...EVENT.data, ...broken },
    });

    expect(text.title).toBe("New notification");
  });

  it.each([
    ["sin días", { weekdays: [] }],
    ["con un día fuera de la semana", { weekdays: [8] }],
    ["con una fecha de fin que no existe", { endsOn: "2027-13-01" }],
  ])("da el texto genérico para una serie %s", (_case, broken) => {
    const text = describeNotification(createTranslator("es"), {
      type: "event_series_created",
      data: { ...SERIES.data, ...broken },
    });

    expect(text.title).toBe("Aviso nuevo");
  });

  it("lleva al calendario", () => {
    expect(notificationDestination(EVENT)).toBe(CALENDAR_PATH);
    expect(notificationDestination(SERIES)).toBe(CALENDAR_PATH);
  });

  it("no lleva a ninguna parte cuando los datos no encajan", () => {
    expect(
      notificationDestination({ type: "event_created", data: {} }),
    ).toBeNull();
  });
});

describe("texto de los avisos de cambio, cancelación y equipos", () => {
  const cases = [
    {
      type: "event_changed",
      en: {
        title: "Event changed",
        body: "Liga estatal: now 11 July 2027 at 11:30 am, at Aquatic Centre",
      },
      es: {
        title: "Evento cambiado",
        body: "Liga estatal: ahora el 11 de julio de 2027, 11:30, en Aquatic Centre",
      },
    },
    {
      type: "event_cancelled",
      en: {
        title: "Event cancelled",
        body: "Liga estatal: 10 July 2027 at 10:00 am",
      },
      es: {
        title: "Evento cancelado",
        body: "Liga estatal: 10 de julio de 2027, 10:00",
      },
    },
    {
      type: "event_series_changed",
      en: {
        title: "Series changed",
        body: "Entrenamiento: now Tuesday and Thursday at 6:00 pm, at Aquatic Centre",
      },
      es: {
        title: "Serie cambiada",
        body: "Entrenamiento: ahora martes y jueves, 18:00, en Aquatic Centre",
      },
    },
    {
      type: "event_series_cancelled",
      en: {
        title: "Series cancelled",
        body: "Entrenamiento: Tuesday and Thursday at 7:00 pm, from today on",
      },
      es: {
        title: "Serie cancelada",
        body: "Entrenamiento: martes y jueves, 19:00, de hoy en adelante",
      },
    },
    {
      type: "team_assigned",
      en: {
        title: "You're playing in Team Kelp",
        body: "Scrimmage: 10 July 2027 at 10:00 am",
      },
      es: {
        title: "Juegas en Team Kelp",
        body: "Scrimmage: 10 de julio de 2027, 10:00",
      },
    },
    {
      type: "team_unassigned",
      en: {
        title: "You're no longer in a team",
        body: "Scrimmage: 10 July 2027 at 10:00 am",
      },
      es: {
        title: "Ya no estás en ningún equipo",
        body: "Scrimmage: 10 de julio de 2027, 10:00",
      },
    },
  ] as const;

  for (const { type, ...byLocale } of cases) {
    for (const locale of ["en", "es"] as const) {
      it(`cuenta ${type} en ${locale}`, () => {
        const text = describeNotification(createTranslator(locale), {
          type,
          data: DATA_FOR_EVERY_TYPE[type],
        });

        expect(text).toEqual(byLocale[locale]);
      });
    }

    it(`${type} lleva al calendario`, () => {
      expect(
        notificationDestination({ type, data: DATA_FOR_EVERY_TYPE[type] }),
      ).toBe(CALENDAR_PATH);
    });

    it(`${type} da el texto genérico con una hora que no es HH:MM`, () => {
      const text = describeNotification(createTranslator("en"), {
        type,
        data: { ...DATA_FOR_EVERY_TYPE[type], startTime: "7pm" },
      });

      expect(text.title).toBe("New notification");
    });
  }
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

// #470: el aviso de renovación siete días antes del cobro.
describe("el aviso de renovación", () => {
  const RENEWAL = {
    type: "membership_renewal_upcoming",
    data: DATA_FOR_EVERY_TYPE.membership_renewal_upcoming,
  };

  it("cuenta en inglés el importe, el día del cobro y la tarjeta", () => {
    const text = describeNotification(createTranslator("en"), RENEWAL);

    expect(text).toEqual({
      title: "Your membership renews soon",
      body: "$45.00 will be charged to your Visa ending in 4242 on 29 October 2026.",
    });
  });

  it("cuenta lo mismo en español, con el importe a la española", () => {
    const text = describeNotification(createTranslator("es"), RENEWAL);

    expect(text).toEqual({
      title: "Tu membresía se renueva pronto",
      body: "El 29 de octubre de 2026 se cobrarán 45,00\u00a0AUD en tu Visa terminada en 4242.",
    });
  });

  it("sin tarjeta guardada, cuenta el importe y el día", () => {
    const text = describeNotification(createTranslator("en"), {
      ...RENEWAL,
      data: { ...RENEWAL.data, card: null },
    });

    expect(text.body).toBe("$45.00 will be charged on 29 October 2026.");
  });

  it("lleva a Pagos", () => {
    expect(notificationDestination(RENEWAL)).toBe(PAYMENTS_PATH);
  });

  it("con un importe que no es de centavos enteros da el texto genérico", () => {
    const text = describeNotification(createTranslator("en"), {
      ...RENEWAL,
      data: { ...RENEWAL.data, amountCents: 45.5 },
    });

    expect(text.title).toBe(
      describeNotification(createTranslator("en"), { type: "x", data: {} })
        .title,
    );
  });
});
