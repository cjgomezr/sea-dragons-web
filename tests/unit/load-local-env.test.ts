import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("carga de .env.local", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sigue disponible sin .env.local (ENOENT)", async () => {
    const missingFileError = Object.assign(
      new Error("ENOENT: no such file or directory, open '.env.local'"),
      { code: "ENOENT" },
    );
    vi.spyOn(process, "loadEnvFile").mockImplementation(() => {
      throw missingFileError;
    });

    const { loadLocalEnvFile } = await import("../support/load-local-env");

    expect(() => loadLocalEnvFile()).not.toThrow();
  });

  it("relanza un error de carga que no sea el archivo ausente", async () => {
    const permissionError = Object.assign(
      new Error("EACCES: permission denied, open '.env.local'"),
      { code: "EACCES" },
    );
    vi.spyOn(process, "loadEnvFile").mockImplementation(() => {
      throw permissionError;
    });

    const { loadLocalEnvFile } = await import("../support/load-local-env");

    // Si esto se tragara en silencio, un `.env.local` ilegible o con
    // sintaxis inválida se vería idéntico a "no hay credenciales" y
    // `describeRls` saltaría los tests de RLS sin ninguna pista de por qué:
    // exactamente el salto inconsistente que reporta el issue #68.
    expect(() => loadLocalEnvFile()).toThrowError(/permission denied/);
  });
});
