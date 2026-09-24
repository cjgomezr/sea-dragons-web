import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow, AuditLogWriter } from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestMember } from "@/lib/auth/role-request";
import {
  type DecidedRoleRequest,
  DecisionNotAuditedError,
  type RoleRequestDecisionGateways,
  type RoleRequestDecisionWrite,
  type RoleRequestDecisionWriteInput,
  RoleAlreadyGrantedError,
  RoleRequestAlreadyDecidedError,
  RoleRequestDecisionForbiddenError,
  RoleRequestNotFoundError,
  decideRoleRequest,
} from "@/lib/auth/role-request-decision";
import type { Role } from "@/lib/auth/roles";
import type {
  NotificationInsert,
  NotificationWriter,
} from "@/lib/notifications/notify-member";
import { NO_NOTIFICATION_CLEANUP } from "../helpers/notification-cleanup";

/**
 * Decidir una solicitud de rol (FR-011, AC-006, RF-5 del PRD de E3), contado
 * sin Supabase delante. Que aprobar cambie estado y rol juntos, y que dos
 * decisiones simultáneas dejen una sola, lo garantiza la función de la base;
 * aquí se prueba qué hace el dominio con cada respuesta suya y qué deja en la
 * bitácora (NFR-010).
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const REQUEST_ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const DECIDED_AT = "2026-09-17T10:15:00.000Z";

function decided(status: DecidedRoleRequest["status"]): DecidedRoleRequest {
  return {
    id: REQUEST_ID,
    status,
    decidedBy: ADMIN_ID,
    decidedAt: DECIDED_AT,
  };
}

const APPROVED_COACH: RoleRequestDecisionWrite = {
  kind: "approved",
  request: decided("approved"),
  roleChange: {
    memberUserId: MEMBER_ID,
    previousRole: "Player",
    newRole: "Coach",
  },
};

const REJECTED: RoleRequestDecisionWrite = {
  kind: "rejected",
  request: decided("rejected"),
  requester: { memberUserId: MEMBER_ID, requestedRole: "Committee" },
};

type FakeOptions = {
  readonly deciderRole?: Role;
  readonly decider?: RoleRequestMember | null;
  readonly write?: RoleRequestDecisionWrite;
  readonly auditFailure?: string;
  /** Sólo falla la entrada de esta acción; sin ella, fallan todas. */
  readonly failingAuditAction?: string;
  readonly notificationFailure?: string;
};

type Fake = {
  readonly gateways: RoleRequestDecisionGateways;
  readonly writes: RoleRequestDecisionWriteInput[];
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
    ...NO_NOTIFICATION_CLEANUP,
  };
}

