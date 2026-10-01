import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type CachedSession,
  SESSION_CACHE_MAX_ENTRIES,
  SESSION_CACHE_TTL_MS,
  createSessionCache,
} from "@/lib/auth/session-cache";

/**
 * La memoria de 30 segundos del estado de sesión (#434), con el reloj en la
 * mano del test: nada aquí espera de verdad.
 */

const START_MS = Date.UTC(2026, 8, 30, 9, 0, 0);
const ONE_HOUR_S = 60 * 60;
const USER_ID = "0f5c2f4e-1b8e-4d2a-9a5e-4f2b0c8d1a33";
const OTHER_USER_ID = "7a1d9c3b-5e2f-4b8a-8c6d-2e9f1a0b3c44";
const ACTIVE_PLAYER = { kind: "active", role: "Player" } as const;

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** Un token con la forma de un JWT y la caducidad pedida. La firma no importa:
 * la memoria nunca da un token por bueno, sólo mira cuándo deja de valer. */
function accessToken(options: {
  readonly expiresAtMs: number;
  readonly subject?: string;
}): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      sub: options.subject ?? USER_ID,
      exp: Math.floor(options.expiresAtMs / 1000),
    }),
  );
  return `${header}.${payload}.firma`;
}

const LIVE_TOKEN = accessToken({ expiresAtMs: START_MS + ONE_HOUR_S * 1000 });

function cacheAt(clock: { now: number }) {
  const entries = new Map<string, CachedSession>();
  const cache = createSessionCache({ now: () => clock.now, entries });
  return { cache, entries };
}

