import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Los 5 s por defecto de Vitest están pensados para tests en memoria.
    // Buena parte de esta suite no lo es: lanza scripts de shell reales
    // (stop-gate, process-backlog, file-incident, assign-epic, clear-blockers)
    // o habla por red con Supabase. Bajo `npm test` esos tests compiten con el
    // resto de los workers y agotan el plazo sin estar rotos. Ha pasado tres
    // veces (#50, #68 y assign-epic), cada una descubierta por separado y con
    // su propia investigación, así que el arreglo deja de ser caso por caso.
    //
    // El precio es que un test genuinamente colgado tarde 20 s en fallar en
    // vez de 5. Sale barato comparado con perseguir el siguiente.
    testTimeout: 20_000,
    // *.test.ts(x) is Vitest; *.spec.ts is Playwright. Keeping the split on the
    // extension stops each runner from collecting the other one's suite.
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/rls/**/*.test.ts",
    ],
  },
});
