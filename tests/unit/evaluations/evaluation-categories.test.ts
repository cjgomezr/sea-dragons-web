import { beforeEach, describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import {
  CATEGORY_NAME_MAX_LENGTH,
  CategoriesChangedError,
  CategoryNotFoundError,
  CategoryValidationError,
  type EvaluationCategory,
  type EvaluationCategoriesGateways,
  createEvaluationCategory,
  findCategoryNameIssues,
  listEvaluationCategories,
  renameEvaluationCategory,
  reorderEvaluationCategories,
  setEvaluationCategoryActive,
} from "@/lib/evaluations/evaluation-categories";
import { EvaluationForbiddenError } from "@/lib/evaluations/member-evaluation";

/**
 * El catálogo de categorías del club (#320, RF-3 del PRD de E9), contado
 * contra un catálogo en memoria. Lo que garantiza la base (que dos personas a
 * la vez no creen dos con el mismo nombre, que ninguna evaluación guardada
 * cambie) lo prueba `manage-evaluation-categories-migration.test.ts`.
 */

const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const OTHER_CLUBS_CATEGORY_ID = "ca7e0000-0000-4000-8000-000000000099";
const NEW_CATEGORY_ID = "ca7e0000-0000-4000-8000-000000000011";

const FITNESS: EvaluationCategory = {
  id: "ca7e0000-0000-4000-8000-000000000001",
  name: "Fitness",
  isActive: true,
};
const SPEED: EvaluationCategory = {
  id: "ca7e0000-0000-4000-8000-000000000002",
  name: "Speed",
  isActive: true,
};
const TEAMWORK: EvaluationCategory = {
  id: "ca7e0000-0000-4000-8000-000000000010",
  name: "Teamwork",
  isActive: false,
};

let callerRole: Role;
let catalog: EvaluationCategory[];
let auditRows: AuditLogInsertRow[];

function isNameTaken(name: string, ownId: string | null): boolean {
  return catalog.some(
    (category) =>
      category.id !== ownId &&
      category.name.toLowerCase() === name.toLowerCase(),
  );
}

function categoryWithId(categoryId: string): EvaluationCategory | undefined {
  return catalog.find((category) => category.id === categoryId);
}

function replaceCategory(changed: EvaluationCategory): void {
  catalog = catalog.map((category) =>
    category.id === changed.id ? changed : category,
  );
}

function gateways(): EvaluationCategoriesGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role: callerRole,
      }),
    },
    categories: {
      findCategories: async () => catalog,
      insertCategory: async (_clubId, name) => {
        if (isNameTaken(name, null)) {
          return { kind: "name_taken" };
        }
        catalog = [...catalog, { id: NEW_CATEGORY_ID, name, isActive: true }];
        return { kind: "created", categoryId: NEW_CATEGORY_ID };
      },
      renameCategory: async ({ categoryId }, name) => {
        const category = categoryWithId(categoryId);
        if (category === undefined) {
          return { kind: "not_found" };
        }
        if (isNameTaken(name, categoryId)) {
          return { kind: "name_taken" };
        }
        replaceCategory({ ...category, name });
        return { kind: "renamed" };
      },
      reorderCategories: async (_clubId, categoryIds) => {
        const activeIds = catalog
          .filter((category) => category.isActive)
          .map((category) => category.id);
        if ([...categoryIds].sort().join() !== activeIds.sort().join()) {
          return { kind: "categories_changed" };
        }
        const inactive = catalog.filter((category) => !category.isActive);
        catalog = [
          ...categoryIds.map((id) => categoryWithId(id) as EvaluationCategory),
          ...inactive,
        ];
        return { kind: "reordered" };
      },
      setCategoryActive: async ({ categoryId }, isActive) => {
        const category = categoryWithId(categoryId);
        if (category === undefined) {
          return { kind: "not_found" };
        }
        if (category.isActive === isActive) {
          return { kind: "unchanged" };
        }
        replaceCategory({ ...category, isActive });
        return { kind: "changed" };
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

beforeEach(() => {
  callerRole = "Coach";
  catalog = [FITNESS, SPEED, TEAMWORK];
  auditRows = [];
});

describe("catálogo de categorías", () => {
  it("lista todas, desactivadas incluidas, en el orden del club", async () => {
    const categories = await listEvaluationCategories(gateways(), COACH_ID);

    expect(categories).toEqual([FITNESS, SPEED, TEAMWORK]);
  });

  it("añade una categoría recortada y devuelve el catálogo como quedó", async () => {
    const categories = await createEvaluationCategory(gateways(), {
      callerId: COACH_ID,
      name: "  Breath hold ",
    });

    expect(categories.at(-1)).toEqual({
      id: NEW_CATEGORY_ID,
      name: "Breath hold",
      isActive: true,
    });
  });

  it("deja añadir también a un Admin", async () => {
    callerRole = "Admin";

    const categories = await createEvaluationCategory(gateways(), {
      callerId: COACH_ID,
      name: "Breath hold",
    });

    expect(categories).toHaveLength(4);
  });

  it("renombra una categoría", async () => {
    const categories = await renameEvaluationCategory(gateways(), {
      callerId: COACH_ID,
      categoryId: FITNESS.id,
      name: "Stamina",
    });

    expect(categories[0]).toEqual({ ...FITNESS, name: "Stamina" });
  });

  it("desactiva una categoría", async () => {
    const categories = await setEvaluationCategoryActive(gateways(), {
      callerId: COACH_ID,
      categoryId: SPEED.id,
      isActive: false,
    });

    expect(categories[1]).toEqual({ ...SPEED, isActive: false });
  });

  it("reactiva una categoría desactivada", async () => {
    const categories = await setEvaluationCategoryActive(gateways(), {
      callerId: COACH_ID,
      categoryId: TEAMWORK.id,
      isActive: true,
    });

    expect(categories[2]).toEqual({ ...TEAMWORK, isActive: true });
  });

  it("aplica el orden que decide el club", async () => {
    const categories = await reorderEvaluationCategories(gateways(), {
      callerId: COACH_ID,
      categoryIds: [SPEED.id, FITNESS.id],
    });

    expect(categories.map((category) => category.name)).toEqual([
      "Speed",
      "Fitness",
      "Teamwork",
    ]);
  });

  it("no aplica un orden si las activas cambiaron entretanto", async () => {
    const attempt = reorderEvaluationCategories(gateways(), {
      callerId: COACH_ID,
      categoryIds: [SPEED.id],
    });

    await expect(attempt).rejects.toBeInstanceOf(CategoriesChangedError);
    expect(catalog).toEqual([FITNESS, SPEED, TEAMWORK]);
  });

  it("rechaza un nombre repetido, sin distinguir mayúsculas", async () => {
    const attempt = createEvaluationCategory(gateways(), {
      callerId: COACH_ID,
      name: "SPEED",
    });

    await expect(attempt).rejects.toMatchObject({
      issues: [{ code: "name_taken" }],
    });
    expect(catalog).toHaveLength(3);
  });

  it("rechaza renombrar con el nombre de otra", async () => {
    const attempt = renameEvaluationCategory(gateways(), {
      callerId: COACH_ID,
      categoryId: FITNESS.id,
      name: "Teamwork",
    });

    await expect(attempt).rejects.toBeInstanceOf(CategoryValidationError);
  });

  it("rechaza un nombre vacío sin tocar el catálogo", async () => {
    const attempt = createEvaluationCategory(gateways(), {
      callerId: COACH_ID,
      name: "   ",
    });

    await expect(attempt).rejects.toMatchObject({
      issues: [{ code: "name_required" }],
    });
    expect(catalog).toHaveLength(3);
  });

  it("rechaza un nombre de 41 caracteres", async () => {
    const attempt = renameEvaluationCategory(gateways(), {
      callerId: COACH_ID,
      categoryId: FITNESS.id,
      name: "a".repeat(CATEGORY_NAME_MAX_LENGTH + 1),
    });

    await expect(attempt).rejects.toMatchObject({
      issues: [{ code: "name_too_long" }],
    });
  });

  it("acepta un nombre de 40 caracteres contados como Postgres", () => {
    const name = `${"a".repeat(CATEGORY_NAME_MAX_LENGTH - 1)}🏊`;

    expect(findCategoryNameIssues(name)).toEqual([]);
  });

  it("no encuentra una categoría de otro club", async () => {
    const attempt = setEvaluationCategoryActive(gateways(), {
      callerId: COACH_ID,
      categoryId: OTHER_CLUBS_CATEGORY_ID,
      isActive: false,
    });

    await expect(attempt).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it.each<Role>(["Player", "Committee"])(
    "rechaza a un %s antes de mirar el nombre",
    async (role) => {
      callerRole = role;

      const attempt = createEvaluationCategory(gateways(), {
        callerId: COACH_ID,
        name: "",
      });

      await expect(attempt).rejects.toBeInstanceOf(EvaluationForbiddenError);
      expect(catalog).toHaveLength(3);
    },
  );
});

describe("bitácora", () => {
  function auditedActions(): string[] {
    return auditRows.map(
      (row) => `${row.action} ${row.entity_type} ${row.entity_id}`,
    );
  }

  it("anota quién añadió qué categoría", async () => {
    await createEvaluationCategory(gateways(), {
      callerId: COACH_ID,
      name: "Breath hold",
    });

    expect(auditRows).toEqual([
      expect.objectContaining({
        actor_id: COACH_ID,
        club_id: CLUB_ID,
        action: "evaluation_category.created",
        entity_type: "evaluation_category",
        entity_id: NEW_CATEGORY_ID,
        result: "success",
      }),
    ]);
  });

  it("anota un renombre", async () => {
    await renameEvaluationCategory(gateways(), {
      callerId: COACH_ID,
      categoryId: FITNESS.id,
      name: "Stamina",
    });

    expect(auditedActions()).toEqual([
      `evaluation_category.renamed evaluation_category ${FITNESS.id}`,
    ]);
  });

  it("anota una desactivación y una reactivación", async () => {
    await setEvaluationCategoryActive(gateways(), {
      callerId: COACH_ID,
      categoryId: SPEED.id,
      isActive: false,
    });
    await setEvaluationCategoryActive(gateways(), {
      callerId: COACH_ID,
      categoryId: SPEED.id,
      isActive: true,
    });

    expect(auditedActions()).toEqual([
      `evaluation_category.deactivated evaluation_category ${SPEED.id}`,
      `evaluation_category.reactivated evaluation_category ${SPEED.id}`,
    ]);
  });

  it("anota un orden nuevo sobre el club, con los ids en su orden", async () => {
    await reorderEvaluationCategories(gateways(), {
      callerId: COACH_ID,
      categoryIds: [SPEED.id, FITNESS.id],
    });

    expect(auditRows).toEqual([
      expect.objectContaining({
        action: "evaluation_category.reordered",
        entity_type: "club",
        entity_id: CLUB_ID,
        metadata: { categoryIds: [SPEED.id, FITNESS.id] },
      }),
    ]);
  });

  it("no anota lo que no cambió", async () => {
    await setEvaluationCategoryActive(gateways(), {
      callerId: COACH_ID,
      categoryId: FITNESS.id,
      isActive: true,
    });

    expect(auditRows).toEqual([]);
  });

  it("no anota un cambio que la base rechazó", async () => {
    await createEvaluationCategory(gateways(), {
      callerId: COACH_ID,
      name: "Fitness",
    }).catch(() => undefined);

    expect(auditRows).toEqual([]);
  });
});
