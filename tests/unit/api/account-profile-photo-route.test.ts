import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import { ACCOUNT_PROFILE_PHOTO_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import {
  PROFILE_PHOTO_MAX_BYTES,
  type ProfilePhotoGateways,
} from "@/lib/members/profile-photo";
import {
  PROFILE_PHOTO_LARGE_SIDE_PX,
  PROFILE_PHOTO_THUMBNAIL_SIDE_PX,
  shrinkProfilePhoto,
} from "@/lib/members/shrink-profile-photo";

/**
 * La foto de perfil por la API (#245, FR-084). Actúa siempre sobre quien
 * identifica la cookie. La petición entra por el proxy y sólo llega al
 * handler si la frontera la deja seguir, como en producción.
 */

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const OTHER_USER_ID = "1b2c3d4e-5f60-4a3b-9c8d-000000000002";
const FILE_ID = "5e6f7a8b-0000-4000-8000-0000000000ff";
const THUMBNAIL_PATH = `${USER_ID}/${FILE_ID}-thumb.webp`;
const LARGE_PATH = `${USER_ID}/${FILE_ID}-large.webp`;
const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";

const FIXTURES_DIR = path.resolve(__dirname, "../../support/fixtures");

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES_DIR, name)));
}

const PNG_BYTES = fixture("foto-de-perfil.png");
const LARGE_PHOTO_BYTES = fixture("foto-apaisada-3000x2000.jpg");
const CORRUPT_PNG_BYTES = fixture("foto-corrupta.png");
const GIF_BYTES = Uint8Array.from(Buffer.from("GIF89a......"));

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();

type Store = {
  status: AccountStatus;
  photoPath: string | null;
  readonly uploadedBy: string[];
  readonly files: Set<string>;
  readonly uploadedBytes: Map<string, Uint8Array>;
};

let store: Store;

function fakeGateways(): ProfilePhotoGateways {
  return {
    members: {
      async findPhotoOwner(userId) {
        store.uploadedBy.push(userId);
        return { status: store.status, photoPath: store.photoPath };
      },
      async savePhotoPath(_userId, photoPath) {
        store.photoPath = photoPath;
      },
    },
    storage: {
      async upload(photoPath, bytes) {
        store.files.add(photoPath);
        store.uploadedBytes.set(photoPath, bytes);
      },
      async remove(photoPaths) {
        photoPaths.forEach((photoPath) => store.files.delete(photoPath));
      },
    },
    signing: {
      async signPhotoUrl(photoPath) {
        return `https://storage.test/${photoPath}?token=t`;
      },
    },
    images: { shrinkPhoto: shrinkProfilePhoto },
    newFileId: () => FILE_ID,
  };
}

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: (...args: unknown[]) =>
    readAuthenticatedUserId(...args),
}));

