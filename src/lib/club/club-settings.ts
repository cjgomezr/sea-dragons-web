import {
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type {
  RoleRequestGateways,
  RoleRequestMember,
} from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import {
  type AccentRejection,
  evaluateAccentColor,
  isHexColor,
} from "./accent-color";

/**
 * La configuración del club (#296, RF-6 del PRD de E18a), contada sin
 * Supabase delante. El Admin lee la marca entera y cambia el nombre, las
 * iniciales y el acento (#294); el logo se enseña aquí y se cambia con
 * `club-logo.ts` (#295).
 *
 * Guardar sigue el patrón de la corrección de la fecha en la ficha del
 * miembro (`member_status_changed`): la escritura lleva lo que el Admin tenía
 * delante y sólo se aplica si la base sigue igual. Si otro Admin guardó
 * entretanto, es un conflicto y no se pisa nada.
 */

/** El límite de `clubs_name_length` en `0022_club_brand.sql`. */
export const CLUB_NAME_MAX_LENGTH = 60;

/** El límite de `clubs_initials_length` en `0022_club_brand.sql`. */
export const CLUB_INITIALS_MAX_LENGTH = 3;

export const CLUB_SETTINGS_CHANGED_REASON = "club_settings_changed";

export type ClubSettings = {
  readonly name: string;
  /** Sin iniciales guardadas es `null`, y la marca las deriva del nombre. */
  readonly initials: string | null;
  readonly accentColor: string;
  /** La dirección pública del logo; se cambia con `club-logo.ts` (#295). */
  readonly logoUrl: string | null;
};

/** La parte de la configuración que esta pantalla escribe. */
export type ClubIdentity = Pick<
  ClubSettings,
  "name" | "initials" | "accentColor"
>;

export type ClubIdentityField = keyof ClubIdentity;

export type ClubSettingsSubmission = {
  readonly identity: ClubIdentity;
  /** Lo que el Admin tenía delante al abrir la pantalla. */
  readonly expected: ClubIdentity;
};

export const CLUB_SETTINGS_ISSUE_CODES = [
  "name_required",
  "name_too_long",
  "initials_too_long",
  "accent_color_invalid",
  "accent_color_no_readable_text",
] as const;

export type ClubSettingsIssueCode = (typeof CLUB_SETTINGS_ISSUE_CODES)[number];

export type ClubSettingsIssue = {
  readonly field: ClubIdentityField;
  readonly code: ClubSettingsIssueCode;
};

export type ClubIdentityUpdate =
  | { readonly kind: "updated"; readonly settings: ClubSettings }
  | { readonly kind: "changed_meanwhile" };

export type ClubSettingsGateways = {
  readonly members: Pick<
    RoleRequestGateways["members"],
    "findRoleRequestMember"
  >;
  readonly settings: {
    findClubSettings(clubId: string): Promise<ClubSettings>;
    /** Escribe `identity` sólo si el club sigue teniendo `expected`, en la
     * misma escritura. */
    updateClubIdentity(
      clubId: string,
      write: {
        readonly expected: ClubIdentity;
        readonly identity: ClubIdentity;
      },
    ): Promise<ClubIdentityUpdate>;
  };
  readonly audit: AuditLogWriter;
};

export class ClubSettingsForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin puede ver y cambiar la configuración del club.");
    this.name = "ClubSettingsForbiddenError";
  }
}

export class ClubSettingsConflictError extends Error {
  constructor() {
    super(
      "Otro Admin cambió la configuración mientras la editabas: vuelve a abrirla.",
    );
    this.name = "ClubSettingsConflictError";
  }
}

export class ClubSettingsValidationError extends Error {
  readonly issues: readonly ClubSettingsIssue[];

  constructor(issues: readonly ClubSettingsIssue[]) {
    super(
      `La configuración trae campos que no valen: ${issues
        .map((issue) => `${issue.field} (${issue.code})`)
        .join(", ")}.`,
    );
    this.name = "ClubSettingsValidationError";
    this.issues = issues;
  }
}

const AUDITED_ENTITY_TYPE = "club";

/** Como `char_length` de Postgres: un emoji es un carácter, no dos. */
function countCharacters(text: string): number {
  return [...text].length;
}

const ACCENT_ISSUE_OF_REJECTION: Readonly<
  Record<AccentRejection, ClubSettingsIssueCode>
> = {
  not_hex: "accent_color_invalid",
  no_readable_text: "accent_color_no_readable_text",
};

/** El nombre sin los espacios de los extremos, unas iniciales vacías como
 * ninguna y el acento en minúsculas: así lo guarda la base. */
function normalizeIdentity(identity: ClubIdentity): ClubIdentity {
  const initials = identity.initials?.trim() ?? "";
  return {
    name: identity.name.trim(),
    initials: initials === "" ? null : initials,
    accentColor: identity.accentColor.toLowerCase(),
  };
}

