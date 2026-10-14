import { describe, expect, it } from "vitest";
import {
  NEWS_PIN_OFF,
  initialNewsPinChoice,
  newsPinChangeOf,
  newsPinChoiceEnd,
  selectedNewsPinDuration,
  toggleNewsPinChoice,
} from "@/lib/news/news-pin-choice";

/**
 * La caja de fijar del formulario (#599): qué cambio de fijado manda cada
 * estado, y qué duración y fecha enseña.
 */

const NOW = new Date("2026-10-13T00:00:00.000Z");
const UNTIL = "2026-10-20T00:00:00.000Z";

describe("estado inicial", () => {
  it("una publicación sin fijar abre la caja apagada", () => {
    expect(initialNewsPinChoice({ isPinned: false, pinnedUntil: null })).toBe(
      NEWS_PIN_OFF,
    );
  });

  it("una fijada abre la caja con el fijado que trae", () => {
    expect(
      initialNewsPinChoice({ isPinned: true, pinnedUntil: UNTIL }),
    ).toEqual({ kind: "current", until: UNTIL });
  });
});

describe("encender y apagar", () => {
  it("encender una sin fijar propone 2 semanas", () => {
    expect(toggleNewsPinChoice(NEWS_PIN_OFF, NEWS_PIN_OFF)).toEqual({
      kind: "chosen",
      duration: "twoWeeks",
    });
  });

  it("volver a encender una fijada recupera su fijado", () => {
    const current = { kind: "current", until: UNTIL } as const;

    expect(toggleNewsPinChoice(NEWS_PIN_OFF, current)).toBe(current);
  });

  it("apagar deja la caja apagada", () => {
    expect(
      toggleNewsPinChoice(
        { kind: "chosen", duration: "oneWeek" },
        NEWS_PIN_OFF,
      ),
    ).toBe(NEWS_PIN_OFF);
  });
});

describe("duración marcada", () => {
  it("un fijado heredado con fecha no marca ninguna", () => {
    expect(selectedNewsPinDuration({ kind: "current", until: UNTIL })).toBe(
      null,
    );
  });

  it("un fijado heredado sin fecha marca hasta que la desfije", () => {
    expect(selectedNewsPinDuration({ kind: "current", until: null })).toBe(
      "untilUnpinned",
    );
  });
});

describe("fecha de fin", () => {
  it("el fijado heredado conserva la suya", () => {
    expect(newsPinChoiceEnd({ kind: "current", until: UNTIL }, NOW)).toBe(
      UNTIL,
    );
  });

  it("una duración elegida se cuenta desde ahora", () => {
    expect(newsPinChoiceEnd({ kind: "chosen", duration: "oneWeek" }, NOW)).toBe(
      UNTIL,
    );
  });
});

describe("cambio que se manda", () => {
  it("apagada en una sin fijar no cambia nada", () => {
    expect(
      newsPinChangeOf(NEWS_PIN_OFF, { wasPinned: false, now: NOW }),
    ).toEqual({ kind: "keep" });
  });

  it("apagada en una fijada la desfija", () => {
    expect(
      newsPinChangeOf(NEWS_PIN_OFF, { wasPinned: true, now: NOW }),
    ).toEqual({ kind: "unpin" });
  });

  it("el fijado heredado sin tocar no cambia nada", () => {
    expect(
      newsPinChangeOf(
        { kind: "current", until: UNTIL },
        { wasPinned: true, now: NOW },
      ),
    ).toEqual({ kind: "keep" });
  });

  it("una duración elegida fija hasta su fecha", () => {
    expect(
      newsPinChangeOf(
        { kind: "chosen", duration: "oneWeek" },
        { wasPinned: false, now: NOW },
      ),
    ).toEqual({ kind: "pin", until: UNTIL });
  });
});
