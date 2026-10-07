import { type AuditLogWriter, recordAuditEvent } from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import type { ClubBrand } from "@/lib/club/club-brand";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import {
  type DirectoryGateways,
  type DirectoryListing,
  type DirectoryRequest,
  contactAccessOf,
  listDirectory,
} from "./directory";
import {
  type ExportableListing,
  directoryCsv,
  directoryCsvFilename,
} from "./directory-csv";
import { writeDirectoryQuery } from "./directory-query";

/**
 * La exportación del directorio a CSV (#500, RF-5 del PRD de E19, D6): un
 * Admin o un Committee descarga la lista que está viendo.
 *
 * La lista sale de `listDirectory` con la misma consulta que la pantalla, así
 * que nunca difiere de lo que se ve: los mismos filtros, el mismo orden y los
 * mismos campos por rol. Cada exportación queda en la bitácora (NFR-010)
 * antes de entregar el archivo: si no se puede apuntar, no sale.
 */

export const DIRECTORY_EXPORT_FORBIDDEN_REASON = "directory_export_forbidden";

export class DirectoryExportForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin o un Committee puede exportar el directorio.");
    this.name = "DirectoryExportForbiddenError";
  }
}

/** Exporta quien ve el contacto de todos en el directorio (D5, D6). */
export function canExportDirectory(role: Role): boolean {
  return contactAccessOf(role) === "full";
}

export type DirectoryExportGateways = DirectoryGateways & {
  readonly brand: { readClubBrand(): Promise<ClubBrand> };
  readonly audit: AuditLogWriter;
};

export type DirectoryExportRequest = DirectoryRequest & {
  /** El idioma de quien exporta: el de las cabeceras y los valores. */
  readonly locale: Locale;
};

export type DirectoryExport = {
  readonly filename: string;
  readonly csv: string;
  readonly memberCount: number;
};

/** El CSV no lleva fotos: firmarlas sería pedir al almacenamiento una
 * dirección por socio que nadie va a usar. */
const WITHOUT_PHOTOS: DirectoryGateways["photos"] = {
  signPhotoUrls: async () => new Map(),
};

/** Que el rol cambie entre las dos lecturas no deja pasar a nadie: la lista
 * que no es de Admin ni de Committee tampoco se exporta. */
function asExportable(listing: DirectoryListing): ExportableListing {
  if (listing.kind === "admin" || listing.kind === "committee") {
    return listing;
  }
  throw new DirectoryExportForbiddenError();
}

export async function exportDirectory(
  gateways: DirectoryExportGateways,
  request: DirectoryExportRequest,
): Promise<DirectoryExport> {
  const caller = await gateways.members.findRoleRequestMember(request.callerId);
  if (caller === null) {
    throw new MemberNotFoundError(request.callerId);
  }
  if (!canExportDirectory(caller.role)) {
    throw new DirectoryExportForbiddenError();
  }
  const listing = asExportable(
    await listDirectory({ ...gateways, photos: WITHOUT_PHOTOS }, request),
  );
  const memberCount = listing.members.length;
  await recordAuditEvent(gateways.audit, {
    actor: { id: request.callerId, clubId: caller.clubId },
    clubId: caller.clubId,
    action: "directory.exported",
    entityType: "club",
    entityId: caller.clubId,
    result: "success",
    metadata: {
      filters: Object.fromEntries(writeDirectoryQuery(request.query)),
      memberCount,
    },
  });
  const translate = createTranslator(request.locale);
  const brand = await gateways.brand.readClubBrand();
  return {
    filename: directoryCsvFilename({
      clubName: brand.name,
      todayInClub: request.todayInClub,
      translate,
    }),
    csv: directoryCsv(listing, translate),
    memberCount,
  };
}
