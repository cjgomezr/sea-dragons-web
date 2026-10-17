import { describe, expect, it } from "vitest";
import { type IcsEvent, buildEventIcs } from "@/lib/events/event-ics";

/**
 * El `.ics` de "Agregar a mi calendario" (#649, RF-8 y D9 del PRD de E24):
 * una sola sesión, en la hora de Melbourne, según RFC 5545.
 */

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;
const GENERATED_AT = new Date("2026-10-17T03:04:05.000Z");

const TRIVIA_NIGHT: IcsEvent = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  title: "Fundraiser trivia night",
  startsOn: "2026-10-14",
  startTime: "18:00",
  endsOn: null,
  endTime: "19:30",
  location: "Seadragons Clubhouse, 12 Beach Rd",
  notes: "Bring a gold coin",
};

function linesOf(ics: string): string[] {
  return ics.split(CRLF);
}

/** Las líneas del calendario con los pliegues deshechos. */
function unfoldedLinesOf(ics: string): string[] {
  return linesOf(ics.replaceAll(`${CRLF} `, ""));
}

function veventOf(ics: string): string[] {
  const lines = unfoldedLinesOf(ics);
  return lines.slice(
    lines.indexOf("BEGIN:VEVENT"),
    lines.indexOf("END:VEVENT") + 1,
  );
}