vi.mock("@/lib/members/supabase-profile-photo-gateways", () => ({
  createSupabaseProfilePhotoGateways: () => ({
    kind: "ready",
    gateways: fakeGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const { PUT, DELETE, GET } =
  await import("@/app/api/v1/account/profile/photo/route");

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

type Method = "PUT" | "DELETE";

async function throughBoundary(
  method: Method,
  options: { body?: Uint8Array; search?: string } = {},
): Promise<Response> {
  const url = new URL(
    `${ACCOUNT_PROFILE_PHOTO_API_PATH}${options.search ?? ""}`,
    ORIGIN,
  );
  const request = new NextRequest(url, {
    method,
    headers: { "content-type": "application/octet-stream" },
    body: options.body === undefined ? undefined : Buffer.from(options.body),
  });
  const boundaryResponse = await proxy(request);
  if (boundaryResponse.headers.get(CONTINUE_HEADER) !== "1") {
    return boundaryResponse;
  }
  return method === "PUT" ? PUT(request) : DELETE(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  givenSession({ kind: "active", role: "Player" });
  readAuthenticatedUserId.mockResolvedValue(USER_ID);
  store = {
    status: "active",
    photoPath: null,
    uploadedBy: [],
    files: new Set(),
    uploadedBytes: new Map(),
  };
});

describe("endpoints de la foto", () => {
  describe("PUT: subir y reemplazar", () => {
    it("responde 200 con la dirección firmada de la foto nueva", async () => {
      const response = await throughBoundary("PUT", { body: PNG_BYTES });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          photoUrl: `https://storage.test/${THUMBNAIL_PATH}?token=t`,
        },
      });
    });

    it("sube a la carpeta de quien identifica la cookie", async () => {
      await throughBoundary("PUT", { body: PNG_BYTES });

      expect(store.uploadedBy).toEqual([USER_ID]);
      expect([...store.files].sort()).toEqual([LARGE_PATH, THUMBNAIL_PATH]);
    });

    it("reemplaza la anterior sin dejarla en el almacenamiento", async () => {
      const oldPath = `${USER_ID}/viejo.webp`;
      store.photoPath = oldPath;
      store.files.add(oldPath);

      const response = await throughBoundary("PUT", { body: PNG_BYTES });

      expect(response.status).toBe(200);
      expect([...store.files].sort()).toEqual([LARGE_PATH, THUMBNAIL_PATH]);
    });

    it.each([
      ["miniatura", THUMBNAIL_PATH, PROFILE_PHOTO_THUMBNAIL_SIDE_PX],
      ["grande", LARGE_PATH, PROFILE_PHOTO_LARGE_SIDE_PX],
    ])(
      "sube al almacenamiento la %s reducida, no la original",
      async (_name, photoPath, side) => {
        const response = await throughBoundary("PUT", {
          body: LARGE_PHOTO_BYTES,
        });

        expect(response.status).toBe(200);
        const uploaded = store.uploadedBytes.get(photoPath) ?? new Uint8Array();
        expect(uploaded.length).toBeLessThan(LARGE_PHOTO_BYTES.length);
        const { format, width } = await sharp(uploaded).metadata();
        expect({ format, width }).toEqual({ format: "webp", width: side });
      },
    );

    it("apunta la ficha a la miniatura", async () => {
      await throughBoundary("PUT", { body: PNG_BYTES });

      expect(store.photoPath).toBe(THUMBNAIL_PATH);
    });

    it("rechaza con el mismo 400 de formato un fichero que no se puede decodificar", async () => {
      const response = await throughBoundary("PUT", {
        body: CORRUPT_PNG_BYTES,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.reason).toBe("photo_type_unsupported");
      expect(body.error.message).toMatch(/JPEG, PNG o WebP/);
      expect(store.files.size).toBe(0);
    });

    it("rechaza con 400 un formato no admitido y dice cuáles valen", async () => {
      const response = await throughBoundary("PUT", { body: GIF_BYTES });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.reason).toBe("photo_type_unsupported");
      expect(body.error.message).toMatch(/JPEG, PNG o WebP/);
      expect(store.files.size).toBe(0);
    });

    it("rechaza con 400 una foto de más de 2 MB y dice el límite", async () => {
      const tooLarge = new Uint8Array(PROFILE_PHOTO_MAX_BYTES + 1);
      tooLarge.set(PNG_BYTES);

      const response = await throughBoundary("PUT", { body: tooLarge });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.reason).toBe("photo_too_large");
      expect(body.error.message).toMatch(/2 MB/);
      expect(store.files.size).toBe(0);
    });

    it("rechaza con 400 una petición sin foto", async () => {
      const response = await throughBoundary("PUT");

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { reason: "photo_empty" },
      });
    });

    it("responde 403 a quien intenta subir la foto de otra persona", async () => {
      const response = await throughBoundary("PUT", {
        body: PNG_BYTES,
        search: `?userId=${OTHER_USER_ID}`,
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { reason: "not_own_photo" },
      });
      expect(store.files.size).toBe(0);
    });

    it("responde 403 a una cuenta que ya no opera aunque la frontera la dejara pasar", async () => {
      store.status = "inactive";

      const response = await throughBoundary("PUT", { body: PNG_BYTES });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { reason: "account_not_operating" },
      });
      expect(store.files.size).toBe(0);
    });
  });

  describe("DELETE: borrar", () => {
    it("responde 204 y deja la ficha sin foto ni fichero", async () => {
      const oldPath = `${USER_ID}/viejo.webp`;
      store.photoPath = oldPath;
      store.files.add(oldPath);

      const response = await throughBoundary("DELETE");

      expect(response.status).toBe(204);
      expect(store.photoPath).toBeNull();
      expect(store.files.size).toBe(0);
    });

    it("responde 403 a quien intenta borrar la foto de otra persona", async () => {
      const otherPath = `${OTHER_USER_ID}/suya.webp`;
      store.files.add(otherPath);

      const response = await throughBoundary("DELETE", {
        search: `?userId=${OTHER_USER_ID}`,
      });

      expect(response.status).toBe(403);
      expect([...store.files]).toEqual([otherPath]);
    });
  });

  describe("fronteras", () => {
    it.each(["PUT", "DELETE"] as const)(
      "%s sin sesión responde 401",
      async (method) => {
        givenSession({ kind: "anonymous" });

        const response = await throughBoundary(method, { body: PNG_BYTES });

        expect(response.status).toBe(401);
      },
    );

    it.each(["PUT", "DELETE"] as const)(
      "%s de una cuenta incompleta responde 403 sin llegar al handler",
      async (method) => {
        givenSession({ kind: "incomplete" });

        const response = await throughBoundary(method, { body: PNG_BYTES });

        expect(response.status).toBe(403);
        expect(store.uploadedBy).toEqual([]);
      },
    );

    it("GET responde 405", async () => {
      const response = await GET(
        new NextRequest(new URL(ACCOUNT_PROFILE_PHOTO_API_PATH, ORIGIN)),
      );

      expect(response.status).toBe(405);
    });
  });
});
