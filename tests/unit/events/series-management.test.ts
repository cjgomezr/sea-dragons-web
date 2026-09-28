import { describe, expect, it } from "vitest";
import {
  EventValidationError,
  EventsForbiddenError,
} from "@/lib/events/event-creation";
import {
  SeriesNotFoundError,
  cancelSeries,
  editSeries,
} from "@/lib/events/series-management";
import {
  CALLER_ID,
  CANCELLED_OCCURRENCE_ID,
  EDITED_OCCURRENCE_ID,
  type FakeManagedSeriesClubOptions,
  MASTERS_SQUAD_ID,
  MISSING_SERIES_ID,
  NOW,
  PAST_OCCURRENCE_ID,
  SERIES,
  SERIES_ID,
  SPENT_OCCURRENCE_ID,
  SPENT_SERIES_ID,
  UPCOMING_OCCURRENCE_ID,
  fakeManagedSeriesClub,
} from "../helpers/managed-series-club";

/**
 * Editar y cancelar una serie de hoy en adelante (#315, RF-12 del PRD de
 * E7), sin Supabase delante. Lo que ya ocurrió o se canceló no se toca.
 */

const NEW_TIME_AND_PLACE = {
  startTime: "20:00",
  location: "  Aquatic Centre  ",
} as const;

describe("editar una serie", () => {
  it("cambia la hora y el lugar de la serie y de sus ocurrencias futuras", async () => {
    const club = fakeManagedSeriesClub();

    const edited = await editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      changes: NEW_TIME_AND_PLACE,
    });

    const moved = { startTime: "20:00", location: "Aquatic Centre" };
    expect(edited).toEqual({
      series: { ...SERIES, ...moved },
      updatedOccurrences: 2,
    });
    expect(club.series(SERIES_ID)).toEqual({ ...SERIES, ...moved });
    expect(club.occurrence(UPCOMING_OCCURRENCE_ID)).toMatchObject(moved);
  });

  it("deja editar a un Admin igual que a un Committee", async () => {
    const club = fakeManagedSeriesClub({ callerRole: "Admin" });

    const edited = await editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      changes: { title: "Entrenamiento de verano" },
    });

    expect(edited.series.title).toBe("Entrenamiento de verano");
  });

  it("aplica los cambios también a una ocurrencia futura que se había editado sola", async () => {
    const club = fakeManagedSeriesClub();

    await editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      changes: NEW_TIME_AND_PLACE,
    });

    expect(club.occurrence(EDITED_OCCURRENCE_ID)).toMatchObject({
      startTime: "20:00",
      location: "Aquatic Centre",
      notes: "Piscina 2",
    });
  });

  it("no toca las ocurrencias pasadas ni las canceladas", async () => {
    const club = fakeManagedSeriesClub();
    const past = club.occurrence(PAST_OCCURRENCE_ID);
    const cancelled = club.occurrence(CANCELLED_OCCURRENCE_ID);

    await editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      changes: NEW_TIME_AND_PLACE,
    });

    expect(club.occurrence(PAST_OCCURRENCE_ID)).toEqual(past);
    expect(club.occurrence(CANCELLED_OCCURRENCE_ID)).toEqual(cancelled);
  });

  it("conserva las respuestas de las ocurrencias que cambia", async () => {
    const club = fakeManagedSeriesClub();

    await editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      changes: NEW_TIME_AND_PLACE,
    });

    expect(club.rsvps.get(UPCOMING_OCCURRENCE_ID)).toEqual(["yes", "maybe"]);
  });

  it("sustituye la audiencia entera, sin grupos repetidos", async () => {
    const club = fakeManagedSeriesClub();

    const edited = await editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      changes: {
        audience: {
          kind: "groups",
          groupIds: [MASTERS_SQUAD_ID, MASTERS_SQUAD_ID],
        },
      },
    });

    const audience = { kind: "groups", groupIds: [MASTERS_SQUAD_ID] };
    expect(edited.series.audience).toEqual(audience);
    expect(club.occurrence(UPCOMING_OCCURRENCE_ID)?.audience).toEqual(audience);
  });

  it("rechaza un título vacío como al crear, sin escribir nada", async () => {
    const club = fakeManagedSeriesClub();

    const attempt = editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      changes: { title: "   " },
    });

    await expect(attempt).rejects.toBeInstanceOf(EventValidationError);
    await expect(attempt).rejects.toMatchObject({
      code: "event_title_invalid",
    });
    expect(club.writeCount()).toBe(0);
  });

  it("rechaza un grupo de otro club, sin escribir nada", async () => {
    const club = fakeManagedSeriesClub({ clubGroupIds: [] });

    const attempt = editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      changes: { audience: { kind: "groups", groupIds: [MASTERS_SQUAD_ID] } },
    });

    await expect(attempt).rejects.toMatchObject({
      code: "event_audience_foreign_group",
    });
    expect(club.writeCount()).toBe(0);
  });

  it("rechaza con 422 una serie sin ocurrencias futuras no canceladas", async () => {
    const club = fakeManagedSeriesClub();
    const before = club.series(SPENT_SERIES_ID);

    const attempt = editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SPENT_SERIES_ID,
      changes: NEW_TIME_AND_PLACE,
    });

    await expect(attempt).rejects.toBeInstanceOf(EventValidationError);
    await expect(attempt).rejects.toMatchObject({
      code: "series_without_upcoming",
    });
    expect(club.series(SPENT_SERIES_ID)).toEqual(before);
  });

  it("deja que un fallo de la base suba tal cual", async () => {
    const club = fakeManagedSeriesClub({ failingWrites: true });

    const attempt = editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      changes: NEW_TIME_AND_PLACE,
    });

    await expect(attempt).rejects.toThrow("a mitad de la escritura");
    expect(club.series(SERIES_ID)).toEqual(SERIES);
  });
});

