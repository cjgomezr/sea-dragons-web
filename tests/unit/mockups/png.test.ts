import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePng, isUniformImage } from "../../../scripts/mockups/png.ts";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 40, height: 40 } });
}, 30_000);

// Mismo presupuesto que el `beforeAll` de arriba: cerrar el navegador no es
// más rápido que abrirlo, y bajo la suite completa los 10 s del hookTimeout
// por defecto no alcanzan (el #50 y el #68 arreglaron esta misma clase de
// fallo para `testTimeout`, que no cubre los hooks).
afterAll(async () => {
  await browser.close();
}, 30_000);

describe("decodePng", () => {
  it("lee el ancho y el alto reales del PNG capturado", async () => {
    await page.setViewportSize({ width: 33, height: 21 });
    await page.setContent('<body style="margin:0;background:#fff"></body>');
    const decoded = decodePng(await page.screenshot());
    expect(decoded.width).toBe(33);
    expect(decoded.height).toBe(21);
  });
});

describe("captura en blanco", () => {
  it("reporta como fallo una captura cuyo contenido es uniforme", async () => {
    await page.setViewportSize({ width: 40, height: 40 });
    await page.setContent('<body style="margin:0;background:#1c6ea4"></body>');
    const decoded = decodePng(await page.screenshot());
    expect(isUniformImage(decoded)).toBe(true);
  });

  it("no reporta fallo cuando la captura tiene contenido real", async () => {
    await page.setViewportSize({ width: 40, height: 40 });
    await page.setContent(
      '<body style="margin:0;background:#1c6ea4"><div style="width:15px;height:15px;background:#ffd66b;margin:5px"></div></body>',
    );
    const decoded = decodePng(await page.screenshot());
    expect(isUniformImage(decoded)).toBe(false);
  });
});
