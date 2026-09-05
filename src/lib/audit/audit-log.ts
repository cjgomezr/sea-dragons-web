import type { SupabaseClient } from "@supabase/supabase-js";

const AUDIT_LOG_TABLE = "audit_log";

// NFR-010: los eventos de autenticación, cambio de rol y cambio de estado de
// pago que este ticket sabe nombrar hoy. Cada epic que instrumente uno nuevo
// (login en E2, roles en E3, pagos en E12) extiende esta unión, nunca escribe
// una acción libre.
export const AUDIT_ACTIONS = [
  "auth.login_succeeded",
  "auth.login_failed",
  "auth.logout",
  "role.changed",
  "payment.status_changed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RESULTS = ["success", "failure"] as const;

export type AuditResult = (typeof AUDIT_RESULTS)[number];

export type AuditActor = {
  readonly id: string;
  readonly clubId: string;
};

export type RecordAuditEventInput = {
  readonly actor: AuditActor;
  readonly clubId: string;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly result: AuditResult;
  readonly metadata?: Record<string, unknown>;
};

export type AuditLogInsertRow = {
  readonly club_id: string;
  readonly actor_id: string;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly result: string;
  readonly metadata: Record<string, unknown> | null;
};

export type AuditLogWriteError = { readonly message: string };

/** Frontera mínima que `recordAuditEvent` necesita de la base de datos, para
 * poder probarlo con un doble de prueba en vez de un mock del SDK de Supabase. */
export type AuditLogWriter = {
  insertAuditLogRow(
    row: AuditLogInsertRow,
  ): Promise<{ readonly error: AuditLogWriteError | null }>;
};

export class AuditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditValidationError";
  }
}

export class AuditClubMismatchError extends Error {
  constructor(actorClubId: string, eventClubId: string) {
    super(
      `El actor pertenece al club ${actorClubId} y no puede registrar un evento para el club ${eventClubId}.`,
    );
    this.name = "AuditClubMismatchError";
  }
}

export class AuditWriteError extends Error {
  constructor(cause: AuditLogWriteError) {
    super(`No se pudo registrar el evento de auditoría: ${cause.message}`);
    this.name = "AuditWriteError";
    this.cause = cause;
  }
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new AuditValidationError(
      `El campo "${fieldName}" no puede estar vacío.`,
    );
  }
}

/** Único camino de escritura de `public.audit_log` (NFR-010). Cualquier otro
 * código que inserte en esa tabla directamente rompe la garantía de que todo
 * evento pasó por esta validación. */
export async function recordAuditEvent(
  writer: AuditLogWriter,
  input: RecordAuditEventInput,
): Promise<void> {
  assertNonEmpty(input.actor.id, "actor.id");
  assertNonEmpty(input.clubId, "clubId");
  assertNonEmpty(input.entityType, "entityType");
  assertNonEmpty(input.entityId, "entityId");

  if (!(AUDIT_ACTIONS as readonly string[]).includes(input.action)) {
    throw new AuditValidationError(
      `"${input.action}" no es una acción auditable reconocida.`,
    );
  }
  if (!(AUDIT_RESULTS as readonly string[]).includes(input.result)) {
    throw new AuditValidationError(
      `"${input.result}" no es un resultado reconocido.`,
    );
  }
  if (input.actor.clubId !== input.clubId) {
    throw new AuditClubMismatchError(input.actor.clubId, input.clubId);
  }

  const { error } = await writer.insertAuditLogRow({
    club_id: input.clubId,
    actor_id: input.actor.id,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    result: input.result,
    metadata: input.metadata ?? null,
  });

  if (error) {
    throw new AuditWriteError(error);
  }
}

/** Adaptador entre `recordAuditEvent` y un cliente real de Supabase. El
 * cliente debe traer la llave de servicio: RLS no deja pasar la escritura de
 * otra forma (ver 0002_audit_log.sql). */
export function createSupabaseAuditLogWriter(
  client: SupabaseClient,
): AuditLogWriter {
  return {
    async insertAuditLogRow(row) {
      const { error } = await client.from(AUDIT_LOG_TABLE).insert(row);
      return { error: error ? { message: error.message } : null };
    },
  };
}
