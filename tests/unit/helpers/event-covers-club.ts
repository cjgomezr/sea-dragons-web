import type { RoleRequestMember } from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import type {
  EventCoverUpload,
  EventCoverUploadGateways,
  EventCoversGateway,
} from "@/lib/events/event-covers";

/**
 * Las imágenes de eventos en memoria (#644). El doble cumple el contrato del
 * adaptador: guarda los ficheros por ruta, firma sólo los que existen, en una
 * llamada por lote, y encuentra una subida por su id sea del club que sea.
 */

export const COVER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
export const COVER_OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
export const COVER_CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";

/** Otra organizadora del club, que subió una imagen. */
export const ORGANIZER_ID = "a1a1a1a1-0000-4000-8000-00000000000a";
/** Un Player del club que, cuando la subió, organizaba. */
export const PLAYER_ID = "a2a2a2a2-0000-4000-8000-00000000000a";

export const OWN_COVER_ID = "cccccccc-0000-4000-8000-000000000001";
export const ORGANIZER_COVER_ID = "cccccccc-0000-4000-8000-000000000002";
export const PLAYER_COVER_ID = "cccccccc-0000-4000-8000-000000000003";
export const FOREIGN_COVER_ID = "cccccccc-0000-4000-8000-000000000004";
/** De alguien a quien ya se le borró la ficha. */
export const ORPHAN_COVER_ID = "cccccccc-0000-4000-8000-000000000005";
export const MISSING_COVER_ID = "cccccccc-0000-4000-8000-000000000009";

export const NEW_COVER_ID = "cccccccc-0000-4000-8000-0000000000ff";
export const SHRUNK_THUMBNAIL = new Uint8Array(12);
export const SHRUNK_LARGE = new Uint8Array(345);

export const SIGNED_URL_PREFIX = "https://storage.test/signed/";

const UPLOADS: readonly EventCoverUpload[] = [
  { id: OWN_COVER_ID, clubId: COVER_CLUB_ID, uploadedBy: COVER_CALLER_ID },
  { id: ORGANIZER_COVER_ID, clubId: COVER_CLUB_ID, uploadedBy: ORGANIZER_ID },
  { id: PLAYER_COVER_ID, clubId: COVER_CLUB_ID, uploadedBy: PLAYER_ID },
  {
    id: FOREIGN_COVER_ID,
    clubId: COVER_OTHER_CLUB_ID,
    uploadedBy: COVER_CALLER_ID,
  },
  { id: ORPHAN_COVER_ID, clubId: COVER_CLUB_ID, uploadedBy: null },
];

const UPLOADERS: Readonly<Record<string, Role>> = {
  [ORGANIZER_ID]: "Admin",
  [PLAYER_ID]: "Player",
};

/** Quien subió cada imagen, si no es quien llama; si no, nadie. */
export function findCoverUploader(userId: string): RoleRequestMember | null {
  const role = UPLOADERS[userId];
  return role === undefined
    ? null
    : { clubId: COVER_CLUB_ID, fullName: "Quien subió", role };
}

export type FakeEventCovers = {
  readonly gateway: EventCoversGateway;
  /** Los ficheros guardados, por ruta. */
  readonly files: Map<string, Uint8Array>;
  /** Las filas guardadas al subir. */
  readonly inserted: EventCoverUpload[];
  /** Las rutas de cada llamada a firmar, en orden. */
  readonly signCalls: (readonly string[])[];
};

export type FakeEventCoversOptions = {
  /** Rutas que Storage tiene, además de las que se suban. */
  readonly storedPaths?: readonly string[];
  readonly failInsert?: boolean;
};

export function fakeEventCovers(
  options: FakeEventCoversOptions = {},
): FakeEventCovers {
  const files = new Map<string, Uint8Array>(
    (options.storedPaths ?? []).map((path) => [path, new Uint8Array(1)]),
  );
  const inserted: EventCoverUpload[] = [];
  const signCalls: (readonly string[])[] = [];
  const gateway: EventCoversGateway = {
    upload: async ({ storagePath, bytes }) => {
      files.set(storagePath, bytes);
    },
    removeFiles: async (storagePaths) => {
      storagePaths.forEach((path) => files.delete(path));
    },
    signUrls: async (storagePaths) => {
      signCalls.push(storagePaths);
      return new Map(
        storagePaths
          .filter((path) => files.has(path))
          .map((path) => [path, `${SIGNED_URL_PREFIX}${path}`]),
      );
    },
    insertCover: async (cover) => {
      if (options.failInsert === true) {
        throw new Error("la fila de la imagen no se pudo guardar");
      }
      inserted.push(cover);
    },
    findCover: async (coverId) =>
      [...UPLOADS, ...inserted].find((cover) => cover.id === coverId) ?? null,
  };
  return { gateway, files, inserted, signCalls };
}

export type FakeCoverUploadOptions = FakeEventCoversOptions & {
  readonly callerRole?: Role;
  readonly undecodable?: boolean;
};

export type FakeCoverUploadClub = FakeEventCovers & {
  readonly gateways: EventCoverUploadGateways;
};

export function fakeCoverUploadClub(
  options: FakeCoverUploadOptions = {},
): FakeCoverUploadClub {
  const covers = fakeEventCovers(options);
  return {
    ...covers,
    gateways: {
      members: {
        findRoleRequestMember: async () => ({
          clubId: COVER_CLUB_ID,
          fullName: "Quien organiza",
          role: options.callerRole ?? "Committee",
        }),
      },
      eventCovers: covers.gateway,
      images: {
        shrinkCover: async () =>
          options.undecodable === true
            ? { kind: "undecodable" }
            : {
                kind: "shrunk",
                thumbnail: SHRUNK_THUMBNAIL,
                large: SHRUNK_LARGE,
              },
      },
      newFileId: () => NEW_COVER_ID,
    },
  };
}
