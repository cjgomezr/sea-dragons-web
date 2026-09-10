import { describe, expect, it } from "vitest";
import {
  CLUB_TIME_ZONE,
  TRAINING_SESSIONS,
  isDuringTrainingHours,
} from "@/lib/training-hours";

/** Instantes escritos en UTC a propósito. Construirlos en hora local del club
 * exigiría la misma conversión que estamos probando, y un test que se apoya en
 * el código que verifica no verifica nada. El comentario de cada uno dice qué
 * hora de Melbourne representa. */
const MELBOURNE = {
  // Invierno austral: AEST, UTC+10.
  tuesdayJuly1759: "2026-07-07T07:59:00Z",
  tuesdayJuly1800: "2026-07-07T08:00:00Z",
  tuesdayJuly2159: "2026-07-07T11:59:00Z",
  tuesdayJuly2200: "2026-07-07T12:00:00Z",
  thursdayJuly1800: "2026-07-09T08:00:00Z",
  wednesdayJuly1900: "2026-07-08T09:00:00Z",
  saturdayJuly0759: "2026-07-10T21:59:00Z",
  saturdayJuly0800: "2026-07-10T22:00:00Z",
  saturdayJuly1259: "2026-07-11T02:59:00Z",
  saturdayJuly1300: "2026-07-11T03:00:00Z",
  // Verano austral: AEDT, UTC+11.
  tuesdayJanuary1759: "2026-01-06T06:59:00Z",
  tuesdayJanuary1800: "2026-01-06T07:00:00Z",
  thursdayJanuary1800: "2026-01-08T07:00:00Z",
  saturdayJanuary0800: "2026-01-09T21:00:00Z",
  saturdayJanuary1300: "2026-01-10T02:00:00Z",
} as const;

function at(instant: string): Date {
  return new Date(instant);
}

describe("horario de entrenamiento", () => {
  it("declara la zona del club, nunca un desfase fijo", () => {
    expect(CLUB_TIME_ZONE).toBe("Australia/Melbourne");
  });

  it("cubre los tres entrenamientos de la semana y ninguno más", () => {
    expect(TRAINING_SESSIONS).toEqual([
      { weekday: "tuesday", startHour: 18, endHour: 22 },
      { weekday: "thursday", startHour: 18, endHour: 22 },
      { weekday: "saturday", startHour: 8, endHour: 13 },
    ]);
  });

  it("deja fuera el minuto anterior al inicio del martes", () => {
    expect(isDuringTrainingHours(at(MELBOURNE.tuesdayJuly1759))).toBe(false);
  });

  it("incluye el minuto en que arranca el martes", () => {
    expect(isDuringTrainingHours(at(MELBOURNE.tuesdayJuly1800))).toBe(true);
  });

  it("incluye el último minuto del martes", () => {
    expect(isDuringTrainingHours(at(MELBOURNE.tuesdayJuly2159))).toBe(true);
  });

  it("deja fuera la hora en que termina el martes", () => {
    expect(isDuringTrainingHours(at(MELBOURNE.tuesdayJuly2200))).toBe(false);
  });

  it("incluye el jueves a la misma hora que el martes", () => {
    expect(isDuringTrainingHours(at(MELBOURNE.thursdayJuly1800))).toBe(true);
  });

  it("deja fuera el miércoles, que no es día de entrenamiento", () => {
    expect(isDuringTrainingHours(at(MELBOURNE.wednesdayJuly1900))).toBe(false);
  });

  it("incluye el sábado desde las 08:00", () => {
    expect(isDuringTrainingHours(at(MELBOURNE.saturdayJuly0800))).toBe(true);
  });

  it("deja fuera el sábado antes de las 08:00", () => {
    expect(isDuringTrainingHours(at(MELBOURNE.saturdayJuly0759))).toBe(false);
  });

  it("incluye el último minuto del sábado", () => {
    expect(isDuringTrainingHours(at(MELBOURNE.saturdayJuly1259))).toBe(true);
  });

  it("deja fuera el sábado a las 13:00, cuando el entrenamiento ya terminó", () => {
    expect(isDuringTrainingHours(at(MELBOURNE.saturdayJuly1300))).toBe(false);
  });
});

// El club entrena a la misma hora local todo el año, así que la respuesta tiene
// que ser la misma en enero (AEDT, UTC+11) y en julio (AEST, UTC+10). Restar
// diez horas fijas a un instante de enero da las 17:00 y contestaría que no.
describe("horario de entrenamiento a través del cambio AEST/AEDT", () => {
  it.each([
    ["martes 18:00", MELBOURNE.tuesdayJanuary1800, MELBOURNE.tuesdayJuly1800],
    ["jueves 18:00", MELBOURNE.thursdayJanuary1800, MELBOURNE.thursdayJuly1800],
    ["sábado 08:00", MELBOURNE.saturdayJanuary0800, MELBOURNE.saturdayJuly0800],
  ])(
    "responde que sí el %s tanto en verano como en invierno",
    (_caso, verano, invierno) => {
      expect(isDuringTrainingHours(at(verano))).toBe(true);
      expect(isDuringTrainingHours(at(invierno))).toBe(true);
    },
  );

  it.each([
    ["martes 17:59", MELBOURNE.tuesdayJanuary1759, MELBOURNE.tuesdayJuly1759],
    ["sábado 13:00", MELBOURNE.saturdayJanuary1300, MELBOURNE.saturdayJuly1300],
  ])(
    "responde que no el %s tanto en verano como en invierno",
    (_caso, verano, invierno) => {
      expect(isDuringTrainingHours(at(verano))).toBe(false);
      expect(isDuringTrainingHours(at(invierno))).toBe(false);
    },
  );
});
