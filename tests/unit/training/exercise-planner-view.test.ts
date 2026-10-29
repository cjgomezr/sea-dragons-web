import { describe, expect, it } from "vitest";
import { EXERCISE_PHOTO_MAX_BYTES } from "@/lib/training/club-exercises";
import {
  checkExercisePhoto,
  countOfSource,
  youtubeFieldText,
} from "@/lib/training/exercise-planner-view";

/** Planificar → Ejercicios (#910): lo que la pantalla decide sola. */

describe("checkExercisePhoto", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])(
    "deja una %s de hasta 5 MB",
    (type) => {
      expect(
        checkExercisePhoto({ size: EXERCISE_PHOTO_MAX_BYTES, type }),
      ).toBeNull();
    },
  );

  it("rechaza una de más de 5 MB", () => {
    expect(
      checkExercisePhoto({
        size: EXERCISE_PHOTO_MAX_BYTES + 1,
        type: "image/jpeg",
      }),
    ).toBe("photo_too_large");
  });

  it.each(["image/gif", "image/heic", ""])("rechaza el tipo '%s'", (type) => {
    expect(checkExercisePhoto({ size: 10, type })).toBe(
      "photo_type_unsupported",
    );
  });
});

describe("countOfSource", () => {
  const counts = { library: 17, club: 5 };

  it("All suma los dos orígenes", () => {
    expect(countOfSource(counts, null)).toBe(22);
  });

  it("cada origen da el suyo", () => {
    expect([
      countOfSource(counts, "library"),
      countOfSource(counts, "club"),
    ]).toEqual([17, 5]);
  });
});

describe("youtubeFieldText", () => {
  it("devuelve el enlace, la búsqueda o nada", () => {
    expect([
      youtubeFieldText({ kind: "link", url: "https://youtu.be/x" }),
      youtubeFieldText({ kind: "search", query: "fin kick" }),
      youtubeFieldText(null),
    ]).toEqual(["https://youtu.be/x", "fin kick", ""]);
  });
});
