import { describe, expect, it } from "vitest";
import {
  type CycleChoiceStorage,
  forgetCycleChoice,
  readSavedCycleChoice,
  saveCycleChoice,
} from "@/lib/training/saved-cycle-choice";

/**
 * El último ciclo que eligió el socio en Entrenamiento (#981, D7 de E38),
 * guardado en el dispositivo y por cuenta.
 */

function memoryStorage(): CycleChoiceStorage & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

function failingStorage(): CycleChoiceStorage {
  const fail = (): never => {
    throw new DOMException("denied", "SecurityError");
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

const ANA = "user-ana";
const BEN = "user-ben";

describe("la elección guardada", () => {
  it("lee lo que se guardó para la misma cuenta", () => {
    const storage = memoryStorage();

    saveCycleChoice(storage, { userId: ANA, cycleId: "cycle-a" });

    expect(readSavedCycleChoice(storage, ANA)).toBe("cycle-a");
  });

  it("no lee la elección de otra cuenta del mismo navegador", () => {
    const storage = memoryStorage();
    saveCycleChoice(storage, { userId: ANA, cycleId: "cycle-a" });

    expect(readSavedCycleChoice(storage, BEN)).toBeNull();
  });

  it("es nula sin nada guardado", () => {
    expect(readSavedCycleChoice(memoryStorage(), ANA)).toBeNull();
  });

  it("olvida la elección de la cuenta y no la de otra", () => {
    const storage = memoryStorage();
    saveCycleChoice(storage, { userId: ANA, cycleId: "cycle-a" });
    saveCycleChoice(storage, { userId: BEN, cycleId: "cycle-b" });

    forgetCycleChoice(storage, ANA);

    expect(readSavedCycleChoice(storage, ANA)).toBeNull();
    expect(readSavedCycleChoice(storage, BEN)).toBe("cycle-b");
  });

  it("tolera que el almacenamiento falle al leer, guardar y olvidar", () => {
    const storage = failingStorage();

    expect(() => {
      saveCycleChoice(storage, { userId: ANA, cycleId: "cycle-a" });
      forgetCycleChoice(storage, ANA);
    }).not.toThrow();
    expect(readSavedCycleChoice(storage, ANA)).toBeNull();
  });

  it("sin almacenamiento no recuerda nada", () => {
    saveCycleChoice(null, { userId: ANA, cycleId: "cycle-a" });

    expect(readSavedCycleChoice(null, ANA)).toBeNull();
  });
});
