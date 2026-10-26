import { beforeEach, describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import type { ClubPositions, PositionNames } from "@/lib/club/club-positions";
import { ClubSettingsForbiddenError } from "@/lib/club/club-settings";
import {
  type ManagedPosition,
  type ManagedPositionsGateways,
  POSITION_MIN_PER_TEAM_MAX,
  POSITION_NAME_MAX_LENGTH,
  POSITION_SHORT_NAME_MAX_LENGTH,
  PositionNotFoundError,
  PositionValidationError,
  PositionsChangedError,
  createPosition,
  findPositionNameIssues,
  listManagedPositions,
  renamePosition,
  reorderPositions,
  setPositionArchived,
  setPositionMinimum,
  setPositionShortNames,
} from "@/lib/club/manage-club-positions";

/**
 * El Admin administra las posiciones del club (#300, RF-7 del PRD de E18a),
 * contado contra un catálogo en memoria. Lo que garantiza la base (que las
 * escrituras no se queden a medias, que un nombre repetido se detecte con dos
 * Admin a la vez) lo prueba `manage-club-positions-migration.test.ts`.
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const OTHER_CLUBS_POSITION_ID = "00000000-0000-4000-8000-000000000099";

const GOALKEEPER: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000001",
  names: { en: "Goalkeeper", es: "Portería" },
  isArchived: false,
  minPerTeam: 1,
  shortNames: { en: "GK", es: "POR" },
};
const DEFENDER: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000002",
  names: { en: "Defender", es: "Defensa" },
  isArchived: false,
  minPerTeam: 1,
  shortNames: { en: "DEF", es: "DEF" },
};
const FORWARD: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000003",
  names: { en: "Forward", es: "Ataque" },
  isArchived: false,
  minPerTeam: 1,
  shortNames: { en: "ATT", es: "ATA" },
};

const NEW_POSITION_ID = "00000000-0000-4000-8000-000000000004";

/** Quién tiene cada posición: archivar o renombrar no debe tocarlo. */
const MEMBER_POSITIONS = new Map([["nerea", DEFENDER.id]]);

let callerRole: Role;
let catalog: ManagedPosition[];
let auditRows: AuditLogInsertRow[];

function sameName(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

function takenLocale(
  names: PositionNames,
  ownId: string | null,
): "en" | "es" | null {
  const others = catalog.filter((position) => position.id !== ownId);
  return (
    (["en", "es"] as const).find((locale) =>
      others.some((other) => sameName(other.names[locale], names[locale])),
    ) ?? null
  );
}

function positionWithId(positionId: string): ManagedPosition | undefined {
  return catalog.find((position) => position.id === positionId);
}

function gateways(): ManagedPositionsGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: callerRole,
      }),
    },
    positions: {
      findClubPositions: async () => catalog,
      insertPosition: async (_clubId, names) => {
        const locale = takenLocale(names, null);
        if (locale !== null) {
          return { kind: "name_taken", locale };
        }
        catalog = [
          ...catalog,
          {
            id: NEW_POSITION_ID,
            names,
            isArchived: false,
            minPerTeam: 0,
            shortNames: { en: null, es: null },
          },
        ];
        return { kind: "created", positionId: NEW_POSITION_ID };
      },
      renamePosition: async ({ positionId }, names) => {
        if (positionWithId(positionId) === undefined) {
          return { kind: "not_found" };
        }
        const locale = takenLocale(names, positionId);
        if (locale !== null) {
          return { kind: "name_taken", locale };
        }
        catalog = catalog.map((position) =>
          position.id === positionId ? { ...position, names } : position,
        );
        return { kind: "renamed" };
      },
      reorderPositions: async (_clubId, positionIds) => {
        const active = catalog.filter((position) => !position.isArchived);
        if (
          positionIds.length !== active.length ||
          !active.every((position) => positionIds.includes(position.id))
        ) {
          return { kind: "positions_changed" };
        }
        catalog = [
          ...active
            .slice()
            .sort(
              (a, b) => positionIds.indexOf(a.id) - positionIds.indexOf(b.id),
            ),
          ...catalog.filter((position) => position.isArchived),
        ];
        return { kind: "reordered" };
      },
      setPositionArchived: async ({ positionId }, isArchived) => {
        const position = positionWithId(positionId);
        if (position === undefined) {
          return { kind: "not_found" };
        }
        if (position.isArchived === isArchived) {
          return { kind: "unchanged" };
        }
        catalog = [
          ...catalog.filter((other) => other !== position),
          { ...position, isArchived },
        ];
        return { kind: "changed" };
      },
      setPositionMinimum: async ({ positionId }, minPerTeam) => {
        const position = positionWithId(positionId);
        if (position === undefined) {
          return { kind: "not_found" };
        }
        if (position.minPerTeam === minPerTeam) {
          return { kind: "unchanged" };
        }
        catalog = catalog.map((other) =>
          other === position ? { ...position, minPerTeam } : other,
        );
        return { kind: "changed", previous: position.minPerTeam };
      },
      setPositionShortNames: async ({ positionId }, shortNames) => {
        const position = positionWithId(positionId);
        if (position === undefined) {
          return { kind: "not_found" };
        }
        const unnamed = (["en", "es"] as const).find(
          (locale) =>
            shortNames[locale] !== null && position.names[locale] === null,
        );
        if (unnamed !== undefined) {
          return { kind: "name_missing", locale: unnamed };
        }
        if (
          position.shortNames.en === shortNames.en &&
          position.shortNames.es === shortNames.es
        ) {
          return { kind: "unchanged" };
        }
        catalog = catalog.map((other) =>
          other === position ? { ...position, shortNames } : other,
        );
        return { kind: "changed", previous: position.shortNames };
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
  };
}

