import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createConfirmedUser,
  findUserByEmail,
  withSupabaseRetry,
} from "./supabase-retry";
import {
  createTestMemberPool,
  type IdentityDirectory,
  type LeaseStore,
  type ListedLease,
  type StoredLease,
  slotKey,
  type TestMemberPool,
} from "./test-member-pool";

/**
 * La reserva de socios de prueba contra `seadragons-dev` (#415).
 *
 * Los arrendamientos y el registro de qué identidad tiene cada correo viven en
 * un bucket privado de Storage que sólo existe en desarrollo: lo crea la
 * propia reserva la primera vez, así que no hay migración que lo lleve a
 * producción. Storage da justo la garantía que hace falta: subir un objeto
 * sin `upsert` falla si ya existe, así que dos corridas no pueden arrendar la
 * misma plaza.
 *
 * El registro evita buscar la identidad por correo en Auth, que no filtra:
 * habría que recorrer todas las páginas de usuarios del proyecto.
 */

const POOL_BUCKET = "test-member-pool";
const LEASES_FOLDER = "leases";
const IDENTITIES_FOLDER = "identities";
const MEMBERS_TABLE = "members";
const PHOTOS_BUCKET = "member-photos";
const JSON_CONTENT_TYPE = "application/json";
/** Storage contesta "ya existe" y "no existe" con estos `statusCode`. */
const ALREADY_EXISTS_STATUS_CODE = "409";
const NOT_FOUND_STATUS_CODE = "404";
/** Más plazas de las que una reserva llega a tener, para listar de una vez. */
const LEASE_LIST_LIMIT = 1_000;

type StorageFailure = {
  readonly message: string;
  readonly statusCode?: string;
};

function hasStatusCode(error: StorageFailure | null, code: string): boolean {
  return error !== null && error.statusCode === code;
}

/** Una descarga de algo que no existe no siempre trae el `statusCode`: según
 * la versión, storage-js la envuelve en un error genérico con el mensaje. */
const NOT_FOUND_MESSAGE_PATTERN = /not found/i;

function isNotFound(error: StorageFailure): boolean {
  return (
    hasStatusCode(error, NOT_FOUND_STATUS_CODE) ||
    NOT_FOUND_MESSAGE_PATTERN.test(error.message)
  );
}

function asJsonBody(contents: unknown): Buffer {
  return Buffer.from(JSON.stringify(contents), "utf8");
}

/** Todos los clientes de un proceso hablan con el mismo proyecto: basta con
 * crear el bucket una vez, y con leer una vez qué identidad tiene cada correo. */
let bucketReady: Promise<void> | null = null;
const knownIds = new Map<string, string>();

async function createPoolBucket(client: SupabaseClient): Promise<void> {
  const { error } = await withSupabaseRetry(
    "crear el bucket de la reserva de socios de prueba",
    () => client.storage.createBucket(POOL_BUCKET, { public: false }),
  );
  if (error && !hasStatusCode(error, ALREADY_EXISTS_STATUS_CODE)) {
    throw new Error(
      `No se pudo crear el bucket de la reserva de socios de prueba: ${error.message}`,
    );
  }
}

function ensurePoolBucket(client: SupabaseClient): Promise<void> {
  // Un fallo no se queda guardado: la siguiente llamada lo vuelve a intentar.
  bucketReady ??= createPoolBucket(client).catch((failure: unknown) => {
    bucketReady = null;
    throw failure;
  });
  return bucketReady;
}

function leasePath(key: string): string {
  return `${LEASES_FOLDER}/${key}.json`;
}

function createStorageLeaseStore(client: SupabaseClient): LeaseStore {
  const bucket = () => client.storage.from(POOL_BUCKET);
  return {
    async list(namespace): Promise<readonly ListedLease[]> {
      await ensurePoolBucket(client);
      const { data, error } = await withSupabaseRetry(
        "listar los arrendamientos de la reserva",
        () =>
          bucket().list(`${LEASES_FOLDER}/${namespace}`, {
            limit: LEASE_LIST_LIMIT,
          }),
      );
      if (error) {
        throw new Error(
          `No se pudo listar los arrendamientos de ${namespace}: ${error.message}`,
        );
      }
      // Sólo los objetos traen fecha: una entrada sin ella es una carpeta.
      return data.flatMap((file) =>
        file.created_at === null
          ? []
          : [
              {
                key: `${namespace}/${file.name.replace(/\.json$/, "")}`,
                leasedAt: file.created_at,
              },
            ],
      );
    },
    async claim(key, lease: StoredLease): Promise<boolean> {
      await ensurePoolBucket(client);
      const { error } = await withSupabaseRetry(
        "arrendar una plaza de la reserva",
        () =>
          bucket().upload(leasePath(key), asJsonBody(lease), {
            contentType: JSON_CONTENT_TYPE,
            upsert: false,
          }),
      );
      if (hasStatusCode(error, ALREADY_EXISTS_STATUS_CODE)) {
        return false;
      }
      if (error) {
        throw new Error(`No se pudo arrendar ${key}: ${error.message}`);
      }
      return true;
    },
    async release(key): Promise<void> {
      const { error } = await withSupabaseRetry(
        "soltar una plaza de la reserva",
        () => bucket().remove([leasePath(key)]),
      );
      if (error) {
        throw new Error(`No se pudo soltar ${key}: ${error.message}`);
      }
    },
  };
}

