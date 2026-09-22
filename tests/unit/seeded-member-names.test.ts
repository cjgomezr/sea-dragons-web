import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createRunId,
  deleteSeededMembers,
  PHOTOGRAPHED_ROLE_REQUEST_MEMBERS,
  RUN_NAMED_MEMBERS,
  seededMemberName,
  seededRoleRequestColumns,
  type E2eSessionState,
  type RunNamedMember,
} from "../support/e2e-session";

function availableState(runId: string, userIds: readonly string[] = []) {
  return {
    kind: "available",
    email: "e2e@example.test",
    password: "secret",
    runId,
    userIds,
    createdGroupIds: [],
  } as const satisfies E2eSessionState;
}

/** Cómo empareja Playwright un `name` de texto en `getByRole`: sin distinguir
 * mayúsculas y por subcadena. Es la regla que hace que dos filas con el mismo
 * nombre choquen en modo estricto. */
function playwrightMatches(
  accessibleNames: readonly string[],
  query: string,
): readonly string[] {
  return accessibleNames.filter((name) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );
}

const RUN_NAMED = Object.keys(RUN_NAMED_MEMBERS) as RunNamedMember[];

describe("nombres de los miembros de prueba", () => {
  it("dos corridas seguidas reciben identificadores distintos", () => {
    expect(createRunId()).not.toBe(createRunId());
  });

  it.each(RUN_NAMED)(
    "dos siembras producen nombres distintos para %s",
    (member) => {
      const first = seededMemberName(availableState(createRunId()), member);
      const second = seededMemberName(availableState(createRunId()), member);

      expect(first).not.toBe(second);
    },
  );

  it.each(RUN_NAMED)(
    "el nombre de %s lleva el sufijo de la corrida y es estable dentro de ella",
    (member) => {
      const state = availableState("abcd1234");

      const name = seededMemberName(state, member);

      expect(name).toBe(`${RUN_NAMED_MEMBERS[member]} abcd1234`);
      expect(seededMemberName(state, member)).toBe(name);
    },
  );

  it.each(RUN_NAMED)(
    "la siembra de %s escribe el mismo nombre que buscan los tests",
    (member) => {
      const state = availableState("abcd1234");

      const columns = seededRoleRequestColumns(member, state.runId);

      expect(columns.full_name).toBe(seededMemberName(state, member));
    },
  );

  it("sin sesión devuelve el nombre base, porque los tests que lo usan se saltan", () => {
    const state: E2eSessionState = { kind: "unavailable", reason: "sin .env" };

    expect(seededMemberName(state, "admin-de-administracion")).toBe(
      RUN_NAMED_MEMBERS["admin-de-administracion"],
    );
  });

  it("dos corridas del mismo papel a la vez: la búsqueda por nombre encuentra uno solo", () => {
    const mine = availableState("aaaa1111");
    const theirs = availableState("bbbb2222");
    const leftoverFromOldRun = "Role for Admin de administración";
    const comboboxes = [
      `Role for ${seededMemberName(mine, "admin-de-administracion")}`,
      `Role for ${seededMemberName(theirs, "admin-de-administracion")}`,
      leftoverFromOldRun,
    ];

    const found = playwrightMatches(
      comboboxes,
      `Role for ${seededMemberName(mine, "admin-de-administracion")}`,
    );

    expect(found).toHaveLength(1);
  });
});

describe("las capturas no dependen del sufijo", () => {
  it.each(PHOTOGRAPHED_ROLE_REQUEST_MEMBERS)(
    "%s nace con el mismo nombre en cualquier corrida",
    (member) => {
      const first = seededRoleRequestColumns(member, "aaaa1111");
      const second = seededRoleRequestColumns(member, "bbbb2222");

      expect(first.full_name).toBe(second.full_name);
    },
  );

  it("ningún socio fotografiado lleva nombre de corrida", () => {
    const runNamed: readonly string[] = RUN_NAMED;

    const overlap = PHOTOGRAPHED_ROLE_REQUEST_MEMBERS.filter((member) =>
      runNamed.includes(member),
    );

    expect(overlap).toEqual([]);
  });
});

type FakeServiceClient = {
  readonly client: SupabaseClient;
  readonly deletedUserIds: string[];
};

/** Un proyecto de dev con los socios de dos corridas. Sólo registra qué
 * identidades se borran; sus carpetas de fotos están vacías. */
function fakeServiceClient(): FakeServiceClient {
  const deletedUserIds: string[] = [];
  const client = {
    auth: {
      admin: {
        deleteUser: vi.fn(async (userId: string) => {
          deletedUserIds.push(userId);
          return { data: { user: null }, error: null };
        }),
      },
    },
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  } as unknown as SupabaseClient;
  return { client, deletedUserIds };
}

describe("el cierre de la corrida", () => {
  it("borra sus propios miembros y no toca los de otra corrida", async () => {
    const fake = fakeServiceClient();
    const mine = availableState("aaaa1111", ["mine-1", "mine-2"]);
    const theirs = availableState("bbbb2222", ["theirs-1"]);

    await deleteSeededMembers(fake.client, mine);

    expect(fake.deletedUserIds).toEqual(["mine-1", "mine-2"]);
    expect(fake.deletedUserIds).not.toContain(theirs.userIds[0]);
  });
});
