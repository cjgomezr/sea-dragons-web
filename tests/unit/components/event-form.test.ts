import { describe, expect, it } from "vitest";
import {
  EMPTY_EVENT_FORM,
  endScopeOf,
  type EventForm,
  formFromEvent,
  isFieldIssueCode,
  issueFromApi,
  listEventChanges,
  listMissingFields,
  listSeriesChanges,
  toEventDraft,
} from "@/components/calendar/event-form";
import type { AgendaEvent } from "@/lib/events/event-agenda";

/**
 * Lo que manda el diálogo al editar (#316): sólo lo que cambió, para que una
 * serie no pise con un campo intacto lo que una ocurrencia tenía editado.
 */

const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000009";
const MASTERS_ID = "8b8b8b8b-0000-4000-8000-000000000008";
const COVER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";

const SAVED: EventForm = {
  ...EMPTY_EVENT_FORM,
  title: "Pool Training",
  startsOn: "2026-10-06",
  startTime: "19:00",
  location: "MSAC Dive Pool",
  notes: "",
  audience: { kind: "groups", groupIds: new Set([SENIOR_ID, MASTERS_ID]) },
};

describe("cambios al editar", () => {
  it("no manda nada si nada cambió", () => {
    expect(listEventChanges(SAVED, { ...SAVED })).toEqual({});
  });

  it("no cuenta como cambio unas notas que siguen en blanco", () => {
    const edited = { ...SAVED, notes: "   " };

    expect(listEventChanges(SAVED, edited)).toEqual({});
  });

  it("manda las notas borradas como ninguna", () => {
    const withNotes = { ...SAVED, notes: "Bring fins" };

    expect(listEventChanges(withNotes, SAVED)).toEqual({ notes: null });
  });

  it("no cuenta como cambio los mismos grupos marcados en otro orden", () => {
    const edited: EventForm = {
      ...SAVED,
      audience: { kind: "groups", groupIds: new Set([MASTERS_ID, SENIOR_ID]) },
    };

    expect(listEventChanges(SAVED, edited)).toEqual({});
  });

  it("manda la audiencia de todo el club sin grupos", () => {
    const edited: EventForm = {
      ...SAVED,
      audience: { kind: "club", groupIds: new Set() },
    };

    expect(listEventChanges(SAVED, edited)).toEqual({
      audience: { kind: "club" },
    });
  });

  it("manda la fecha nueva de un evento suelto", () => {
    const edited = { ...SAVED, startsOn: "2026-10-07" };

    expect(listEventChanges(SAVED, edited)).toEqual({
      startsOn: "2026-10-07",
    });
  });

  it("nunca manda la fecha de una serie", () => {
    const edited = { ...SAVED, startsOn: "2026-10-07", startTime: "19:30" };

    expect(listSeriesChanges(SAVED, edited)).toEqual({ startTime: "19:30" });
  });
});

describe("el fin y la imagen al editar (#650)", () => {
  const WITH_END: EventForm = { ...SAVED, endTime: "20:30" };

  it("manda la hora de fin nueva", () => {
    const edited = { ...WITH_END, endTime: "21:00" };

    expect(listEventChanges(WITH_END, edited)).toEqual({ endTime: "21:00" });
  });

  it("manda la fecha de fin al encender Termina otro día", () => {
    const edited = {
      ...WITH_END,
      endsAnotherDay: true,
      endDate: "2026-10-07",
    };

    expect(listEventChanges(WITH_END, edited)).toEqual({
      endsOn: "2026-10-07",
    });
  });

  it("manda la fecha de fin como ninguna al apagar Termina otro día", () => {
    const multiDay = {
      ...WITH_END,
      endsAnotherDay: true,
      endDate: "2026-10-07",
    };

    expect(
      listEventChanges(multiDay, { ...multiDay, endsAnotherDay: false }),
    ).toEqual({ endsOn: null });
  });

  it("nunca manda la fecha de fin de una serie", () => {
    const edited = {
      ...WITH_END,
      endTime: "21:00",
      endsAnotherDay: true,
      endDate: "2026-10-07",
    };

    expect(listSeriesChanges(WITH_END, edited)).toEqual({ endTime: "21:00" });
  });

  it("manda la imagen nueva", () => {
    const edited: EventForm = {
      ...WITH_END,
      cover: { kind: "replace", coverUploadId: COVER_ID },
    };

    expect(listSeriesChanges(WITH_END, edited)).toEqual({
      coverUploadId: COVER_ID,
    });
  });

  it("manda la imagen quitada como ninguna", () => {
    const edited: EventForm = {
      ...WITH_END,
      cover: { kind: "replace", coverUploadId: null },
    };

    expect(listEventChanges(WITH_END, edited)).toEqual({ coverUploadId: null });
  });
});

