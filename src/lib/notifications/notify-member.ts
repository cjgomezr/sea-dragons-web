import type { AccountStatus } from "@/lib/auth/account-status";
import type { RequestableRole } from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import type { EventType } from "@/lib/events/event-creation";
import type { IsoWeekday } from "@/lib/events/event-occurrences";
import type { RenewalCharge } from "@/lib/membership/renewal-charge";
import type { NewsCategory } from "@/lib/news/news-posts";

/**
 * La única puerta para crear avisos (#265, RF-2 del PRD de E6). La usan esta
 * épica y después E7, E11 y E12.
 *
 * No lanza nunca: devuelve un resultado. El PRD pide que un aviso perdido no
 * tumbe la acción que lo originó (un cambio de rol se aplica aunque su aviso
 * no se guarde), así que el fallo se registra aquí y quien avisa sigue.
 *
 * Después de guardar, deja para cuando ya se respondió la limpieza de los
 * avisos del destinatario (#339, `0023_prune_notifications.sql`). Va aquí
 * porque todavía no hay programador: cuando llegue `pg_cron` (E16b), el
 * trabajo programado llamará a la misma función de la base con todos los
 * socios, y esto podrá quitarse.
 */

/** El catálogo cerrado de `notifications.type` en
 * `supabase/migrations/0019_notifications.sql`, del lado de TypeScript para
 * poder estrechar lo que llega de la base. Un tipo nuevo se añade aquí, en
 * sus datos de abajo y en el `check` de la tabla a la vez. */
