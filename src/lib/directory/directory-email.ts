import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import {
  type AuditLogWriter,
  AuditWriteError,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import type { ClubBrand } from "@/lib/club/club-brand";
import type { EmailProviderProbe } from "@/lib/email/email-delivery-availability";
import { FALLBACK_EMAIL_LOCALE } from "@/lib/email/email-locale";
import { renderDirectoryEmail } from "@/lib/email/email-templates";
import {
  type BatchEmailDelivery,
  type BatchEmailSender,
  type BatchEmailSenderConnection,
  EmailDeliveryError,
  type ReplyableEmail,
} from "@/lib/email/resend-email-sender";
import { isLocale } from "@/lib/i18n/locale";
import { contactAccessOf } from "./directory";
import {
  DIRECTORY_EMAIL_QUOTA,
  DIRECTORY_EMAIL_WINDOW_HOURS,
  type DirectoryEmailDraft,
  type DirectoryEmailQuota,
  type DirectoryEmailResult,
  type DraftProblems,
  type FailedRecipient,
  checkDirectoryEmailDraft,
  hasDraftProblems,
} from "./directory-email-rules";

export * from "./directory-email-rules";

/**
 * El correo del directorio (#501, RF-6 y RF-7 del PRD de E19, D7 y D8): un
 * Admin o un Committee escribe a los socios de la lista, y cada uno recibe
 * su propio correo, desde la dirección del club y con respuesta a quien lo
 * escribió.
 *
 * Sale del mismo cupo diario de Resend que los correos de cuenta
 * (invitación, confirmación, recuperación), así que lleva el suyo aparte:
 * como mucho `DIRECTORY_EMAIL_QUOTA` correos en la ventana, contados en su
 * propio registro. El cupo de los correos de cuenta
 * (`email-delivery-availability.ts`) cuenta otra tabla, y el directorio no le
 * resta nada.
 */

const MILLISECONDS_PER_HOUR = 3_600_000;

/** Quien escribe correos desde el directorio es quien ve el correo de todos
 * en él (D5, D7): Admin y Committee. */
export function canEmailFromDirectory(role: Role): boolean {
  return contactAccessOf(role) === "full";
}

/** Un socio tal como lo lee el envío. `locale` llega tal cual de la base. */
export type DirectoryEmailRecipient = {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: AccountStatus;
  readonly locale: string;
};

export type DirectoryEmailReservationRequest = {
  readonly clubId: string;
  readonly senderId: string;
  readonly requestId: string;
  readonly recipientCount: number;
  readonly limit: number;
  readonly windowStart: Date;
};

export type DirectoryEmailReservation =
  | { readonly kind: "reserved"; readonly sendId: string }
  | { readonly kind: "exceeded"; readonly remaining: number }
  | { readonly kind: "duplicate" };

/** El registro de los envíos del directorio. Reservar cuenta y apunta de una
 * vez, para que dos envíos a la vez no pasen juntos del cupo. Un envío cuenta
 * lo reservado hasta que `settle` dice cuántos salieron de verdad. */
export type DirectoryEmailQuotaGateway = {
  countSentSince(windowStart: Date): Promise<number>;
  reserve(
    request: DirectoryEmailReservationRequest,
  ): Promise<DirectoryEmailReservation>;
  settle(sendId: string, deliveredCount: number): Promise<void>;
};

export type DirectoryEmailGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly recipients: {
    /** Sólo los socios de ese club; un id de fuera no vuelve. */
    findEmailRecipients(
      clubId: string,
      userIds: readonly string[],
    ): Promise<readonly DirectoryEmailRecipient[]>;
  };
  readonly quota: DirectoryEmailQuotaGateway;
  readonly delivery: {
    readonly connection: BatchEmailSenderConnection;
    readonly provider: EmailProviderProbe;
  };
  readonly brand: { readClubBrand(): Promise<ClubBrand> };
  readonly audit: AuditLogWriter;
  readonly log: (message: string, details: Record<string, unknown>) => void;
};

