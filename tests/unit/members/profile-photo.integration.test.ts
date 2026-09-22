import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import {
  removeProfilePhoto,
  replaceProfilePhoto,
} from "@/lib/members/profile-photo";
import { PROFILE_PHOTO_MAX_SIDE_PX } from "@/lib/members/shrink-profile-photo";
import {
  PROFILE_PHOTO_BUCKET,
  createProfilePhotoGateways,
} from "@/lib/members/supabase-profile-photo-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * La foto de perfil contra `seadragons-dev` con los adaptadores de verdad
 * (#245). Lo que ningún doble puede decir: que el bucket y las policies de
 * `0018_member_photos.sql` dejan al dueño subir y borrar en su carpeta, que
 * la dirección firmada sirve la foto, que el reemplazo no deja huérfanos, y
 * que la sesión de otro miembro no toca esa carpeta ni atacando Storage
 * directamente.
 *
 * Cada caso borra al terminar lo que quede en las carpetas que usó: la
 * cascada de `members` no alcanza a Storage.
 */

const FIXTURES_DIR = path.resolve(__dirname, "../../support/fixtures");

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES_DIR, name)));
}

/** Un PNG de 128 × 128 de verdad: desde #271 el servidor lo decodifica para
 * reducirlo, así que no vale cualquier cabecera. */
const PNG_BYTES = fixture("foto-de-perfil.png");
const PNG_SIDE_PX = 128;
const LARGE_PHOTO_BYTES = fixture("foto-apaisada-3000x2000.jpg");
const MAX_STORED_BYTES = 100 * 1024;

async function seedActiveMember(
  serviceClient: ServiceRoleClient,
  user: TestUser,
): Promise<void> {
  const { data: club, error: clubError } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", DEFAULT_CLUB_SLUG)
    .single();
  if (clubError) {
    throw new Error(`No se pudo leer el club sembrado: ${clubError.message}`);
  }
  const { error } = await serviceClient.client.from("members").insert({
    club_id: club.id,
    user_id: user.id,
    full_name: "Socia con foto",
    email: user.email,
    country: "AU",
    account_status: "active",
  });
  if (error) {
    throw new Error(`No se pudo sembrar la socia: ${error.message}`);
  }
}

async function listFolder(
  serviceClient: ServiceRoleClient,
  userId: string,
): Promise<readonly string[]> {
  const { data, error } = await serviceClient.client.storage
    .from(PROFILE_PHOTO_BUCKET)
    .list(userId);
  if (error) {
    throw new Error(`No se pudo listar la carpeta: ${error.message}`);
  }
  return data.map((file) => `${userId}/${file.name}`);
}

async function emptyFolder(
  serviceClient: ServiceRoleClient,
  userId: string,
): Promise<void> {
  const files = await listFolder(serviceClient, userId);
  if (files.length === 0) {
    return;
  }
  const { error } = await serviceClient.client.storage
    .from(PROFILE_PHOTO_BUCKET)
    .remove([...files]);
  if (error) {
    throw new Error(`No se pudo limpiar la carpeta: ${error.message}`);
  }
}

/** Una socia activa con su sesión abierta, y su carpeta vacía al terminar. */
async function withPhotoOwner<T>(
  serviceClient: ServiceRoleClient,
  run: (member: {
    readonly user: TestUser;
    readonly sessionClient: Awaited<ReturnType<typeof createRlsClient>>;
  }) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, async (user) => {
    await seedActiveMember(serviceClient, user);
    const sessionClient = await createRlsClient(
      { role: "authenticated", email: user.email, password: user.password },
      process.env,
    );
    try {
      return await run({ user, sessionClient });
    } finally {
      await emptyFolder(serviceClient, user.id);
    }
  });
}

