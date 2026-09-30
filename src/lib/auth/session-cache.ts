import { createHash } from "node:crypto";
import type { SessionState } from "./session-boundary";

/**
 * Memoria de 30 segundos del estado de sesión (#434).
 *
 * Sin ella cada petición viajaba dos veces a Supabase antes de hacer nada, y
 * esos dos viajes eran el 93 % de lo que recibía `seadragons-dev`. El dueño
 * decidió el 30 de septiembre de 2026 aceptar hasta 30 segundos de retraso en
 * que un cierre de sesión ajeno, una baja o un cambio de rol surtan efecto a
 * cambio de no repetirlos. Quien cambia un rol o un estado en este servidor
 * llama a `forgetMember`, así que ahí el cambio vale en la siguiente petición;
 * otro servidor, con su propia memoria, lo aplica como mucho 30 segundos
 * después.
 *
 * La llave es el hash del token de acceso, nunca el token: un volcado de esta
 * memoria no debe servir para hacerse pasar por nadie.
 */

export const SESSION_CACHE_TTL_MS = 30_000;
export const SESSION_CACHE_MAX_ENTRIES = 1_000;

const MS_PER_SECOND = 1000;

/** Sólo se guarda un estado con sesión. Un anónimo no ahorra ningún viaje que
 * valga la pena y guardarlo haría durar un rechazo que quizá era una avería. */
export type RememberedSessionState = Exclude<
  SessionState,
  { readonly kind: "anonymous" }
>;

export type CachedSession = {
  readonly userId: string;
  readonly state: RememberedSessionState;
  /** Lo que ocurra antes: los 30 segundos o la caducidad del token. */
  readonly validUntilMs: number;
};

export type SessionCache = {
  read(accessToken: string): RememberedSessionState | null;
  remember(entry: {
    readonly accessToken: string;
    readonly userId: string;
    readonly state: RememberedSessionState;
  }): void;
  forgetMember(userId: string): void;
};

function hashAccessToken(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

/**
 * Cuándo deja de valer el token, leído de su carga SIN verificar la firma.
 * Sólo sirve para no guardar ni servir un token caducado, nunca para darlo por
 * bueno: eso lo decide Supabase. Un token ilegible no tiene fecha y no se
 * guarda.
 */
function readTokenExpiryMs(accessToken: string): number | null {
  const payload = accessToken.split(".")[1];
  if (payload === undefined) {
    return null;
  }
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      typeof claims === "object" &&
      claims !== null &&
      "exp" in claims &&
      typeof claims.exp === "number"
    ) {
      return claims.exp * MS_PER_SECOND;
    }
    return null;
  } catch {
    // Una carga que no es JSON es un token que no se sabe cuándo caduca, y eso
    // ya tiene respuesta: no se guarda.
    return null;
  }
}

export function createSessionCache(options: {
  readonly now: () => number;
  /** Se pasa sólo desde los tests, para mirar qué quedó guardado. */
  readonly entries?: Map<string, CachedSession>;
}): SessionCache {
  const entries = options.entries ?? new Map<string, CachedSession>();
  const keysByUser = new Map<string, Set<string>>();

  function forgetKey(key: string): void {
    const entry = entries.get(key);
    if (entry === undefined) {
      return;
    }
    entries.delete(key);
    const userKeys = keysByUser.get(entry.userId);
    userKeys?.delete(key);
    if (userKeys?.size === 0) {
      keysByUser.delete(entry.userId);
    }
  }

  // Un `Map` recorre en orden de inserción, así que la primera llave es la
  // más vieja.
  function evictOldest(): void {
    const oldest = entries.keys().next();
    if (!oldest.done) {
      forgetKey(oldest.value);
    }
  }

  return {
    read(accessToken) {
      const key = hashAccessToken(accessToken);
      const entry = entries.get(key);
      if (entry === undefined) {
        return null;
      }
      if (options.now() >= entry.validUntilMs) {
        forgetKey(key);
        return null;
      }
      return entry.state;
    },

    remember({ accessToken, userId, state }) {
      const expiryMs = readTokenExpiryMs(accessToken);
      const now = options.now();
      if (expiryMs === null || expiryMs <= now) {
        return;
      }
      const key = hashAccessToken(accessToken);
      forgetKey(key);
      if (entries.size >= SESSION_CACHE_MAX_ENTRIES) {
        evictOldest();
      }
      entries.set(key, {
        userId,
        state,
        validUntilMs: Math.min(now + SESSION_CACHE_TTL_MS, expiryMs),
      });
      keysByUser.set(userId, (keysByUser.get(userId) ?? new Set()).add(key));
    },

    forgetMember(userId) {
      for (const key of [...(keysByUser.get(userId) ?? [])]) {
        forgetKey(key);
      }
    },
  };
}

const SHARED_CACHE_KEY = Symbol.for("seadragons.sessionCache");

type ProcessGlobals = { [SHARED_CACHE_KEY]?: SessionCache };

/**
 * La memoria de este proceso. El proxy y los handlers se empaquetan aparte y
 * cada paquete carga su propia copia de este módulo, así que la memoria cuelga
 * de `globalThis`: si no, el olvido que hace el handler que guarda un cambio de
 * rol no llegaría a la copia que consulta el proxy. Si algún día vivieran en
 * procesos distintos, el tope de 30 segundos sigue valiendo para los dos.
 */
function readSharedSessionCache(): SessionCache {
  const processGlobals = globalThis as ProcessGlobals;
  processGlobals[SHARED_CACHE_KEY] ??= createSessionCache({
    now: () => Date.now(),
  });
  return processGlobals[SHARED_CACHE_KEY];
}

export const sharedSessionCache: SessionCache = readSharedSessionCache();

/** Lo llaman los dominios que cambian el rol o el estado de un socio, justo
 * después de guardarlo, para que su siguiente petición ya lo vea. */
export function forgetCachedSession(userId: string): void {
  sharedSessionCache.forgetMember(userId);
}
