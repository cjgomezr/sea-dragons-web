import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCENT_COLOR } from "@/lib/club/accent-color";
import {
  type ClubBrandRow,
  DEFAULT_CLUB_BRAND,
  createCachedClubBrandReader,
  deriveInitials,
} from "@/lib/club/club-brand";

/** La marca de E18a (#292, RF-1 y RF-2): se lee de la base una vez, se sirve de
 * la caché, y si la base no contesta la pantalla se pinta con el respaldo. */

const STORED_ROW: ClubBrandRow = {
  name: "Hobart Orcas",
  initials: "HO",
  accentColor: "#7b3fa0",
};
const TIME_TO_LIVE_MS = 60_000;
const READ_TIMEOUT_MS = 3_000;

type ReaderSetup = {
  readonly fetchRow: () => Promise<ClubBrandRow>;
  readonly reportFailure?: (error: unknown) => void;
};

function createReader({ fetchRow, reportFailure = vi.fn() }: ReaderSetup): {
  reader: ReturnType<typeof createCachedClubBrandReader>;
  advanceClock: (ms: number) => void;
} {
  let nowMs = 0;
  const reader = createCachedClubBrandReader({
    fetchRow,
    reportFailure,
    timeToLiveMs: TIME_TO_LIVE_MS,
    readTimeoutMs: READ_TIMEOUT_MS,
    now: () => nowMs,
  });
  return {
    reader,
    advanceClock: (ms) => {
      nowMs += ms;
    },
  };
}

describe("derivar las iniciales", () => {
  it("toma la primera letra de las dos primeras palabras, en mayúsculas", () => {
    expect(deriveInitials("hobart orcas underwater club")).toBe("HO");
  });

  it("se queda con una letra si el nombre es de una sola palabra", () => {
    expect(deriveInitials("Orcas")).toBe("O");
  });

  it("ignora los espacios de sobra entre palabras", () => {
    expect(deriveInitials("  Ñandúes   del Sur ")).toBe("ÑD");
  });
});

describe("marca por defecto", () => {
  // #294: sin marca legible, el acento de hoy.
  it("lleva el acento de hoy", () => {
    expect(DEFAULT_CLUB_BRAND.accentColor).toBe(DEFAULT_ACCENT_COLOR);
  });
});

describe("lectura de la marca", () => {
  it("devuelve el nombre y las iniciales guardados", async () => {
    const { reader } = createReader({ fetchRow: async () => STORED_ROW });

    expect(await reader.read()).toEqual({
      name: "Hobart Orcas",
      initials: "HO",
      accentColor: "#7b3fa0",
    });
  });

  it("deriva las iniciales del nombre cuando no hay guardadas", async () => {
    const { reader } = createReader({
      fetchRow: async () => ({
        ...STORED_ROW,
        name: "Geelong Stingrays",
        initials: null,
      }),
    });

    expect((await reader.read()).initials).toBe("GS");
  });

  it("una segunda lectura no vuelve a consultar la base", async () => {
    const fetchRow = vi.fn(async () => STORED_ROW);
    const { reader } = createReader({ fetchRow });

    await reader.read();
    await reader.read();

    expect(fetchRow).toHaveBeenCalledTimes(1);
  });

  it("dos visitas a la vez con la caché vacía hacen una sola consulta", async () => {
    const fetchRow = vi.fn(async () => STORED_ROW);
    const { reader } = createReader({ fetchRow });

    await Promise.all([reader.read(), reader.read()]);

    expect(fetchRow).toHaveBeenCalledTimes(1);
  });

  it("vuelve a consultar cuando caduca la caché", async () => {
    const fetchRow = vi.fn(async () => STORED_ROW);
    const { reader, advanceClock } = createReader({ fetchRow });

    await reader.read();
    advanceClock(TIME_TO_LIVE_MS + 1);
    await reader.read();

    expect(fetchRow).toHaveBeenCalledTimes(2);
  });

  it("invalidar la caché hace que la siguiente lectura vea el valor nuevo", async () => {
    const fetchRow = vi
      .fn<() => Promise<ClubBrandRow>>()
      .mockResolvedValueOnce(STORED_ROW)
      .mockResolvedValueOnce({ ...STORED_ROW, name: "Hobart Sharks" });
    const { reader } = createReader({ fetchRow });

    await reader.read();
    reader.invalidate();

    expect((await reader.read()).name).toBe("Hobart Sharks");
  });

  it("con la base caída devuelve los valores por defecto y registra el fallo", async () => {
    const failure = new Error("connect ECONNREFUSED");
    const reportFailure = vi.fn();
    const { reader } = createReader({
      fetchRow: async () => {
        throw failure;
      },
      reportFailure,
    });

    expect(await reader.read()).toEqual(DEFAULT_CLUB_BRAND);
    expect(reportFailure).toHaveBeenCalledWith(failure);
  });

  describe("con la base colgada", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // Una base que no contesta no devuelve un error: deja la consulta colgada,
    // y con ella cada pantalla que espera la marca.
    it("pasado el plazo devuelve los valores por defecto y registra el fallo", async () => {
      vi.useFakeTimers();
      const reportFailure = vi.fn();
      const { reader } = createReader({
        fetchRow: () => new Promise<ClubBrandRow>(() => {}),
        reportFailure,
      });

      const brand = reader.read();
      await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);

      expect(await brand).toEqual(DEFAULT_CLUB_BRAND);
      expect(reportFailure).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/3000ms/) }),
      );
    });

    it("la visita siguiente al plazo vuelve a consultar la base", async () => {
      vi.useFakeTimers();
      const fetchRow = vi
        .fn<() => Promise<ClubBrandRow>>()
        .mockReturnValueOnce(new Promise<ClubBrandRow>(() => {}))
        .mockResolvedValueOnce(STORED_ROW);
      const { reader } = createReader({ fetchRow });

      const firstBrand = reader.read();
      await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
      await firstBrand;

      expect((await reader.read()).name).toBe("Hobart Orcas");
    });
  });

  it("no guarda en la caché un fallo: la visita siguiente vuelve a intentarlo", async () => {
    const fetchRow = vi
      .fn<() => Promise<ClubBrandRow>>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(STORED_ROW);
    const { reader } = createReader({ fetchRow });

    await reader.read();

    expect((await reader.read()).name).toBe("Hobart Orcas");
  });
});
