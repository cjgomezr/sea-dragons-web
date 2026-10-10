import type {
  AdminDirectoryMember,
  CoachDirectoryMember,
  CommitteeDirectoryMember,
  DirectoryListing,
  DirectoryMember,
} from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import { verificationMarkOf } from "./auf-marks";
import type { RowContact } from "./DirectoryContactCell";
import { statusDotsOf } from "./status-dots";

/**
 * El socio que se eligió en la lista para la ficha rápida del panel lateral
 * (#550, RF-5 del PRD de E21), con la marca de la vista que lo trajo. Como en
 * la fila, lo que la ficha enseña lo decide esa marca, que pone el servidor,
 * y no un rol que la pantalla lea por su cuenta (D4).
 */
export type SelectedMember =
  | { readonly kind: "admin"; readonly member: AdminDirectoryMember }
  | { readonly kind: "committee"; readonly member: CommitteeDirectoryMember }
  | { readonly kind: "coach"; readonly member: CoachDirectoryMember }
  | { readonly kind: "member"; readonly member: DirectoryMember };

/** Null si ya no está en la lista: otro filtro lo dejó fuera. */
export function findSelectedMember(
  listing: DirectoryListing,
  userId: string,
): SelectedMember | null {
  const isSelected = (member: DirectoryMember): boolean =>
    member.userId === userId;
  switch (listing.kind) {
    case "admin": {
      const member = listing.members.find(isSelected);
      return member === undefined ? null : { kind: "admin", member };
    }
    case "committee": {
      const member = listing.members.find(isSelected);
      return member === undefined ? null : { kind: "committee", member };
    }
    case "coach": {
      const member = listing.members.find(isSelected);
      return member === undefined ? null : { kind: "coach", member };
    }
    case "member": {
      const member = listing.members.find(isSelected);
      return member === undefined ? null : { kind: "member", member };
    }
  }
}

/** El contacto que esa vista trae (FR-090): todo para Admin y Committee, el
 * de emergencia para el Coach, nada para el Player. */
export function contactOf(selected: SelectedMember): RowContact {
  switch (selected.kind) {
    case "admin":
    case "committee":
      return {
        kind: "full",
        email: selected.member.email,
        phone: selected.member.phone,
        emergencyContact: selected.member.emergencyContact,
      };
    case "coach":
      return {
        kind: "emergency",
        emergencyContact: selected.member.emergencyContact,
      };
    case "member":
      return { kind: "none" };
  }
}

export type CardTagTone = "danger" | "warning" | "neutral";

export type CardTag = { readonly text: string; readonly tone: CardTagTone };

function statusTagsOf(
  translate: Translator,
  member: DirectoryMember,
): readonly CardTag[] {
  if (member.invitedOn !== null) {
    return [{ text: translate("directory.invited.pill"), tone: "neutral" }];
  }
  if (member.status === "inactive") {
    return [{ text: translate("directory.mark.inactive"), tone: "neutral" }];
  }
  return [];
}

/** A un dado de baja no se le marca: no se le puede evaluar (#324). */
function evaluationTagsOf(
  translate: Translator,
  member: CoachDirectoryMember,
): readonly CardTag[] {
  return member.isEvaluated || member.status === "inactive"
    ? []
    : [{ text: translate("directory.mark.notEvaluated"), tone: "warning" }];
}

/** Lo que en la fila del Admin son puntos (#549) va aquí con su texto, y
 * además si el AUF está verificado (#274). El vencido ya lo dice su punto. */
function adminTagsOf(
  translate: Translator,
  member: AdminDirectoryMember,
): readonly CardTag[] {
  const dotTags = statusDotsOf(translate, member);
  return member.aufNumber === null
    ? dotTags
    : [...dotTags, verificationMarkOf(translate, member)];
}

/** Las etiquetas de la ficha rápida: las de todos y las de cada vista. */
export function cardTagsOf(
  translate: Translator,
  selected: SelectedMember,
): readonly CardTag[] {
  const statusTags = statusTagsOf(translate, selected.member);
  switch (selected.kind) {
    case "admin":
      return [
        ...statusTags,
        ...adminTagsOf(translate, selected.member),
        ...evaluationTagsOf(translate, selected.member),
      ];
    case "coach":
      return [...statusTags, ...evaluationTagsOf(translate, selected.member)];
    case "committee":
    case "member":
      return statusTags;
  }
}
