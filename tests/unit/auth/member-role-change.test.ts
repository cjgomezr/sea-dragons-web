import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuditLogInsertRow,
  type AuditLogWriter,
  AuditWriteError,
} from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  LastAdminError,
  type MemberRoleChange,
  MemberRoleChangeForbiddenError,
  type MemberRoleChangeGateways,
  type MemberRoleChangeWrite,
  type MemberRoleChangeWriteInput,
  MemberToChangeNotFoundError,
  RoleChangeNotAuditedError,
  changeMemberRole,
} from "@/lib/auth/member-role-change";
import type { RoleRequestMember } from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import type {
  NotificationInsert,
  NotificationWriter,
} from "@/lib/notifications/notify-member";

/**
 * Cambiar el rol de un socio (FR-014, AC-008, RF-6 y RF-7 del PRD de E3),
 * contado sin Supabase delante. Que el club nunca se quede sin Admin, también
 * con dos degradaciones a la vez, lo garantiza la función de la base; aquí se
 * prueba qué hace el dominio con cada respuesta suya y qué deja en la
 * bitácora (NFR-010).
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

function changed(previousRole: Role, newRole: Role): MemberRoleChangeWrite {
  return { kind: "changed", previousRole, newRole };
}

type FakeOptions = {
  readonly actorRole?: Role;
  readonly actor?: RoleRequestMember | null;
  readonly write?: MemberRoleChangeWrite;
  readonly auditFailure?: string;
  readonly notificationFailure?: string;
};

type Fake = {
  readonly gateways: MemberRoleChangeGateways;
  readonly writes: MemberRoleChangeWriteInput[];
  readonly auditRows: AuditLogInsertRow[];
  readonly notifications: NotificationInsert[];
};

function fakeNotificationWriter(
  inserted: NotificationInsert[],
  failure: string | undefined,
): NotificationWriter {
  return {
    findRecipient: async () => ({ clubId: CLUB_ID, accountStatus: "active" }),
    async insertNotification(row) {
      if (failure !== undefined) {
        throw new Error(failure);
      }
      inserted.push(row);
    },
  };
}

function fakeGateways(options: FakeOptions = {}): Fake {
  const writes: MemberRoleChangeWriteInput[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  const notifications: NotificationInsert[] = [];
  const actor: RoleRequestMember | null =
    options.actor === undefined
      ? {
          clubId: CLUB_ID,
          fullName: "Ana Admin",
          role: options.actorRole ?? "Admin",
        }
      : options.actor;
  const audit: AuditLogWriter = {
    async insertAuditLogRow(row) {
      if (options.auditFailure !== undefined) {
        return { error: { message: options.auditFailure } };
      }
      auditRows.push(row);
      return { error: null };
    },
  };

  return {
    writes,
    auditRows,
    notifications,
    gateways: {
      members: { findRoleRequestMember: async () => actor },
      roles: {
        async applyRoleChange(input) {
          writes.push(input);
          return options.write ?? changed("Player", input.newRole);
        },
      },
      audit,
      notifications: fakeNotificationWriter(
        notifications,
        options.notificationFailure,
      ),
    },
  };
}

function change(
  fake: Fake,
  newRole: Role,
  targetUserId: string = MEMBER_ID,
): Promise<MemberRoleChange> {
  return changeMemberRole(fake.gateways, {
    actorId: ADMIN_ID,
    targetUserId,
    newRole,
  });
}

describe("cambiar el rol de un socio", () => {
  it.each(["Admin", "Coach", "Committee", "Player"] as const)(
    "pone %s y devuelve el rol anterior y el nuevo",
    async (newRole) => {
      const fake = fakeGateways({ write: changed("Coach", newRole) });

      const result = await change(fake, newRole);

      expect(result).toEqual({
        userId: MEMBER_ID,
        previousRole: "Coach",
        role: newRole,
      });
    },
  );

  it("pide la escritura acotada al club de quien actúa", async () => {
    const fake = fakeGateways();

    await change(fake, "Committee");

    expect(fake.writes).toEqual([
      {
        targetUserId: MEMBER_ID,
        clubId: CLUB_ID,
        actorId: ADMIN_ID,
        newRole: "Committee",
      },
    ]);
  });

  it("con el mismo rol responde sin cambio", async () => {
    const fake = fakeGateways({ write: { kind: "unchanged", role: "Coach" } });

    const result = await change(fake, "Coach");

    expect(result).toEqual({
      userId: MEMBER_ID,
      previousRole: "Coach",
      role: "Coach",
    });
  });

  it("responde no encontrado si el socio no existe en el club", async () => {
    const fake = fakeGateways({ write: { kind: "not_found" } });

    await expect(change(fake, "Coach")).rejects.toBeInstanceOf(
      MemberToChangeNotFoundError,
    );
  });

  it.each([
    ["a otra persona", MEMBER_ID],
    ["a sí mismo", ADMIN_ID],
  ])("no deja degradar al último Admin %s", async (_label, targetUserId) => {
    const fake = fakeGateways({ write: { kind: "last_admin" } });

    await expect(change(fake, "Player", targetUserId)).rejects.toBeInstanceOf(
      LastAdminError,
    );
  });

  it.each([
    ["a otro Admin", MEMBER_ID],
    ["a sí mismo", ADMIN_ID],
  ])("con dos Admin deja degradar %s", async (_label, targetUserId) => {
    const fake = fakeGateways({ write: changed("Admin", "Player") });

    const result = await change(fake, "Player", targetUserId);

    expect(result).toEqual({
      userId: targetUserId,
      previousRole: "Admin",
      role: "Player",
    });
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "niega el cambio a un %s sin llegar a escribir",
    async (role) => {
      const fake = fakeGateways({ actorRole: role });

      await expect(change(fake, "Admin")).rejects.toBeInstanceOf(
        MemberRoleChangeForbiddenError,
      );
      expect(fake.writes).toEqual([]);
      expect(fake.auditRows).toEqual([]);
    },
  );

  it("niega el cambio si la base dice que quien actúa ya no es Admin", async () => {
    const fake = fakeGateways({ write: { kind: "actor_not_admin" } });

    await expect(change(fake, "Admin")).rejects.toBeInstanceOf(
      MemberRoleChangeForbiddenError,
    );
    expect(fake.auditRows).toEqual([]);
  });

  it("no escribe nada si quien actúa no es socio del club", async () => {
    const fake = fakeGateways({ actor: null });

    await expect(change(fake, "Coach")).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
    expect(fake.writes).toEqual([]);
  });
});

describe("bitácora de cambios de rol", () => {
  it("un cambio aplicado deja role.changed con Admin, socio, roles y éxito", async () => {
    const fake = fakeGateways({ write: changed("Player", "Committee") });

    await change(fake, "Committee");

    expect(fake.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "role.changed",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: { previousRole: "Player", newRole: "Committee" },
      },
    ]);
  });

  it("el intento sobre el último Admin queda como role.changed fallido", async () => {
    const fake = fakeGateways({ write: { kind: "last_admin" } });

    await expect(change(fake, "Coach")).rejects.toThrow();

    expect(fake.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "role.changed",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "failure",
        metadata: {
          previousRole: "Admin",
          newRole: "Coach",
          reason: "last_admin",
        },
      },
    ]);
  });

  it("no guarda nombre ni correo", async () => {
    const fake = fakeGateways({ write: changed("Player", "Admin") });

    await change(fake, "Admin");

    const written = JSON.stringify(fake.auditRows);
    expect(written).not.toContain("Ana Admin");
    expect(written).not.toMatch(/@|email|name/i);
  });

  it.each([
    { kind: "unchanged", role: "Coach" },
    { kind: "not_found" },
    { kind: "actor_not_admin" },
  ] as const)("no deja rastro si la escritura es %o", async (write) => {
    const fake = fakeGateways({ write });

    await change(fake, "Coach").catch(() => undefined);

    expect(fake.auditRows).toEqual([]);
  });

  it("no se traga el fallo de la bitácora: lo lanza con el cambio ya aplicado", async () => {
    const fake = fakeGateways({
      write: changed("Player", "Coach"),
      auditFailure: "connection reset",
    });

    const attempt = change(fake, "Coach");

    await expect(attempt).rejects.toBeInstanceOf(RoleChangeNotAuditedError);
    await expect(attempt).rejects.toMatchObject({
      change: { userId: MEMBER_ID, previousRole: "Player", role: "Coach" },
      cause: expect.objectContaining({
        message: expect.stringContaining("connection reset"),
      }),
    });
  });

  it("tampoco se traga el fallo al registrar el rechazo del último Admin", async () => {
    const fake = fakeGateways({
      write: { kind: "last_admin" },
      auditFailure: "connection reset",
    });

    await expect(change(fake, "Coach")).rejects.toBeInstanceOf(AuditWriteError);
  });
});

describe("aviso de cambio de rol", () => {
  it("un cambio directo avisa al socio con su rol nuevo", async () => {
    const fake = fakeGateways({ write: changed("Player", "Committee") });

    await change(fake, "Committee");

    expect(fake.notifications).toEqual([
      {
        clubId: CLUB_ID,
        userId: MEMBER_ID,
        type: "role_changed",
        data: { newRole: "Committee" },
      },
    ]);
  });

  it("poner el rol que ya tenía no avisa a nadie", async () => {
    const fake = fakeGateways({ write: { kind: "unchanged", role: "Coach" } });

    await change(fake, "Coach");

    expect(fake.notifications).toEqual([]);
  });

  it.each([
    { kind: "last_admin" },
    { kind: "not_found" },
    { kind: "actor_not_admin" },
  ] as const)("un intento rechazado (%o) no avisa a nadie", async (write) => {
    const fake = fakeGateways({ write });

    await expect(change(fake, "Coach")).rejects.toThrow();
    expect(fake.notifications).toEqual([]);
  });

  it("un permiso que no alcanza no avisa a nadie", async () => {
    const fake = fakeGateways({ actorRole: "Committee" });

    await expect(change(fake, "Admin")).rejects.toBeInstanceOf(
      MemberRoleChangeForbiddenError,
    );
    expect(fake.notifications).toEqual([]);
  });
});

describe("aviso que falla", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("el cambio se aplica y responde igual, con el fallo registrado", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeGateways({
      write: changed("Player", "Coach"),
      notificationFailure: "timeout",
    });

    const result = await change(fake, "Coach");

    expect(result).toEqual({
      userId: MEMBER_ID,
      previousRole: "Player",
      role: "Coach",
    });
    expect(fake.auditRows).toHaveLength(1);
    expect(errorLog).toHaveBeenCalledWith(
      "[notifications] aviso sin guardar",
      expect.objectContaining({ recipientUserId: MEMBER_ID }),
    );
  });
});
