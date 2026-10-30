import { describe, expect, it } from "vitest";
import {
  type ExerciseRecord,
  youtubeUrlOf,
} from "@/lib/training/training-plan";

/**
 * A dónde lleva "Watch on YouTube" (#937, D13 y RF-4 del PRD de E35): un
 * ejercicio del club con el campo vacío no tiene botón; uno de la biblioteca
 * busca su nombre.
 */

const SEARCH = "https://www.youtube.com/results?search_query=";

function exercise(
  source: ExerciseRecord["source"],
  youtube: string | null,
): ExerciseRecord {
  return {
    id: "ex-1",
    name: "Swim set",
    source,
    tips: [],
    youtube,
    imageStartPath: null,
    imageEndPath: null,
  };
}

describe("youtubeUrlOf", () => {
  it("un ejercicio del club con enlace abre ese enlace", () => {
    expect(youtubeUrlOf(exercise("club", " https://youtu.be/abc "))).toBe(
      "https://youtu.be/abc",
    );
  });

  it("un ejercicio del club con texto busca ese texto", () => {
    expect(youtubeUrlOf(exercise("club", "fin kick drill"))).toBe(
      `${SEARCH}fin%20kick%20drill`,
    );
  });

  it("un ejercicio del club con el campo nulo no tiene botón", () => {
    expect(youtubeUrlOf(exercise("club", null))).toBeNull();
  });

  it("un ejercicio del club con el campo vacío no tiene botón", () => {
    expect(youtubeUrlOf(exercise("club", ""))).toBeNull();
  });

  it("un ejercicio del club con solo espacios no tiene botón", () => {
    expect(youtubeUrlOf(exercise("club", "   "))).toBeNull();
  });

  it("un ejercicio de la biblioteca con el campo vacío busca su nombre", () => {
    expect(youtubeUrlOf(exercise("library", null))).toBe(`${SEARCH}Swim%20set`);
  });

  it("un ejercicio de la biblioteca con solo espacios busca su nombre", () => {
    expect(youtubeUrlOf(exercise("library", "  "))).toBe(`${SEARCH}Swim%20set`);
  });

  it("un ejercicio de la biblioteca con texto busca ese texto", () => {
    expect(youtubeUrlOf(exercise("library", "squat form"))).toBe(
      `${SEARCH}squat%20form`,
    );
  });

  it("un ejercicio de la biblioteca con enlace abre ese enlace", () => {
    expect(youtubeUrlOf(exercise("library", "https://youtu.be/xyz"))).toBe(
      "https://youtu.be/xyz",
    );
  });

  it("codifica los caracteres especiales del nombre que busca", () => {
    const record = { ...exercise("library", null), name: "Push & pull #2 ñ" };

    expect(youtubeUrlOf(record)).toBe(
      `${SEARCH}Push%20%26%20pull%20%232%20%C3%B1`,
    );
  });
});
