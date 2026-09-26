import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import {
  AccountNotOperatingError,
  PROFILE_PHOTO_MAX_BYTES,
  type ProfilePhotoGateways,
  ProfilePhotoValidationError,
  detectProfilePhotoType,
  largePhotoPathOf,
  readProfilePhoto,
  removeProfilePhoto,
  replaceProfilePhoto,
  validateProfilePhotoFile,
} from "@/lib/members/profile-photo";

const USER_ID = "4c1f2a9e-0000-4000-8000-000000000001";
const NEW_FILE_ID = "9b2e7d10-0000-4000-8000-0000000000aa";

const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const WEBP_BYTES = Uint8Array.from([
  ...Buffer.from("RIFF"),
  0x24,
  0x00,
  0x00,
  0x00,
  ...Buffer.from("WEBPVP8 "),
]);
const GIF_BYTES = Uint8Array.from(Buffer.from("GIF89a......"));

type Owner = { status: AccountStatus; photoPath: string | null } | null;

/** Lo que devuelve el reductor de mentira: bytes que no se parecen a ninguno
 * de los que se suben, para ver cuáles llegan al almacenamiento. */
const THUMBNAIL_BYTES = Uint8Array.from([0x54, 0x48, 0x55, 0x4d, 0x42]);
const LARGE_BYTES = Uint8Array.from([0x4c, 0x41, 0x52, 0x47, 0x45]);

type FakeState = {
  owner: Owner;
  readonly stored: Set<string>;
  readonly uploads: { path: string; bytes: Uint8Array; type: string }[];
  readonly savedPaths: (string | null)[];
  failUpload: (path: string) => boolean;
  failSave: boolean;
  isUndecodable: boolean;
};

function fakeGateways(
  owner: Owner,
  storedFiles: readonly string[] = owner?.photoPath ? [owner.photoPath] : [],
): {
  gateways: ProfilePhotoGateways;
  state: FakeState;
} {
  const state: FakeState = {
    owner,
    stored: new Set(storedFiles),
    uploads: [],
    savedPaths: [],
    failUpload: () => false,
    failSave: false,
    isUndecodable: false,
  };
  const gateways: ProfilePhotoGateways = {
    members: {
      async findPhotoOwner() {
        return state.owner;
      },
      async savePhotoPath(_userId, path) {
        if (state.failSave) {
          throw new Error("la base no respondió");
        }
        state.savedPaths.push(path);
      },
    },
    storage: {
      async upload(path, bytes, type) {
        if (state.failUpload(path)) {
          throw new Error("conexión caída");
        }
        state.stored.add(path);
        state.uploads.push({ path, bytes, type });
      },
      async remove(paths) {
        paths.forEach((path) => state.stored.delete(path));
      },
    },
    signing: {
      async signPhotoUrl(path) {
        return `https://storage.test/signed/${path}?token=t`;
      },
    },
    images: {
      async shrinkPhoto() {
        return state.isUndecodable
          ? { kind: "undecodable" }
          : {
              kind: "shrunk",
              thumbnail: { bytes: THUMBNAIL_BYTES, type: "image/webp" },
              large: { bytes: LARGE_BYTES, type: "image/webp" },
            };
      },
    },
    newFileId: () => NEW_FILE_ID,
  };
  return { gateways, state };
}

