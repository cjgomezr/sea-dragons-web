import { describe, expect, it, vi } from "vitest";
import {
  createTestMemberPool,
  type IdentityDirectory,
  type LeaseStore,
  type StoredLease,
  type TestMemberPool,
  withPooledMember,
} from "../../support/test-member-pool";

const NOW = new Date("2026-09-29T10:00:00.000Z");
const TWO_HOURS_AGO = new Date("2026-09-29T07:59:00.000Z");

/** Un almacén de arrendamientos en memoria con la única garantía que importa
 * del de verdad: dos `claim` de la misma clave no pueden ganar los dos. */
function fakeLeaseStore(
  initial: Record<string, StoredLease> = {},
): LeaseStore & {
  readonly held: Map<string, StoredLease>;
} {
  const held = new Map<string, StoredLease>(Object.entries(initial));
  return {
    held,
    async list(namespace) {
      return [...held.entries()]
        .filter(([key]) => key.startsWith(`${namespace}/`))
        .map(([key, lease]) => ({ key, leasedAt: lease.leasedAt }));
    },
    async claim(key, lease) {
      if (held.has(key)) {
        return false;
      }
      held.set(key, lease);
      return true;
    },
    async release(key) {
      held.delete(key);
    },
  };
}

type FakeDirectory = IdentityDirectory & {
  readonly createUser: ReturnType<typeof vi.fn>;
  readonly setPassword: ReturnType<typeof vi.fn>;
  readonly users: Map<string, string>;
};

function fakeIdentityDirectory(
  existing: Record<string, string> = {},
): FakeDirectory {
  const users = new Map<string, string>(Object.entries(existing));
  let nextId = users.size + 1;
  return {
    users,
    findUserId: async (email) => users.get(email) ?? null,
    createUser: vi.fn(async (email: string) => {
      const id = `user-${nextId}`;
      nextId += 1;
      users.set(email, id);
      return id;
    }),
    setPassword: vi.fn(async () => undefined),
  };
}

function poolFor(
  options: {
    readonly leases?: LeaseStore;
    readonly identities?: IdentityDirectory;
    readonly runId?: string;
    readonly resetMember?: (userId: string) => Promise<void>;
  } = {},
): TestMemberPool {
  return createTestMemberPool({
    leases: options.leases ?? fakeLeaseStore(),
    identities: options.identities ?? fakeIdentityDirectory(),
    resetMember: options.resetMember ?? (async () => undefined),
    runId: options.runId ?? "corrida1",
    now: () => NOW,
    createPassword: () => "contraseña-nueva",
  });
}

describe("la reserva de socios de prueba", () => {
  it("devuelve el mismo socio para el mismo papel", async () => {
    const pool = poolFor();

    const first = await pool.provideMember("e2e-activo@example.test");
    const second = await pool.provideMember("e2e-activo@example.test");

    expect(second.id).toBe(first.id);
  });

  it("crea la identidad sólo si todavía no existe", async () => {
    const identities = fakeIdentityDirectory({
      "e2e-activo@example.test": "user-existente",
    });
    const pool = poolFor({ identities });

    const member = await pool.provideMember("e2e-activo@example.test");

    expect(member.id).toBe("user-existente");
    expect(identities.createUser).not.toHaveBeenCalled();
  });

  it("crea la identidad que falta, una sola vez", async () => {
    const identities = fakeIdentityDirectory();
    const pool = poolFor({ identities });

    await pool.provideMember("e2e-activo@example.test");
    await pool.provideMember("e2e-activo@example.test");

    expect(identities.createUser).toHaveBeenCalledTimes(1);
  });

  it("le pone una contraseña nueva a cada socio que entrega, para poder abrir su sesión", async () => {
    const identities = fakeIdentityDirectory({
      "e2e-activo@example.test": "user-existente",
    });
    const pool = poolFor({ identities });

    const member = await pool.provideMember("e2e-activo@example.test");

    expect(member.password).toBe("contraseña-nueva");
    expect(identities.setPassword).toHaveBeenCalledWith(
      "user-existente",
      "contraseña-nueva",
    );
  });

  it("no da la misma plaza a dos corridas distintas a la vez", async () => {
    const leases = fakeLeaseStore();
    const identities = fakeIdentityDirectory();
    const firstRun = poolFor({ leases, identities, runId: "corrida1" });
    const secondRun = poolFor({ leases, identities, runId: "corrida2" });

    const [first, second] = await Promise.all([
      firstRun.leaseSlot("rls"),
      secondRun.leaseSlot("rls"),
    ]);

    expect(first.slot).not.toBe(second.slot);
  });

  it("marca la plaza con el runId de la corrida que la tiene", async () => {
    const leases = fakeLeaseStore();
    const pool = poolFor({ leases, runId: "corrida7" });

    const lease = await pool.leaseSlot("rls");

    expect(leases.held.get(`rls/${lease.slot}`)?.runId).toBe("corrida7");
  });

  it("reutiliza la plaza que otra corrida ya soltó", async () => {
    const leases = fakeLeaseStore();
    const firstRun = poolFor({ leases, runId: "corrida1" });
    const secondRun = poolFor({ leases, runId: "corrida2" });

    const first = await firstRun.leaseSlot("rls");
    await first.release();
    const second = await secondRun.leaseSlot("rls");

    expect(second.slot).toBe(first.slot);
  });

  it("recupera la plaza de una corrida que murió sin soltarla", async () => {
    const leases = fakeLeaseStore({
      "rls/0": { runId: "muerta", leasedAt: TWO_HOURS_AGO.toISOString() },
    });
    const pool = poolFor({ leases });

    const lease = await pool.leaseSlot("rls");

    expect(lease.slot).toBe(0);
    expect(leases.held.get("rls/0")?.runId).toBe("corrida1");
  });

  it("no toca la plaza de una corrida que sigue viva", async () => {
    const leases = fakeLeaseStore({
      "rls/0": { runId: "viva", leasedAt: NOW.toISOString() },
    });
    const pool = poolFor({ leases });

    const lease = await pool.leaseSlot("rls");

    expect(lease.slot).toBe(1);
    expect(leases.held.get("rls/0")?.runId).toBe("viva");
  });

  it("no mezcla las plazas de dos reservas distintas", async () => {
    const leases = fakeLeaseStore({
      "e2e/0": { runId: "otra", leasedAt: NOW.toISOString() },
    });
    const pool = poolFor({ leases });

    const lease = await pool.leaseSlot("rls");

    expect(lease.slot).toBe(0);
  });
});

