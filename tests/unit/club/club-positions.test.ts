import { describe, expect, it, vi } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  type ClubPosition,
  type ClubPositions,
  createCachedClubPositionsReader,
  findClubPosition,
  isAcceptablePosition,
  listPositionChoices,
  offeredPositions,
  positionName,
  positionRank,
} from "@/lib/club/club-positions";

/** Las posiciones de juego por club (#299, RF-7 del PRD de E18a): el
 * desplegable ofrece las activas en el orden del club, una archivada sólo la
 * conserva quien ya la tenía, y el nombre sale en el idioma de la pantalla o,
 * si falta, en el otro. */

const GOALKEEPER: ClubPosition = {
  id: "00000000-0000-4000-8000-000000000001",
  names: { en: "Goalkeeper", es: "Portería" },
  isArchived: false,
};
const UTILITY: ClubPosition = {
  id: "00000000-0000-4000-8000-000000000002",
  names: { en: "Utility", es: "Comodín" },
  isArchived: true,
};
const FORWARD: ClubPosition = {
  id: "00000000-0000-4000-8000-000000000003",
  names: { en: "Forward", es: "Ataque" },
  isArchived: false,
};
const OTHER_CLUBS_POSITION_ID = "00000000-0000-4000-8000-000000000099";

/** En el orden del club: la archivada va en medio a propósito. */
const CLUB_POSITIONS: ClubPositions = [GOALKEEPER, UTILITY, FORWARD];

describe("posiciones del club", () => {
  describe("las que se ofrecen", () => {
    it("son las activas, en el orden del club", () => {
      expect(offeredPositions(CLUB_POSITIONS, null)).toEqual([
        GOALKEEPER,
        FORWARD,
      ]);
    });

    it("incluyen la archivada, en su sitio, para quien la tiene", () => {
      expect(offeredPositions(CLUB_POSITIONS, UTILITY.id)).toEqual([
        GOALKEEPER,
        UTILITY,
        FORWARD,
      ]);
    });

    it("no incluyen la archivada para quien tiene otra", () => {
      expect(offeredPositions(CLUB_POSITIONS, FORWARD.id)).toEqual([
        GOALKEEPER,
        FORWARD,
      ]);
    });

    it("quedan vacías si el club archivó todas", () => {
      expect(offeredPositions([UTILITY], null)).toEqual([]);
    });
  });

  describe("lo que se acepta al guardar", () => {
    it("acepta una activa", () => {
      expect(
        isAcceptablePosition(CLUB_POSITIONS, {
          chosenId: FORWARD.id,
          currentId: null,
        }),
      ).toBe(true);
    });

    it("acepta no tener posición", () => {
      expect(
        isAcceptablePosition(CLUB_POSITIONS, {
          chosenId: null,
          currentId: GOALKEEPER.id,
        }),
      ).toBe(true);
    });

    it("rechaza una archivada como valor nuevo", () => {
      expect(
        isAcceptablePosition(CLUB_POSITIONS, {
          chosenId: UTILITY.id,
          currentId: GOALKEEPER.id,
        }),
      ).toBe(false);
    });

    it("acepta conservar la archivada que ya tenía", () => {
      expect(
        isAcceptablePosition(CLUB_POSITIONS, {
          chosenId: UTILITY.id,
          currentId: UTILITY.id,
        }),
      ).toBe(true);
    });

    it("rechaza una posición de otro club", () => {
      expect(
        isAcceptablePosition(CLUB_POSITIONS, {
          chosenId: OTHER_CLUBS_POSITION_ID,
          currentId: null,
        }),
      ).toBe(false);
    });

    it("rechaza un valor que no es ninguna posición", () => {
      expect(
        isAcceptablePosition(CLUB_POSITIONS, {
          chosenId: "Forward",
          currentId: null,
        }),
      ).toBe(false);
    });
  });

  describe("el nombre", () => {
    it("sale en el idioma de la pantalla", () => {
      expect(positionName(GOALKEEPER.names, "en")).toBe("Goalkeeper");
      expect(positionName(GOALKEEPER.names, "es")).toBe("Portería");
    });

    it("sale en inglés si falta el español", () => {
      expect(positionName({ en: "Sweeper", es: null }, "es")).toBe("Sweeper");
    });

    it("sale en español si falta el inglés", () => {
      expect(positionName({ en: null, es: "Líbero" }, "en")).toBe("Líbero");
    });
  });

  describe("el orden", () => {
    it("es el lugar en el catálogo del club, archivadas incluidas", () => {
      expect(positionRank(CLUB_POSITIONS, GOALKEEPER.id)).toBe(0);
      expect(positionRank(CLUB_POSITIONS, UTILITY.id)).toBe(1);
      expect(positionRank(CLUB_POSITIONS, FORWARD.id)).toBe(2);
    });

    it("falla con una posición que el club no tiene", () => {
      expect(() =>
        positionRank(CLUB_POSITIONS, OTHER_CLUBS_POSITION_ID),
      ).toThrow(OTHER_CLUBS_POSITION_ID);
    });
  });
});

