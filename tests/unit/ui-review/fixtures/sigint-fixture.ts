import { writeFile } from "node:fs/promises";
import { withRestoredFiles } from "../../../../scripts/ui-review/tree-guard.ts";

// Fixture para tree-guard.integration.test.ts: un proceso Node real al que el
// test le manda un SIGINT de verdad, para probar el mecanismo contra la señal
// del sistema operativo en vez de un `processLike` inyectado a mano.
const [guardedFilePath] = process.argv.slice(2);
if (!guardedFilePath) {
  throw new Error("uso: sigint-fixture.ts <archivo-a-vigilar>");
}

// Sin await de nivel superior: tsx (ejecutor de este fixture bajo Node 20,
// que no soporta --experimental-strip-types) transpila el entrypoint a CommonJS,
// y un await de nivel superior no es válido ahí.
console.error(`DEBUG fixture pid=${process.pid}`);
process.on("exit", (code) => {
  console.error(
    `DEBUG fixture exit code=${code} listeners=${process.listenerCount("SIGINT")}`,
  );
});
void (async () => {
  await withRestoredFiles([guardedFilePath], async () => {
    await writeFile(guardedFilePath, "reescrito por el fixture", "utf8");
    console.error(
      `DEBUG fixture listeners-after-register=${process.listenerCount("SIGINT")}`,
    );
    console.log("listo-para-sigint");
    await new Promise(() => {
      // Nunca resuelve: el fixture solo termina cuando el test le manda SIGINT.
    });
  });
})();
