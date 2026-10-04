import { describe, expect, it } from "vitest";
import {
  type SessionLedgerGateway,
  type SessionMovement,
  readSessionBalance,
} from "@/lib/membership/session-balance";

/**
 * El saldo de sesiones de un Casual (#468, RF-1 del PRD de E13, D6): la suma
 * del libro y sus movimientos, del más reciente al más antiguo.
 */

const USER_ID = "8d0c4c3e-7a9f-4a52-9c0b-2f8f3d1e6a11";

function aPurchase(
  overrides: Partial<Extract<SessionMovement, { kind: "pack_purchase" }>> = {},
): SessionMovement {
  return {
    kind: "pack_purchase",
    id: "mov-compra",
    delta: 5,
    paymentId: "pay-1",
    createdAt: new Date("2026-10-01T09:00:00Z"),
    ...overrides,
  };
}

function anAttendance(
  overrides: Partial<Extract<SessionMovement, { kind: "attendance" }>> = {},
): SessionMovement {
  return {
    kind: "attendance",
    id: "mov-asistencia",
    delta: -1,
    eventId: "evt-1",
    createdAt: new Date("2026-10-02T09:00:00Z"),
    ...overrides,
  };
}

function ledgerWith(
  movements: readonly SessionMovement[],
): SessionLedgerGateway {
  return { listByUserId: () => Promise.resolve(movements) };
}

describe("readSessionBalance", () => {
  it("devuelve saldo cero y ningún movimiento con el libro vacío", async () => {
    const gateway = ledgerWith([]);

    const balance = await readSessionBalance(gateway, { userId: USER_ID });

    expect(balance).toEqual({ sessions: 0, movements: [] });
  });

  it("suma las compras y resta las asistencias", async () => {
    const gateway = ledgerWith([
      aPurchase({ id: "a", delta: 5 }),
      aPurchase({ id: "b", delta: 10, paymentId: "pay-2" }),
      anAttendance({ id: "c" }),
      anAttendance({ id: "d", eventId: "evt-2" }),
    ]);

    const balance = await readSessionBalance(gateway, { userId: USER_ID });

    expect(balance.sessions).toBe(13);
  });

  it("ordena los movimientos del más reciente al más antiguo", async () => {
    const gateway = ledgerWith([
      aPurchase({ id: "viejo", createdAt: new Date("2026-09-01T09:00:00Z") }),
      anAttendance({
        id: "nuevo",
        createdAt: new Date("2026-10-05T09:00:00Z"),
      }),
      anAttendance({
        id: "medio",
        eventId: "evt-2",
        createdAt: new Date("2026-09-15T09:00:00Z"),
      }),
    ]);

    const balance = await readSessionBalance(gateway, { userId: USER_ID });

    expect(balance.movements.map((movement) => movement.id)).toEqual([
      "nuevo",
      "medio",
      "viejo",
    ]);
  });

  it("con la misma fecha ordena por id para que el orden no cambie", async () => {
    const createdAt = new Date("2026-10-05T09:00:00Z");
    const gateway = ledgerWith([
      anAttendance({ id: "a", createdAt }),
      aPurchase({ id: "c", createdAt }),
      anAttendance({ id: "b", eventId: "evt-2", createdAt }),
    ]);

    const balance = await readSessionBalance(gateway, { userId: USER_ID });

    expect(balance.movements.map((movement) => movement.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("pide al libro los movimientos del socio que lee", async () => {
    const requested: string[] = [];
    const gateway: SessionLedgerGateway = {
      listByUserId: (userId) => {
        requested.push(userId);
        return Promise.resolve([]);
      },
    };

    await readSessionBalance(gateway, { userId: USER_ID });

    expect(requested).toEqual([USER_ID]);
  });
});