function namesOf(positions: ClubPositions): string[] {
  return positions.map(
    (position) => `${position.names.en ?? "-"}|${position.names.es ?? "-"}`,
  );
}

beforeEach(() => {
  callerRole = "Admin";
  catalog = [GOALKEEPER, DEFENDER, FORWARD];
  auditRows = [];
});

describe("administrar posiciones", () => {
  describe("listar", () => {
    it("devuelve activas y archivadas, en el orden del club", async () => {
      catalog = [GOALKEEPER, { ...DEFENDER, isArchived: true }, FORWARD];

      const positions = await listManagedPositions(gateways(), ADMIN_ID);

      expect(positions).toEqual(catalog);
    });
  });

  describe("crear", () => {
    it("añade la posición con sus dos nombres, recortados", async () => {
      const positions = await createPosition(gateways(), {
        callerId: ADMIN_ID,
        names: { en: "  Centre ", es: "Centro" },
      });

      expect(namesOf(positions).at(-1)).toBe("Centre|Centro");
    });

    it("guarda sólo el idioma que se dio, y el otro vacío queda en null", async () => {
      const positions = await createPosition(gateways(), {
        callerId: ADMIN_ID,
        names: { en: "   ", es: "Centro" },
      });

      expect(positions.at(-1)?.names).toEqual({ en: null, es: "Centro" });
    });

    it("rechaza un nombre repetido en el mismo idioma, señalando el campo", async () => {
      const creating = createPosition(gateways(), {
        callerId: ADMIN_ID,
        names: { en: "Centre", es: "defensa" },
      });

      await expect(creating).rejects.toBeInstanceOf(PositionValidationError);
      await expect(creating).rejects.toMatchObject({
        issues: [{ code: "name_es_taken" }],
      });
      expect(catalog).toHaveLength(3);
    });

    it("rechaza una posición sin ningún nombre sin llegar al catálogo", async () => {
      await expect(
        createPosition(gateways(), {
          callerId: ADMIN_ID,
          names: { en: "", es: " " },
        }),
      ).rejects.toMatchObject({ issues: [{ code: "name_required" }] });
      expect(catalog).toHaveLength(3);
    });
  });

  describe("renombrar", () => {
    it("cambia el nombre y quien la tenía la sigue teniendo", async () => {
      const positions = await renamePosition(gateways(), {
        callerId: ADMIN_ID,
        positionId: DEFENDER.id,
        names: { en: "Back", es: "Defensa" },
      });

      expect(namesOf(positions)).toEqual([
        "Goalkeeper|Portería",
        "Back|Defensa",
        "Forward|Ataque",
      ]);
      expect(MEMBER_POSITIONS.get("nerea")).toBe(DEFENDER.id);
    });

    it("rechaza el nombre de otra posición", async () => {
      await expect(
        renamePosition(gateways(), {
          callerId: ADMIN_ID,
          positionId: DEFENDER.id,
          names: { en: "forward", es: "Defensa" },
        }),
      ).rejects.toMatchObject({ issues: [{ code: "name_en_taken" }] });
    });

    it("no encuentra la posición de otro club", async () => {
      await expect(
        renamePosition(gateways(), {
          callerId: ADMIN_ID,
          positionId: OTHER_CLUBS_POSITION_ID,
          names: { en: "Back", es: null },
        }),
      ).rejects.toBeInstanceOf(PositionNotFoundError);
    });
  });

  describe("reordenar", () => {
    it("deja las posiciones en el orden de la lista", async () => {
      const positions = await reorderPositions(gateways(), {
        callerId: ADMIN_ID,
        positionIds: [FORWARD.id, GOALKEEPER.id, DEFENDER.id],
      });

      expect(positions.map((position) => position.id)).toEqual([
        FORWARD.id,
        GOALKEEPER.id,
        DEFENDER.id,
      ]);
    });

    it("avisa si las activas cambiaron entretanto", async () => {
      await expect(
        reorderPositions(gateways(), {
          callerId: ADMIN_ID,
          positionIds: [FORWARD.id, GOALKEEPER.id],
        }),
      ).rejects.toBeInstanceOf(PositionsChangedError);
    });
  });

  describe("archivar y reactivar", () => {
    it("archivar una que está en uso conserva a sus miembros", async () => {
      const positions = await setPositionArchived(gateways(), {
        callerId: ADMIN_ID,
        positionId: DEFENDER.id,
        isArchived: true,
      });

      expect(
        positions.find((position) => position.id === DEFENDER.id)?.isArchived,
      ).toBe(true);
      expect(MEMBER_POSITIONS.get("nerea")).toBe(DEFENDER.id);
    });

    it("reactivar la vuelve a dejar entre las activas", async () => {
      catalog = [GOALKEEPER, FORWARD, { ...DEFENDER, isArchived: true }];

      const positions = await setPositionArchived(gateways(), {
        callerId: ADMIN_ID,
        positionId: DEFENDER.id,
        isArchived: false,
      });

      expect(positions.every((position) => !position.isArchived)).toBe(true);
    });

    it("no encuentra la posición de otro club", async () => {
      await expect(
        setPositionArchived(gateways(), {
          callerId: ADMIN_ID,
          positionId: OTHER_CLUBS_POSITION_ID,
          isArchived: true,
        }),
      ).rejects.toBeInstanceOf(PositionNotFoundError);
    });
  });

  describe("mínimo por equipo", () => {
    it("guarda el mínimo nuevo de la posición", async () => {
      const positions = await setPositionMinimum(gateways(), {
        callerId: ADMIN_ID,
        positionId: FORWARD.id,
        minPerTeam: 2,
      });

      expect(positions.map((position) => position.minPerTeam)).toEqual([
        1, 1, 2,
      ]);
    });

    it.each([0, POSITION_MIN_PER_TEAM_MAX])("admite %s", async (minPerTeam) => {
      const positions = await setPositionMinimum(gateways(), {
        callerId: ADMIN_ID,
        positionId: FORWARD.id,
        minPerTeam,
      });

      expect(positions[2]?.minPerTeam).toBe(minPerTeam);
    });

    it.each([-1, POSITION_MIN_PER_TEAM_MAX + 1, 1.5])(
      "rechaza %s sin guardar nada",
      async (minPerTeam) => {
        await expect(
          setPositionMinimum(gateways(), {
            callerId: ADMIN_ID,
            positionId: FORWARD.id,
            minPerTeam,
          }),
        ).rejects.toMatchObject({
          issues: [{ code: "min_per_team_out_of_range" }],
        });
        expect(catalog).toEqual([GOALKEEPER, DEFENDER, FORWARD]);
        expect(auditRows).toEqual([]);
      },
    );

    it("lo guarda también en una posición archivada", async () => {
      catalog = [GOALKEEPER, DEFENDER, { ...FORWARD, isArchived: true }];

      const positions = await setPositionMinimum(gateways(), {
        callerId: ADMIN_ID,
        positionId: FORWARD.id,
        minPerTeam: 3,
      });

      expect(positions[2]).toMatchObject({ isArchived: true, minPerTeam: 3 });
    });

    it("no encuentra la posición de otro club", async () => {
      await expect(
        setPositionMinimum(gateways(), {
          callerId: ADMIN_ID,
          positionId: OTHER_CLUBS_POSITION_ID,
          minPerTeam: 2,
        }),
      ).rejects.toBeInstanceOf(PositionNotFoundError);
    });
  });

  describe("abreviaturas", () => {
    it("guarda las dos, recortadas", async () => {
      const positions = await setPositionShortNames(gateways(), {
        callerId: ADMIN_ID,
        positionId: DEFENDER.id,
        shortNames: { en: " LIB ", es: "LÍB" },
      });

      expect(positions[1]?.shortNames).toEqual({ en: "LIB", es: "LÍB" });
    });

    it("deja sin abreviatura el idioma que llega vacío o en blanco", async () => {
      const positions = await setPositionShortNames(gateways(), {
        callerId: ADMIN_ID,
        positionId: DEFENDER.id,
        shortNames: { en: "", es: "   " },
      });

      expect(positions[1]?.shortNames).toEqual({ en: null, es: null });
    });

    it("cuenta un emoji como un carácter", async () => {
      const positions = await setPositionShortNames(gateways(), {
        callerId: ADMIN_ID,
        positionId: DEFENDER.id,
        shortNames: {
          en: "🤿".repeat(POSITION_SHORT_NAME_MAX_LENGTH),
          es: null,
        },
      });

      expect(positions[1]?.shortNames.en).toBe(
        "🤿".repeat(POSITION_SHORT_NAME_MAX_LENGTH),
      );
    });

    it("rechaza una de más de 4 caracteres, señalando el idioma", async () => {
      await expect(
        setPositionShortNames(gateways(), {
          callerId: ADMIN_ID,
          positionId: DEFENDER.id,
          shortNames: { en: "DEF", es: "DEFEN" },
        }),
      ).rejects.toMatchObject({
        issues: [{ code: "short_name_es_too_long" }],
      });
      expect(catalog).toEqual([GOALKEEPER, DEFENDER, FORWARD]);
      expect(auditRows).toEqual([]);
    });

    it("rechaza una abreviatura en un idioma sin nombre", async () => {
      catalog = [
        GOALKEEPER,
        { ...DEFENDER, names: { en: "Defender", es: null } },
      ];

      await expect(
        setPositionShortNames(gateways(), {
          callerId: ADMIN_ID,
          positionId: DEFENDER.id,
          shortNames: { en: "DEF", es: "DEF" },
        }),
      ).rejects.toMatchObject({
        issues: [{ code: "short_name_es_without_name" }],
      });
      expect(auditRows).toEqual([]);
    });

    it("no encuentra la posición de otro club", async () => {
      await expect(
        setPositionShortNames(gateways(), {
          callerId: ADMIN_ID,
          positionId: OTHER_CLUBS_POSITION_ID,
          shortNames: { en: "LIB", es: null },
        }),
      ).rejects.toBeInstanceOf(PositionNotFoundError);
    });
  });

  describe("quién puede", () => {
    it.each(["Coach", "Committee", "Player"] as const)(
      "un %s no puede cambiar el mínimo ni las abreviaturas",
      async (role) => {
        callerRole = role;

        await expect(
          setPositionMinimum(gateways(), {
            callerId: ADMIN_ID,
            positionId: DEFENDER.id,
            minPerTeam: 2,
          }),
        ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
        await expect(
          setPositionShortNames(gateways(), {
            callerId: ADMIN_ID,
            positionId: DEFENDER.id,
            shortNames: { en: "LIB", es: null },
          }),
        ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
        expect(catalog).toEqual([GOALKEEPER, DEFENDER, FORWARD]);
        expect(auditRows).toEqual([]);
      },
    );

    it.each(["Coach", "Committee", "Player"] as const)(
      "un %s no puede crear, renombrar, reordenar, archivar ni cambiar la función",
      async (role) => {
        callerRole = role;
        const request = { callerId: ADMIN_ID };

        await expect(
          createPosition(gateways(), {
            ...request,
            names: { en: "Centre", es: null },
          }),
        ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
        await expect(
          renamePosition(gateways(), {
            ...request,
            positionId: DEFENDER.id,
            names: { en: "Back", es: null },
          }),
        ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
        await expect(
          reorderPositions(gateways(), {
            ...request,
            positionIds: [FORWARD.id, GOALKEEPER.id, DEFENDER.id],
          }),
        ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
        await expect(
          setPositionArchived(gateways(), {
            ...request,
            positionId: DEFENDER.id,
            isArchived: true,
          }),
        ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
        expect(catalog).toEqual([GOALKEEPER, DEFENDER, FORWARD]);
        expect(auditRows).toEqual([]);
      },
    );
  });
});

describe("los nombres de una posición", () => {
  it("no tienen avisos con un nombre en cada idioma", () => {
    expect(findPositionNameIssues({ en: "Centre", es: "Centro" })).toEqual([]);
  });

  it("piden al menos un nombre", () => {
    expect(findPositionNameIssues({ en: null, es: "  " })).toEqual([
      { code: "name_required" },
    ]);
  });

  it("señalan el idioma que pasa del máximo", () => {
    expect(
      findPositionNameIssues({
        en: "a".repeat(POSITION_NAME_MAX_LENGTH + 1),
        es: "Centro",
      }),
    ).toEqual([{ code: "name_en_too_long" }]);
  });

  it("cuentan un emoji como un carácter", () => {
    expect(
      findPositionNameIssues({
        en: "🤿".repeat(POSITION_NAME_MAX_LENGTH),
        es: null,
      }),
    ).toEqual([]);
  });
});

describe("bitácora", () => {
  it("anota una entrada por acción, con quién, qué y sobre qué posición", async () => {
    await createPosition(gateways(), {
      callerId: ADMIN_ID,
      names: { en: "Centre", es: "Centro" },
    });
    await renamePosition(gateways(), {
      callerId: ADMIN_ID,
      positionId: DEFENDER.id,
      names: { en: "Back", es: "Defensa" },
    });
    await setPositionArchived(gateways(), {
      callerId: ADMIN_ID,
      positionId: DEFENDER.id,
      isArchived: true,
    });
    await setPositionArchived(gateways(), {
      callerId: ADMIN_ID,
      positionId: DEFENDER.id,
      isArchived: false,
    });

    expect(
      auditRows.map(({ actor_id, action, entity_type, entity_id }) => ({
        actor_id,
        action,
        entity_type,
        entity_id,
      })),
    ).toEqual([
      {
        actor_id: ADMIN_ID,
        action: "club_position.created",
        entity_type: "club_position",
        entity_id: NEW_POSITION_ID,
      },
      {
        actor_id: ADMIN_ID,
        action: "club_position.renamed",
        entity_type: "club_position",
        entity_id: DEFENDER.id,
      },
      {
        actor_id: ADMIN_ID,
        action: "club_position.archived",
        entity_type: "club_position",
        entity_id: DEFENDER.id,
      },
      {
        actor_id: ADMIN_ID,
        action: "club_position.reactivated",
        entity_type: "club_position",
        entity_id: DEFENDER.id,
      },
    ]);
  });

  it("anota el reordenado sobre el club, con las posiciones en su orden nuevo", async () => {
    const positionIds = [FORWARD.id, GOALKEEPER.id, DEFENDER.id];

    await reorderPositions(gateways(), { callerId: ADMIN_ID, positionIds });

    expect(auditRows).toEqual([
      expect.objectContaining({
        action: "club_position.reordered",
        entity_type: "club",
        entity_id: CLUB_ID,
        metadata: { positionIds },
      }),
    ]);
  });

  it("anota el cambio de mínimo con el valor anterior y el nuevo", async () => {
    await setPositionMinimum(gateways(), {
      callerId: ADMIN_ID,
      positionId: FORWARD.id,
      minPerTeam: 2,
    });

    expect(auditRows).toEqual([
      expect.objectContaining({
        actor_id: ADMIN_ID,
        action: "club_position.min_per_team_changed",
        entity_type: "club_position",
        entity_id: FORWARD.id,
        metadata: { previous: 1, minPerTeam: 2 },
      }),
    ]);
  });

  it("anota el cambio de abreviaturas con las anteriores y las nuevas", async () => {
    await setPositionShortNames(gateways(), {
      callerId: ADMIN_ID,
      positionId: DEFENDER.id,
      shortNames: { en: "LIB", es: "" },
    });

    expect(auditRows).toEqual([
      expect.objectContaining({
        actor_id: ADMIN_ID,
        action: "club_position.short_names_changed",
        entity_type: "club_position",
        entity_id: DEFENDER.id,
        metadata: {
          previous: { en: "DEF", es: "DEF" },
          shortNames: { en: "LIB", es: null },
        },
      }),
    ]);
  });

  it("no anota un mínimo ni unas abreviaturas que no cambian", async () => {
    await setPositionMinimum(gateways(), {
      callerId: ADMIN_ID,
      positionId: FORWARD.id,
      minPerTeam: 1,
    });
    await setPositionShortNames(gateways(), {
      callerId: ADMIN_ID,
      positionId: FORWARD.id,
      shortNames: { en: "ATT", es: " ATA " },
    });

    expect(auditRows).toEqual([]);
  });

  it("no lleva los nombres ni ningún otro dato de la posición", async () => {
    await createPosition(gateways(), {
      callerId: ADMIN_ID,
      names: { en: "Centre", es: "Centro" },
    });

    expect(auditRows).toEqual([expect.objectContaining({ metadata: null })]);
    expect(JSON.stringify(auditRows)).not.toMatch(/Centre|Centro/);
  });

  it("no anota nada cuando el cambio no se hace", async () => {
    await setPositionArchived(gateways(), {
      callerId: ADMIN_ID,
      positionId: GOALKEEPER.id,
      isArchived: false,
    });
    await setPositionMinimum(gateways(), {
      callerId: ADMIN_ID,
      positionId: GOALKEEPER.id,
      minPerTeam: GOALKEEPER.minPerTeam,
    });
    await createPosition(gateways(), {
      callerId: ADMIN_ID,
      names: { en: "Forward", es: null },
    }).catch(() => undefined);

    expect(auditRows).toEqual([]);
  });
});
