import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow, AuditLogWriter } from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  MemberRoleChangeForbiddenError,
  type MemberRoleChangeGateways,
  type MemberRoleChangeWrite,
  type MemberRoleChangeWriteInput,
} from "@/lib/auth/member-role-change";
import { changeMemberRoles } from "@/lib/auth/member-roles-bulk-change";
import type { RoleRequestMember } from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import { NO_NOTIFICATION_CLEANUP } from "../helpers/notification-cleanup";

/**
 * Cambiar el rol de varios socios a la vez (#552, RF-6 del PRD de E21). Cada
 * socio pasa por `changeMemberRole`, con sus reglas y su bitácora; aquí se
 * prueba que uno que falla no tumba a los demás y que el resultado dice qué
 * pasó con cada uno.
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const FIRST_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const SECOND_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
const THIRD_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

type WriteFor = (input: MemberRoleChangeWriteInput) => MemberRoleChangeWrite;

type Fake = {
  readonly gateways: MemberRoleChangeGateways;
  readonly writes: MemberRoleChangeWriteInput[];
  readonly auditRows: AuditLogInsertRow[];
};

const changedFromPlayer: WriteFor = (input) => ({
  kind: "changed",
  previousRole: "Player",
  newRole: input.newRole,
});

function fakeGateways(
  options: {
    readonly actorRole?: Role;
    readonly actor?: RoleRequestMember | null;
    readonly writeFor?: WriteFor;
    readonly failingTarget?: string;
    readonly auditFailingTarget?: string;
  } = {},
): Fake {
  const writes: MemberRoleChangeWriteInput[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  const actor =
    options.actor === undefined
      ? {
          clubId: CLUB_ID,
          fullName: "Ana Admin",
          role: options.actorRole ?? "Admin",
        }
      : options.actor;
  const audit: AuditLogWriter = {
    async insertAuditLogRow(row) {
      if (row.entity_id === options.auditFailingTarget) {
        return { error: { message: "connection reset" } };
      }
      auditRows.push(row);
      return { error: null };
    },
  };
  return {
    writes,
    auditRows,
    gateways: {
      members: { findRoleRequestMember: async () => actor },
      roles: {
        async applyRoleChange(input) {
          if (input.targetUserId === options.failingTarget) {
            throw new Error("fetch failed");
          }
          writes.push(input);
          return (options.writeFor ?? changedFromPlayer)(input);
        },
      },
      audit,
      notifications: {
        findRecipient: async () => ({
          clubId: CLUB_ID,
          accountStatus: "active",
        }),
        insertNotification: async () => undefined,
        ...NO_NOTIFICATION_CLEANUP,
      },
    },
  };
}

function changeAll(
  fake: Fake,
  targetUserIds: readonly string[],
  newRole: Role = "Coach",
): ReturnType<typeof changeMemberRoles> {
  return changeMemberRoles(fake.gateways, {
    actorId: ADMIN_ID,
    targetUserIds,
    newRole,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cambiar el rol de varios socios", () => {
  it("cambia a todos y devuelve el resultado de cada uno", async () => {
    const fake = fakeGateways();

    const result = await changeAll(fake, [FIRST_ID, SECOND_ID]);

    expect(result).toEqual({
      role: "Coach",
      results: [
        {
          kind: "changed",
          userId: FIRST_ID,
          previousRole: "Player",
          role: "Coach",
        },
        {
          kind: "changed",
          userId: SECOND_ID,
          previousRole: "Player",
          role: "Coach",
        },
      ],
    });
  });

  it("deja una entrada de bitácora por cada socio cambiado", async () => {
    const fake = fakeGateways();

    await changeAll(fake, [FIRST_ID, SECOND_ID]);

    expect(
      fake.auditRows.map((row) => [row.action, row.entity_id, row.result]),
    ).toEqual([
      ["role.changed", FIRST_ID, "success"],
      ["role.changed", SECOND_ID, "success"],
    ]);
  });

  it("no cambia al último Admin y sigue con los demás", async () => {
    const fake = fakeGateways({
      writeFor: (input) =>
        input.targetUserId === FIRST_ID
          ? { kind: "last_admin" }
          : changedFromPlayer(input),
    });

    const result = await changeAll(fake, [FIRST_ID, SECOND_ID], "Committee");

    expect(result.results).toEqual([
      { kind: "failed", userId: FIRST_ID, reason: "last_admin" },
      {
        kind: "changed",
        userId: SECOND_ID,
        previousRole: "Player",
        role: "Committee",
      },
    ]);
    expect(fake.auditRows.map((row) => row.result)).toEqual([
      "failure",
      "success",
    ]);
  });

  it("quien ya tenía el rol no cuenta como cambiado ni deja bitácora", async () => {
    const fake = fakeGateways({
      writeFor: (input) =>
        input.targetUserId === FIRST_ID
          ? { kind: "unchanged", role: "Coach" }
          : changedFromPlayer(input),
    });

    const result = await changeAll(fake, [FIRST_ID, SECOND_ID]);

    expect(result.results[0]).toEqual({
      kind: "unchanged",
      userId: FIRST_ID,
      role: "Coach",
    });
    expect(fake.auditRows.map((row) => row.entity_id)).toEqual([SECOND_ID]);
  });

  it("un fallo de red a la mitad no deshace ni detiene a los demás", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeGateways({ failingTarget: SECOND_ID });

    const result = await changeAll(fake, [FIRST_ID, SECOND_ID, THIRD_ID]);

    expect(result.results.map((entry) => entry.kind)).toEqual([
      "changed",
      "failed",
      "changed",
    ]);
    expect(result.results[1]).toEqual({
      kind: "failed",
      userId: SECOND_ID,
      reason: "unexpected",
    });
    expect(fake.writes.map((write) => write.targetUserId)).toEqual([
      FIRST_ID,
      THIRD_ID,
    ]);
  });

  it("deja en el servidor el error que no sabe nombrar", async () => {
    const serverLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeGateways({ failingTarget: FIRST_ID });

    await changeAll(fake, [FIRST_ID]);

    expect(JSON.stringify(serverLog.mock.calls)).toContain(FIRST_ID);
  });

  it("dice que no quedó en la bitácora sin dar el cambio por perdido", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeGateways({ auditFailingTarget: FIRST_ID });

    const result = await changeAll(fake, [FIRST_ID, SECOND_ID]);

    expect(result.results[0]).toEqual({
      kind: "failed",
      userId: FIRST_ID,
      reason: "not_audited",
    });
    expect(result.results[1]?.kind).toBe("changed");
  });

  it("nombra al socio que no existe en el club", async () => {
    const fake = fakeGateways({
      writeFor: (input) =>
        input.targetUserId === FIRST_ID
          ? { kind: "not_found" }
          : changedFromPlayer(input),
    });

    const result = await changeAll(fake, [FIRST_ID]);

    expect(result.results).toEqual([
      { kind: "failed", userId: FIRST_ID, reason: "not_found" },
    ]);
  });

  it("cambia una sola vez a un socio repetido en la petición", async () => {
    const fake = fakeGateways();

    const result = await changeAll(fake, [FIRST_ID, FIRST_ID]);

    expect(result.results).toHaveLength(1);
    expect(fake.writes).toHaveLength(1);
  });

  it("cambia a quien actúa al final, para que degradarse no frene a los demás", async () => {
    const fake = fakeGateways();

    await changeAll(fake, [ADMIN_ID, FIRST_ID], "Player");

    expect(fake.writes.map((write) => write.targetUserId)).toEqual([
      FIRST_ID,
      ADMIN_ID,
    ]);
  });
});

describe("quién puede cambiar roles en bloque", () => {
  it.each(["Coach", "Committee", "Player"] as const)(
    "niega a un %s antes de cambiar a nadie",
    async (actorRole) => {
      const fake = fakeGateways({ actorRole });

      await expect(changeAll(fake, [FIRST_ID, SECOND_ID])).rejects.toThrow(
        MemberRoleChangeForbiddenError,
      );
      expect(fake.writes).toEqual([]);
      expect(fake.auditRows).toEqual([]);
    },
  );

  it("niega a quien no es socio del club", async () => {
    const fake = fakeGateways({ actor: null });

    await expect(changeAll(fake, [FIRST_ID])).rejects.toThrow(
      MemberNotFoundError,
    );
    expect(fake.writes).toEqual([]);
  });

  it("si quien actúa deja de ser Admin a mitad, el resto sale como prohibido", async () => {
    const fake = fakeGateways({
      writeFor: (input) =>
        input.targetUserId === FIRST_ID
          ? changedFromPlayer(input)
          : { kind: "actor_not_admin" },
    });

    const result = await changeAll(fake, [FIRST_ID, SECOND_ID]);

    expect(result.results[1]).toEqual({
      kind: "failed",
      userId: SECOND_ID,
      reason: "forbidden",
    });
  });
});
