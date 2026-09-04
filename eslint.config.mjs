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
      // Checkouts completos que la fábrica deja por cada ticket. Sin esto,
      // `eslint .` lintea el repo tantas veces como worktrees haya, y el gate
      // se cae por código que ya está mergeado.
      ".claude/worktrees/**",
      ".factory/**",
    ],
  },
  ...coreWebVitals,
  ...typescriptConfig,
];

export default config;
