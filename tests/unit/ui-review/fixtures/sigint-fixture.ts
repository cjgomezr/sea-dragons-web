import { writeFile } from "node:fs/promises";
import { withRestoredFiles } from "../../../../scripts/ui-review/tree-guard.ts";

// Fixture para tree-guard.integration.test.ts: un proceso Node real al que el
// test le manda un SIGINT de verdad, para probar el mecanismo contra la señal
// del sistema operativo en vez de un `processLike` inyectado a mano.
const [guardedFilePath] = process.argv.slice(2);
if (!guardedFilePath) {
  throw new Error("uso: sigint-fixture.ts <archivo-a-vigilar>");
}

// Sin await de nivel superior: tsx, que es quien ejecuta este fixture,
// transpila el entrypoint a CommonJS, y un await de nivel superior no es
// válido ahí.
void (async () => {
  await withRestoredFiles([guardedFilePath], async () => {
    await writeFile(guardedFilePath, "reescrito por el fixture", "utf8");
    console.log("listo-para-sigint");
    await new Promise(() => {
      // Nunca resuelve por sí sola: una promesa colgada no mantiene vivo el
      // event loop (confirmado en Linux: sin este timer, el proceso salía
      // solo con código 0 apenas terminaba de arrancar, antes de que le
      // llegara cualquier señal). El intervalo es el handle real que lo
      // mantiene vivo hasta el SIGINT que manda el test.
      setInterval(() => {}, 1 << 30);
    });
  });
})();
