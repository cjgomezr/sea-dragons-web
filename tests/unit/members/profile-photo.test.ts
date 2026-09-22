import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import {
  AccountNotOperatingError,
  PROFILE_PHOTO_MAX_BYTES,
  type ProfilePhotoGateways,
  ProfilePhotoValidationError,
  detectProfilePhotoType,
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

type FakeState = {
  owner: Owner;
  readonly stored: Set<string>;
  readonly savedPaths: (string | null)[];
  failUpload: boolean;
  failSave: boolean;
};

function fakeGateways(owner: Owner): {
  gateways: ProfilePhotoGateways;
  state: FakeState;
} {
  const state: FakeState = {
    owner,
    stored: new Set(owner?.photoPath ? [owner.photoPath] : []),
    savedPaths: [],
    failUpload: false,
    failSave: false,
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
      async upload(path) {
        if (state.failUpload) {
          throw new Error("conexión caída");
        }
        state.stored.add(path);
      },
      async remove(path) {
        state.stored.delete(path);
      },
    },
    signing: {
      async signPhotoUrl(path) {
        return `https://storage.test/signed/${path}?token=t`;
      },
    },
    newFileId: () => NEW_FILE_ID,
  };
  return { gateways, state };
}

const ACTIVE_WITHOUT_PHOTO: Owner = { status: "active", photoPath: null };
const OLD_PATH = `${USER_ID}/viejo.png`;
const ACTIVE_WITH_PHOTO: Owner = { status: "active", photoPath: OLD_PATH };

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
    it("guarda la foto en la carpeta del miembro, con un nombre que no dice nada de él", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITHOUT_PHOTO);

      const photo = await replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      const expectedPath = `${USER_ID}/${NEW_FILE_ID}.png`;
      expect([...state.stored]).toEqual([expectedPath]);
      expect(state.savedPaths).toEqual([expectedPath]);
      expect(photo.photoUrl).toBe(
        `https://storage.test/signed/${expectedPath}?token=t`,
      );
    });

    it("usa la extensión del tipo que dicen los bytes", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITHOUT_PHOTO);

      await replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: JPEG_BYTES,
      });

      expect(state.savedPaths).toEqual([`${USER_ID}/${NEW_FILE_ID}.jpg`]);
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
    it("sustituye la foto anterior y la borra del almacenamiento", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITH_PHOTO);

      await replaceProfilePhoto(gateways, {
        userId: USER_ID,
        bytes: PNG_BYTES,
      });

      expect([...state.stored]).toEqual([`${USER_ID}/${NEW_FILE_ID}.png`]);
    });

    it("conserva la foto anterior si la subida falla a mitad", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITH_PHOTO);
      state.failUpload = true;

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

  describe("borrado", () => {
    it("deja la ficha sin foto y borra el fichero", async () => {
      const { gateways, state } = fakeGateways(ACTIVE_WITH_PHOTO);

      await removeProfilePhoto(gateways, USER_ID);

      expect(state.savedPaths).toEqual([null]);
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
