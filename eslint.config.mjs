import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescriptConfig from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "tests/**/*-snapshots/**",
      "next-env.d.ts",
      // Handoff de Claude Design: HTML y runtime generados, no código del proyecto.
      "docs/**",
    ],
  },
  ...coreWebVitals,
  ...typescriptConfig,
];

export default config;
