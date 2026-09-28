import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  EVENT_TITLE_MAX_LENGTH,
  type EventIssueCode,
  EventValidationError,
  EventsForbiddenError,
} from "@/lib/events/event-creation";
import {
  type EventEdit,
  cancelEvent,
  editEvent,
} from "@/lib/events/event-management";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import {
  CALLER_ID,
  CANCELLED_EVENT_ID,
  type FakeManagedEventsClubOptions,
  FIRST_OCCURRENCE_ID,
  MASTERS_SQUAD_ID,
  MISSING_EVENT_ID,
  NOW,
  PAST_EVENT_ID,
  SECOND_OCCURRENCE_ID,
  SENIOR_SQUAD_ID,
  SERIES_ID,
  SINGLE_EVENT,
  SINGLE_EVENT_ID,
  fakeManagedEventsClub,
} from "../helpers/managed-events-club";

/**
 * Editar y cancelar un evento suelto o una ocurrencia (#314, RF-11 del PRD
 * de E7), sin Supabase delante. Cada rechazo deja el evento como estaba.
 */

async function expectEditRejected(
  edit: {
    readonly eventId?: string;
    readonly changes: EventEdit;
  },
  code: EventIssueCode,
): Promise<void> {
  const club = fakeManagedEventsClub();
  const eventId = edit.eventId ?? SINGLE_EVENT_ID;
  const before = club.event(eventId);

  const attempt = editEvent(club.gateways, {
    callerId: CALLER_ID,
    eventId,
    changes: edit.changes,
    now: NOW,
  });

  await expect(attempt).rejects.toBeInstanceOf(EventValidationError);
  await expect(attempt).rejects.toMatchObject({ code });
  expect(club.event(eventId)).toEqual(before);
}

describe("editar un evento", () => {
  it("cambia sólo el lugar y deja lo demás y las respuestas como estaban", async () => {
    const club = fakeManagedEventsClub();

    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { location: "  Aquatic Centre  " },
      now: NOW,
    });

    const expected = { ...SINGLE_EVENT, location: "Aquatic Centre" };
    expect(edited).toEqual(expected);
    expect(club.event(SINGLE_EVENT_ID)).toEqual(expected);
    expect(club.rsvps.get(SINGLE_EVENT_ID)).toEqual(["yes", "maybe"]);
  });

  it("deja editar a un Admin igual que a un Committee", async () => {
    const club = fakeManagedEventsClub({ callerRole: "Admin" });

    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { title: "Liga estatal, jornada 2" },
      now: NOW,
    });

    expect(edited.title).toBe("Liga estatal, jornada 2");
  });

  it("cambia sólo esa ocurrencia y deja las demás y la serie como estaban", async () => {
    const club = fakeManagedEventsClub();
    const sibling = club.event(SECOND_OCCURRENCE_ID);

    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: FIRST_OCCURRENCE_ID,
      changes: {
        startsOn: "2027-07-07",
        startTime: "18:30",
        notes: "Piscina 2",
      },
      now: NOW,
    });

    expect(edited).toMatchObject({
      id: FIRST_OCCURRENCE_ID,
      seriesId: SERIES_ID,
      startsOn: "2027-07-07",
      startTime: "18:30",
      notes: "Piscina 2",
    });
    expect(club.event(SECOND_OCCURRENCE_ID)).toEqual(sibling);
  });

  it("sustituye la audiencia entera por la nueva", async () => {
    const club = fakeManagedEventsClub();

    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: {
        audience: {
          kind: "groups",
          groupIds: [MASTERS_SQUAD_ID, MASTERS_SQUAD_ID],
        },
      },
      now: NOW,
    });

    expect(edited.audience).toEqual({
      kind: "groups",
      groupIds: [MASTERS_SQUAD_ID],
    });
  });

  it("pasa de unos grupos a todo el club", async () => {
    const club = fakeManagedEventsClub();

    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { audience: { kind: "club" } },
      now: NOW,
    });

    expect(edited.audience).toEqual({ kind: "club" });
  });

  it("no escribe nada si uno de los grupos nuevos es de otro club", async () => {
    await expectEditRejected(
      {
        changes: {
          audience: {
            kind: "groups",
            groupIds: [SENIOR_SQUAD_ID, "0f0f0f0f-0000-4000-8000-00000000000f"],
          },
        },
      },
      "event_audience_foreign_group",
    );
  });

  it("rechaza una audiencia de cero grupos", async () => {
    await expectEditRejected(
      { changes: { audience: { kind: "groups", groupIds: [] } } },
      "event_audience_empty",
    );
  });

  it("rechaza moverlo a una fecha que ya pasó", async () => {
    await expectEditRejected(
      { changes: { startsOn: "2027-06-14" } },
      "event_in_past",
    );
  });

  it("rechaza moverlo a una hora de hoy que ya pasó", async () => {
    await expectEditRejected(
      { changes: { startsOn: "2027-06-15", startTime: "09:59" } },
      "event_in_past",
    );
  });

  it("rechaza un título vacío como al crear", async () => {
    await expectEditRejected(
      { changes: { title: "   " } },
      "event_title_invalid",
    );
  });

  it("rechaza un título demasiado largo como al crear", async () => {
    await expectEditRejected(
      { changes: { title: "x".repeat(EVENT_TITLE_MAX_LENGTH + 1) } },
      "event_title_invalid",
    );
  });

  it("guarda unas notas en blanco como ninguna", async () => {
    const club = fakeManagedEventsClub();

    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { notes: "   " },
      now: NOW,
    });

    expect(edited.notes).toBeNull();
  });

  it("rechaza con 422 un evento que ya empezó", async () => {
    await expectEditRejected(
      { eventId: PAST_EVENT_ID, changes: { location: "MSAC 2" } },
      "event_started",
    );
  });

  it("rechaza con 422 un evento cancelado", async () => {
    await expectEditRejected(
      { eventId: CANCELLED_EVENT_ID, changes: { location: "MSAC 2" } },
      "event_cancelled",
    );
  });

  it("rechaza con 422 si otro organizador lo canceló entretanto", async () => {
    const club = fakeManagedEventsClub({
      cancelledMeanwhile: SINGLE_EVENT_ID,
    });

    const attempt = editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { location: "MSAC 2" },
      now: NOW,
    });

    await expect(attempt).rejects.toMatchObject({ code: "event_cancelled" });
  });

  it("deja lo que guardó el último cuando dos organizadores editan a la vez", async () => {
    const club = fakeManagedEventsClub();
    const editTo = (location: string): Promise<unknown> =>
      editEvent(club.gateways, {
        callerId: CALLER_ID,
        eventId: SINGLE_EVENT_ID,
        changes: { location },
        now: NOW,
      });

    await Promise.all([editTo("Primera piscina"), editTo("Segunda piscina")]);

    expect(club.event(SINGLE_EVENT_ID)?.location).toBe("Segunda piscina");
  });
});