describe("withPooledMember", () => {
  it("entrega un socio de la reserva y lo deja limpio y libre al terminar", async () => {
    const leases = fakeLeaseStore();
    const resetMember = vi.fn(async () => undefined);
    const pool = poolFor({ leases, resetMember });

    const seen = await withPooledMember(pool, "rls", async (member) => member);

    expect(seen.email).toBe("rls-0@example.test");
    expect(resetMember).toHaveBeenCalledTimes(2);
    expect(leases.held.size).toBe(0);
  });

  it("no borra ninguna identidad: la siguiente vez entrega la misma", async () => {
    const identities = fakeIdentityDirectory();
    const pool = poolFor({ identities });

    const first = await withPooledMember(pool, "rls", async (m) => m.id);
    const second = await withPooledMember(pool, "rls", async (m) => m.id);

    expect(second).toBe(first);
    expect(identities.users.size).toBe(1);
  });

  it("da socios distintos a dos llamadas anidadas", async () => {
    const pool = poolFor();

    const ids = await withPooledMember(pool, "rls", (outer) =>
      withPooledMember(pool, "rls", async (inner) => [outer.id, inner.id]),
    );

    expect(new Set(ids).size).toBe(2);
  });

  it("relanza el fallo del test aunque la limpieza también falle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let resets = 0;
    const pool = poolFor({
      resetMember: async () => {
        resets += 1;
        if (resets > 1) {
          throw new Error("la limpieza falló");
        }
      },
    });
    const testFailure = new Error("la aserción del test falló");

    const settled = await withPooledMember(pool, "rls", async () => {
      throw testFailure;
    }).catch((error: unknown) => error);

    expect(settled).toBe(testFailure);
  });

  it("falla un test que pasó si no pudo dejar limpio al socio", async () => {
    let resets = 0;
    const pool = poolFor({
      resetMember: async () => {
        resets += 1;
        if (resets > 1) {
          throw new Error("la limpieza falló");
        }
      },
    });

    await expect(
      withPooledMember(pool, "rls", async () => "pasó"),
    ).rejects.toThrow(/la limpieza falló/);
  });

  it("suelta la plaza aunque la limpieza falle", async () => {
    const leases = fakeLeaseStore();
    let resets = 0;
    const pool = poolFor({
      leases,
      resetMember: async () => {
        resets += 1;
        if (resets > 1) {
          throw new Error("la limpieza falló");
        }
      },
    });

    await withPooledMember(pool, "rls", async () => "pasó").catch(
      () => undefined,
    );

    expect(leases.held.size).toBe(0);
  });

  it("salta a otra plaza si no puede limpiar al socio que le tocó, y la deja apartada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const leases = fakeLeaseStore();
    const identities = fakeIdentityDirectory({ "rls-0@example.test": "roto" });
    const pool = poolFor({
      leases,
      identities,
      resetMember: async (userId) => {
        if (userId === "roto") {
          throw new Error("le quedó una noticia de otra corrida");
        }
      },
    });

    const seen = await withPooledMember(pool, "rls", async (m) => m.email);

    expect(seen).toBe("rls-1@example.test");
    expect(leases.held.has("rls/0")).toBe(true);
  });
});