function propertyOf(ics: string, name: string): string | undefined {
  return veventOf(ics).find(
    (line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`),
  );
}

describe("buildEventIcs", () => {
  it("envuelve un solo VEVENT en un VCALENDAR 2.0 con líneas CRLF", () => {
    const ics = buildEventIcs(TRIVIA_NIGHT, GENERATED_AT);

    const lines = linesOf(ics);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines.some((line) => line.startsWith("PRODID:"))).toBe(true);
    expect(ics.endsWith(`END:VCALENDAR${CRLF}`)).toBe(true);
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(ics.replaceAll(CRLF, "")).not.toMatch(/[\r\n]/);
  });

  it("pone el inicio y el fin de un día en la hora de Melbourne", () => {
    const ics = buildEventIcs(TRIVIA_NIGHT, GENERATED_AT);

    expect(propertyOf(ics, "DTSTART")).toBe(
      "DTSTART;TZID=Australia/Melbourne:20261014T180000",
    );
    expect(propertyOf(ics, "DTEND")).toBe(
      "DTEND;TZID=Australia/Melbourne:20261014T193000",
    );
  });

  it("define la zona de Melbourne con su horario de verano", () => {
    const lines = unfoldedLinesOf(buildEventIcs(TRIVIA_NIGHT, GENERATED_AT));

    const zone = lines.slice(
      lines.indexOf("BEGIN:VTIMEZONE"),
      lines.indexOf("END:VTIMEZONE") + 1,
    );
    expect(zone).toContain("TZID:Australia/Melbourne");
    expect(zone).toContain("BEGIN:STANDARD");
    expect(zone).toContain("TZOFFSETTO:+1000");
    expect(zone).toContain("BEGIN:DAYLIGHT");
    expect(zone).toContain("TZOFFSETTO:+1100");
  });

  it("lleva el título, el lugar, las notas y la marca de cuándo se generó", () => {
    const ics = buildEventIcs(TRIVIA_NIGHT, GENERATED_AT);

    expect(propertyOf(ics, "SUMMARY")).toBe("SUMMARY:Fundraiser trivia night");
    expect(propertyOf(ics, "LOCATION")).toBe(
      "LOCATION:Seadragons Clubhouse\\, 12 Beach Rd",
    );
    expect(propertyOf(ics, "DESCRIPTION")).toBe(
      "DESCRIPTION:Bring a gold coin",
    );
    expect(propertyOf(ics, "DTSTAMP")).toBe("DTSTAMP:20261017T030405Z");
  });

  it("da el mismo UID al mismo evento y otro a otro evento", () => {
    const first = buildEventIcs(TRIVIA_NIGHT, GENERATED_AT);
    const later = buildEventIcs(
      { ...TRIVIA_NIGHT, title: "Renamed" },
      new Date("2026-11-01T00:00:00.000Z"),
    );
    const other = buildEventIcs(
      { ...TRIVIA_NIGHT, id: "bbbbbbbb-0000-4000-8000-00000000000b" },
      GENERATED_AT,
    );

    expect(propertyOf(first, "UID")).toContain(TRIVIA_NIGHT.id);
    expect(propertyOf(later, "UID")).toBe(propertyOf(first, "UID"));
    expect(propertyOf(other, "UID")).not.toBe(propertyOf(first, "UID"));
  });

  it("sin hora de fin no lleva DTEND", () => {
    const ics = buildEventIcs({ ...TRIVIA_NIGHT, endTime: null }, GENERATED_AT);

    expect(propertyOf(ics, "DTEND")).toBeUndefined();
    expect(propertyOf(ics, "DTSTART")).toBe(
      "DTSTART;TZID=Australia/Melbourne:20261014T180000",
    );
  });

  it("en un evento de varios días el fin es la fecha y la hora de fin", () => {
    const ics = buildEventIcs(
      {
        ...TRIVIA_NIGHT,
        startsOn: "2026-10-24",
        startTime: "08:30",
        endsOn: "2026-10-25",
        endTime: "17:00",
      },
      GENERATED_AT,
    );

    expect(propertyOf(ics, "DTSTART")).toBe(
      "DTSTART;TZID=Australia/Melbourne:20261024T083000",
    );
    expect(propertyOf(ics, "DTEND")).toBe(
      "DTEND;TZID=Australia/Melbourne:20261025T170000",
    );
  });

  it("no repite el evento: el VEVENT no lleva RRULE", () => {
    const ics = buildEventIcs(TRIVIA_NIGHT, GENERATED_AT);

    expect(veventOf(ics).some((line) => line.startsWith("RRULE"))).toBe(false);
  });

  it("sin notas no lleva DESCRIPTION", () => {
    const ics = buildEventIcs({ ...TRIVIA_NIGHT, notes: null }, GENERATED_AT);

    expect(propertyOf(ics, "DESCRIPTION")).toBeUndefined();
  });

  it("escapa comas, punto y coma, barras invertidas y saltos de línea", () => {
    const ics = buildEventIcs(
      {
        ...TRIVIA_NIGHT,
        title: "Trivia, quiz; C:\\club",
        location: "Pool; lane 3, deep end",
        notes: "Line one\nLine two\r\nLine three",
      },
      GENERATED_AT,
    );

    expect(propertyOf(ics, "SUMMARY")).toBe(
      "SUMMARY:Trivia\\, quiz\\; C:\\\\club",
    );
    expect(propertyOf(ics, "LOCATION")).toBe(
      "LOCATION:Pool\\; lane 3\\, deep end",
    );
    expect(propertyOf(ics, "DESCRIPTION")).toBe(
      "DESCRIPTION:Line one\\nLine two\\nLine three",
    );
  });

  it("pliega las líneas de más de 75 octetos sin partir una letra con tilde", () => {
    const notes = "Natación en el río, después de la sesión. ".repeat(6);
    const ics = buildEventIcs({ ...TRIVIA_NIGHT, notes }, GENERATED_AT);

    const encoder = new TextEncoder();
    const lines = linesOf(ics);
    expect(
      lines.every((line) => encoder.encode(line).length <= MAX_LINE_OCTETS),
    ).toBe(true);
    expect(lines.some((line) => line.startsWith(" "))).toBe(true);
    expect(ics).not.toContain("\uFFFD");
    expect(propertyOf(ics, "DESCRIPTION")).toBe(
      `DESCRIPTION:${notes.replaceAll(",", "\\,")}`,
    );
  });
});
