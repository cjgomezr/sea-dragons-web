import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import {
  JUSTIFICATION_MAX_LENGTH,
  JustificationTooLongError,
  type NewRoleRequest,
  PendingRoleRequestError,
  type RoleRequest,
  type RoleRequestGateways,
  type RoleRequestInsert,
  RoleRequestRefusedError,
  describeRoleRequestAccount,
  isJustificationTooLong,
  parseRequestableRole,
  requestRole,
  roleRequestAvailability,
} from "@/lib/auth/role-request";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { NotificationInsert } from "@/lib/notifications/notify-member";

/**
 * Pedir Coach o Committee (FR-010, RF-4 del PRD de E3), sin Supabase delante.
 * La regla de una sola pendiente la garantiza el índice de `0012`; aquí se
 * prueba que el dominio la traduce a un conflicto, venga de la comprobación
 * previa o del choque con el índice.
 */

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const ADMIN_IDS = [
  "a0000000-0000-4000-8000-000000000001",
  "a0000000-0000-4000-8000-000000000002",
] as const;

const PENDING_COACH: RoleRequest = {
  id: "0f0e0d0c-0b0a-4908-8706-050403020100",
  requestedRole: "Coach",
  status: "pending",
  createdAt: "2026-09-17T08:30:00.000Z",
};

type FakeOptions = {
  readonly role?: Role;
  readonly memberExists?: boolean;
  readonly latestRequest?: RoleRequest | null;
  readonly insertResult?: RoleRequestInsert;
  readonly adminIds?: readonly string[];
  readonly adminLookupFails?: boolean;
  readonly inactiveRecipients?: readonly string[];
  readonly failingRecipients?: readonly string[];
};

type Fake = {
  readonly gateways: RoleRequestGateways;
  readonly inserts: NewRoleRequest[];
  readonly lookups: string[];
  readonly notifications: NotificationInsert[];
};

function recipientStatus(options: FakeOptions, userId: string): AccountStatus {
  return options.inactiveRecipients?.includes(userId) ? "inactive" : "active";
}

function fakeGateways(options: FakeOptions = {}): Fake {
  const inserts: NewRoleRequest[] = [];
  const lookups: string[] = [];
  const notifications: NotificationInsert[] = [];
  const gateways: RoleRequestGateways = {
    members: {
      async findRoleRequestMember(userId) {
        lookups.push(userId);
        return options.memberExists === false
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Nerea Ruiz",
              role: options.role ?? "Player",
            };
      },
    },
    requests: {
      async findLatestRequest() {
        return options.latestRequest ?? null;
      },
      async insertPendingRequest(request) {
        inserts.push(request);
        return (
          options.insertResult ?? {
            kind: "created",
            request: { ...PENDING_COACH, requestedRole: request.requestedRole },
          }
        );
      },
    },
    admins: {
      async listActiveAdminUserIds(clubId) {
        if (options.adminLookupFails === true) {
          throw new Error("La base no responde.");
        }
        return clubId === CLUB_ID ? (options.adminIds ?? [ADMIN_IDS[0]]) : [];
      },
    },
    notifications: {
      async findRecipient(userId) {
        return {
          clubId: CLUB_ID,
          accountStatus: recipientStatus(options, userId),
        };
      },
      async insertNotification(row) {
        if (options.failingRecipients?.includes(row.userId)) {
          throw new Error("No se pudo guardar el aviso.");
        }
        notifications.push(row);
      },
    },
  };
  return { gateways, inserts, lookups, notifications };
}

function receivedNotification(userId: string): NotificationInsert {
  return {
    clubId: CLUB_ID,
    userId,
    type: "role_request_received",
    data: { requesterName: "Nerea Ruiz", requestedRole: "Coach" },
  };
}