describe("cancelar un evento", () => {
  it("lo marca cancelado con la hora y conserva sus respuestas", async () => {
    const club = fakeManagedEventsClub();

    const cancelled = await cancelEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      now: NOW,
    });

    const expected = {
      ...SINGLE_EVENT,
      status: "cancelled",
      cancelledAt: NOW.toISOString(),
    };
    expect(cancelled).toEqual(expected);
    expect(club.event(SINGLE_EVENT_ID)).toEqual(expected);
    expect(club.rsvps.get(SINGLE_EVENT_ID)).toEqual(["yes", "maybe"]);
  });

  it("cancela sólo esa ocurrencia de la serie", async () => {
    const club = fakeManagedEventsClub();

    await cancelEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: FIRST_OCCURRENCE_ID,
      now: NOW,
    });

    expect(club.event(SECOND_OCCURRENCE_ID)?.status).toBe("scheduled");
  });

  it("rechaza con 422 un evento que ya empezó", async () => {
    const club = fakeManagedEventsClub();

    const attempt = cancelEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: PAST_EVENT_ID,
      now: NOW,
    });

    await expect(attempt).rejects.toMatchObject({ code: "event_started" });
    expect(club.event(PAST_EVENT_ID)?.status).toBe("scheduled");
  });

  it("rechaza con 422 un evento ya cancelado", async () => {
    const club = fakeManagedEventsClub();

    const attempt = cancelEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: CANCELLED_EVENT_ID,
      now: NOW,
    });

    await expect(attempt).rejects.toMatchObject({ code: "event_cancelled" });
    expect(club.writeCount()).toBe(0);
  });
});

describe("quién puede editar y cancelar", () => {
  const forbiddenRoles: readonly FakeManagedEventsClubOptions["callerRole"][] =
    ["Coach", "Player"];

  it.each(forbiddenRoles)("niega editar a un %s", async (callerRole) => {
    const club = fakeManagedEventsClub({ callerRole });

    const attempt = editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { location: "MSAC 2" },
      now: NOW,
    });

    await expect(attempt).rejects.toBeInstanceOf(EventsForbiddenError);
    expect(club.writeCount()).toBe(0);
  });

  it.each(forbiddenRoles)("niega cancelar a un %s", async (callerRole) => {
    const club = fakeManagedEventsClub({ callerRole });

    const attempt = cancelEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      now: NOW,
    });

    await expect(attempt).rejects.toBeInstanceOf(EventsForbiddenError);
    expect(club.writeCount()).toBe(0);
  });

  it("responde que no existe a un evento de otro club o que no existe", async () => {
    const club = fakeManagedEventsClub();

    const attempt = cancelEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: MISSING_EVENT_ID,
      now: NOW,
    });

    await expect(attempt).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("no busca el evento de quien no es socio", async () => {
    const club = fakeManagedEventsClub({ callerIsMember: false });

    const attempt = editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { location: "MSAC 2" },
      now: NOW,
    });

    await expect(attempt).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
