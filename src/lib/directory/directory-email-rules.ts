import type { DirectoryEmailDraft } from "@/lib/email/email-templates";

/**
 * Las reglas del correo del directorio (#501, RF-6 y RF-7 del PRD de E19)
 * que comparten el servidor y la pantalla: los límites, la validación del
 * borrador, los motivos de cada rechazo y la forma de las respuestas.
 *
 * Vive aparte de `directory-email.ts` porque ese módulo habla con Resend, y
 * nada que hable con Resend puede llegar al navegador.
 */

export type { DirectoryEmailDraft };

/** D8: la mitad de los 100 correos diarios del plan gratuito de Resend. Si el
 * club paga un plan mayor, se cambia aquí. */
export const DIRECTORY_EMAIL_QUOTA = 50;
export const DIRECTORY_EMAIL_WINDOW_HOURS = 24;
export const DIRECTORY_EMAIL_SUBJECT_MAX_LENGTH = 150;
export const DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH = 5_000;


/** Los motivos de los rechazos, que la pantalla traduce (E17). */
export const DIRECTORY_EMAIL_FORBIDDEN_REASON = "directory_email_forbidden";
export const INVALID_DIRECTORY_EMAIL_REASON = "invalid_directory_email";
export const NO_DIRECTORY_EMAIL_RECIPIENTS_REASON = "no_recipients";
export const DIRECTORY_EMAIL_QUOTA_EXCEEDED_REASON =
  "directory_email_quota_exceeded";
export const DIRECTORY_EMAIL_DUPLICATE_REASON = "directory_email_duplicate";
export const DIRECTORY_EMAIL_UNAVAILABLE_REASON = "email_unavailable";

export type DraftFieldProblem = "required" | "too_long";

export type DraftProblems = {
  readonly subject: DraftFieldProblem | null;
  readonly message: DraftFieldProblem | null;
};

function checkField(
  value: string,
  maxLength: number,
): DraftFieldProblem | null {
  if (value.trim() === "") {
    return "required";
  }
  return value.length > maxLength ? "too_long" : null;
}

/** La pantalla y el servidor validan con esta misma función. */
export function checkDirectoryEmailDraft(
  draft: DirectoryEmailDraft,
): DraftProblems {
  return {
    subject: checkField(draft.subject, DIRECTORY_EMAIL_SUBJECT_MAX_LENGTH),
    message: checkField(draft.message, DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH),
  };
}

export function hasDraftProblems(problems: DraftProblems): boolean {
  return problems.subject !== null || problems.message !== null;
}


export type DirectoryEmailQuota = {
  readonly limit: number;
  readonly remaining: number;
};

export type FailedRecipient = {
  readonly userId: string;
  readonly fullName: string;
};

export type DirectoryEmailResult = {
  readonly sentCount: number;
  readonly failed: readonly FailedRecipient[];
  readonly remaining: number;
};

