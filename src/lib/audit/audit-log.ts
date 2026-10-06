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
  // RF-6 de E2. Nunca lleva metadata: la contraseña y el enlace no se auditan,
  // ni en claro ni troceados.
  "auth.password_changed",
  // RF-3 y RF-8 de E2. Sin metadata: el nombre y el correo del tutor son datos
  // personales y ya están en la fila del socio.
  "auth.guardian_consent_recorded",
  "role.changed",
  // RF-5 de E3: un Admin aprueba o rechaza una solicitud de rol. La metadata
  // sólo lleva la decisión; el cambio de rol que trae una aprobación va en su
  // propia entrada `role.changed`. Ni nombre, ni correo, ni justificación.
  "role_request.decided",
  // RF-6 de E5: un Admin da de baja o reactiva a un miembro. La metadata lleva
  // el estado anterior y el nuevo, y en el rechazo del último Admin el motivo.
  // Ni nombre ni correo: la entidad es el `user_id` del miembro.
  "member.status_changed",
  // RF-10 de E5 (#272): un Admin corrige la fecha de nacimiento de un miembro.
  // Sin metadata: ni la fecha nueva ni la anterior, que son datos personales.
  // Quién, sobre quién y cuándo ya están en la entrada.
  "member.date_of_birth_corrected",
  // RF-12 de E5 (#274): un Admin verifica el AUF de un miembro, confirmando
  // el que propuso el miembro o escribiendo él mismo otro en la ficha. Sin
  // metadata: ni el número ni el vencimiento. Quién, sobre quién y cuándo ya
  // están en la entrada. El alta de un miembro (#243) también deja su AUF
  // verificado, pero no escribe esta entrada: ahí el AUF nace con la fila.
  "member.auf_verified",
  // RF-3 de E19 (#499): un Admin corrige el teléfono o el contacto de
  // emergencia de otro socio desde su ficha. Sin metadata: ni los números ni
  // los nombres, que son datos personales, y el del contacto es de un tercero.
  "member.contact_corrected",
  // RF-6 de E18a (#296): un Admin cambia la configuración del club. La
  // metadata sólo nombra los campos que cambiaron (`{ fields: ["name"] }`),
  // nunca sus valores ni los anteriores. La entidad es el id del club.
  "club.settings_changed",
  // RF-5 de E18a (#301): un Admin cambia los textos del inicio de sesión. La
  // metadata nombra los que cambiaron (`{ fields: ["es.tagline"] }`), nunca
  // el texto. La entidad es el id del club.
  "club.sign_in_texts_changed",
  // RF-4 de E13 (#469): un Admin o un Committee cambia los packs de sesiones
  // que se ofrecen. La entidad es el id del club y la metadata lleva los
  // tamaños en el orden nuevo (`{ sessions: [5, 10] }`).
  "club.session_packs_changed",
  // RF-7 de E18a (#300): un Admin administra las posiciones del club. La
  // entidad es la posición (`club_position`), sin metadata: ni el nombre nuevo
  // ni el anterior. Reordenar toca todas, así que su entidad es el club y la
  // metadata lleva los ids en el orden nuevo (`{ positionIds }`).
  "club_position.created",
  "club_position.renamed",
  "club_position.reordered",
  "club_position.archived",
  "club_position.reactivated",
  // RF-2 de E10 (#404): un Admin cambia la función de una posición (portero,
  // defensa, ataque o ninguna). La entidad es la posición y la metadata lleva
  // la función nueva (`{ coverage: "goalkeeper" }`, `null` si se la quitó).
  "club_position.coverage_changed",
  // RF-1 y RF-5 de E9 (#319): un Coach o un Admin crea la evaluación de un
  // miembro o guarda sus valoraciones. La entidad es el `user_id` del miembro
  // evaluado (`member`), sin metadata: ni las notas, ni las categorías, ni el
  // OVR. Quién evaluó, sobre quién y cuándo ya están en la entrada.
  "member_evaluation.created",
  "member_evaluation.ratings_saved",
  // RF-4 de E9 (#320): un Coach o un Admin pone al día la evaluación de un
  // miembro con el conjunto actual de categorías. Sólo cuando cambió algo; la
  // entidad es el miembro, sin metadata, como las dos de arriba.
  "member_evaluation.refreshed",
  // RF-3 de E9 (#320): un Coach o un Admin configura el catálogo de
  // categorías. La entidad es la categoría (`evaluation_category`), sin
  // metadata: ni el nombre nuevo ni el anterior. Reordenar toca todas, así
  // que su entidad es el club y la metadata lleva los ids en el orden nuevo
  // (`{ categoryIds }`).
  "evaluation_category.created",
  "evaluation_category.renamed",
  "evaluation_category.reordered",
  "evaluation_category.deactivated",
  "evaluation_category.reactivated",
  // RF-6 de E11 (#331): quien publicó, o un Admin, edita, retira o vuelve a
  // publicar una publicación. La entidad es la publicación (`news_post`), sin
  // metadata: ni el título, ni el cuerpo, ni la audiencia. Quién, qué acción y
  // sobre cuál ya están en la entrada.
  "news_post.edited",
  "news_post.withdrawn",
  "news_post.republished",
  // RF-3 de E8 (#393): un Admin o un Coach guarda la hoja de asistencia de
  // un entrenamiento, la primera vez o al corregirla. La entidad es el evento
  // (`event`), sin metadata: ni los estados ni a quién. Quién, qué sesión y
  // cuándo ya están en la entrada.
  "attendance.saved",
  // RF-7 de E10 (#401): un Admin o un Coach publica el reparto de equipos de
  // un evento. La entidad es el evento (`event`) y la metadata lleva sólo
  // cuántos quedaron asignados (`{ assignedCount }`), nunca quiénes
  // (NFR-010).
  "team_split.published",
  "payment.status_changed",
  // RF-4 de E12 (#457): un Admin exime de cuota a un socio o le retira la
  // exención. La entidad es el `user_id` del socio (`member`). La exención
  // lleva el motivo y la fecha de fin (`{ reason, until }`), que es lo que
  // justifica no cobrarle; la retirada, el estado al que vuelve
  // (`{ newStatus }`).
  "membership.waived",
  "membership.waiver_removed",
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
