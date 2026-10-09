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
  {
    rules: {
      // #547: la raíz de Phosphor reexporta más de mil iconos y la variante
      // `csr` necesita un contexto de React que obliga a "use client". Un
      // icono por archivo, desde `dist/ssr`, y nada más del paquete.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^@phosphor-icons/react(?!/dist/ssr/[A-Z]\\w*$|/dist/lib/types$)",
              message:
                'Importa cada icono desde "@phosphor-icons/react/dist/ssr/<Icono>" y píntalo con <Icon> (design-system.md, Icons).',
            },
          ],
        },
      ],
    },
  },
];

export default config;