describe("lo que se manda al crear (#650)", () => {
  const FILLED: EventForm = {
    ...SAVED,
    audience: { kind: "club", groupIds: new Set() },
    endTime: "20:30",
  };

  it("manda la hora de fin y no la fecha de fin de un evento de un día", () => {
    expect(toEventDraft(FILLED)).toEqual({
      repeat: "none",
      title: "Pool Training",
      eventType: "training",
      startsOn: "2026-10-06",
      startTime: "19:00",
      endTime: "20:30",
      location: "MSAC Dive Pool",
      notes: null,
      audience: { kind: "club" },
    });
  });

  it("manda la fecha de fin de un evento de varios días", () => {
    const multiDay = { ...FILLED, endsAnotherDay: true, endDate: "2026-10-08" };

    expect(toEventDraft(multiDay)).toMatchObject({ endsOn: "2026-10-08" });
  });

  it("manda la imagen subida", () => {
    const withCover: EventForm = {
      ...FILLED,
      cover: { kind: "replace", coverUploadId: COVER_ID },
    };

    expect(toEventDraft(withCover)).toMatchObject({ coverUploadId: COVER_ID });
  });

  it("pide la hora de fin, y la fecha de fin sólo con Termina otro día", () => {
    const blank = { ...FILLED, endTime: "" };

    expect(listMissingFields(blank)).toEqual([
      { field: "endTime", code: "required" },
    ]);
    expect(listMissingFields({ ...FILLED, endsAnotherDay: true })).toEqual([
      { field: "endDate", code: "required" },
    ]);
  });
});

describe("el evento guardado en el formulario (#650)", () => {
  const EVENT: AgendaEvent = {
    id: "aaaaaaaa-0000-4000-8000-00000000000a",
    startsOn: "2026-10-06",
    startTime: "19:00",
    endTime: null,
    endsOn: null,
    title: "Pool Training",
    eventType: "training",
    location: "MSAC Dive Pool",
    place: null,
    placeDetail: null,
    status: "scheduled",
    seriesId: null,
    goingCount: 0,
    maybeCount: 0,
    myResponse: null,
    inAudience: true,
    coverThumbUrl: null,
  };
  const DETAILS = { notes: null, audience: { kind: "club" } } as const;

  it("deja Termina vacío en un evento anterior a E24", () => {
    expect(formFromEvent(EVENT, DETAILS)).toMatchObject({
      endTime: "",
      endsAnotherDay: false,
      endDate: "",
    });
  });

  it("enciende Termina otro día en uno de varios días", () => {
    const multiDay = { ...EVENT, endTime: "17:00", endsOn: "2026-10-07" };

    expect(formFromEvent(multiDay, DETAILS)).toMatchObject({
      endTime: "17:00",
      endsAnotherDay: true,
      endDate: "2026-10-07",
    });
  });
});

describe("los motivos de la API junto a su campo (#650)", () => {
  it.each([
    ["end_time_required", "endTime"],
    ["end_before_start", "endTime"],
    ["multi_day_series", "endTime"],
    ["event_cover_empty", "cover"],
    ["event_cover_too_large", "cover"],
    ["event_cover_type_unsupported", "cover"],
    ["event_cover_upload_invalid", "cover"],
  ])("pinta %s junto a %s", (code, field) => {
    expect(isFieldIssueCode(code)).toBe(true);
    if (isFieldIssueCode(code)) {
      expect(issueFromApi(code).field).toBe(field);
    }
  });
});