export class DirectoryEmailForbiddenError extends Error {
  constructor() {
    super(
      "Sólo un Admin o un Committee puede mandar correos desde el directorio.",
    );
    this.name = "DirectoryEmailForbiddenError";
  }
}

export class DirectoryEmailInvalidError extends Error {
  readonly problems: DraftProblems;

  constructor(problems: DraftProblems) {
    super(
      `El correo no es válido: asunto ${problems.subject ?? "bien"}, mensaje ${problems.message ?? "bien"}.`,
    );
    this.name = "DirectoryEmailInvalidError";
    this.problems = problems;
  }
}

export class DirectoryEmailNoRecipientsError extends Error {
  constructor() {
    super("Ninguno de los socios elegidos puede recibir el correo.");
    this.name = "DirectoryEmailNoRecipientsError";
  }
}

export class DirectoryEmailQuotaExceededError extends Error {
  readonly remaining: number;

  constructor(remaining: number) {
    super(
      `No caben: el directorio puede mandar ${remaining} correos más en las próximas ${DIRECTORY_EMAIL_WINDOW_HOURS} horas.`,
    );
    this.name = "DirectoryEmailQuotaExceededError";
    this.remaining = remaining;
  }
}

export class DirectoryEmailDuplicateError extends Error {
  constructor(requestId: string) {
    super(`El envío ${requestId} ya se hizo.`);
    this.name = "DirectoryEmailDuplicateError";
  }
}

export class DirectoryEmailUnavailableError extends Error {
  constructor(reason: string) {
    super(`El envío de correos no está disponible ahora: ${reason}`);
    this.name = "DirectoryEmailUnavailableError";
  }
}

function windowStartFor(now: Date): Date {
  return new Date(
    now.getTime() - DIRECTORY_EMAIL_WINDOW_HOURS * MILLISECONDS_PER_HOUR,
  );
}

type Sender = {
  readonly userId: string;
  readonly clubId: string;
  readonly fullName: string;
  readonly role: Role;
};

async function findAllowedSender(
  gateways: Pick<DirectoryEmailGateways, "members">,
  callerId: string,
): Promise<Sender> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  // El rol se lee al enviar: a quien se lo quitaron con el formulario
  // abierto no le vale el que tenía al abrirlo.
  if (!canEmailFromDirectory(caller.role)) {
    throw new DirectoryEmailForbiddenError();
  }
  return { userId: callerId, ...caller };
}

async function remainingQuota(
  quota: DirectoryEmailQuotaGateway,
  now: Date,
): Promise<number> {
  const sent = await quota.countSentSince(windowStartFor(now));
  return Math.max(DIRECTORY_EMAIL_QUOTA - sent, 0);
}

export async function readDirectoryEmailQuota(
  gateways: DirectoryEmailGateways,
  request: { readonly callerId: string; readonly now: Date },
): Promise<DirectoryEmailQuota> {
  await findAllowedSender(gateways, request.callerId);
  return {
    limit: DIRECTORY_EMAIL_QUOTA,
    remaining: await remainingQuota(gateways.quota, request.now),
  };
}

export type DirectoryEmailRequest = {
  readonly callerId: string;
  /** Lo genera quien llama una vez por envío: repetir la petición con el
   * mismo no manda nada otra vez. */
  readonly requestId: string;
  readonly draft: DirectoryEmailDraft;
  readonly recipientIds: readonly string[];
  readonly now: Date;
};

/** Las bajas se quitan aquí, al enviar, y no al abrir el formulario: quien se
 * da de baja mientras otro escribe ya no lo recibe. */
async function findActiveRecipients(
  gateways: DirectoryEmailGateways,
  sender: Sender,
  recipientIds: readonly string[],
): Promise<readonly DirectoryEmailRecipient[]> {
  const found = await gateways.recipients.findEmailRecipients(sender.clubId, [
    ...new Set(recipientIds),
  ]);
  const active = found.filter((member) => member.status !== "inactive");
  if (active.length === 0) {
    throw new DirectoryEmailNoRecipientsError();
  }
  return active;
}

