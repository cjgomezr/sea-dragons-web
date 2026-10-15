import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  EVENT_TITLE_MAX_LENGTH,
  type EventIssueCode,
  EventValidationError,
  EventsForbiddenError,
} from "@/lib/events/event-creation";
import {
  type EventEditDraft,
  cancelEvent,
  editEvent,
} from "@/lib/events/event-management";
import { PLACE_DETAIL_MAX_LENGTH } from "@/lib/events/event-place";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import {
  CALLER_ID,
  CANCELLED_EVENT_ID,
  type FakeManagedEventsClubOptions,
  FIRST_OCCURRENCE_ID,
  LEGACY_EVENT_ID,
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
    readonly changes: EventEditDraft;
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

describe("editar un evento: hora y fecha de fin", () => {
  async function editSingle(
    changes: EventEditDraft,
    eventId = SINGLE_EVENT_ID,
  ) {
    const club = fakeManagedEventsClub();
    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId,
      changes,
      now: NOW,
    });
    return { club, edited };
  }

  it("cambia la hora de fin", async () => {
    const { edited } = await editSingle({ endTime: "13:30" });

    expect(edited).toMatchObject({ endTime: "13:30", endsOn: null });
  });

  it("conserva la hora de fin al cambiar otra cosa", async () => {
    const { edited } = await editSingle({ location: "Aquatic Centre" });

    expect(edited).toMatchObject({ endTime: "12:00", endsOn: null });
  });

  it("lo alarga a varios días con cualquier hora de fin", async () => {
    const { edited } = await editSingle({
      endsOn: "2027-07-11",
      endTime: "09:00",
    });

    expect(edited).toMatchObject({ endTime: "09:00", endsOn: "2027-07-11" });
  });

  it("guarda como de un día una fecha de fin igual a la de inicio", async () => {
    const { edited } = await editSingle({ endsOn: "2027-07-10" });

    expect(edited.endsOn).toBeNull();
  });

  it("rechaza una hora de fin que no va después del inicio", async () => {
    await expectEditRejected(
      { changes: { endTime: "10:00" } },
      "end_before_start",
    );
  });

  it("rechaza mover el inicio a después de la hora de fin que ya tenía", async () => {
    await expectEditRejected(
      { changes: { startTime: "12:30" } },
      "end_before_start",
    );
  });

  it("rechaza mover el inicio a después de su fecha de fin", async () => {
    const { club } = await editSingle({
      endsOn: "2027-07-11",
      endTime: "09:00",
    });

    const attempt = editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { startsOn: "2027-07-12" },
      now: NOW,
    });

    await expect(attempt).rejects.toMatchObject({ code: "end_before_start" });
  });

  it("rechaza una fecha de fin anterior a la de inicio", async () => {
    await expectEditRejected(
      { changes: { endsOn: "2027-07-09" } },
      "end_before_start",
    );
  });

  it("rechaza que una sesión de una serie dure varios días", async () => {
    await expectEditRejected(
      { eventId: FIRST_OCCURRENCE_ID, changes: { endsOn: "2027-07-07" } },
      "multi_day_series",
    );
  });

  it("rechaza quitarle la hora de fin", async () => {
    await expectEditRejected(
      { changes: { endTime: null } },
      "end_time_required",
    );
  });

  it("rechaza guardar un evento anterior a E24 sin ponerle hora de fin", async () => {
    await expectEditRejected(
      { eventId: LEGACY_EVENT_ID, changes: { location: "Aquatic Centre" } },
      "end_time_required",
    );
  });

  it("guarda un evento anterior a E24 cuando se le pone hora de fin", async () => {
    const { edited } = await editSingle(
      { location: "Aquatic Centre", endTime: "11:00" },
      LEGACY_EVENT_ID,
    );

    expect(edited).toMatchObject({
      location: "Aquatic Centre",
      endTime: "11:00",
    });
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

  it("rechaza con 422 si otro organizador lo canceló entretanto", async () => {
    const club = fakeManagedEventsClub({
      cancelledMeanwhile: SINGLE_EVENT_ID,
    });

    const attempt = cancelEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      now: NOW,
    });

    await expect(attempt).rejects.toBeInstanceOf(EventValidationError);
    await expect(attempt).rejects.toMatchObject({ code: "event_cancelled" });
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

describe("editar un evento: lugar estructurado", () => {
  const MSAC_PLACE = {
    name: "MSAC",
    address: "Aughtie Dr, Albert Park VIC 3206",
    lat: -37.8423,
    lng: 144.9601,
  } as const;

  async function editSingle(changes: EventEditDraft) {
    const club = fakeManagedEventsClub();
    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes,
      now: NOW,
    });
    return { club, edited };
  }

  it("guarda el lugar elegido y dónde exactamente, y enseña su nombre", async () => {
    const { club, edited } = await editSingle({
      location: "Lo que había escrito",
      place: { ...MSAC_PLACE, name: " Aquatic Centre " },
      placeDetail: " Piscina de buceo ",
    });

    expect(edited).toMatchObject({
      location: "Aquatic Centre",
      place: { ...MSAC_PLACE, name: "Aquatic Centre" },
      placeDetail: "Piscina de buceo",
    });
    expect(club.event(SINGLE_EVENT_ID)).toEqual(edited);
  });

  it("quita el lugar elegido y vuelve al texto libre", async () => {
    const club = fakeManagedEventsClub();
    await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { place: MSAC_PLACE, placeDetail: "Piscina de buceo" },
      now: NOW,
    });

    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: {
        location: "Piscina de Box Hill",
        place: null,
        placeDetail: null,
      },
      now: NOW,
    });

    expect(edited).toMatchObject({
      location: "Piscina de Box Hill",
      place: null,
      placeDetail: null,
    });
  });

  it("conserva el lugar al cambiar otra cosa", async () => {
    const club = fakeManagedEventsClub();
    await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { place: MSAC_PLACE },
      now: NOW,
    });

    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { title: "Final estatal" },
      now: NOW,
    });

    expect(edited.place).toEqual(MSAC_PLACE);
  });

  it("cambiar sólo el texto libre quita el lugar elegido y su detalle", async () => {
    const club = fakeManagedEventsClub();
    await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { place: MSAC_PLACE, placeDetail: "Piscina de buceo" },
      now: NOW,
    });

    const edited = await editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      changes: { location: "Piscina de Box Hill" },
      now: NOW,
    });

    expect(edited).toMatchObject({
      location: "Piscina de Box Hill",
      place: null,
      placeDetail: null,
    });
  });

  it("conserva el detalle que llega junto al texto libre", async () => {
    const { edited } = await editSingle({
      location: "Piscina de Box Hill",
      placeDetail: "Carril 3",
    });

    expect(edited).toMatchObject({ place: null, placeDetail: "Carril 3" });
  });

  it("rechaza coordenadas fuera de rango sin escribir nada", async () => {
    await expectEditRejected(
      { changes: { place: { ...MSAC_PLACE, lat: -95 } } },
      "event_place_coordinates_invalid",
    );
  });

  it("rechaza una latitud sin longitud sin escribir nada", async () => {
    await expectEditRejected(
      { changes: { place: { name: "MSAC", lat: -37.8 } } },
      "event_place_coordinates_invalid",
    );
  });

  it("rechaza un detalle demasiado largo sin escribir nada", async () => {
    await expectEditRejected(
      { changes: { placeDetail: "x".repeat(PLACE_DETAIL_MAX_LENGTH + 1) } },
      "event_place_detail_invalid",
    );
  });
});
