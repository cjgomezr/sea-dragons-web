import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import type { DirectoryMemberRecord } from "@/lib/directory/directory";
import {
  DirectoryMemberNotFoundError,
  type MemberPhotoGateways,
  readLargeMemberPhoto,
} from "@/lib/directory/member-photo";

/**
 * La foto grande de un socio (#353). Se firma sólo cuando alguien la pide, y
 * la puede pedir quien ve su miniatura en el directorio: cualquiera del club
 * si el socio está activo, y sólo un Admin si está dado de baja.
 */

const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const MEMBER_ID = "cccccccc-0000-4000-8000-00000000000c";
const OUTSIDER_ID = "eeeeeeee-0000-4000-8000-00000000000e";

const THUMBNAIL_PATH = `${MEMBER_ID}/foto-thumb.webp`;
const LARGE_PATH = `${MEMBER_ID}/foto-large.webp`;
/** Una foto subida antes de #353: un solo tamaño, sin sufijo. */
const SINGLE_SIZE_PATH = `${MEMBER_ID}/antigua.webp`;

function memberRecord(
  overrides: Partial<DirectoryMemberRecord> = {},
): DirectoryMemberRecord {
  return {
    userId: MEMBER_ID,
    fullName: "María Ñíguez",
    country: "AU",
    experienceLevel: null,
    role: "Player",
    positionId: null,
    status: "active",
    aufNumber: null,
    aufExpiry: null,
    isAufVerified: false,
    photoPath: THUMBNAIL_PATH,
    ...overrides,
  };
}

type FakeOptions = {
  readonly callerRole?: Role;
  readonly records?: readonly DirectoryMemberRecord[];
  readonly hasCaller?: boolean;
  readonly unsignable?: boolean;
};

function fakeGateways(options: FakeOptions = {}): {
  gateways: MemberPhotoGateways;
  signed: string[][];
} {
  const signed: string[][] = [];
  const gateways: MemberPhotoGateways = {
    members: {
      findRoleRequestMember: async () =>
        options.hasCaller === false
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Quien pregunta",
              role: options.callerRole ?? "Player",
            },
    },
    directory: {
      findDirectoryMembers: async () => options.records ?? [memberRecord()],
    },
    photos: {
      signPhotoUrls: async (photoPaths) => {
        signed.push([...photoPaths]);
        return options.unsignable
          ? new Map()
          : new Map(
              photoPaths.map((path) => [path, `https://signed.test/${path}`]),
            );
      },
    },
  };
  return { gateways, signed };
}

describe("la foto grande", () => {
  it("firma la versión grande de la foto de un socio del club", async () => {
    const { gateways, signed } = fakeGateways();

    const photo = await readLargeMemberPhoto(gateways, {
      callerId: CALLER_ID,
      userId: MEMBER_ID,
    });

    expect(photo).toEqual({ photoUrl: `https://signed.test/${LARGE_PATH}` });
    expect(signed).toEqual([[LARGE_PATH]]);
  });

  it("devuelve la única versión de una foto subida antes de los dos tamaños", async () => {
    const { gateways } = fakeGateways({
      records: [memberRecord({ photoPath: SINGLE_SIZE_PATH })],
    });

    const photo = await readLargeMemberPhoto(gateways, {
      callerId: CALLER_ID,
      userId: MEMBER_ID,
    });

    expect(photo).toEqual({
      photoUrl: `https://signed.test/${SINGLE_SIZE_PATH}`,
    });
  });

  it("devuelve null a quien pide la foto de un socio sin foto, sin firmar nada", async () => {
    const { gateways, signed } = fakeGateways({
      records: [memberRecord({ photoPath: null })],
    });

    const photo = await readLargeMemberPhoto(gateways, {
      callerId: CALLER_ID,
      userId: MEMBER_ID,
    });

    expect(photo).toEqual({ photoUrl: null });
    expect(signed).toEqual([]);
  });

  it("devuelve null si Storage no la pudo firmar, para que salgan las iniciales", async () => {
    const { gateways } = fakeGateways({ unsignable: true });

    const photo = await readLargeMemberPhoto(gateways, {
      callerId: CALLER_ID,
      userId: MEMBER_ID,
    });

    expect(photo).toEqual({ photoUrl: null });
  });

  it("no deja a un Player abrir la foto de un socio dado de baja", async () => {
    const { gateways, signed } = fakeGateways({
      records: [memberRecord({ status: "inactive" })],
    });

    const read = readLargeMemberPhoto(gateways, {
      callerId: CALLER_ID,
      userId: MEMBER_ID,
    });

    await expect(read).rejects.toBeInstanceOf(DirectoryMemberNotFoundError);
    expect(signed).toEqual([]);
  });

  it("deja a un Admin abrir la foto de un socio dado de baja, como en su directorio", async () => {
    const { gateways } = fakeGateways({
      callerRole: "Admin",
      records: [memberRecord({ status: "inactive" })],
    });

    const photo = await readLargeMemberPhoto(gateways, {
      callerId: CALLER_ID,
      userId: MEMBER_ID,
    });

    expect(photo).toEqual({ photoUrl: `https://signed.test/${LARGE_PATH}` });
  });

  it("no encuentra a quien no es del club de quien pregunta", async () => {
    const { gateways, signed } = fakeGateways();

    const read = readLargeMemberPhoto(gateways, {
      callerId: CALLER_ID,
      userId: OUTSIDER_ID,
    });

    await expect(read).rejects.toBeInstanceOf(DirectoryMemberNotFoundError);
    expect(signed).toEqual([]);
  });

  it("rechaza a una identidad sin fila de miembro", async () => {
    const { gateways } = fakeGateways({ hasCaller: false });

    const read = readLargeMemberPhoto(gateways, {
      callerId: CALLER_ID,
      userId: MEMBER_ID,
    });

    await expect(read).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
