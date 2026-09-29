import { randomUUID } from "node:crypto";
import { runWithCleanup } from "./run-with-cleanup";

/**
 * La reserva de socios de prueba (#415).
 *
 * Hasta este ticket cada test que necesitaba una identidad la creaba en Auth
 * y la borraba al terminar. Supabase la contaba igual como usuario del mes, y
 * la organización llegó a 44.501 de un límite de 50.000 con un club de
 * decenas de socios. Ahora las identidades de prueba tienen un correo fijo,
 * se crean sólo la primera vez que hacen falta y no se borran nunca: lo que
 * cambia entre un test y otro (rol, estado, foto, grupos, solicitudes) vive en
 * la fila de `members`, y esa sí se deshace.
 *
 * Dos corridas a la vez (dos personas, CI y una persona, o dos shards de
 * Playwright) no se pisan porque la reserva se reparte en plazas, y cada plaza
 * la arrienda una sola corrida a la vez: el arrendamiento es un alta atómica
 * que falla si ya existe, marcada con el `runId` de quien la tiene. Una plaza
 * ocupada se salta; si no queda ninguna libre, la reserva crece una plaza, y
 * esa identidad se queda para la siguiente vez.
 */

/** Lo que dura un arrendamiento que nadie soltó. Una corrida que muere a mitad
 * (un Ctrl+C, un runner cancelado) deja su plaza apartada hasta entonces; es
 * de sobra más larga que una corrida entera de Vitest o de Playwright. */
export const LEASE_TTL_MS = 2 * 60 * 60 * 1000;

/** Un tope, no una expectativa: la reserva tiene tantas plazas como
 * arrendamientos a la vez haya habido. Llegar aquí es una fuga de plazas, y es
 * mejor fallar diciéndolo que crear identidades sin fin. */
const MAX_SLOTS = 200;

/** Ocho caracteres de un UUID: de sobra para que dos corridas no coincidan, y
 * cortos para que el nombre siga cabiendo en su fila. */
const RUN_ID_LENGTH = 8;

/** El identificador de una corrida. Distingue sus nombres sembrados (#254) y
 * marca las plazas que arrienda de la reserva. */
export function createRunId(): string {
  return randomUUID().slice(0, RUN_ID_LENGTH);
}

export type StoredLease = {
  readonly runId: string;
  readonly leasedAt: string;
};

export type ListedLease = {
  readonly key: string;
  readonly leasedAt: string;
};

/** Dónde viven los arrendamientos. `claim` tiene que ser atómico: de dos
 * llamadas con la misma clave, sólo una devuelve `true`. */
export type LeaseStore = {
  readonly list: (namespace: string) => Promise<readonly ListedLease[]>;
  readonly claim: (key: string, lease: StoredLease) => Promise<boolean>;
  readonly release: (key: string) => Promise<void>;
};

/** Las identidades de Auth, sin la forma de borrarlas: la reserva no borra. */
export type IdentityDirectory = {
  readonly findUserId: (email: string) => Promise<string | null>;
  readonly createUser: (email: string, password: string) => Promise<string>;
  /** `false` si la identidad ya no existe en Auth: alguien la borró de dev
   * y el registro de la reserva se quedó apuntando a ella. */
  readonly setPassword: (userId: string, password: string) => Promise<boolean>;
};

export type PooledMember = {
  readonly id: string;
  readonly email: string;
  readonly password: string;
};

export type SlotLease = {
  readonly slot: number;
  readonly release: () => Promise<void>;
};

export type TestMemberPool = {
  /** Arrienda la plaza libre más baja de `namespace`. */
  readonly leaseSlot: (namespace: string) => Promise<SlotLease>;
  /** La identidad de ese correo, creada si falta, con una contraseña nueva
   * con la que abrir su sesión. */
  readonly provideMember: (email: string) => Promise<PooledMember>;
  /** Deshace todo lo que un test dejó colgando del socio, salvo la identidad. */
  readonly resetMember: (userId: string) => Promise<void>;
};

export type TestMemberPoolDependencies = {
  readonly leases: LeaseStore;
  readonly identities: IdentityDirectory;
  readonly resetMember: (userId: string) => Promise<void>;
  readonly runId: string;
  readonly now: () => Date;
  readonly createPassword: () => string;
};

export function slotKey(namespace: string, slot: number): string {
  return `${namespace}/${slot}`;
}

function isStale(leasedAt: string, now: Date): boolean {
  return now.getTime() - new Date(leasedAt).getTime() > LEASE_TTL_MS;
}

/** Las plazas que tiene una corrida viva. Las de una corrida muerta cuentan
 * como libres. */
function liveSlots(
  namespace: string,
  listed: readonly ListedLease[],
  now: Date,
): ReadonlySet<number> {
  const prefix = `${namespace}/`;
  return new Set(
    listed
      .filter((lease) => !isStale(lease.leasedAt, now))
      .map((lease) => Number(lease.key.slice(prefix.length))),
  );
}

/** La clave con la que una sola corrida gana el derecho a recuperar un
 * arrendamiento caducado. Lleva la fecha del caducado, así que no vuelve a
 * servir para el siguiente: se queda como rastro, y ocupa un objeto por
 * corrida que murió. Si una corrida muere justo después de ganarla, esa
 * plaza queda apartada para siempre; las demás absorben el hueco, y se
 * recupera borrando su marca del bucket a mano. */
function reclaimKey(key: string, staleLeasedAt: string): string {
  return `reclaims/${key}@${new Date(staleLeasedAt).getTime()}`;
}