/** El correo de quien escribe, para que la respuesta le llegue a él. */
async function findReplyAddress(
  gateways: DirectoryEmailGateways,
  sender: Sender,
): Promise<string> {
  const [own] = await gateways.recipients.findEmailRecipients(sender.clubId, [
    sender.userId,
  ]);
  if (own === undefined) {
    throw new MemberNotFoundError(sender.userId);
  }
  return own.email;
}

/** Lo más barato primero, y nada se reserva si el proveedor no puede
 * mandarlo: una caída no deja el cupo gastado para cuando vuelva. */
async function requireConnectedSender(
  delivery: DirectoryEmailGateways["delivery"],
): Promise<BatchEmailSender> {
  if (delivery.connection.kind === "not_connected") {
    throw new DirectoryEmailUnavailableError(delivery.connection.reason);
  }
  const status = await delivery.provider.probeProvider();
  if (status.kind === "unreachable") {
    throw new DirectoryEmailUnavailableError(status.reason);
  }
  return delivery.connection.sender;
}

async function reserveQuota(
  gateways: DirectoryEmailGateways,
  request: DirectoryEmailRequest & { readonly sender: Sender },
  recipientCount: number,
): Promise<string> {
  const reservation = await gateways.quota.reserve({
    clubId: request.sender.clubId,
    senderId: request.sender.userId,
    requestId: request.requestId,
    recipientCount,
    limit: DIRECTORY_EMAIL_QUOTA,
    windowStart: windowStartFor(request.now),
  });
  switch (reservation.kind) {
    case "reserved":
      return reservation.sendId;
    case "exceeded":
      throw new DirectoryEmailQuotaExceededError(reservation.remaining);
    case "duplicate":
      throw new DirectoryEmailDuplicateError(request.requestId);
  }
}

function composeEmails(
  draft: DirectoryEmailDraft,
  context: {
    readonly sender: Sender;
    readonly replyTo: string;
    readonly brand: ClubBrand;
    readonly recipients: readonly DirectoryEmailRecipient[];
  },
): readonly ReplyableEmail[] {
  return context.recipients.map((recipient) => ({
    to: recipient.email,
    replyTo: context.replyTo,
    ...renderDirectoryEmail({
      draft,
      sender: context.sender,
      locale: isLocale(recipient.locale)
        ? recipient.locale
        : FALLBACK_EMAIL_LOCALE,
      brand: context.brand,
    }),
  }));
}
type BatchOutcome =
  | {
      readonly kind: "delivered";
      readonly deliveries: readonly BatchEmailDelivery[];
    }
  | { readonly kind: "failed"; readonly error: EmailDeliveryError };

/** Sólo un fallo de entrega es un resultado; cualquier otro error sube tal
 * cual. */
async function deliverBatch(
  sender: BatchEmailSender,
  emails: readonly ReplyableEmail[],
  requestId: string,
): Promise<BatchOutcome> {
  try {
    return {
      kind: "delivered",
      deliveries: await sender.sendBatch(emails, requestId),
    };
  } catch (error) {
    if (!(error instanceof EmailDeliveryError)) {
      throw error;
    }
    return { kind: "failed", error };
  }
}

const CLIENT_ERROR_MIN_STATUS = 400;
const SERVER_ERROR_MIN_STATUS = 500;

/** Un 4xx es Resend diciendo que no aceptó el lote: no salió nada. Sin
 * respuesta, con un 5xx o con un 200 sin la lista de envíos no hay constancia
 * de qué pasó, y el lote pudo salir entero. */
function isClearRejection(error: EmailDeliveryError): boolean {
  return (
    error.status !== undefined &&
    error.status >= CLIENT_ERROR_MIN_STATUS &&
    error.status < SERVER_ERROR_MIN_STATUS
  );
}

/** Un envío tal como lo cuenta la bitácora. */
type AuditedSend = {
  readonly sender: Sender;
  readonly sendId: string;
  readonly subject: string;
  readonly recipientCount: number;
};

/** La bitácora guarda quién, cuándo, el asunto y a cuántos (NFR-010); el
 * cuerpo no. `sentCount` es `null` cuando no se sabe si el lote salió. Los
 * correos pudieron salir cuando esto corre, así que un fallo de la bitácora
 * se registra en el servidor y no cambia la respuesta: decir que falló
 * invitaría a mandarlos otra vez. */