function identityPath(email: string): string {
  return `${IDENTITIES_FOLDER}/${email}.json`;
}

type RegisteredIdentity = { readonly userId: string };

function createAuthIdentityDirectory(
  client: SupabaseClient,
): IdentityDirectory {
  const bucket = () => client.storage.from(POOL_BUCKET);

  async function register(email: string, userId: string): Promise<void> {
    const { error } = await withSupabaseRetry(
      "apuntar la identidad en la reserva",
      () =>
        bucket().upload(
          identityPath(email),
          asJsonBody({ userId } satisfies RegisteredIdentity),
          { contentType: JSON_CONTENT_TYPE, upsert: true },
        ),
    );
    if (error) {
      throw new Error(
        `No se pudo apuntar la identidad de ${email}: ${error.message}`,
      );
    }
    knownIds.set(email, userId);
  }

  async function setPassword(userId: string, password: string): Promise<void> {
    const { error } = await withSupabaseRetry(
      "cambiar la contraseña del socio de prueba",
      () => client.auth.admin.updateUserById(userId, { password }),
    );
    if (error) {
      throw new Error(
        `No se pudo cambiar la contraseña del socio de prueba ${userId}: ${error.message}`,
      );
    }
  }

  async function readRegistry(email: string): Promise<string | null> {
    await ensurePoolBucket(client);
    const { data, error } = await withSupabaseRetry(
      "leer la identidad apuntada en la reserva",
      () => bucket().download(identityPath(email)),
    );
    if (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw new Error(
        `No se pudo leer la identidad de ${email}: ${error.message}`,
      );
    }
    const { userId } = JSON.parse(await data.text()) as RegisteredIdentity;
    return userId;
  }

  /** La identidad existe en Auth pero no en el registro: se perdió el
   * registro, o otra corrida la creó y no llegó a apuntarla. Es el camino
   * lento, porque Auth no busca por correo. */
  async function adoptExistingUser(
    email: string,
    password: string,
    creationFailure: unknown,
  ): Promise<string> {
    const existing = await findUserByEmail(client.auth.admin, email);
    if (existing === null) {
      throw creationFailure;
    }
    await setPassword(existing.id, password);
    await register(email, existing.id);
    return existing.id;
  }

  return {
    async findUserId(email): Promise<string | null> {
      const known = knownIds.get(email);
      if (known !== undefined) {
        return known;
      }
      const registered = await readRegistry(email);
      if (registered !== null) {
        knownIds.set(email, registered);
      }
      return registered;
    },
    async createUser(email, password): Promise<string> {
      let userId: string;
      try {
        const user = await createConfirmedUser(client.auth.admin, {
          email,
          password,
          operation: `crear el socio de prueba ${email}`,
        });
        userId = user.id;
      } catch (creationFailure) {
        return adoptExistingUser(email, password, creationFailure);
      }
      await register(email, userId);
      return userId;
    },
    setPassword,
  };
}

/** Borra la fila de socio (y con ella, por cascada, todo lo que cuelga de
 * ella: solicitudes, grupos, respuestas, asistencia, evaluaciones, avisos) y
 * vacía su carpeta de fotos, que la cascada no alcanza. */
export async function resetPooledMember(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await withSupabaseRetry(
    "borrar la fila del socio de prueba",
    () => client.from(MEMBERS_TABLE).delete().eq("user_id", userId),
  );
  if (error) {
    throw new Error(
      `No se pudo borrar la fila del socio de prueba ${userId}: ${error.message}`,
    );
  }
  await emptyPhotoFolder(client, userId);
}

async function emptyPhotoFolder(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  const photos = client.storage.from(PHOTOS_BUCKET);
  const { data, error } = await withSupabaseRetry(
    "listar las fotos del socio de prueba",
    () => photos.list(userId),
  );
  if (error) {
    throw new Error(
      `No se pudo listar las fotos de ${userId}: ${error.message}`,
    );
  }
  if (data.length === 0) {
    return;
  }
  const { error: removeError } = await withSupabaseRetry(
    "borrar las fotos del socio de prueba",
    () => photos.remove(data.map((file) => `${userId}/${file.name}`)),
  );
  if (removeError) {
    throw new Error(
      `No se pudo borrar las fotos de ${userId}: ${removeError.message}`,
    );
  }
}

export function createSupabaseTestMemberPool(
  client: SupabaseClient,
  runId: string,
): TestMemberPool {
  return createTestMemberPool({
    leases: createStorageLeaseStore(client),
    identities: createAuthIdentityDirectory(client),
    resetMember: (userId) => resetPooledMember(client, userId),
    runId,
    now: () => new Date(),
    createPassword: () => randomUUID(),
  });
}

/** Suelta una plaza desde otro momento de la corrida que el que la arrendó:
 * el cierre global de Playwright sólo tiene el número de plaza. */
export function releasePoolSlot(
  client: SupabaseClient,
  namespace: string,
  slot: number,
): Promise<void> {
  return createStorageLeaseStore(client).release(slotKey(namespace, slot));
}
