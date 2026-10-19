import { describe, expect, it } from "vitest";
import { dropLineEdge, orderAfterDrop } from "@/lib/club/drop-order";

/** Arrastrar una posición o un pack por el asa (#725, RF-8 del PRD de E26):
 * el orden nuevo sale del puesto de origen y del de destino, y soltar en el
 * mismo sitio o fuera de la lista no cambia nada. */

const ORDER = ["a", "b", "c", "d", "e", "f"] as const;

describe("orderAfterDrop", () => {
  it("lleva el último al primer puesto y corre los demás", () => {
    expect(orderAfterDrop(ORDER, "f", "a")).toEqual([
      "f",
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("lleva el primero al último puesto", () => {
    expect(orderAfterDrop(ORDER, "a", "f")).toEqual([
      "b",
      "c",
      "d",
      "e",
      "f",
      "a",
    ]);
  });

  it("deja el arrastrado en el puesto de la fila sobre la que cae", () => {
    expect(orderAfterDrop(ORDER, "b", "d")).toEqual([
      "a",
      "c",
      "d",
      "b",
      "e",
      "f",
    ]);
  });

  it("no da orden nuevo al soltar en el mismo sitio", () => {
    expect(orderAfterDrop(ORDER, "c", "c")).toBeNull();
  });

  it("no da orden nuevo al soltar fuera de la lista", () => {
    expect(orderAfterDrop(ORDER, "c", null)).toBeNull();
  });

  it("no da orden nuevo si el destino no es de la lista", () => {
    expect(orderAfterDrop(ORDER, "c", "z")).toBeNull();
  });

  it("funciona con números, que es como se identifican los packs", () => {
    expect(orderAfterDrop([5, 10, 20], 20, 5)).toEqual([20, 5, 10]);
  });
});

describe("dropLineEdge", () => {
  it("marca el borde de arriba cuando la fila sube", () => {
    expect(dropLineEdge(ORDER, "e", "b")).toBe("before");
  });

  it("marca el borde de abajo cuando la fila baja", () => {
    expect(dropLineEdge(ORDER, "b", "e")).toBe("after");
  });

  it("no marca nada sobre su propio puesto", () => {
    expect(dropLineEdge(ORDER, "b", "b")).toBeNull();
  });
});
