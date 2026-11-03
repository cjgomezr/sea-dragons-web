import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCENT_COLOR } from "@/lib/club/accent-color";
import {
  type ClubBrandRow,
  DEFAULT_CLUB_BRAND,
  createCachedClubBrandReader,
  deriveInitials,
} from "@/lib/club/club-brand";
import { NO_SIGN_IN_TEXTS, type SignInTexts } from "@/lib/club/sign-in-texts";
import { NO_SOCIAL_LINKS, type SocialLinks } from "@/lib/club/social-links";

/** La marca de E18a (#292, RF-1 y RF-2): se lee de la base una vez, se sirve de
 * la caché, y si la base no contesta la pantalla se pinta con el respaldo. */

const STORED_ROW: ClubBrandRow = {
  name: "Hobart Orcas",
  initials: "HO",
  accentColor: "#7b3fa0",
  logoUrl: null,
  signInTexts: NO_SIGN_IN_TEXTS,
};
const CLUB_SOCIAL_LINKS: SocialLinks = {
  ...NO_SOCIAL_LINKS,
  instagram: "https://www.instagram.com/hobartorcas",
};
const LOGO_URL = "https://storage.example.test/club-logos/club/logo.png";
const TIME_TO_LIVE_MS = 60_000;
const READ_TIMEOUT_MS = 3_000;

type ReaderSetup = {
  readonly fetchRow: () => Promise<ClubBrandRow>;
  readonly fetchSocialLinks?: () => Promise<SocialLinks>;
  readonly reportFailure?: (error: unknown) => void;
};

function createReader({
  fetchRow,
  fetchSocialLinks = async () => NO_SOCIAL_LINKS,
  reportFailure = vi.fn(),
}: ReaderSetup): {
  reader: ReturnType<typeof createCachedClubBrandReader>;
  advanceClock: (ms: number) => void;
} {
  let nowMs = 0;
  const reader = createCachedClubBrandReader({
    fetchRow,
    fetchSocialLinks,
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

  // #295: si la base no contesta, las iniciales y no un logo que no se sabe.
  it("no lleva logo", () => {
    expect(DEFAULT_CLUB_BRAND.logoUrl).toBeNull();
  });

  it("no lleva textos del inicio de sesión, así que salen los de la aplicación", () => {
    expect(DEFAULT_CLUB_BRAND.signInTexts).toEqual(NO_SIGN_IN_TEXTS);
  });

  // #964: si la base no contesta, la entrada se pinta sin redes.
  it("no lleva redes del club", () => {
    expect(DEFAULT_CLUB_BRAND.socialLinks).toEqual(NO_SOCIAL_LINKS);
  });
});

describe("lectura de la marca", () => {
  it("devuelve el nombre y las iniciales guardados", async () => {
    const { reader } = createReader({ fetchRow: async () => STORED_ROW });

    expect(await reader.read()).toEqual({
      name: "Hobart Orcas",
      initials: "HO",
      accentColor: "#7b3fa0",
      logoUrl: null,
      signInTexts: NO_SIGN_IN_TEXTS,
      socialLinks: NO_SOCIAL_LINKS,
    });
  });

  // #964: las redes del club viajan con la marca, en la misma caché.
  it("devuelve las redes que guardó el club", async () => {
    const { reader } = createReader({
      fetchRow: async () => STORED_ROW,
      fetchSocialLinks: async () => CLUB_SOCIAL_LINKS,
    });

    expect((await reader.read()).socialLinks).toEqual(CLUB_SOCIAL_LINKS);
  });

  it("sirve las redes de la caché, sin volver a pedirlas", async () => {
    const fetchSocialLinks = vi.fn(async () => CLUB_SOCIAL_LINKS);
    const { reader } = createReader({
      fetchRow: async () => STORED_ROW,
      fetchSocialLinks,
    });

    await reader.read();
    await reader.read();

    expect(fetchSocialLinks).toHaveBeenCalledTimes(1);
  });

  it("tras invalidar, vuelve a pedir las redes", async () => {
    const fetchSocialLinks = vi
      .fn<() => Promise<SocialLinks>>()
      .mockResolvedValueOnce(NO_SOCIAL_LINKS)
      .mockResolvedValueOnce(CLUB_SOCIAL_LINKS);
    const { reader } = createReader({
      fetchRow: async () => STORED_ROW,
      fetchSocialLinks,
    });

    await reader.read();
    reader.invalidate();

    expect((await reader.read()).socialLinks).toEqual(CLUB_SOCIAL_LINKS);
  });

  // #301: el lema y el párrafo del inicio de sesión viajan con la marca.
  it("devuelve los textos del inicio de sesión que escribió el club", async () => {
    const signInTexts: SignInTexts = {
      en: { tagline: "Dive in.", welcome: null },
      es: { tagline: null, welcome: null },
    };
    const { reader } = createReader({
      fetchRow: async () => ({ ...STORED_ROW, signInTexts }),
    });

    expect((await reader.read()).signInTexts).toEqual(signInTexts);
  });

  it("devuelve la dirección del logo cuando el club lo tiene", async () => {
    const { reader } = createReader({
      fetchRow: async () => ({ ...STORED_ROW, logoUrl: LOGO_URL }),
    });

    expect((await reader.read()).logoUrl).toBe(LOGO_URL);
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

  // #964: un fallo de las redes no se lleva el nombre, el logo ni los textos.
  it("si leer las redes falla, devuelve la marca guardada sin redes y registra el fallo", async () => {
    const failure = new Error("relation club_social_links does not exist");
    const reportFailure = vi.fn();
    const { reader } = createReader({
      fetchRow: async () => STORED_ROW,
      fetchSocialLinks: async () => {
        throw failure;
      },
      reportFailure,
    });

    const brand = await reader.read();

    expect(brand.name).toBe("Hobart Orcas");
    expect(brand.socialLinks).toEqual(NO_SOCIAL_LINKS);
    expect(reportFailure).toHaveBeenCalledWith(failure);
  });

  it("tras un fallo de las redes, la visita siguiente vuelve a pedirlas", async () => {
    const fetchSocialLinks = vi
      .fn<() => Promise<SocialLinks>>()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce(CLUB_SOCIAL_LINKS);
    const { reader } = createReader({
      fetchRow: async () => STORED_ROW,
      fetchSocialLinks,
    });

    await reader.read();

    expect((await reader.read()).socialLinks).toEqual(CLUB_SOCIAL_LINKS);
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