/** Recuperar un arrendamiento caducado es borrarlo y volver a darlo de alta,
 * y el borrado no es atómico: otra corrida que también lo vio caducado podría
 * borrar el que esta acaba de crear. Por eso antes se gana, con otra alta
 * atómica, el derecho a recuperarlo; quien la pierde pasa a la siguiente. */
async function claimSlot(
  deps: TestMemberPoolDependencies,
  key: string,
  staleLeases: ReadonlyMap<string, string>,
): Promise<boolean> {
  const lease = { runId: deps.runId, leasedAt: deps.now().toISOString() };
  const staleLeasedAt = staleLeases.get(key);
  if (staleLeasedAt !== undefined) {
    const mayReclaim = await deps.leases.claim(
      reclaimKey(key, staleLeasedAt),
      lease,
    );
    if (!mayReclaim) {
      return false;
    }
    await deps.leases.release(key);
  }
  return deps.leases.claim(key, lease);
}

async function leaseSlot(
  deps: TestMemberPoolDependencies,
  namespace: string,
): Promise<SlotLease> {
  const listed = await deps.leases.list(namespace);
  const now = deps.now();
  const taken = liveSlots(namespace, listed, now);
  const staleLeases = new Map(
    listed
      .filter((lease) => isStale(lease.leasedAt, now))
      .map((lease) => [lease.key, lease.leasedAt]),
  );
  for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
    const key = slotKey(namespace, slot);
    // Una plaza que la lista daba por libre puede habérsela llevado otra
    // corrida entre la lista y el alta: el alta falla y se prueba la siguiente.
    if (!taken.has(slot) && (await claimSlot(deps, key, staleLeases))) {
      return { slot, release: () => deps.leases.release(key) };
    }
  }
  throw new Error(
    `La reserva de socios de prueba "${namespace}" tiene ${MAX_SLOTS} plazas ocupadas: algo arrienda plazas sin soltarlas.`,
  );
}

async function provideMember(
  deps: TestMemberPoolDependencies,
  email: string,
): Promise<PooledMember> {
  const password = deps.createPassword();
  const existingId = await deps.identities.findUserId(email);
  if (
    existingId !== null &&
    (await deps.identities.setPassword(existingId, password))
  ) {
    return { id: existingId, email, password };
  }
  const id = await deps.identities.createUser(email, password);
  return { id, email, password };
}

export function createTestMemberPool(
  deps: TestMemberPoolDependencies,
): TestMemberPool {
  return {
    leaseSlot: (namespace) => leaseSlot(deps, namespace),
    provideMember: (email) => provideMember(deps, email),
    resetMember: deps.resetMember,
  };
}

/** El correo del socio de la plaza `slot` de una reserva de un solo papel. */
export function pooledMemberEmail(namespace: string, slot: number): string {
  return `${namespace}-${slot}@example.test`;
}

function describeError(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

export async function describeFailure(
  action: () => Promise<void>,
): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (thrown) {
    return describeError(thrown);
  }
}

/** Arrienda una plaza y deja limpio a su socio. Si no puede limpiarlo (le
 * quedó algo que no se deja borrar), deja la plaza apartada para que nadie
 * vuelva a tropezar con ella hasta que caduque, y prueba con la siguiente. */
async function leaseCleanMember(
  pool: TestMemberPool,
  namespace: string,
): Promise<{ readonly member: PooledMember; readonly lease: SlotLease }> {
  for (let attempt = 0; attempt < MAX_SLOTS; attempt += 1) {
    const lease = await pool.leaseSlot(namespace);
    const member = await pool.provideMember(
      pooledMemberEmail(namespace, lease.slot),
    );
    const resetFailure = await describeFailure(() =>
      pool.resetMember(member.id),
    );
    if (resetFailure === null) {
      return { member, lease };
    }
    console.error(
      `El socio de prueba ${member.email} no se pudo dejar limpio y su plaza queda apartada: ${resetFailure}`,
    );
  }
  throw new Error(
    `Ningún socio de la reserva "${namespace}" se pudo dejar limpio.`,
  );
}

export type MemberLease = {
  readonly member: PooledMember;
  /** Deshace lo que el test le colgó al socio y suelta la plaza, aunque lo
   * primero falle. Devuelve el fallo, o `null` si todo fue bien. */
  readonly returnToPool: () => Promise<string | null>;
};

/** Un socio de la reserva que nadie más está usando, hasta `returnToPool`.
 * Para los tests que lo montan en un `beforeAll`; los demás, mejor con
 * `withPooledMember`, que no deja olvidarse de devolverlo. */
export async function leasePooledMember(
  pool: TestMemberPool,
  namespace: string,
): Promise<MemberLease> {
  const { member, lease } = await leaseCleanMember(pool, namespace);
  return {
    member,
    async returnToPool() {
      const resetFailure = await describeFailure(() =>
        pool.resetMember(member.id),
      );
      const releaseFailure = await describeFailure(lease.release);
      return resetFailure ?? releaseFailure;
    },
  };
}

/** Pasa a `run` un socio de la reserva que nadie más está usando, y al
 * terminar deshace lo que el test le colgó y suelta la plaza, aunque `run`
 * lance. La identidad no se borra: es la de la siguiente vez. */
export async function withPooledMember<T>(
  pool: TestMemberPool,
  namespace: string,
  run: (member: PooledMember) => Promise<T>,
): Promise<T> {
  const { member, returnToPool } = await leasePooledMember(pool, namespace);
  return runWithCleanup(
    () => run(member),
    returnToPool,
    `No se pudo dejar limpio al socio de prueba ${member.email}`,
  );
}