async function auditSend(
  gateways: DirectoryEmailGateways,
  send: AuditedSend & { readonly sentCount: number | null },
): Promise<void> {
  const actor = { id: send.sender.userId, clubId: send.sender.clubId };
  const isSent = send.sentCount !== null && send.sentCount > 0;
  try {
    await recordAuditEvent(gateways.audit, {
      actor,
      clubId: actor.clubId,
      action: "directory.email_sent",
      entityType: "directory_email",
      entityId: send.sendId,
      result: isSent ? "success" : "failure",
      metadata: {
        subject: send.subject,
        recipientCount: send.recipientCount,
        sentCount: send.sentCount,
      },
    });
  } catch (error) {
    if (!(error instanceof AuditWriteError)) {
      throw error;
    }
    gateways.log("[directory-email] bitácora sin escribir", {
      sendId: send.sendId,
      message: error.message,
    });
  }
}

function failedRecipients(
  recipients: readonly DirectoryEmailRecipient[],
  deliveries: readonly BatchEmailDelivery[],
): readonly FailedRecipient[] {
  return recipients.flatMap((recipient, index) =>
    deliveries[index]?.kind === "sent"
      ? []
      : [{ userId: recipient.userId, fullName: recipient.fullName }],
  );
}

/** Lo que se comprueba y se arma antes de tocar el proveedor o el cupo. */
async function prepareEmails(
  gateways: DirectoryEmailGateways,
  request: DirectoryEmailRequest,
): Promise<{
  readonly sender: Sender;
  readonly recipients: readonly DirectoryEmailRecipient[];
  readonly emails: readonly ReplyableEmail[];
}> {
  const sender = await findAllowedSender(gateways, request.callerId);
  const problems = checkDirectoryEmailDraft(request.draft);
  if (hasDraftProblems(problems)) {
    throw new DirectoryEmailInvalidError(problems);
  }
  const recipients = await findActiveRecipients(
    gateways,
    sender,
    request.recipientIds,
  );
  const emails = composeEmails(request.draft, {
    sender,
    replyTo: await findReplyAddress(gateways, sender),
    brand: await gateways.brand.readClubBrand(),
    recipients,
  });
  return { sender, recipients, emails };
}

/** Un lote que Resend rechazó no gasta cupo. Uno del que no se sabe si salió
 * deja el cupo reservado entero: contar de menos podría dejar sin cupo a los
 * correos de cuenta (D8). */
async function settleFailedBatch(
  gateways: DirectoryEmailGateways,
  send: AuditedSend & { readonly error: EmailDeliveryError },
): Promise<never> {
  const isRejected = isClearRejection(send.error);
  if (isRejected) {
    await gateways.quota.settle(send.sendId, 0);
  }
  await auditSend(gateways, { ...send, sentCount: isRejected ? 0 : null });
  throw new DirectoryEmailUnavailableError(send.error.message);
}

export async function sendDirectoryEmail(
  gateways: DirectoryEmailGateways,
  request: DirectoryEmailRequest,
): Promise<DirectoryEmailResult> {
  const { sender, recipients, emails } = await prepareEmails(gateways, request);
  const batchSender = await requireConnectedSender(gateways.delivery);
  const sendId = await reserveQuota(
    gateways,
    { ...request, sender },
    recipients.length,
  );
  const send: AuditedSend = {
    sender,
    sendId,
    subject: request.draft.subject,
    recipientCount: recipients.length,
  };
  const outcome = await deliverBatch(batchSender, emails, request.requestId);
  if (outcome.kind === "failed") {
    return settleFailedBatch(gateways, { ...send, error: outcome.error });
  }
  const failed = failedRecipients(recipients, outcome.deliveries);
  const sentCount = recipients.length - failed.length;
  await gateways.quota.settle(sendId, sentCount);
  await auditSend(gateways, { ...send, sentCount });
  return {
    sentCount,
    failed,
    remaining: await remainingQuota(gateways.quota, request.now),
  };
}