function fakeGateways(options: FakeOptions = {}): Fake {
  const writes: RoleRequestDecisionWriteInput[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  const notifications: NotificationInsert[] = [];
  const decider: RoleRequestMember | null =
    options.decider === undefined
      ? {
          clubId: CLUB_ID,
          fullName: "Ana Admin",
          role: options.deciderRole ?? "Admin",
        }
      : options.decider;
  const audit: AuditLogWriter = {
    async insertAuditLogRow(row) {
      const isFailingAction =
        options.failingAuditAction === undefined ||
        options.failingAuditAction === row.action;
      if (options.auditFailure !== undefined && isFailingAction) {
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
      members: { findRoleRequestMember: async () => decider },
      decisions: {
        async applyDecision(input) {
          writes.push(input);
          return options.write ?? APPROVED_COACH;
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

function decide(
  fake: Fake,
  decision: "approved" | "rejected",
): Promise<DecidedRoleRequest> {
  return decideRoleRequest(fake.gateways, {
    deciderId: ADMIN_ID,
    requestId: REQUEST_ID,
    decision,
  });
}

describe("decidir una solicitud", () => {
  it("aprueba y devuelve la solicitud con quién decidió y cuándo", async () => {
    const fake = fakeGateways({ write: APPROVED_COACH });

    const result = await decide(fake, "approved");

    expect(result).toEqual(decided("approved"));
  });

  it("pide la escritura acotada al club de quien decide", async () => {
    const fake = fakeGateways();

    await decide(fake, "approved");

    expect(fake.writes).toEqual([
      {
        requestId: REQUEST_ID,
        clubId: CLUB_ID,
        decidedBy: ADMIN_ID,
        decision: "approved",
      },
    ]);
  });

  it("rechaza y devuelve la solicitud rechazada", async () => {
    const fake = fakeGateways({ write: REJECTED });

    const result = await decide(fake, "rejected");

    expect(result).toEqual(decided("rejected"));
    expect(fake.writes[0]?.decision).toBe("rejected");
  });

  it("responde conflicto con el estado previo si ya estaba resuelta", async () => {
    const fake = fakeGateways({
      write: { kind: "already_decided", status: "rejected" },
    });

    const attempt = decide(fake, "approved");

    await expect(attempt).rejects.toBeInstanceOf(
      RoleRequestAlreadyDecidedError,
    );
    await expect(attempt).rejects.toMatchObject({ status: "rejected" });
  });

  it("responde regla de negocio si el socio ya tiene ese rol o es Admin", async () => {
    const fake = fakeGateways({ write: { kind: "role_already_granted" } });

    await expect(decide(fake, "approved")).rejects.toBeInstanceOf(
      RoleAlreadyGrantedError,
    );
  });

  it("responde no encontrada si la solicitud no existe en el club", async () => {
    const fake = fakeGateways({ write: { kind: "not_found" } });

    await expect(decide(fake, "rejected")).rejects.toBeInstanceOf(
      RoleRequestNotFoundError,
    );
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "niega la decisión a un %s sin llegar a escribir",
    async (role) => {
      const fake = fakeGateways({ deciderRole: role });

      await expect(decide(fake, "approved")).rejects.toBeInstanceOf(
        RoleRequestDecisionForbiddenError,
      );
      expect(fake.writes).toEqual([]);
      expect(fake.auditRows).toEqual([]);
    },
  );

  it("no escribe nada si quien decide no es socio del club", async () => {
    const fake = fakeGateways({ decider: null });

    await expect(decide(fake, "approved")).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
    expect(fake.writes).toEqual([]);
  });

  it.each([
    { kind: "already_decided", status: "approved" },
    { kind: "role_already_granted" },
    { kind: "not_found" },
  ] as const)(
    "no deja rastro en la bitácora si la escritura es %o",
    async (write) => {
      const fake = fakeGateways({ write });

      await expect(decide(fake, "approved")).rejects.toThrow();
      expect(fake.auditRows).toEqual([]);
    },
  );
});

describe("bitácora de decisiones", () => {
  it("al rechazar deja una sola entrada: Admin, solicitud y resultado", async () => {
    const fake = fakeGateways({ write: REJECTED });

    await decide(fake, "rejected");

    expect(fake.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "role_request.decided",
        entity_type: "role_request",
        entity_id: REQUEST_ID,
        result: "success",
        metadata: { decision: "rejected" },
      },
    ]);
  });

  it("al aprobar deja la decisión y el cambio de rol del socio", async () => {
    const fake = fakeGateways({ write: APPROVED_COACH });

    await decide(fake, "approved");

    expect(fake.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "role_request.decided",
        entity_type: "role_request",
        entity_id: REQUEST_ID,
        result: "success",
        metadata: { decision: "approved" },
      },
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "role.changed",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: {
          previousRole: "Player",
          newRole: "Coach",
          roleRequestId: REQUEST_ID,
        },
      },
    ]);
  });

  it("no guarda nombre, correo ni justificación en ninguna entrada", async () => {
    const fake = fakeGateways({ write: APPROVED_COACH });

    await decide(fake, "approved");

    const written = JSON.stringify(fake.auditRows);
    expect(written).not.toContain("Ana Admin");
    expect(written).not.toMatch(/@|justification|email|name/i);
  });

  it("tampoco se traga el fallo de la entrada del cambio de rol", async () => {
    const fake = fakeGateways({
      write: APPROVED_COACH,
      auditFailure: "connection reset",
      failingAuditAction: "role.changed",
    });

    await expect(decide(fake, "approved")).rejects.toBeInstanceOf(
      DecisionNotAuditedError,
    );
    expect(fake.auditRows.map((row) => row.action)).toEqual([
      "role_request.decided",
    ]);
  });

  it("no se traga el fallo de la bitácora: lo lanza con la solicitud ya decidida", async () => {
    const fake = fakeGateways({
      write: APPROVED_COACH,
      auditFailure: "connection reset",
    });

    const attempt = decide(fake, "approved");

    await expect(attempt).rejects.toBeInstanceOf(DecisionNotAuditedError);
    await expect(attempt).rejects.toMatchObject({
      request: decided("approved"),
      cause: expect.objectContaining({
        message: expect.stringContaining("connection reset"),
      }),
    });
  });
});

describe("aviso de cambio de rol", () => {
  it("al aprobar avisa al socio con su rol nuevo", async () => {
    const fake = fakeGateways({ write: APPROVED_COACH });

    await decide(fake, "approved");

    expect(fake.notifications).toEqual([
      {
        clubId: CLUB_ID,
        userId: MEMBER_ID,
        type: "role_changed",
        data: { newRole: "Coach" },
      },
    ]);
  });

  it.each([
    { kind: "already_decided", status: "approved" },
    { kind: "role_already_granted" },
    { kind: "not_found" },
  ] as const)("no avisa a nadie si la escritura es %o", async (write) => {
    const fake = fakeGateways({ write });

    await expect(decide(fake, "approved")).rejects.toThrow();
    expect(fake.notifications).toEqual([]);
  });

  it("no avisa a nadie si quien decide no es Admin", async () => {
    const fake = fakeGateways({ deciderRole: "Coach" });

    await expect(decide(fake, "approved")).rejects.toBeInstanceOf(
      RoleRequestDecisionForbiddenError,
    );
    expect(fake.notifications).toEqual([]);
  });
});

describe("aviso de solicitud rechazada", () => {
  it("al rechazar avisa al socio con el rol que había pedido", async () => {
    const fake = fakeGateways({ write: REJECTED });

    await decide(fake, "rejected");

    expect(fake.notifications).toEqual([
      {
        clubId: CLUB_ID,
        userId: MEMBER_ID,
        type: "role_request_rejected",
        data: { requestedRole: "Committee" },
      },
    ]);
  });
});

describe("aviso que falla", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["aprobada", APPROVED_COACH, "approved"],
    ["rechazada", REJECTED, "rejected"],
  ] as const)(
    "la solicitud queda %s y responde igual, con el fallo registrado",
    async (_label, write, decision) => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const fake = fakeGateways({ write, notificationFailure: "timeout" });

      const result = await decide(fake, decision);

      expect(result).toEqual(decided(decision));
      expect(fake.auditRows.length).toBeGreaterThan(0);
      expect(errorLog).toHaveBeenCalledWith(
        "[notifications] aviso sin guardar",
        expect.objectContaining({ recipientUserId: MEMBER_ID }),
      );
    },
  );
});
