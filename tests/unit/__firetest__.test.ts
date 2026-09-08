import { describe, expect, it } from "vitest";

describe("prueba de fuego temporal para #98", () => {
  it("se rompe a propósito para verificar que CI queda en rojo", () => {
    expect(true).toBe(false);
  });
});
