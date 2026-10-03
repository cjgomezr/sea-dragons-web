/**
 * El saldo de sesiones de un Casual (#468, RF-1 del PRD de E13, D6).
 *
 * El saldo no se guarda: es la suma de los movimientos de `session_ledger`
 * (`0052_session_ledger.sql`). Una compra suma las sesiones del pack; una
 * asistencia Present o Late guardada siendo Casual resta una. La base decide
 * cuándo se escribe cada uno; aquí sólo se suma y se ordena.
 */

type MovementDetails = {
  readonly id: string;
  readonly createdAt: Date;
};

export type SessionMovement =
  | (MovementDetails & {
      readonly kind: "pack_purchase";
      /** Las sesiones del pack, siempre positivas. */
      readonly delta: number;
      readonly paymentId: string;
    })
  | (MovementDetails & {
      readonly kind: "attendance";
      readonly delta: -1;
      /** El entrenamiento cuya asistencia gastó la sesión. */
      readonly eventId: string;
    });

export type SessionBalance = {
  readonly sessions: number;
  /** Del más reciente al más antiguo. */
  readonly movements: readonly SessionMovement[];
};

export type SessionLedgerGateway = {
  listByUserId(userId: string): Promise<readonly SessionMovement[]>;
};

function newestFirst(
  movements: readonly SessionMovement[],
): readonly SessionMovement[] {
  return [...movements].sort(
    (first, second) => second.createdAt.getTime() - first.createdAt.getTime(),
  );
}

export async function readSessionBalance(
  gateway: SessionLedgerGateway,
  input: { readonly userId: string },
): Promise<SessionBalance> {
  const movements = await gateway.listByUserId(input.userId);
  return {
    sessions: movements.reduce((sum, movement) => sum + movement.delta, 0),
    movements: newestFirst(movements),
  };
}
