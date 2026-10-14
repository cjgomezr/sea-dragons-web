/**
 * #599: la caja de fijar del formulario toma el borde y el fondo de acento
 * cuando está encendida (handoff de E22, "Publish / edit (#2b)", punto 5).
 */
import { describe, expect, it } from "vitest";
import { cssBlock, readGlobalsCss } from "./helpers/css-tokens";

const globalsCss = readGlobalsCss();

describe("caja de fijar", () => {
  it("apagada lleva el borde de siempre", () => {
    expect(cssBlock(globalsCss, ".news-pin-field")).toMatch(
      /border:\s*1px solid var\(--color-border\)/,
    );
  });

  it("encendida toma el borde de acento", () => {
    expect(cssBlock(globalsCss, ".news-pin-field-on")).toMatch(
      /border-color:[^;]*var\(--color-accent\)/,
    );
  });

  it("encendida toma el fondo de acento", () => {
    expect(cssBlock(globalsCss, ".news-pin-field-on")).toMatch(
      /background:[^;]*var\(--color-accent\)/,
    );
  });

  it("el interruptor encendido se rellena de acento", () => {
    expect(
      cssBlock(globalsCss, '.news-pin-switch[aria-checked="true"]'),
    ).toMatch(/background:\s*var\(--color-accent\)/);
  });
});
