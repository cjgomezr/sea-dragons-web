import { describe, expect, it } from "vitest";
import { agendaEventSchema } from "@/components/calendar/agenda-client";

/**
 * La forma de un evento de la agenda como la lee la pantalla (#642, RF-2 del
 * PRD de E24): la hora y la fecha de fin llegan siempre, nulas en lo anterior
 * a E24 y en un evento de un día.
 */

const AGENDA_EVENT = {
  id: "e0000000-0000-4000-8000-000000000001",
  startsOn: "2027-06-26",
  startTime: "08:30",
  endTime: "17:00",
  endsOn: "2027-06-27",
  title: "Torneo",
  eventType: "competition",
  location: "MSAC",
  status: "scheduled",
  seriesId: null,
  goingCount: 0,
  maybeCount: 0,
  myResponse: null,
  inAudience: true,
};

describe("agendaEventSchema", () => {
  it("lee la hora y la fecha de fin de un evento de varios días", () => {
    expect(agendaEventSchema.parse(AGENDA_EVENT)).toMatchObject({
      endTime: "17:00",
      endsOn: "2027-06-27",
    });
  });

  it("lee nulas la hora y la fecha de fin de un evento anterior a E24", () => {
    const legacy = { ...AGENDA_EVENT, endTime: null, endsOn: null };

    expect(agendaEventSchema.parse(legacy)).toMatchObject({
      endTime: null,
      endsOn: null,
    });
  });

  it("rechaza un evento sin la hora de fin", () => {
    const withoutEnd: Record<string, unknown> = { ...AGENDA_EVENT };
    delete withoutEnd.endTime;

    expect(agendaEventSchema.safeParse(withoutEnd).success).toBe(false);
  });
});
