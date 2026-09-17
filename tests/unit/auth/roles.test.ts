import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CAPABILITY_MATRIX,
  type Capability,
  ROLES,
  type Role,
  type RoleGrants,
  hasCapability,
  parseRole,
} from "@/lib/auth/roles";

const MEMBERS_MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/0003_members.sql",
);

/** Los roles que la restricción `check (role in (...))` de `members` acepta. */
function rolesAcceptedByMembersTable(): string[] {
  const sql = readFileSync(MEMBERS_MIGRATION, "utf8");
  const match = /check \(role in \(([^)]*)\)\)/.exec(sql);
  if (!match?.[1]) {
    throw new Error("0003_members.sql ya no tiene el check de roles");
  }
  return match[1].split(",").map((literal) => literal.trim().slice(1, -1));
}

describe("catálogo de roles", () => {
  it("tiene exactamente Admin, Coach, Committee y Player", () => {
    expect(ROLES).toEqual(["Admin", "Coach", "Committee", "Player"]);
  });

  it("usa los mismos nombres que acepta la restricción de members.role", () => {
    expect([...ROLES].sort()).toEqual(rolesAcceptedByMembersTable().sort());
  });
});

describe("interpretar un rol", () => {
  it.each(["Admin", "Coach", "Committee", "Player"])("acepta %s", (value) => {
    expect(parseRole(value)).toBe(value);
  });

  it.each([
    ["un rol que no existe", "Owner"],
    ["un rol en minúsculas", "admin"],
    ["un rol en mayúsculas", "PLAYER"],
    ["un rol con espacios alrededor", " Coach "],
    ["una cadena vacía", ""],
    ["null", null],
    ["undefined", undefined],
    ["un número", 1],
    ["un objeto", { role: "Admin" }],
  ])("rechaza %s", (_description, value) => {
    expect(parseRole(value)).toBeNull();
  });
});

/**
 * La matriz de la sección 4 del SRD, copiada a mano. No se genera desde
 * `CAPABILITY_MATRIX`: si se generara, el test daría por buena cualquier
 * celda que el código tuviera mal.
 */
const SRD_MATRIX: Readonly<
  Record<Capability, readonly [boolean, boolean, boolean, boolean]>
> = {
  // Columnas: Admin, Coach, Committee, Player (SRD_COLUMNS).
  viewEvaluations: [true, true, false, false],
  publishNewsAndDocuments: [true, false, true, false],
  createEvents: [true, false, true, false],
  manageUsersAndRoles: [true, false, false, false],
  buildTeamsAndTrackAttendance: [true, true, false, false],
  manageGroups: [true, true, true, false],
  useMemberFeatures: [true, true, true, true],
};

const SRD_COLUMNS = ["Admin", "Coach", "Committee", "Player"] as const;

const SRD_CELLS = Object.entries(SRD_MATRIX).flatMap(([capability, row]) =>
  row.map((expected, column) => ({
    capability: capability as Capability,
    role: SRD_COLUMNS[column] as Role,
    expected,
  })),
);

describe("matriz de capacidades", () => {
  it("recorre las 28 celdas del SRD", () => {
    expect(SRD_CELLS).toHaveLength(28);
  });

  it("no tiene capacidades que el SRD no liste", () => {
    expect(Object.keys(CAPABILITY_MATRIX).sort()).toEqual(
      Object.keys(SRD_MATRIX).sort(),
    );
  });

  it.each(SRD_CELLS)(
    "$role en $capability: $expected",
    ({ capability, role, expected }) => {
      expect(hasCapability(role, capability)).toBe(expected);
    },
  );

  it("no deja a un Player ver evaluaciones, ni las propias", () => {
    expect(hasCapability("Player", "viewEvaluations")).toBe(false);
  });

  it("deja a un Coach gestionar grupos", () => {
    expect(hasCapability("Coach", "manageGroups")).toBe(true);
  });

  it.each<Capability>([
    "publishNewsAndDocuments",
    "createEvents",
    "manageUsersAndRoles",
  ])("no deja a un Coach %s", (capability) => {
    expect(hasCapability("Coach", capability)).toBe(false);
  });
});

describe("una capacidad nueva", () => {
  it("no compila si no declara su valor para los cuatro roles", () => {
    // @ts-expect-error falta Player: si algún día compilara, `npm run
    // typecheck` fallaría por esta directiva sobrante.
    const grants: RoleGrants = { Admin: true, Coach: true, Committee: false };

    expect(grants).toBeDefined();
  });

  it("obliga a que la matriz tenga una fila por capacidad", () => {
    expectTypeOf(CAPABILITY_MATRIX).toEqualTypeOf<
      Readonly<Record<Capability, RoleGrants>>
    >();
  });
});