describe("solicitar un rol", () => {
  it("crea una solicitud pendiente del club y del socio que la pide", async () => {
    const fake = fakeGateways();

    const created = await requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: "Entreno a los juveniles los jueves.",
    });

    expect(created).toEqual(PENDING_COACH);
    expect(fake.inserts).toEqual([
      {
        clubId: CLUB_ID,
        userId: USER_ID,
        requestedRole: "Coach",
        justification: "Entreno a los juveniles los jueves.",
      },
    ]);
  });

  it("guarda sin justificación la que sólo trae espacios", async () => {
    const fake = fakeGateways();

    await requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Committee",
      justification: "   ",
    });

    expect(fake.inserts[0]?.justification).toBeNull();
  });

  it("quita los espacios de los extremos de la justificación", async () => {
    const fake = fakeGateways();

    await requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Committee",
      justification: "  Llevo la tesorería.  ",
    });

    expect(fake.inserts[0]?.justification).toBe("Llevo la tesorería.");
  });

  it("rechaza el rol que el socio ya tiene, sin guardar nada", async () => {
    const fake = fakeGateways({ role: "Coach" });

    const attempt = requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: null,
    });

    await expect(attempt).rejects.toBeInstanceOf(RoleRequestRefusedError);
    await expect(attempt).rejects.toMatchObject({
      reason: "role_already_held",
    });
    expect(fake.inserts).toEqual([]);
  });

  it("rechaza cualquier solicitud de un Admin, que ya tiene todas las capacidades", async () => {
    const fake = fakeGateways({ role: "Admin" });

    const attempt = requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Committee",
      justification: null,
    });

    await expect(attempt).rejects.toMatchObject({
      reason: "admin_has_every_capability",
    });
    expect(fake.inserts).toEqual([]);
  });

  it("rechaza una justificación más larga que el límite antes de mirar la base", async () => {
    const fake = fakeGateways();

    const attempt = requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: "a".repeat(JUSTIFICATION_MAX_LENGTH + 1),
    });

    await expect(attempt).rejects.toBeInstanceOf(JustificationTooLongError);
    expect(fake.lookups).toEqual([]);
    expect(fake.inserts).toEqual([]);
  });

  it("devuelve el conflicto cuando ya hay una pendiente, sin intentar guardar", async () => {
    const fake = fakeGateways({ latestRequest: PENDING_COACH });

    const attempt = requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Committee",
      justification: null,
    });

    await expect(attempt).rejects.toBeInstanceOf(PendingRoleRequestError);
    expect(fake.inserts).toEqual([]);
  });

  it("devuelve el conflicto aunque la comprobación previa no vea la pendiente", async () => {
    const fake = fakeGateways({
      latestRequest: null,
      insertResult: { kind: "pending_exists" },
    });

    const attempt = requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: null,
    });

    await expect(attempt).rejects.toBeInstanceOf(PendingRoleRequestError);
  });

  it("acepta una nueva cuando la última fue rechazada", async () => {
    const fake = fakeGateways({
      latestRequest: { ...PENDING_COACH, status: "rejected" },
    });

    await requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: null,
    });

    expect(fake.inserts).toHaveLength(1);
  });

  it("niega la solicitud a una identidad sin fila de socio", async () => {
    const fake = fakeGateways({ memberExists: false });

    const attempt = requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: null,
    });

    await expect(attempt).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("aviso de solicitud nueva", () => {
  it("avisa al Admin del club con quién pidió y qué rol", async () => {
    const fake = fakeGateways();

    await requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: null,
    });

    expect(fake.notifications).toEqual([receivedNotification(ADMIN_IDS[0])]);
  });

  it("da a cada Admin del club su propio aviso", async () => {
    const fake = fakeGateways({ adminIds: ADMIN_IDS });

    await requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: null,
    });

    expect(fake.notifications).toEqual(ADMIN_IDS.map(receivedNotification));
  });

  // El falso devuelve también al Admin inactivo: así se prueba la defensa de
  // `notifyMember`. El filtro de la consulta lo prueba la integración.
  it("no avisa a un Admin dado de baja", async () => {
    const fake = fakeGateways({
      adminIds: ADMIN_IDS,
      inactiveRecipients: [ADMIN_IDS[1]],
    });

    await requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: null,
    });

    expect(fake.notifications).toEqual([receivedNotification(ADMIN_IDS[0])]);
  });

  it("no lleva ni la justificación ni el correo en los datos", async () => {
    const fake = fakeGateways();

    await requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: "Entreno a los juveniles los jueves.",
    });

    expect(fake.notifications[0]?.data).toEqual({
      requesterName: "Nerea Ruiz",
      requestedRole: "Coach",
    });
  });

  it.each([
    ["ya había una pendiente", { latestRequest: PENDING_COACH }, "Committee"],
    [
      "la pendiente chocó con el índice",
      { insertResult: { kind: "pending_exists" } },
      "Coach",
    ],
    ["pide el rol que ya tiene", { role: "Coach" }, "Coach"],
    ["un Admin pide", { role: "Admin" }, "Committee"],
  ] as const)(
    "no avisa a nadie cuando la solicitud se rechaza porque %s",
    async (_case, options, requestedRole) => {
      const fake = fakeGateways({ ...options, adminIds: ADMIN_IDS });

      await expect(
        requestRole(fake.gateways, {
          userId: USER_ID,
          requestedRole,
          justification: null,
        }),
      ).rejects.toThrow();

      expect(fake.notifications).toEqual([]);
    },
  );
});