const ACTIVE_WITHOUT_PHOTO: Owner = { status: "active", photoPath: null };
/** Una foto de antes de #353: un solo tamaño, sin sufijo. */
const OLD_PATH = `${USER_ID}/viejo.png`;
const ACTIVE_WITH_PHOTO: Owner = { status: "active", photoPath: OLD_PATH };
const OLD_THUMBNAIL_PATH = `${USER_ID}/viejo-thumb.webp`;
const OLD_LARGE_PATH = `${USER_ID}/viejo-large.webp`;
const ACTIVE_WITH_TWO_SIZES: Owner = {
  status: "active",
  photoPath: OLD_THUMBNAIL_PATH,
};
const THUMBNAIL_PATH = `${USER_ID}/${NEW_FILE_ID}-thumb.webp`;
const LARGE_PATH = `${USER_ID}/${NEW_FILE_ID}-large.webp`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("foto de perfil", () => {
  describe("formato admitido", () => {
    it.each([
      ["JPEG", JPEG_BYTES, "image/jpeg"],
      ["PNG", PNG_BYTES, "image/png"],
      ["WebP", WEBP_BYTES, "image/webp"],
    ])("reconoce un %s por sus bytes", (_name, bytes, type) => {
      expect(detectProfilePhotoType(bytes)).toBe(type);
    });

    it("no reconoce un GIF aunque sea una imagen", () => {
      expect(detectProfilePhotoType(GIF_BYTES)).toBeNull();
    });

    it("no reconoce un RIFF que no es WebP", () => {
      const wav = Uint8Array.from([
        ...Buffer.from("RIFF"),
        0,
        0,
        0,
        0,
        ...Buffer.from("WAVE"),
      ]);

      expect(detectProfilePhotoType(wav)).toBeNull();
    });
  });

  describe("comprobación previa en la pantalla", () => {
    it("acepta una foto admitida justo en el límite", () => {
      expect(
        validateProfilePhotoFile({
          type: "image/webp",
          size: PROFILE_PHOTO_MAX_BYTES,
        }),
      ).toBeNull();
    });

    it("avisa de una foto de más de 2 MB antes de subirla", () => {
      expect(
        validateProfilePhotoFile({
          type: "image/jpeg",
          size: PROFILE_PHOTO_MAX_BYTES + 1,
        }),
      ).toBe("photo_too_large");
    });

    it("avisa de un tipo que no es JPEG, PNG ni WebP", () => {
      expect(validateProfilePhotoFile({ type: "image/gif", size: 1_000 })).toBe(
        "photo_type_unsupported",
      );
    });

    it("avisa de un fichero vacío", () => {
      expect(validateProfilePhotoFile({ type: "image/png", size: 0 })).toBe(
        "photo_empty",
      );
    });
  });

  describe("subir", () => {
    it("guarda las dos versiones en la carpeta del miembro, con un nombre que no dice nada de él", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITHOUT_PHOTO);

      await replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      expect([...state.stored].sort()).toEqual([LARGE_PATH, THUMBNAIL_PATH]);
    });

    it("guarda las dos versiones reducidas y no la que se subió", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITHOUT_PHOTO);

      await replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: JPEG_BYTES,
      });

      expect(state.uploads).toHaveLength(2);
      expect(state.uploads).toEqual(
        expect.arrayContaining([
          { path: THUMBNAIL_PATH, bytes: THUMBNAIL_BYTES, type: "image/webp" },
          { path: LARGE_PATH, bytes: LARGE_BYTES, type: "image/webp" },
        ]),
      );
    });

    it("apunta en la ficha la miniatura y responde con su dirección firmada", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITHOUT_PHOTO);

      const photo = await replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: JPEG_BYTES,
      });

      expect(state.savedPaths).toEqual([THUMBNAIL_PATH]);
      expect(photo.photoUrl).toBe(
        `https://storage.test/signed/${THUMBNAIL_PATH}?token=t`,
      );
    });

    it("no deja ninguna versión si falla la subida de una de las dos", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITHOUT_PHOTO);
      state.failUpload = (path) => path === LARGE_PATH;

      const upload = replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      await expect(upload).rejects.toThrow("conexión caída");
      expect(state.stored.size).toBe(0);
      expect(state.savedPaths).toEqual([]);
    });

    it("rechaza como formato no admitido lo que no se puede decodificar, sin subir nada", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITHOUT_PHOTO);
      state.isUndecodable = true;

      const upload = replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      await expect(upload).rejects.toMatchObject({
        name: ProfilePhotoValidationError.name,
        code: "photo_type_unsupported",
      });
      expect(state.stored.size).toBe(0);
      expect(state.savedPaths).toEqual([]);
    });

    it("rechaza un formato no admitido sin subir nada", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITHOUT_PHOTO);

      const upload = replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: GIF_BYTES,
      });

      await expect(upload).rejects.toMatchObject({
        name: ProfilePhotoValidationError.name,
        code: "photo_type_unsupported",
      });
      expect(state.stored.size).toBe(0);
    });

    it("rechaza una foto de más de 2 MB sin subir nada", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITHOUT_PHOTO);
      const tooLarge = new Uint8Array(PROFILE_PHOTO_MAX_BYTES + 1);
      tooLarge.set(PNG_BYTES);

      const upload = replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: tooLarge,
      });

      await expect(upload).rejects.toMatchObject({ code: "photo_too_large" });
      expect(state.stored.size).toBe(0);
    });

    it("rechaza un fichero vacío", async () => {
      const { gateways } = fakeGateways(ACTIVE_WITHOUT_PHOTO);

      const upload = replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: new Uint8Array(0),
      });

      await expect(upload).rejects.toMatchObject({ code: "photo_empty" });
    });
  });

  describe("reemplazo", () => {
    it("sustituye una foto de dos tamaños y borra las dos versiones viejas", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITH_TWO_SIZES, [
        OLD_THUMBNAIL_PATH,
        OLD_LARGE_PATH,
      ]);

      await replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      expect([...state.stored].sort()).toEqual([LARGE_PATH, THUMBNAIL_PATH]);
    });

    it("sustituye una foto de antes, de un solo tamaño, y la borra", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITH_PHOTO);

      await replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      expect([...state.stored].sort()).toEqual([LARGE_PATH, THUMBNAIL_PATH]);
    });

    it("conserva la foto anterior si la subida falla a mitad", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITH_PHOTO);
      state.failUpload = () => true;

      const upload = replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      await expect(upload).rejects.toThrow("conexión caída");
      expect([...state.stored]).toEqual([OLD_PATH]);
      expect(state.savedPaths).toEqual([]);
    });

    it("no deja la foto nueva huérfana si no se pudo apuntar en la ficha", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITH_PHOTO);
      state.failSave = true;

      const upload = replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      await expect(upload).rejects.toThrow("la base no respondió");
      expect([...state.stored]).toEqual([OLD_PATH]);
    });
  });

  describe("limpieza de la foto anterior", () => {
    it("da el reemplazo por hecho aunque la foto anterior no se pueda borrar", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITH_PHOTO);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const failingRemove: ProfilePhotoGateways = {
        ...gateways,
        storage: {
          ...gateways.storage,
          remove: async (paths) => {
            if (paths.includes(OLD_PATH)) {
              throw new Error("Storage no respondió");
            }
            await gateways.storage.remove(paths);
          },
        },
      };

      const photo = await replaceProfilePhoto(failingRemove, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      expect(photo.photoUrl).toContain(THUMBNAIL_PATH);
      expect(state.savedPaths).toEqual([THUMBNAIL_PATH]);
      expect(errors).toHaveBeenCalledWith(
        expect.stringContaining(OLD_PATH),
        expect.any(Error),
      );
    });
  });

  describe("una foto que no se puede firmar", () => {
    it("se lee como sin foto, para que salgan las iniciales", async () => {
      const { gateways } = fakeGateways(ACTIVE_WITH_PHOTO);
      const unsigned: ProfilePhotoGateways = {
        ...gateways,
        signing: { signPhotoUrl: async () => null },
      };

      await expect(readProfilePhoto(unsigned, USER_ID)).resolves.toEqual({
        photoUrl: null,
      });
    });
  });

  describe("borrado", () => {
    it("deja la ficha sin foto y borra el fichero", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITH_PHOTO);

      await removeProfilePhoto(gateways, USER_ID);

      expect(state.savedPaths).toEqual([null]);
      expect(state.stored.size).toBe(0);
    });

    it("borra las dos versiones de una foto de dos tamaños", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITH_TWO_SIZES, [
        OLD_THUMBNAIL_PATH,
        OLD_LARGE_PATH,
      ]);

      await removeProfilePhoto(gateways, USER_ID);

      expect(state.stored.size).toBe(0);
    });

    it("no hace nada si el miembro no tenía foto", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITHOUT_PHOTO);

      await removeProfilePhoto(gateways, USER_ID);

      expect(state.savedPaths).toEqual([]);
    });
  });

  describe("lectura", () => {
    it("sirve la foto firmada de quien tiene una", async () => {
      const { gateways } = fakeGateways(ACTIVE_WITH_PHOTO);

      await expect(readProfilePhoto(gateways, USER_ID)).resolves.toEqual({
        photoUrl: `https://storage.test/signed/${OLD_PATH}?token=t`,
      });
    });

    it("sirve null a quien no tiene foto, para que salgan sus iniciales", async () => {
      const { gateways } = fakeGateways(ACTIVE_WITHOUT_PHOTO);

      await expect(readProfilePhoto(gateways, USER_ID)).resolves.toEqual({
        photoUrl: null,
      });
    });

    it("rechaza a una identidad sin fila de miembro", async () => {
      const { gateways } = fakeGateways(null);

      await expect(readProfilePhoto(gateways, USER_ID)).rejects.toBeInstanceOf(
        MemberNotFoundError,
      );
    });
  });

  describe("la ruta de la versión grande", () => {
    it("es la de la miniatura con el sufijo de la grande", () => {
      expect(largePhotoPathOf(OLD_THUMBNAIL_PATH)).toBe(OLD_LARGE_PATH);
    });

    it("es la misma ruta en una foto de antes, que sólo tiene un tamaño", () => {
      expect(largePhotoPathOf(OLD_PATH)).toBe(OLD_PATH);
    });

    it("no confunde un sufijo que no está al final del nombre", () => {
      const path = `${USER_ID}/a-thumb-b.webp`;

      expect(largePhotoPathOf(path)).toBe(path);
    });
  });

  describe("cuenta que no opera", () => {
    it.each(["inactive", "incomplete"] as const)(
      "no deja subir a una cuenta %s",
      async (status) => {
        const { gateways, state } = fakeGateways({ status, photoPath: null });

        const upload = replaceProfilePhoto(gateways, {
          userId: USER_ID,
          bytes: PNG_BYTES,
        });

        await expect(upload).rejects.toBeInstanceOf(AccountNotOperatingError);
        expect(state.stored.size).toBe(0);
      },
    );

    it("no deja borrar a una cuenta dada de baja", async () => {
      const { gateways, state } = fakeGateways({
        status: "inactive",
        photoPath: OLD_PATH,
      });

      await expect(
        removeProfilePhoto(gateways, USER_ID),
      ).rejects.toBeInstanceOf(AccountNotOperatingError);
      expect([...state.stored]).toEqual([OLD_PATH]);
    });

    it("rechaza a una identidad sin fila de miembro", async () => {
      const { gateways } = fakeGateways(null);

      const upload = replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      await expect(upload).rejects.toBeInstanceOf(MemberNotFoundError);
    });
  });
});
