import { type AuditLogWriter, recordAuditEvent } from "@/lib/audit/audit-log";
import {
  type IdentityConfirmationReader,
  type MemberAccountStore,
  type MemberProfile,
  requiresGuardianConsent,
} from "./account-activation";
import {
  type AccountCompletion,
  findIncompleteAccount,
  settleAccount,
} from "./complete-registration";
import { looksLikeEmail } from "./registration";

/**
 * El consentimiento del tutor de un socio menor (FR-082, NFR-012, RF-3 del PRD
 * de E2), contado sin Supabase delante.
 *
 * El consentimiento es un hecho con fecha, no una casilla: queda quién lo dio,
 * su correo y cuándo, porque es lo que habría que poder enseñar si alguien lo
 * reclama. La marca de tiempo la pone el servidor. Y no hay forma de marcarlo
 * sin los datos del tutor, ni desde el formulario ni atacando la API.
 */

/** Lo que llega del formulario o de la API, sin validar. */
export type GuardianConsentRequest = {
  readonly guardianName: string;
  readonly guardianEmail: string;
  readonly consent: boolean;
};

export type GuardianConsentField = keyof GuardianConsentRequest;

export type GuardianConsentIssue = {
  readonly field: GuardianConsentField;
  readonly message: string;
};

/** El consentimiento ya validado, con su marca de tiempo. Es lo único que
 * llega a la base. */
export type GuardianConsent = {
  readonly guardianName: string;
  readonly guardianEmail: string;
  readonly consentedAt: string;
};

/** `already_recorded` es la carrera: otra petición lo registró entre la
 * lectura de la fila y esta escritura, y la primera marca de tiempo no se
 * pisa. */
export type GuardianConsentWrite = "recorded" | "already_recorded";

export type GuardianConsentWriter = {
  recordGuardianConsent(
    memberId: string,
    consent: GuardianConsent,
  ): Promise<GuardianConsentWrite>;
};

export type GuardianConsentGateways = {
  readonly accounts: MemberAccountStore & GuardianConsentWriter;
  readonly identities: IdentityConfirmationReader;
  readonly audit: AuditLogWriter;
};

const MISSING_NAME_MESSAGE = "El nombre del tutor es obligatorio.";
const INVALID_EMAIL_MESSAGE = "El correo del tutor no tiene una forma válida.";
const MISSING_CONSENT_MESSAGE =
  "Marca la casilla del consentimiento: sin ella la cuenta no se activa.";

/** En la bitácora el socio es la entidad. Sin metadata: el nombre y el correo
 * del tutor son datos personales y la bitácora no los necesita. */
const AUDITED_ENTITY_TYPE = "member";

export class GuardianConsentValidationError extends Error {
  readonly issues: readonly GuardianConsentIssue[];

  constructor(issues: readonly GuardianConsentIssue[]) {
    super("Faltan datos del tutor para registrar el consentimiento.");
    this.name = "GuardianConsentValidationError";
    this.issues = issues;
  }
}

export class GuardianConsentNotRequiredError extends Error {
  constructor() {
    super(
      "Esta cuenta no necesita el consentimiento de un tutor: no era menor de 18 el día del registro, o todavía no se sabe su fecha de nacimiento.",
    );
    this.name = "GuardianConsentNotRequiredError";
  }
}

export class GuardianConsentAlreadyRecordedError extends Error {
  constructor() {
    super("El consentimiento del tutor ya está registrado.");
    this.name = "GuardianConsentAlreadyRecordedError";
  }
}

export type GuardianConsentValidation =
  | {
      readonly ok: true;
      readonly guardianName: string;
      readonly guardianEmail: string;
    }
  | { readonly ok: false; readonly issues: readonly GuardianConsentIssue[] };

/** Valida y normaliza. Devuelve TODOS los campos malos, no el primero. Es pura
 * y la usan los dos lados, igual que `validateCompletionValues`. */
export function validateGuardianConsent(
  request: GuardianConsentRequest,
): GuardianConsentValidation {
  const guardianName = request.guardianName.trim();
  const guardianEmail = request.guardianEmail.trim().toLowerCase();
  const issues: GuardianConsentIssue[] = [
    ...(guardianName === ""
      ? [{ field: "guardianName", message: MISSING_NAME_MESSAGE } as const]
      : []),
    ...(looksLikeEmail(guardianEmail)
      ? []
      : [{ field: "guardianEmail", message: INVALID_EMAIL_MESSAGE } as const]),
    ...(request.consent
      ? []
      : [{ field: "consent", message: MISSING_CONSENT_MESSAGE } as const]),
  ];
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, guardianName, guardianEmail };
}

function assertConsentIsPending(profile: MemberProfile): void {
  if (profile.guardianConsentAt !== null) {
    throw new GuardianConsentAlreadyRecordedError();
  }
  if (!requiresGuardianConsent(profile)) {
    throw new GuardianConsentNotRequiredError();
  }
}

/**
 * Registra el consentimiento, lo deja en la bitácora y activa la cuenta si
 * era lo último que faltaba.
 *
 * La escritura va antes que la bitácora: auditar primero dejaría una entrada
 * de éxito para un consentimiento que luego no se guardó. Si la bitácora
 * falla, el error sube y la petición no responde en verde.
 */
export async function recordGuardianConsent(
  gateways: GuardianConsentGateways,
  input: {
    readonly userId: string;
    readonly request: GuardianConsentRequest;
    readonly now: Date;
  },
): Promise<AccountCompletion> {
  const record = await findIncompleteAccount(gateways, input.userId);
  assertConsentIsPending(record.profile);

  const validation = validateGuardianConsent(input.request);
  if (!validation.ok) {
    throw new GuardianConsentValidationError(validation.issues);
  }

  const consent: GuardianConsent = {
    guardianName: validation.guardianName,
    guardianEmail: validation.guardianEmail,
    consentedAt: input.now.toISOString(),
  };
  const write = await gateways.accounts.recordGuardianConsent(
    record.memberId,
    consent,
  );
  if (write === "already_recorded") {
    throw new GuardianConsentAlreadyRecordedError();
  }

  await recordAuditEvent(gateways.audit, {
    actor: { id: input.userId, clubId: record.clubId },
    clubId: record.clubId,
    action: "auth.guardian_consent_recorded",
    entityType: AUDITED_ENTITY_TYPE,
    entityId: record.memberId,
    result: "success",
  });

  return settleAccount(gateways, {
    userId: input.userId,
    memberId: record.memberId,
    profile: { ...record.profile, guardianConsentAt: consent.consentedAt },
  });
}
