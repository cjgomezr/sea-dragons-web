import { clubCalendarDate } from "@/lib/time/club-calendar";
import type { AccountStatus } from "./account-status";

/** NFR-012: por debajo de esta edad hace falta el consentimiento del tutor. */
export const ADULT_AGE = 18;

/** Los campos de los que depende que a una cuenta "no le falte nada" (FR-083).
 * Nulos porque la fila puede nacer sin ellos: el estado `incomplete` existe
 * justo para eso. */
export type MemberProfile = {
  readonly country: string | null;
  readonly dateOfBirth: string | null;
  readonly membershipType: string | null;
  readonly guardianConsentAt: string | null;
};

/**
 * Lo que puede estar pendiente en una cuenta `incomplete`.
 *
 * Los tres primeros son columnas de `members` que la pantalla de completar
 * registro pide en su formulario. Los dos últimos no se rellenan escribiendo:
 * el consentimiento lo da otra persona (FR-082) y la confirmación llega
 * abriendo el enlace del correo.
 */
export const PENDING_REQUIREMENTS = [
  "country",
  "dateOfBirth",
  "membershipType",
  "guardianConsent",
  "emailConfirmation",
] as const;

export type PendingRequirement = (typeof PENDING_REQUIREMENTS)[number];

export type MemberAccountRecord = {
  readonly memberId: string;
  readonly accountStatus: AccountStatus;
  readonly profile: MemberProfile;
};

export type MemberAccountStore = {
  findByUserId(userId: string): Promise<MemberAccountRecord | null>;
  updateAccountStatus(memberId: string, status: AccountStatus): Promise<void>;
};

export type IdentityConfirmationReader = {
  isEmailConfirmed(userId: string): Promise<boolean>;
};

export type AccountActivation =
  | { readonly kind: "activated" }
  | { readonly kind: "unchanged"; readonly status: AccountStatus };

export class MemberNotFoundError extends Error {
  constructor(userId: string) {
    super(`La identidad ${userId} no tiene fila de miembro en el club.`);
    this.name = "MemberNotFoundError";
  }
}

type CalendarParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

/** Parte una fecha de calendario AAAA-MM-DD. Sus dos entradas ya tienen ese
 * formato: una viene de `clubCalendarDate` y la otra de una columna `date` de
 * Postgres, que PostgREST serializa siempre así. */
function calendarParts(isoDate: string): CalendarParts {
  return {
    year: Number(isoDate.slice(0, 4)),
    month: Number(isoDate.slice(5, 7)),
    day: Number(isoDate.slice(8, 10)),
  };
}

/** Edad en años cumplidos comparando dos fechas de calendario (AAAA-MM-DD).
 * Se hace sobre el texto y no con aritmética de `Date` para no arrastrar husos
 * horarios a una cuenta que sólo tiene día, mes y año. */
export function isMinorOn(dateOfBirth: string, day: string): boolean {
  const born = calendarParts(dateOfBirth);
  const today = calendarParts(day);

  const hadBirthdayThisYear =
    today.month > born.month ||
    (today.month === born.month && today.day >= born.day);
  const age = today.year - born.year - (hadBirthdayThisYear ? 0 : 1);
  return age < ADULT_AGE;
}

function needsGuardianConsent(profile: MemberProfile, now: Date): boolean {
  if (profile.dateOfBirth === null || profile.guardianConsentAt !== null) {
    return false;
  }
  return isMinorOn(profile.dateOfBirth, clubCalendarDate(now));
}

/**
 * Todo lo que le falta a una cuenta para poder operar (FR-083 y decisión B2).
 *
 * Es LA regla, y por eso está sola: la pantalla de completar registro pregunta
 * aquí qué pedir, y el paso a `active` pregunta aquí si ya no falta nada. Dos
 * copias de esto acabarían discrepando, y la discrepancia sería una cuenta
 * activa sin los datos que el club necesita.
 *
 * El orden es el que la pantalla muestra: primero lo que se rellena en el
 * formulario, después lo que depende de otra persona o de otro correo.
 */
export function listPendingRequirements(input: {
  readonly profile: MemberProfile;
  readonly emailConfirmed: boolean;
  readonly now: Date;
}): readonly PendingRequirement[] {
  const { profile, emailConfirmed, now } = input;
  const pending: PendingRequirement[] = [];

  if (profile.country === null) {
    pending.push("country");
  }
  if (profile.dateOfBirth === null) {
    pending.push("dateOfBirth");
  }
  if (profile.membershipType === null) {
    pending.push("membershipType");
  }
  if (needsGuardianConsent(profile, now)) {
    pending.push("guardianConsent");
  }
  if (!emailConfirmed) {
    pending.push("emailConfirmation");
  }
  return pending;
}

/** Un solo estado `incomplete` para "faltan datos", "falta confirmar el
 * correo" y "falta el consentimiento del tutor": no hay tres estados, hay una
 * lista de pendientes y un estado que dice si está vacía. */
export function resolveAccountStatus(input: {
  readonly profile: MemberProfile;
  readonly emailConfirmed: boolean;
  readonly now: Date;
}): Extract<AccountStatus, "incomplete" | "active"> {
  return listPendingRequirements(input).length === 0 ? "active" : "incomplete";
}

/** Recalcula el estado de una cuenta `incomplete` y la activa si ya no le
 * falta nada. Sólo mira las cuentas `incomplete`: una `inactive` es una baja
 * de socio (FR-085) y confirmar un correo no la revive. */
export async function activateAccountIfComplete(
  gateways: {
    readonly accounts: MemberAccountStore;
    readonly identities: IdentityConfirmationReader;
  },
  userId: string,
  options: { readonly now: Date },
): Promise<AccountActivation> {
  const record = await gateways.accounts.findByUserId(userId);
  if (record === null) {
    throw new MemberNotFoundError(userId);
  }
  if (record.accountStatus !== "incomplete") {
    return { kind: "unchanged", status: record.accountStatus };
  }

  const status = resolveAccountStatus({
    profile: record.profile,
    emailConfirmed: await gateways.identities.isEmailConfirmed(userId),
    now: options.now,
  });
  if (status !== "active") {
    return { kind: "unchanged", status };
  }

  await gateways.accounts.updateAccountStatus(record.memberId, "active");
  return { kind: "activated" };
}