export const NOTIFICATION_TYPES = [
  "role_changed",
  "role_request_rejected",
  "role_request_received",
  "news_post_published",
  "event_created",
  "event_series_created",
  "event_changed",
  "event_cancelled",
  "event_series_changed",
  "event_series_cancelled",
  "team_assigned",
  "team_unassigned",
  "membership_renewal_upcoming",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Obliga a que cada tipo del catálogo tenga sus datos declarados. */
type DataForEveryType<Map extends Record<NotificationType, object>> = Map;

/** Los datos que cada tipo necesita para contarse, con nombre. Son los
 * mínimos: nada de correos, fechas de nacimiento ni justificaciones (sección
 * de privacidad del PRD). */
type NotificationDataByType = DataForEveryType<{
  readonly role_changed: { readonly newRole: Role };
  readonly role_request_rejected: { readonly requestedRole: RequestableRole };
  readonly role_request_received: {
    readonly requesterName: string;
    readonly requestedRole: RequestableRole;
  };
  /** El título tal como se publicó: si luego se edita, el aviso no cambia. */
  readonly news_post_published: {
    readonly postId: string;
    readonly category: NewsCategory;
    readonly title: string;
  };
  /** #310. El día y la hora de Melbourne, como se guardaron. */
  readonly event_created: {
    readonly eventId: string;
    readonly title: string;
    readonly eventType: EventType;
    /** `YYYY-MM-DD`. */
    readonly startsOn: string;
    /** `HH:MM`. */
    readonly startTime: string;
  };
  /** #310. Un aviso por serie, no uno por ocurrencia. */
  readonly event_series_created: {
    readonly seriesId: string;
    readonly title: string;
    readonly eventType: EventType;
    readonly weekdays: readonly IsoWeekday[];
    readonly startsOn: string;
    readonly endsOn: string;
    readonly startTime: string;
  };
  /** #317. Lo que quedó después del cambio: el aviso cuenta lo nuevo. */
  readonly event_changed: {
    readonly eventId: string;
    readonly title: string;
    readonly startsOn: string;
    readonly startTime: string;
    readonly location: string;
  };
  /** #317. El día y la hora que se pierden. */
  readonly event_cancelled: {
    readonly eventId: string;
    readonly title: string;
    readonly startsOn: string;
    readonly startTime: string;
  };
  /** #317. Un aviso por serie; sus días y fechas no se editan. */
  readonly event_series_changed: {
    readonly seriesId: string;
    readonly title: string;
    readonly weekdays: readonly IsoWeekday[];
    readonly startTime: string;
    readonly location: string;
  };
  /** #317. Una serie se cancela de hoy en adelante, con un solo aviso. */
  readonly event_series_cancelled: {
    readonly seriesId: string;
    readonly title: string;
    readonly weekdays: readonly IsoWeekday[];
    readonly startTime: string;
  };
  /** #401. A quien entra en un equipo o cambia de equipo al publicar el
   * reparto, con el nombre y el color tal como se publicaron. */
  readonly team_assigned: {
    readonly eventId: string;
    readonly title: string;
    readonly startsOn: string;
    readonly startTime: string;
    readonly teamName: string;
    /** `#RRGGBB`. */
    readonly teamColor: string;
  };
  /** #401. A quien sale del reparto al volver a publicarlo (D6). */
  readonly team_unassigned: {
    readonly eventId: string;
    readonly title: string;
    readonly startsOn: string;
    readonly startTime: string;
  };
  /** #470. Siete días antes de cada renovación, con lo que se va a cobrar. */
  readonly membership_renewal_upcoming: RenewalCharge;
}>;

/** Un tipo con sus datos. Al ser una unión discriminada, quien avisa no puede
 * mandar unos datos que la pantalla no sepa leer. */
export type NotificationContent = {
  [Type in NotificationType]: {
    readonly type: Type;
    readonly data: NotificationDataByType[Type];
  };
}[NotificationType];

export type NewNotification = NotificationContent & {
  readonly recipientUserId: string;
};

export type NotificationRecipient = {
  readonly clubId: string;
  readonly accountStatus: AccountStatus;
};

export type NotificationInsert = NotificationContent & {
  readonly clubId: string;
  readonly userId: string;
};

/** El tope de avisos por socio. La base lo aplica en
 * `0023_prune_notifications.sql`; aquí sirve para dejar constancia de quien
 * sigue por encima porque todo lo suyo está sin leer. Cambian juntos. */
export const MAX_NOTIFICATIONS_PER_MEMBER = 200;

export type NotificationCleanup = {
  readonly deletedCount: number;
  /** Los avisos que le quedan al socio después de limpiar. */
  readonly keptCount: number;
};

export type NotificationWriter = {
  /** `null` cuando la identidad no es socia de ningún club. */
  findRecipient(userId: string): Promise<NotificationRecipient | null>;
  insertNotification(row: NotificationInsert): Promise<void>;
  pruneNotifications(userId: string): Promise<NotificationCleanup>;
  /** Deja trabajo para después de responder a quien disparó el aviso. */
  runAfterResponse(work: () => Promise<void>): void;
};

/** Lo mismo que `NotificationWriter`, para muchos destinatarios a la vez: una
 * lectura, una escritura y una limpieza, en vez de una por cabeza (#332). */
export type NotificationBroadcastWriter = Pick<
  NotificationWriter,
  "insertNotification" | "runAfterResponse"
> & {
  /** Sin entrada para quien no es socio de ningún club. */
  findRecipients(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, NotificationRecipient>>;
  /** Todo o nada: si una fila falla, no se guarda ninguna. */
  insertNotifications(rows: readonly NotificationInsert[]): Promise<void>;
  /** Sin entrada para quien se quedó sin ningún aviso. */
  pruneNotificationsOf(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, NotificationCleanup>>;
};

/** El mismo aviso para varios socios. Un destinatario repetido se avisa una
 * vez. */
export type NewBroadcast = NotificationContent & {
  readonly recipientUserIds: readonly string[];
};

export type NotifyMembersOutcome =
  | {
      readonly kind: "notified";
      readonly savedCount: number;
      readonly failedCount: number;
    }
  | { readonly kind: "failed"; readonly error: unknown };

export type NotifyOutcome =
  | { readonly kind: "saved" }
  | { readonly kind: "recipient_ineligible" }
  | { readonly kind: "failed"; readonly error: unknown };

/** Una cuenta dada de baja no recibe avisos: no puede entrar a leerlos. */
const INELIGIBLE_ACCOUNT_STATUS: AccountStatus = "inactive";

function canReceive(recipient: NotificationRecipient): boolean {
  return recipient.accountStatus !== INELIGIBLE_ACCOUNT_STATUS;
}

export async function notifyMember(
  writer: NotificationWriter,
  notification: NewNotification,
): Promise<NotifyOutcome> {
  const { recipientUserId, ...content } = notification;
  try {
    const recipient = await writer.findRecipient(recipientUserId);
    if (recipient === null || !canReceive(recipient)) {
      return { kind: "recipient_ineligible" };
    }
    await writer.insertNotification({
      ...content,
      clubId: recipient.clubId,
      userId: recipientUserId,
    });
  } catch (error) {
    logUnsavedNotification({ userId: recipientUserId, ...content }, error);
    return { kind: "failed", error };
  }
  scheduleCleanup(writer, recipientUserId);
  return { kind: "saved" };
}

/** El mismo aviso para varios socios, con las reglas de `notifyMember`: no
 * lanza nunca y deja la limpieza para después de responder. Se escribe en una
 * sola vez; si esa escritura falla, se reintenta fila por fila para que un
 * aviso que no entra no se lleve a los demás. */
export async function notifyMembers(
  writer: NotificationBroadcastWriter,
  broadcast: NewBroadcast,
): Promise<NotifyMembersOutcome> {
  const { recipientUserIds, ...content } = broadcast;
  const userIds = [...new Set(recipientUserIds)];
  let rows: readonly NotificationInsert[];
  try {
    rows = await eligibleRows(writer, userIds, content);
  } catch (error) {
    console.error("[notifications] destinatarios sin leer", {
      type: content.type,
      error,
    });
    return { kind: "failed", error };
  }
  if (rows.length === 0) {
    return { kind: "notified", savedCount: 0, failedCount: 0 };
  }
  const savedUserIds = await insertAll(writer, rows);
  scheduleBroadcastCleanup(writer, savedUserIds);
  return {
    kind: "notified",
    savedCount: savedUserIds.length,
    failedCount: rows.length - savedUserIds.length,
  };
}

async function eligibleRows(
  writer: NotificationBroadcastWriter,
  userIds: readonly string[],
  content: NotificationContent,
): Promise<readonly NotificationInsert[]> {
  if (userIds.length === 0) {
    return [];
  }
  const recipients = await writer.findRecipients(userIds);
  return userIds.flatMap((userId) => {
    const recipient = recipients.get(userId);
    return recipient !== undefined && canReceive(recipient)
      ? [{ ...content, clubId: recipient.clubId, userId }]
      : [];
  });
}

/** Devuelve a quiénes les llegó. */
async function insertAll(
  writer: NotificationBroadcastWriter,
  rows: readonly NotificationInsert[],
): Promise<readonly string[]> {
  try {
    await writer.insertNotifications(rows);
    return rows.map((row) => row.userId);
  } catch (error) {
    console.error("[notifications] avisos en lote sin guardar; van uno a uno", {
      type: rows[0]?.type,
      count: rows.length,
      error,
    });
  }
  const results = await Promise.allSettled(
    rows.map((row) => writer.insertNotification(row)),
  );
  return rows.flatMap((row, index) => {
    const result = results[index];
    if (result?.status === "rejected") {
      logUnsavedNotification(row, result.reason);
      return [];
    }
    return [row.userId];
  });
}

/** Sin los datos: pueden llevar el nombre de alguien. */
function logUnsavedNotification(
  row: Pick<NotificationInsert, "userId" | "type">,
  error: unknown,
): void {
  console.error("[notifications] aviso sin guardar", {
    recipientUserId: row.userId,
    type: row.type,
    error,
  });
}

/** Limpiar nunca puede tumbar la acción que originó el aviso: ni cuando no se
 * puede dejar para después ni cuando falla ya corriendo. */
function scheduleCleanup(
  writer: NotificationWriter,
  recipientUserId: string,
): void {
  try {
    writer.runAfterResponse(() => pruneRecipient(writer, recipientUserId));
  } catch (error) {
    logCleanupFailure(recipientUserId, error);
  }
}

async function pruneRecipient(
  writer: NotificationWriter,
  recipientUserId: string,
): Promise<void> {
  try {
    const { keptCount } = await writer.pruneNotifications(recipientUserId);
    warnIfOverCap(recipientUserId, keptCount);
  } catch (error) {
    logCleanupFailure(recipientUserId, error);
  }
}

function warnIfOverCap(recipientUserId: string, keptCount: number): void {
  if (keptCount > MAX_NOTIFICATIONS_PER_MEMBER) {
    // Sólo puede pasar si todo lo que sobra está sin leer, y eso no se borra
    // nunca.
    console.warn("[notifications] socio por encima del tope de avisos", {
      recipientUserId,
      keptCount,
    });
  }
}

function scheduleBroadcastCleanup(
  writer: NotificationBroadcastWriter,
  recipientUserIds: readonly string[],
): void {
  if (recipientUserIds.length === 0) {
    return;
  }
  try {
    writer.runAfterResponse(() => pruneRecipients(writer, recipientUserIds));
  } catch (error) {
    logBroadcastCleanupFailure(recipientUserIds, error);
  }
}

async function pruneRecipients(
  writer: NotificationBroadcastWriter,
  recipientUserIds: readonly string[],
): Promise<void> {
  try {
    const cleanups = await writer.pruneNotificationsOf(recipientUserIds);
    for (const [recipientUserId, { keptCount }] of cleanups) {
      warnIfOverCap(recipientUserId, keptCount);
    }
  } catch (error) {
    logBroadcastCleanupFailure(recipientUserIds, error);
  }
}

function logBroadcastCleanupFailure(
  recipientUserIds: readonly string[],
  error: unknown,
): void {
  console.error("[notifications] limpieza de avisos sin hacer", {
    recipientUserIds,
    error,
  });
}

function logCleanupFailure(recipientUserId: string, error: unknown): void {
  console.error("[notifications] limpieza de avisos sin hacer", {
    recipientUserId,
    error,
  });
}