const CLUB_ID = "club-1";
const OTHER_CLUB_ID = "club-2";
const TIME_TO_LIVE_MS = 60_000;

function createReader(
  fetchPositions: (clubId: string) => Promise<ClubPositions>,
): {
  reader: ReturnType<typeof createCachedClubPositionsReader>;
  advanceClock: (ms: number) => void;
} {
  let nowMs = 0;
  return {
    reader: createCachedClubPositionsReader({
      fetchPositions,
      timeToLiveMs: TIME_TO_LIVE_MS,
      now: () => nowMs,
    }),
    advanceClock: (ms) => {
      nowMs += ms;
    },
  };
}

describe("buscar una posición del club", () => {
  it("devuelve la del id pedido", () => {
    expect(findClubPosition(CLUB_POSITIONS, UTILITY.id)).toBe(UTILITY);
  });

  it("falla con una posición que el club no tiene", () => {
    expect(() =>
      findClubPosition(CLUB_POSITIONS, OTHER_CLUBS_POSITION_ID),
    ).toThrow(OTHER_CLUBS_POSITION_ID);
  });
});

describe("la caché de las posiciones", () => {
  it("lee la base una sola vez mientras no caduca", async () => {
    const fetchPositions = vi.fn(async () => CLUB_POSITIONS);
    const { reader } = createReader(fetchPositions);

    await reader.findClubPositions(CLUB_ID);
    const positions = await reader.findClubPositions(CLUB_ID);

    expect(positions).toEqual(CLUB_POSITIONS);
    expect(fetchPositions).toHaveBeenCalledTimes(1);
  });

  it("vuelve a leer la base cuando caduca", async () => {
    const fetchPositions = vi.fn(async () => CLUB_POSITIONS);
    const { reader, advanceClock } = createReader(fetchPositions);

    await reader.findClubPositions(CLUB_ID);
    advanceClock(TIME_TO_LIVE_MS);
    await reader.findClubPositions(CLUB_ID);

    expect(fetchPositions).toHaveBeenCalledTimes(2);
  });

  it("guarda cada club por separado", async () => {
    const fetchPositions = vi.fn(async (clubId: string) =>
      clubId === CLUB_ID ? CLUB_POSITIONS : [FORWARD],
    );
    const { reader } = createReader(fetchPositions);

    await reader.findClubPositions(CLUB_ID);

    expect(await reader.findClubPositions(OTHER_CLUB_ID)).toEqual([FORWARD]);
    expect(fetchPositions).toHaveBeenCalledWith(OTHER_CLUB_ID);
  });

  it("propaga un fallo y no lo guarda: la siguiente lectura reintenta", async () => {
    const fetchPositions = vi
      .fn<(clubId: string) => Promise<ClubPositions>>()
      .mockRejectedValueOnce(new Error("sin base"))
      .mockResolvedValueOnce(CLUB_POSITIONS);
    const { reader } = createReader(fetchPositions);

    await expect(reader.findClubPositions(CLUB_ID)).rejects.toThrow("sin base");

    expect(await reader.findClubPositions(CLUB_ID)).toEqual(CLUB_POSITIONS);
  });
});

describe("las posiciones que se pueden elegir", () => {
  const CALLER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";

  function choicesGateways(member: { clubId: string } | null): {
    gateways: Parameters<typeof listPositionChoices>[0];
    clubsRead: string[];
  } {
    const clubsRead: string[] = [];
    return {
      clubsRead,
      gateways: {
        members: {
          findRoleRequestMember: async () =>
            member === null
              ? null
              : { clubId: member.clubId, fullName: "Ana", role: "Admin" },
        },
        positions: {
          findClubPositions: async (clubId) => {
            clubsRead.push(clubId);
            return CLUB_POSITIONS;
          },
        },
      },
    };
  }

  it("son las activas del club de quien pregunta, en su orden y sin la marca de archivo", async () => {
    const { gateways, clubsRead } = choicesGateways({ clubId: CLUB_ID });

    const choices = await listPositionChoices(gateways, CALLER_ID);

    expect(choices).toEqual([
      { id: GOALKEEPER.id, names: GOALKEEPER.names },
      { id: FORWARD.id, names: FORWARD.names },
    ]);
    expect(clubsRead).toEqual([CLUB_ID]);
  });

  it("falla con quien no tiene fila de miembro", async () => {
    const { gateways } = choicesGateways(null);

    await expect(
      listPositionChoices(gateways, CALLER_ID),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