describe("memoria del estado de sesión", () => {
  it("sirve el estado guardado mientras no pasen 30 segundos", () => {
    const clock = { now: START_MS };
    const { cache } = cacheAt(clock);
    cache.remember({
      accessToken: LIVE_TOKEN,
      userId: USER_ID,
      state: ACTIVE_PLAYER,
    });

    clock.now += SESSION_CACHE_TTL_MS - 1;

    expect(cache.read(LIVE_TOKEN)).toEqual(ACTIVE_PLAYER);
  });

  // #427: la cáscara necesita el id de quien mira sin volver a preguntarlo.
  it("sirve también el id del socio de ese token mientras vale", () => {
    const clock = { now: START_MS };
    const { cache } = cacheAt(clock);
    cache.remember({
      accessToken: LIVE_TOKEN,
      userId: USER_ID,
      state: ACTIVE_PLAYER,
    });

    clock.now += SESSION_CACHE_TTL_MS - 1;

    expect(cache.readUserId(LIVE_TOKEN)).toBe(USER_ID);
  });

  it("deja de servir el id cuando el estado deja de valer", () => {
    const clock = { now: START_MS };
    const { cache } = cacheAt(clock);
    cache.remember({
      accessToken: LIVE_TOKEN,
      userId: USER_ID,
      state: ACTIVE_PLAYER,
    });

    clock.now += SESSION_CACHE_TTL_MS;

    expect(cache.readUserId(LIVE_TOKEN)).toBeNull();
  });

  it("deja de servirlo en cuanto se cumplen los 30 segundos", () => {
    const clock = { now: START_MS };
    const { cache } = cacheAt(clock);
    cache.remember({
      accessToken: LIVE_TOKEN,
      userId: USER_ID,
      state: ACTIVE_PLAYER,
    });

    clock.now += SESSION_CACHE_TTL_MS;

    expect(cache.read(LIVE_TOKEN)).toBeNull();
  });

  it("guarda treinta segundos exactamente", () => {
    expect(SESSION_CACHE_TTL_MS).toBe(30_000);
  });

  it("no sirve un token cuya caducidad pasó, aunque no hayan pasado 30 segundos", () => {
    const clock = { now: START_MS };
    const { cache } = cacheAt(clock);
    const shortLived = accessToken({ expiresAtMs: START_MS + 10_000 });
    cache.remember({
      accessToken: shortLived,
      userId: USER_ID,
      state: ACTIVE_PLAYER,
    });

    clock.now += 10_000;

    expect(cache.read(shortLived)).toBeNull();
  });

  it("no sirve un token que ya llegó caducado", () => {
    const clock = { now: START_MS };
    const { cache } = cacheAt(clock);
    const expired = accessToken({ expiresAtMs: START_MS - 1_000 });

    cache.remember({
      accessToken: expired,
      userId: USER_ID,
      state: ACTIVE_PLAYER,
    });

    expect(cache.read(expired)).toBeNull();
  });

  it("no sirve un token cuya caducidad no se puede leer", () => {
    const clock = { now: START_MS };
    const { cache } = cacheAt(clock);
    const unreadable = "esto-no-es-un-jwt";

    cache.remember({
      accessToken: unreadable,
      userId: USER_ID,
      state: ACTIVE_PLAYER,
    });

    expect(cache.read(unreadable)).toBeNull();
  });

  it("olvida todos los estados de un socio y deja los de los demás", () => {
    const clock = { now: START_MS };
    const { cache } = cacheAt(clock);
    const secondDevice = accessToken({
      expiresAtMs: START_MS + ONE_HOUR_S * 1000 + 1_000,
    });
    const otherMember = accessToken({
      expiresAtMs: START_MS + ONE_HOUR_S * 1000,
      subject: OTHER_USER_ID,
    });
    for (const token of [LIVE_TOKEN, secondDevice]) {
      cache.remember({
        accessToken: token,
        userId: USER_ID,
        state: ACTIVE_PLAYER,
      });
    }
    cache.remember({
      accessToken: otherMember,
      userId: OTHER_USER_ID,
      state: { kind: "incomplete" },
    });

    cache.forgetMember(USER_ID);

    expect(cache.read(LIVE_TOKEN)).toBeNull();
    expect(cache.read(secondDevice)).toBeNull();
    expect(cache.read(otherMember)).toEqual({ kind: "incomplete" });
  });

  it("guarda bajo el hash SHA-256 del token, nunca el token", () => {
    const clock = { now: START_MS };
    const { cache, entries } = cacheAt(clock);

    cache.remember({
      accessToken: LIVE_TOKEN,
      userId: USER_ID,
      state: ACTIVE_PLAYER,
    });

    const expectedKey = createHash("sha256").update(LIVE_TOKEN).digest("hex");
    expect([...entries.keys()]).toEqual([expectedKey]);
    expect(JSON.stringify([...entries])).not.toContain(LIVE_TOKEN);
  });

  it("no pasa de 1.000 entradas y suelta las más viejas al llegar al tope", () => {
    const clock = { now: START_MS };
    const { cache, entries } = cacheAt(clock);
    const tokens = Array.from(
      { length: SESSION_CACHE_MAX_ENTRIES + 1 },
      (_, i) =>
        accessToken({ expiresAtMs: START_MS + ONE_HOUR_S * 1000 + i * 1000 }),
    );

    for (const token of tokens) {
      cache.remember({
        accessToken: token,
        userId: USER_ID,
        state: ACTIVE_PLAYER,
      });
    }

    expect(SESSION_CACHE_MAX_ENTRIES).toBe(1_000);
    expect(entries.size).toBe(SESSION_CACHE_MAX_ENTRIES);
    expect(cache.read(tokens[0] ?? "")).toBeNull();
    expect(cache.read(tokens[1] ?? "")).toEqual(ACTIVE_PLAYER);
    expect(cache.read(tokens.at(-1) ?? "")).toEqual(ACTIVE_PLAYER);
  });

  it("guardar otra vez el mismo token lo reemplaza en vez de duplicarlo", () => {
    const clock = { now: START_MS };
    const { cache, entries } = cacheAt(clock);
    cache.remember({
      accessToken: LIVE_TOKEN,
      userId: USER_ID,
      state: ACTIVE_PLAYER,
    });

    cache.remember({
      accessToken: LIVE_TOKEN,
      userId: USER_ID,
      state: { kind: "active", role: "Coach" },
    });

    expect(entries.size).toBe(1);
    expect(cache.read(LIVE_TOKEN)).toEqual({ kind: "active", role: "Coach" });
  });
});
