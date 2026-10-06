import { availableParallelism, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import {
  defineConfig,
  type TestProjectInlineConfiguration,
} from "vitest/config";
import {
  selectTestProjects,
  type TestProjectSelection,
} from "./tests/support/test-projects.mts";
import { selectMaxWorkers } from "./tests/support/test-workers.mts";

const sharedProjectOptions = {
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
} as const;

const sharedTestOptions = {
  globals: true,
  environment: "jsdom",
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
} as const;

function toVitestProject(
  project: TestProjectSelection,
): TestProjectInlineConfiguration {
  return {
    ...sharedProjectOptions,
    test: {
      ...sharedTestOptions,
      ...project,
      include: [...project.include],
      exclude: [...project.exclude],
      setupFiles: [...project.setupFiles],
    },
  };
}

export default defineConfig({
  test: {
    // Los workers los limita también la memoria, no sólo los núcleos: ver
    // `tests/support/test-workers.mts`.
    maxWorkers: selectMaxWorkers({
      cpuCount: availableParallelism(),
      totalMemoryBytes: totalmem(),
    }),
    projects: selectTestProjects(process.env).map(toVitestProject),
    globalSetup: [
      "./tests/support/vitest-global-setup.ts",
      "./tests/support/fetch-timeout-report.ts",
    ],
  },
});
