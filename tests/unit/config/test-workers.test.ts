import { describe, expect, it } from "vitest";
import {
  MEMORY_PER_WORKER_BYTES,
  selectMaxWorkers,
} from "../../support/test-workers.mts";

const GIGABYTE = 1024 ** 3;

describe("cuántos workers abre Vitest", () => {
  it("abre uno por cada 2 GB en una máquina de 8 núcleos y 8 GB", () => {
    const workers = selectMaxWorkers({
      cpuCount: 8,
      totalMemoryBytes: 8 * GIGABYTE,
    });

    expect(workers).toBe(4);
  });

  it("no pasa de un núcleo menos que la máquina cuando sobra memoria", () => {
    const workers = selectMaxWorkers({
      cpuCount: 4,
      totalMemoryBytes: 16 * GIGABYTE,
    });

    expect(workers).toBe(3);
  });

  it("abre al menos uno aunque la memoria no llegue a un worker", () => {
    const workers = selectMaxWorkers({
      cpuCount: 8,
      totalMemoryBytes: GIGABYTE,
    });

    expect(workers).toBe(1);
  });

  it("abre uno en una máquina de un solo núcleo", () => {
    const workers = selectMaxWorkers({
      cpuCount: 1,
      totalMemoryBytes: 16 * GIGABYTE,
    });

    expect(workers).toBe(1);
  });

  it("cuenta solo los tramos completos de memoria", () => {
    const workers = selectMaxWorkers({
      cpuCount: 16,
      totalMemoryBytes: 5 * MEMORY_PER_WORKER_BYTES - 1,
    });

    expect(workers).toBe(4);
  });
});