describe("si puede terminar otro día (#650)", () => {
  it("un evento suelto nuevo sí", () => {
    expect(endScopeOf("create", EMPTY_EVENT_FORM)).toBe("event");
  });

  it.each([
    ["una serie nueva", "create", { ...EMPTY_EVENT_FORM, repeat: "weekly" }],
    ["una serie que se edita", "series", EMPTY_EVENT_FORM],
    [
      "una ocurrencia que se edita a solas",
      "event",
      { ...EMPTY_EVENT_FORM, belongsToSeries: true },
    ],
  ] as const)("%s no", (_name, layout, form) => {
    expect(endScopeOf(layout, form)).toBe("series");
  });
});

describe("el lugar elegido (#652)", () => {
  const PRINCES_PARK = {
    name: "Princes Park, Oval 2",
    address: "Princes Park Dr, Carlton North VIC 3054",
    lat: -37.7836,
    lng: 144.9616,
  } as const;
  const FILLED: EventForm = {
    ...SAVED,
    audience: { kind: "club", groupIds: new Set() },
    endTime: "20:30",
  };
  const CHOSEN: EventForm = {
    ...FILLED,
    location: "princes",
    place: PRINCES_PARK,
    placeDetail: "Field 2, near the pavilion",
  };

  it("manda el lugar y dónde exactamente al crear con un lugar elegido", () => {
    expect(toEventDraft(CHOSEN)).toMatchObject({
      location: PRINCES_PARK.name,
      place: PRINCES_PARK,
      placeDetail: "Field 2, near the pavilion",
    });
  });

  it("manda dónde exactamente en blanco como ninguno", () => {
    expect(toEventDraft({ ...CHOSEN, placeDetail: "  " })).toMatchObject({
      placeDetail: null,
    });
  });

  it("manda sólo el texto con texto libre", () => {
    const draft = toEventDraft({ ...FILLED, placeDetail: "Field 2" });

    expect(draft.location).toBe("MSAC Dive Pool");
    expect(draft).not.toHaveProperty("place");
    expect(draft).not.toHaveProperty("placeDetail");
  });

  it("no pide el texto del lugar cuando hay uno elegido", () => {
    expect(listMissingFields({ ...CHOSEN, location: "" })).toEqual([]);
  });

  it("arranca con el lugar y dónde exactamente del evento", () => {
    const event: AgendaEvent = {
      id: "aaaaaaaa-0000-4000-8000-00000000000a",
      startsOn: "2026-10-06",
      startTime: "19:00",
      endTime: "20:30",
      endsOn: null,
      title: "Pool Training",
      eventType: "training",
      location: PRINCES_PARK.name,
      place: PRINCES_PARK,
      placeDetail: "Field 2",
      status: "scheduled",
      seriesId: null,
      goingCount: 0,
      maybeCount: 0,
      myResponse: null,
      inAudience: true,
      coverThumbUrl: null,
    };

    expect(
      formFromEvent(event, { notes: null, audience: { kind: "club" } }),
    ).toMatchObject({
      location: PRINCES_PARK.name,
      place: PRINCES_PARK,
      placeDetail: "Field 2",
    });
  });

  it("manda el lugar nuevo al elegir otro al editar", () => {
    expect(listEventChanges(FILLED, CHOSEN)).toEqual({
      place: PRINCES_PARK,
      placeDetail: "Field 2, near the pavilion",
    });
  });

  it("no manda el lugar si sigue siendo el mismo", () => {
    expect(listSeriesChanges(CHOSEN, { ...CHOSEN })).toEqual({});
  });

  it("manda sólo dónde exactamente si es lo único que cambió", () => {
    const edited = { ...CHOSEN, placeDetail: "Field 3" };

    expect(listSeriesChanges(CHOSEN, edited)).toEqual({
      placeDetail: "Field 3",
    });
  });

  it("manda el texto al volver al texto libre aunque no cambie", () => {
    const saved = { ...CHOSEN, location: PRINCES_PARK.name };
    const freeText = { ...saved, place: null };

    expect(listEventChanges(saved, freeText)).toEqual({
      location: PRINCES_PARK.name,
    });
  });

  it.each([
    ["event_place_invalid", "location"],
    ["event_place_coordinates_invalid", "location"],
    ["event_place_detail_invalid", "placeDetail"],
  ])("pinta %s junto a %s", (code, field) => {
    expect(isFieldIssueCode(code)).toBe(true);
    if (isFieldIssueCode(code)) {
      expect(issueFromApi(code).field).toBe(field);
    }
  });
});
