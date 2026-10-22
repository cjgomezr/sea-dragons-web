import { describe, expect, it } from "vitest";
import { locateInList } from "@/lib/evaluations/sheet-navigation";

/**
 * Dónde está el jugador abierto dentro de la lista filtrada (#819): lo que
 * dice la barra de arriba del panel y a quién llevan ‹ y ›.
 */

const LIST = ["ana", "beto", "carla"] as const;

describe("locateInList", () => {
  it("en medio de la lista tiene anterior y siguiente", () => {
    expect(locateInList(LIST, "beto")).toEqual({
      kind: "listed",
      index: 1,
      count: 3,
      previousId: "ana",
      nextId: "carla",
    });
  });

  it("el primero no tiene anterior", () => {
    expect(locateInList(LIST, "ana")).toMatchObject({
      previousId: null,
      nextId: "beto",
    });
  });

  it("el último no tiene siguiente", () => {
    expect(locateInList(LIST, "carla")).toMatchObject({
      previousId: "beto",
      nextId: null,
    });
  });

  it("fuera del filtro, siguiente lleva al primero y anterior al último", () => {
    expect(locateInList(LIST, "dani")).toEqual({
      kind: "unlisted",
      previousId: "carla",
      nextId: "ana",
    });
  });

  it("fuera del filtro y con la lista vacía no lleva a nadie", () => {
    expect(locateInList([], "dani")).toEqual({
      kind: "unlisted",
      previousId: null,
      nextId: null,
    });
  });
});
