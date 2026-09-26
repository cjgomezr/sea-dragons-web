import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  type ProfilePhoto,
  largePhotoPathOf,
} from "@/lib/members/profile-photo";
import { type DirectoryGateways, canSeeInDirectory } from "./directory";

/**
 * La foto grande de un socio (#353), la que se abre al tocar su miniatura.
 *
 * La puede pedir quien ve esa miniatura en el directorio, y con la misma
 * regla: cualquiera de su club si el socio no está dado de baja, y un Admin
 * también si lo está. Se firma sólo cuando se pide, para que la lista del
 * club no descargue nunca las grandes.
 */

export type MemberPhotoGateways = Pick<
  DirectoryGateways,
  "members" | "directory" | "photos"
>;

/** El socio no está en el directorio de quien pregunta: no existe, es de otro
 * club, o está dado de baja y quien pregunta no es Admin. Los tres casos se
 * responden igual para no decir cuál es. */
export class DirectoryMemberNotFoundError extends Error {
  constructor() {
    super("Ese socio no está en el directorio del club.");
    this.name = "DirectoryMemberNotFoundError";
  }
}

export type MemberPhotoRequest = {
  readonly callerId: string;
  /** El `user_id` del socio cuya foto se pide. */
  readonly userId: string;
};

export async function readLargeMemberPhoto(
  gateways: MemberPhotoGateways,
  request: MemberPhotoRequest,
): Promise<ProfilePhoto> {
  const caller = await gateways.members.findRoleRequestMember(request.callerId);
  if (caller === null) {
    throw new MemberNotFoundError(request.callerId);
  }
  // El club tiene decenas de socios: leerlo entero es lo que garantiza que
  // la regla sea la del directorio y no una copia que se desvíe.
  const records = await gateways.directory.findDirectoryMembers(caller.clubId);
  const member = records.find((record) => record.userId === request.userId);
  if (member === undefined || !canSeeInDirectory(member, caller.role)) {
    throw new DirectoryMemberNotFoundError();
  }
  if (member.photoPath === null) {
    return { photoUrl: null };
  }
  const largePath = largePhotoPathOf(member.photoPath);
  const signed = await gateways.photos.signPhotoUrls([largePath]);
  return { photoUrl: signed.get(largePath) ?? null };
}