/**
 * El contraste sólo se exige a un acento que cambia. Uno ya guardado que no
 * llegue a AA (escrito a mano en la base, o de antes de un cambio de paleta)
 * no puede impedir que el Admin guarde el nombre: la pantalla todavía no deja
 * elegir otro. El formato sí se exige siempre, porque es el de la base.
 */
function findAccentIssue(
  accentColor: string,
  expectedAccentColor: string,
): ClubSettingsIssue | null {
  if (isHexColor(accentColor) && accentColor === expectedAccentColor) {
    return null;
  }
  const evaluation = evaluateAccentColor(accentColor);
  return evaluation.kind === "accepted"
    ? null
    : {
        field: "accentColor",
        code: ACCENT_ISSUE_OF_REJECTION[evaluation.reason],
      };
}

export function findClubSettingsIssues({
  identity,
  expected,
}: ClubSettingsSubmission): readonly ClubSettingsIssue[] {
  const { name, initials, accentColor } = normalizeIdentity(identity);
  const issues: ClubSettingsIssue[] = [];
  if (name === "") {
    issues.push({ field: "name", code: "name_required" });
  } else if (countCharacters(name) > CLUB_NAME_MAX_LENGTH) {
    issues.push({ field: "name", code: "name_too_long" });
  }
  if (
    initials !== null &&
    countCharacters(initials) > CLUB_INITIALS_MAX_LENGTH
  ) {
    issues.push({ field: "initials", code: "initials_too_long" });
  }
  const accentIssue = findAccentIssue(
    accentColor,
    expected.accentColor.toLowerCase(),
  );
  if (accentIssue !== null) {
    issues.push(accentIssue);
  }
  return issues;
}

/** Quien llama, con su club, si es Admin. La frontera ya lo comprobó por la
 * ruta; esto es el cerrojo del propio dominio. */
export async function findAdministrator(
  gateways: Pick<ClubSettingsGateways, "members">,
  callerId: string,
): Promise<RoleRequestMember> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  // La matriz del SRD no tiene una fila para configurar el club, y la única
  // que es sólo del Admin es esta.
  if (!hasCapability(caller.role, "manageUsersAndRoles")) {
    throw new ClubSettingsForbiddenError();
  }
  return caller;
}

function changedFields(
  identity: ClubIdentity,
  expected: ClubIdentity,
): readonly ClubIdentityField[] {
  return (["name", "initials", "accentColor"] as const).filter(
    (field) => identity[field] !== expected[field],
  );
}

export async function readClubSettings(
  gateways: ClubSettingsGateways,
  request: { readonly callerId: string },
): Promise<ClubSettings> {
  const caller = await findAdministrator(gateways, request.callerId);
  return gateways.settings.findClubSettings(caller.clubId);
}

/** La bitácora nombra los campos y nunca sus valores: quién, cuándo y sobre
 * qué club ya están en la entrada. */
function recordSettingsChanged(
  gateways: ClubSettingsGateways,
  actor: AuditActor,
  fields: readonly ClubIdentityField[],
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor,
    clubId: actor.clubId,
    action: "club.settings_changed",
    entityType: AUDITED_ENTITY_TYPE,
    entityId: actor.clubId,
    result: "success",
    metadata: { fields },
  });
}

/**
 * Valida antes de leer nada, escribe sólo si algo cambió y anota después de
 * escribir: auditar primero dejaría rastro de un cambio que no se guardó.
 */
export async function updateClubSettings(
  gateways: ClubSettingsGateways,
  request: {
    readonly callerId: string;
    readonly submission: ClubSettingsSubmission;
  },
): Promise<ClubSettings> {
  const issues = findClubSettingsIssues(request.submission);
  if (issues.length > 0) {
    throw new ClubSettingsValidationError(issues);
  }
  const caller = await findAdministrator(gateways, request.callerId);
  const identity = normalizeIdentity(request.submission.identity);
  const { expected } = request.submission;
  // La base admite un acento en mayúsculas, y no por eso cambió. Al gateway
  // va lo esperado tal cual, para que case con la fila; la escritura lo deja
  // en minúsculas sin contarlo como cambio.
  const fields = changedFields(identity, {
    ...expected,
    accentColor: expected.accentColor.toLowerCase(),
  });
  if (fields.length === 0) {
    return gateways.settings.findClubSettings(caller.clubId);
  }
  const result = await gateways.settings.updateClubIdentity(caller.clubId, {
    expected,
    identity,
  });
  if (result.kind === "changed_meanwhile") {
    throw new ClubSettingsConflictError();
  }
  await recordSettingsChanged(
    gateways,
    { id: request.callerId, clubId: caller.clubId },
    fields,
  );
  return result.settings;
}
