import type { AccountStatus } from "@/lib/auth/account-status";
import type { RequestableRole } from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";

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

export type NotifyOutcome =
  | { readonly kind: "saved" }
  | { readonly kind: "recipient_ineligible" }
  | { readonly kind: "failed"; readonly error: unknown };

/** Una cuenta dada de baja no recibe avisos: no puede entrar a leerlos. */
const INELIGIBLE_ACCOUNT_STATUS: AccountStatus = "inactive";

export async function notifyMember(
  writer: NotificationWriter,
  notification: NewNotification,
): Promise<NotifyOutcome> {
  const { recipientUserId, ...content } = notification;
  try {
    const recipient = await writer.findRecipient(recipientUserId);
    if (
      recipient === null ||
      recipient.accountStatus === INELIGIBLE_ACCOUNT_STATUS
    ) {
      return { kind: "recipient_ineligible" };
    }
    await writer.insertNotification({
      ...content,
      clubId: recipient.clubId,
      userId: recipientUserId,
    });
  } catch (error) {
    // Sin los datos: pueden llevar el nombre de alguien.
    console.error("[notifications] aviso sin guardar", {
      recipientUserId,
      type: content.type,
      error,
    });
    return { kind: "failed", error };
  }
  scheduleCleanup(writer, recipientUserId);
  return { kind: "saved" };
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
    if (keptCount > MAX_NOTIFICATIONS_PER_MEMBER) {
      // Sólo puede pasar si todo lo que sobra está sin leer, y eso no se
      // borra nunca.
      console.warn("[notifications] socio por encima del tope de avisos", {
        recipientUserId,
        keptCount,
      });
    }
  } catch (error) {
    logCleanupFailure(recipientUserId, error);
  }
}

function logCleanupFailure(recipientUserId: string, error: unknown): void {
  console.error("[notifications] limpieza de avisos sin hacer", {
    recipientUserId,
    error,
  });
}
