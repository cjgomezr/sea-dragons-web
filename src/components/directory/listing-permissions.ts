import type {
  DirectoryListing,
  DirectoryMember,
} from "@/lib/directory/directory";
import type { EmailRecipient } from "./DirectoryEmailComposer";

/**
 * Qué puede hacer con la lista quien la mira, leído de la marca que el
 * servidor le pone y nunca de un rol que la pantalla lea por su cuenta. El
 * servidor lo vuelve a mirar al enviar, exportar o cambiar roles. Lo usan la
 * cabecera (#548) y la selección múltiple (#552).
 */

/** Escriben correos quienes reciben la lista con el correo de todos (D5, D7). */
export function canWriteEmails(listing: DirectoryListing): boolean {
  return listing.kind === "admin" || listing.kind === "committee";
}

/** Exporta a CSV quien ve el contacto de todos (D6, #500): hoy los mismos
 * que escriben correos, pero son dos permisos distintos. */
export function canExportListing(listing: DirectoryListing): boolean {
  return listing.kind === "admin" || listing.kind === "committee";
}

/** Las casillas sólo sirven para escribir, exportar o cambiar roles: quien
 * no puede nada de eso no las tiene (#552). */
export function canCheckMembers(listing: DirectoryListing): boolean {
  return canWriteEmails(listing) || canExportListing(listing);
}

/** Cambia roles, también en bloque, sólo el Admin (FR-014). */
export function canChangeRoles(listing: DirectoryListing): boolean {
  return listing.kind === "admin";
}

/** A quién va un correo, sin las bajas: no van a recibirlo. El servidor las
 * vuelve a quitar al enviar, por si alguien se dio de baja entre medias. */
export function emailRecipientsOf(
  members: readonly DirectoryMember[],
): readonly EmailRecipient[] {
  return members
    .filter((member) => member.status !== "inactive")
    .map(({ userId, fullName }) => ({ userId, fullName }));
}
