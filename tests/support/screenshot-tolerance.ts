/**
 * Cuánto puede diferir una captura de su línea base sin que cuente como
 * regresión. Viven juntas porque se leen juntas: un píxel sólo entra en la
 * cuenta de los presupuestos de abajo si su color supera la tolerancia.
 */

// #606: la tolerancia de color por píxel de pixelmatch (0 = cualquier
// diferencia cuenta, 1 = ninguna). Con el 0,2 por defecto la visual dejó
// pasar el #590: la etiqueta Document pasó del acento al 16 % al verde de
// Success al 22 % sobre el panel y ninguna captura se puso roja. Medido con
// la fórmula YIQ de pixelmatch, ese cambio deja de contar por encima de
// 0,0217 en el tema claro (0,0623 en el oscuro), así que 0,02 es el valor
// redondo más alto que todavía lo ve. Lo fija
// tests/unit/scripts/screenshot-color-threshold.test.ts. Bajarla no trae
// ruido: el #77 midió con tolerancia cero en Linux y salió 0 píxeles en
// todas las capturas sin regresión real. Se aplica una sola vez, en
// playwright.config.ts, para que ninguna llamada pueda saltársela.
export const SCREENSHOT_COLOR_THRESHOLD = 0.02;

// #77: medido comparando esta misma rama sin cambios dos veces en CI
// (Linux), contra la línea base ya aceptada, con tolerancia puesta a cero
// para que cualquier diferencia real de renderizado quedara expuesta en el
// reporte (runs 34072162451 y 34072312519). Resultado: 0 píxeles de
// diferencia en las 22 capturas de página sin regresión real, en ambas
// corridas. Las únicas fallas fueron las dos líneas base oscuras ya sabidas
// como desactualizadas (home-mobile-dark: 1756px, section-mobile-dark:
// 1849px, idénticos en ambas corridas), que no son ruido sino el defecto
// que este ticket corrige. El margen de abajo es generoso frente al ruido
// medido (0) y sigue quedando dos órdenes de magnitud por debajo de la
// regresión real más pequeña observada (1756px). Es un presupuesto
// ABSOLUTO a propósito: uno por ratio crece con el alto de la página y es
// la causa raíz del punto ciego (#77).
export const PAGE_MAX_DIFF_PIXELS = 20;
export const COMPONENT_MAX_DIFF_PIXELS = 10;
