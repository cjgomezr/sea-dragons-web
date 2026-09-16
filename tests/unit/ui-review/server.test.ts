import { describe, expect, it, vi } from "vitest";
import {
  describeFailure,
  withDevServer,
} from "../../../scripts/ui-review/server.ts";

const APP_URL = "http://localhost:3417";

describe("withDevServer", () => {
  it("apaga el servidor cuando el trabajo termina bien", async () => {
    const stop = vi.fn();
    const start = vi.fn().mockReturnValue(APP_URL);

    const result = await withDevServer(async (url) => `visitado ${url}`, {
      start,
      stop,
    });

    expect(result).toBe(`visitado ${APP_URL}`);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("apaga el servidor cuando el trabajo falla, y propaga el error", async () => {
    const stop = vi.fn();
    const start = vi.fn().mockReturnValue(APP_URL);

    await expect(
      withDevServer(() => Promise.reject(new Error("la captura falló")), {
        start,
        stop,
      }),
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

    await expect(withDevServer(run, { start, stop })).rejects.toThrow(
      /already answers/,
    );
    expect(run).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("describeFailure", () => {
  it("dice el código de salida aunque el proceso no haya escrito nada", () => {
    const failure = Object.assign(new Error("Command failed"), {
      status: 141,
      stdout: "",
      stderr: "",
    });

    expect(describeFailure(failure)).toContain("141");
  });

  it("acompaña el stderr con el código, porque su última línea puede ser un mensaje de éxito", () => {
    const failure = Object.assign(new Error("Command failed"), {
      status: 1,
      stdout: "",
      stderr: "ui-preflight: http://localhost:3417 is free.\n",
    });

    const described = describeFailure(failure);

    expect(described).toContain("is free");
    expect(described).toContain("1");
  });

  it("incluye también el stdout, donde el script deja la URL que llegó a imprimir", () => {
    const failure = Object.assign(new Error("Command failed"), {
      status: 2,
      stdout: "http://localhost:3417\n",
      stderr: "algo salió mal\n",
    });

    const described = describeFailure(failure);

    expect(described).toContain("http://localhost:3417");
    expect(described).toContain("algo salió mal");
  });

  it("nombra la señal cuando el proceso murió por una, no un código de salida", () => {
    const failure = Object.assign(new Error("Command failed"), {
      status: null,
      signal: "SIGKILL",
      stderr: "",
    });

    expect(describeFailure(failure)).toContain("SIGKILL");
  });

  it("se conforma con el mensaje cuando el error no viene de un proceso", () => {
    expect(describeFailure(new Error("bash no está instalado"))).toBe(
      "bash no está instalado",
    );
  });
});
