import { describe, expect, it, vi } from "vitest";
import { withDevServer } from "../../../scripts/ui-review/server.ts";

const APP_URL = "http://localhost:3417";

describe("withDevServer", () => {
  it("apaga el servidor cuando el trabajo termina bien", async () => {
    const stop = vi.fn();
    const start = vi.fn().mockReturnValue(APP_URL);

    const result = await withDevServer(async (url) => `visitado ${url}`, { start, stop });

    expect(result).toBe(`visitado ${APP_URL}`);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("apaga el servidor cuando el trabajo falla, y propaga el error", async () => {
    const stop = vi.fn();
    const start = vi.fn().mockReturnValue(APP_URL);

    await expect(
      withDevServer(() => Promise.reject(new Error("la captura falló")), { start, stop }),
    ).rejects.toThrow("la captura falló");
    expect(stop).toHaveBeenCalledOnce();
  });

  it("cuenta el fallo al apagar dentro del error del trabajo, sin ocultarlo", async () => {
    const stopError = new Error("no se pudo matar el proceso");
    const stop = vi.fn().mockImplementation(() => {
      throw stopError;
    });
    const start = vi.fn().mockReturnValue(APP_URL);

    const failure = await withDevServer(
      () => Promise.reject(new Error("la captura falló")),
      { start, stop },
    ).catch((error: unknown) => error as Error);

    expect(failure.message).toContain("la captura falló");
    expect(failure.message).toContain("no se pudo apagar el dev server");
    expect(failure.cause).toBe(stopError);
  });

  it("no intenta apagar nada si el servidor nunca llegó a arrancar", async () => {
    const stop = vi.fn();
    const start = vi.fn().mockImplementation(() => {
      throw new Error("something already answers at http://localhost:3417");
    });
    const run = vi.fn();

    await expect(withDevServer(run, { start, stop })).rejects.toThrow(/already answers/);
    expect(run).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
});
