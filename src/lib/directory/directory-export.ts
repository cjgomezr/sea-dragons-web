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
  /** Los socios marcados en la lista (#552), o `null` para exportarla
   * entera. Un marcado que el filtro deja fuera no sale. */
  readonly selectedUserIds: readonly string[] | null;
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

function onlySelected(
  listing: ExportableListing,
  selectedUserIds: readonly string[] | null,
): ExportableListing {
  if (selectedUserIds === null) {
    return listing;
  }
  const selected = new Set(selectedUserIds);
  // Las dos ramas por separado: TypeScript no deja filtrar una unión de
  // listas sin perder qué miembros lleva cada una.
  return listing.kind === "admin"
    ? {
        ...listing,
        members: listing.members.filter((member) =>
          selected.has(member.userId),
        ),
      }
    : {
        ...listing,
        members: listing.members.filter((member) =>
          selected.has(member.userId),
        ),
      };
}

/** Lo que la bitácora apunta de una exportación: los filtros y cuántos
 * salieron y, si se marcaron socios, cuántos. Ni nombres ni correos
 * (NFR-010). */
function exportAuditMetadata(
  request: DirectoryExportRequest,
  memberCount: number,
): Readonly<Record<string, unknown>> {
  const metadata = {
    filters: Object.fromEntries(writeDirectoryQuery(request.query)),
    memberCount,
  };
  return request.selectedUserIds === null
    ? metadata
    : { ...metadata, selectedCount: request.selectedUserIds.length };
}

function buildExport(
  listing: ExportableListing,
  { locale, todayInClub }: DirectoryExportRequest,
  brand: ClubBrand,
): DirectoryExport {
  const translate = createTranslator(locale);
  return {
    filename: directoryCsvFilename({
      clubName: brand.name,
      todayInClub,
      translate,
    }),
    csv: directoryCsv(listing, translate),
    memberCount: listing.members.length,
  };
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
  const listing = onlySelected(
    asExportable(
      await listDirectory({ ...gateways, photos: WITHOUT_PHOTOS }, request),
    ),
    request.selectedUserIds,
  );
  const exported = buildExport(
    listing,
    request,
    await gateways.brand.readClubBrand(),
  );
  // Lo último antes de entregarlo: la bitácora no apunta una exportación que
  // luego no salió, y sin apuntarla no sale.
  await recordAuditEvent(gateways.audit, {
    actor: { id: request.callerId, clubId: caller.clubId },
    clubId: caller.clubId,
    action: "directory.exported",
    entityType: "club",
    entityId: caller.clubId,
    result: "success",
    metadata: exportAuditMetadata(request, exported.memberCount),
  });
  return exported;
}