describe("cancelar una serie", () => {
  it("cancela sus ocurrencias futuras con la hora y conserva sus respuestas", async () => {
    const club = fakeManagedSeriesClub();

    const cancelled = await cancelSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      now: NOW,
    });

    expect(cancelled).toEqual({
      seriesId: SERIES_ID,
      cancelledAt: NOW.toISOString(),
      cancelledOccurrences: 2,
    });
    for (const id of [EDITED_OCCURRENCE_ID, UPCOMING_OCCURRENCE_ID]) {
      expect(club.occurrence(id)).toMatchObject({
        status: "cancelled",
        cancelledAt: NOW.toISOString(),
      });
    }
    expect(club.rsvps.get(UPCOMING_OCCURRENCE_ID)).toEqual(["yes", "maybe"]);
  });

  it("no toca las ocurrencias pasadas ni las ya canceladas", async () => {
    const club = fakeManagedSeriesClub();
    const past = club.occurrence(PAST_OCCURRENCE_ID);
    const cancelled = club.occurrence(CANCELLED_OCCURRENCE_ID);

    await cancelSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      now: NOW,
    });

    expect(club.occurrence(PAST_OCCURRENCE_ID)).toEqual(past);
    expect(club.occurrence(CANCELLED_OCCURRENCE_ID)).toEqual(cancelled);
  });

  it("rechaza con 422 una serie sin ocurrencias futuras no canceladas", async () => {
    const club = fakeManagedSeriesClub();
    const before = club.occurrence(SPENT_OCCURRENCE_ID);

    const attempt = cancelSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SPENT_SERIES_ID,
      now: NOW,
    });

    await expect(attempt).rejects.toMatchObject({
      code: "series_without_upcoming",
    });
    expect(club.occurrence(SPENT_OCCURRENCE_ID)).toEqual(before);
  });
});

describe("quién puede editar y cancelar una serie", () => {
  const forbiddenRoles: readonly FakeManagedSeriesClubOptions["callerRole"][] =
    ["Coach", "Player"];

  it.each(forbiddenRoles)("niega editar a un %s", async (callerRole) => {
    const club = fakeManagedSeriesClub({ callerRole });

    const attempt = editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      changes: NEW_TIME_AND_PLACE,
    });

    await expect(attempt).rejects.toBeInstanceOf(EventsForbiddenError);
    expect(club.writeCount()).toBe(0);
  });

  it.each(forbiddenRoles)("niega cancelar a un %s", async (callerRole) => {
    const club = fakeManagedSeriesClub({ callerRole });

    const attempt = cancelSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      now: NOW,
    });

    await expect(attempt).rejects.toBeInstanceOf(EventsForbiddenError);
    expect(club.writeCount()).toBe(0);
  });

  it("responde que no existe a una serie de otro club o que no existe", async () => {
    const club = fakeManagedSeriesClub();

    const edit = editSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: MISSING_SERIES_ID,
      changes: NEW_TIME_AND_PLACE,
    });
    const cancellation = cancelSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: MISSING_SERIES_ID,
      now: NOW,
    });

    await expect(edit).rejects.toBeInstanceOf(SeriesNotFoundError);
    await expect(cancellation).rejects.toBeInstanceOf(SeriesNotFoundError);
    expect(club.writeCount()).toBe(0);
  });
});