describe("aviso que falla", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("un aviso que falla no impide el de los demás Admin ni la solicitud", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeGateways({
      adminIds: ADMIN_IDS,
      failingRecipients: [ADMIN_IDS[0]],
    });

    const created = await requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: null,
    });

    expect(created).toEqual(PENDING_COACH);
    expect(fake.notifications).toEqual([receivedNotification(ADMIN_IDS[1])]);
    expect(logged).toHaveBeenCalled();
  });

  it("si no se pueden leer los Admin, la solicitud queda y el error se registra", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeGateways({ adminLookupFails: true });

    const created = await requestRole(fake.gateways, {
      userId: USER_ID,
      requestedRole: "Coach",
      justification: null,
    });

    expect(created).toEqual(PENDING_COACH);
    expect(fake.inserts).toHaveLength(1);
    expect(fake.notifications).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });
});

describe("roles que se pueden pedir", () => {
  it.each([["Coach"], ["Committee"]])("acepta %s", (value) => {
    expect(parseRequestableRole(value)).toBe(value);
  });

  it.each([["Admin"], ["Player"], ["coach"], ["Capitán"], [null], [3]])(
    "no acepta %s",
    (value) => {
      expect(parseRequestableRole(value)).toBeNull();
    },
  );
});

describe("límite de la justificación", () => {
  it("admite justo el límite", () => {
    expect(isJustificationTooLong("a".repeat(JUSTIFICATION_MAX_LENGTH))).toBe(
      false,
    );
  });

  it("marca un carácter de más", () => {
    expect(
      isJustificationTooLong("a".repeat(JUSTIFICATION_MAX_LENGTH + 1)),
    ).toBe(true);
  });

  // La base cuenta caracteres con `char_length`, y un emoji es uno solo
  // aunque en JavaScript ocupe dos unidades.
  it("cuenta un emoji como un carácter, igual que la base", () => {
    expect(isJustificationTooLong("🤿".repeat(JUSTIFICATION_MAX_LENGTH))).toBe(
      false,
    );
  });

  it("no cuenta los espacios de los extremos, que no se guardan", () => {
    expect(
      isJustificationTooLong(` ${"a".repeat(JUSTIFICATION_MAX_LENGTH)} `),
    ).toBe(false);
  });
});

describe("qué ve cada socio en Mi cuenta", () => {
  it("un Player sin solicitudes puede pedir Coach o Committee", () => {
    expect(roleRequestAvailability("Player", null)).toEqual({
      kind: "available",
      roles: ["Coach", "Committee"],
    });
  });

  it("un Coach sólo puede pedir Committee", () => {
    expect(roleRequestAvailability("Coach", null)).toEqual({
      kind: "available",
      roles: ["Committee"],
    });
  });

  it("un Committee sólo puede pedir Coach", () => {
    expect(roleRequestAvailability("Committee", null)).toEqual({
      kind: "available",
      roles: ["Coach"],
    });
  });

  it("con una pendiente ve la solicitud en vez del formulario", () => {
    expect(roleRequestAvailability("Player", PENDING_COACH)).toEqual({
      kind: "pending",
      request: PENDING_COACH,
    });
  });

  it("tras un rechazo vuelve a poder pedir", () => {
    const rejected: RoleRequest = { ...PENDING_COACH, status: "rejected" };

    expect(roleRequestAvailability("Player", rejected)).toEqual({
      kind: "available",
      roles: ["Coach", "Committee"],
    });
  });

  it("un Admin no tiene nada que pedir", () => {
    expect(roleRequestAvailability("Admin", null)).toEqual({
      kind: "not_needed",
    });
  });
});

describe("la cuenta que muestra Mi cuenta", () => {
  it("trae el nombre, el rol y la última solicitud del socio", async () => {
    const fake = fakeGateways({ role: "Coach", latestRequest: PENDING_COACH });

    const account = await describeRoleRequestAccount(fake.gateways, USER_ID);

    expect(account).toEqual({
      fullName: "Nerea Ruiz",
      role: "Coach",
      latestRequest: PENDING_COACH,
    });
  });

  it("niega la cuenta a una identidad sin fila de socio", async () => {
    const fake = fakeGateways({ memberExists: false });

    await expect(
      describeRoleRequestAccount(fake.gateways, USER_ID),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