describeRls("foto de perfil contra seadragons-dev", () => {
  it(
    "sube, sirve por dirección firmada, reemplaza sin huérfanos y borra",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withPhotoOwner(serviceClient, async ({ user, sessionClient }) => {
        const gateways = createProfilePhotoGateways({
          sessionClient: sessionClient.client,
          serviceClient: serviceClient.client,
        });

        const first = await replaceProfilePhoto(gateways, {
          userId: user.id,
          bytes: PNG_BYTES,
        });
        expect(first.photoUrl).not.toContain(user.email);
        const served = await fetch(first.photoUrl ?? "");
        expect(served.status).toBe(200);
        const servedPhoto = await sharp(
          new Uint8Array(await served.arrayBuffer()),
        ).metadata();
        expect(servedPhoto).toMatchObject({
          format: "webp",
          width: PNG_SIDE_PX,
        });

        await replaceProfilePhoto(gateways, {
          userId: user.id,
          bytes: PNG_BYTES,
        });
        const afterReplace = await listFolder(serviceClient, user.id);
        expect(afterReplace).toHaveLength(1);
        const { data: row } = await serviceClient.client
          .from("members")
          .select("photo_path")
          .eq("user_id", user.id)
          .single();
        expect(row).toEqual({ photo_path: afterReplace[0] });

        await removeProfilePhoto(gateways, user.id);
        await expect(listFolder(serviceClient, user.id)).resolves.toEqual([]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "una foto grande queda en el bucket reducida, en WebP y por debajo de 100 KB",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withPhotoOwner(serviceClient, async ({ user, sessionClient }) => {
        const gateways = createProfilePhotoGateways({
          sessionClient: sessionClient.client,
          serviceClient: serviceClient.client,
        });

        await replaceProfilePhoto(gateways, {
          userId: user.id,
          bytes: LARGE_PHOTO_BYTES,
        });

        const [storedPath = ""] = await listFolder(serviceClient, user.id);
        expect(storedPath).toMatch(/\.webp$/);
        const { data, error } = await serviceClient.client.storage
          .from(PROFILE_PHOTO_BUCKET)
          .download(storedPath);
        if (error) {
          throw new Error(`No se pudo bajar la foto: ${error.message}`);
        }
        const stored = new Uint8Array(await data.arrayBuffer());
        expect(stored.length).toBeLessThan(MAX_STORED_BYTES);
        await expect(sharp(stored).metadata()).resolves.toMatchObject({
          format: "webp",
          width: PROFILE_PHOTO_MAX_SIDE_PX,
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "la sesión de otro miembro no sube, no lee ni borra en esa carpeta",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withPhotoOwner(serviceClient, async (owner) => {
        const ownerGateways = createProfilePhotoGateways({
          sessionClient: owner.sessionClient.client,
          serviceClient: serviceClient.client,
        });
        await replaceProfilePhoto(ownerGateways, {
          userId: owner.user.id,
          bytes: PNG_BYTES,
        });
        const [ownerPhoto] = await listFolder(serviceClient, owner.user.id);

        await withPhotoOwner(serviceClient, async (intruder) => {
          const bucket =
            intruder.sessionClient.client.storage.from(PROFILE_PHOTO_BUCKET);

          const upload = await bucket.upload(
            `${owner.user.id}/intrusa.png`,
            PNG_BYTES,
            { contentType: "image/png" },
          );
          const download = await bucket.download(ownerPhoto ?? "");
          await bucket.remove([ownerPhoto ?? ""]);

          expect(upload.error).not.toBeNull();
          expect(download.error).not.toBeNull();
        });
        await expect(listFolder(serviceClient, owner.user.id)).resolves.toEqual(
          [ownerPhoto],
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS * 2,
  );

  it(
    "una socia dada de baja no puede subir a su carpeta con su sesión",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withPhotoOwner(serviceClient, async ({ user, sessionClient }) => {
        const { error: statusError } = await serviceClient.client
          .from("members")
          .update({ account_status: "inactive" })
          .eq("user_id", user.id);
        expect(statusError).toBeNull();

        const upload = await sessionClient.client.storage
          .from(PROFILE_PHOTO_BUCKET)
          .upload(`${user.id}/despues-de-la-baja.png`, PNG_BYTES, {
            contentType: "image/png",
          });

        expect(upload.error).not.toBeNull();
        await expect(listFolder(serviceClient, user.id)).resolves.toEqual([]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
