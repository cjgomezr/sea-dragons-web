import { describe, expect, it } from "vitest";
import { readDeploymentCommit } from "@/lib/deployment";

describe("readDeploymentCommit", () => {
  it("devuelve el sha que el build de Vercel inyecta en el entorno", () => {
    expect(readDeploymentCommit({ VERCEL_GIT_COMMIT_SHA: "9f1c0de" })).toBe(
      "9f1c0de",
    );
  });

  it("devuelve null fuera de un despliegue, donde nadie inyecta el sha", () => {
    expect(readDeploymentCommit({})).toBeNull();
  });

  it("trata una variable vacía como ausente", () => {
    expect(readDeploymentCommit({ VERCEL_GIT_COMMIT_SHA: "   " })).toBeNull();
  });
});
