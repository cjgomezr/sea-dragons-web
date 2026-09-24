import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_NOTIFICATIONS_PER_MEMBER,
  type NewNotification,
  type NotificationCleanup,
  type NotificationInsert,
  type NotificationRecipient,
  type NotificationWriter,
  notifyMember,
} from "@/lib/notifications/notify-member";

/**
 * La única puerta para crear avisos (#265, RF-2 del PRD de E6). Quien avisa
 * nunca ve una excepción: recibe un resultado y sigue con lo suyo.
 */

const RECIPIENT_ID = "3c1f0a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const CLUB_ID = "c1000000-0000-4000-8000-000000000001";

const ROLE_CHANGED: NewNotification = {
  recipientUserId: RECIPIENT_ID,
  type: "role_changed",
  data: { newRole: "Coach" },
};

const NOTHING_TO_CLEAN: NotificationCleanup = { deletedCount: 0, keptCount: 1 };

type FakeWriter = NotificationWriter & {
  readonly inserted: NotificationInsert[];
  /** Lo que se dejó para después de responder, sin correr todavía. */
  readonly deferred: (() => Promise<void>)[];
};

function writerFor(
  recipient: NotificationRecipient | null,
  prune: NotificationWriter["pruneNotifications"] = async () =>
    NOTHING_TO_CLEAN,
): FakeWriter {
  const inserted: NotificationInsert[] = [];
  const deferred: (() => Promise<void>)[] = [];
  return {
    inserted,
    deferred,
    findRecipient: vi.fn(async () => recipient),
    insertNotification: vi.fn(async (row: NotificationInsert) => {
      inserted.push(row);
    }),
    pruneNotifications: vi.fn(prune),
    runAfterResponse: (work) => {
      deferred.push(work);
    },
  };
}

const ACTIVE_RECIPIENT: NotificationRecipient = {
  clubId: CLUB_ID,
  accountStatus: "active",
};

async function runDeferredWork(writer: FakeWriter): Promise<void> {
  for (const work of writer.deferred) {
    await work();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("crear un aviso", () => {
  it("guarda el aviso en el club del destinatario, con su tipo y sus datos", async () => {
    const writer = writerFor({ clubId: CLUB_ID, accountStatus: "active" });

    const outcome = await notifyMember(writer, ROLE_CHANGED);

    expect(outcome).toEqual({ kind: "saved" });
    expect(writer.inserted).toEqual([
      {
        clubId: CLUB_ID,
        userId: RECIPIENT_ID,
        type: "role_changed",
        data: { newRole: "Coach" },
      },
    ]);
  });

  it("también avisa a una cuenta que aún no completó su registro", async () => {
    const writer = writerFor({ clubId: CLUB_ID, accountStatus: "incomplete" });

    const outcome = await notifyMember(writer, ROLE_CHANGED);

    expect(outcome).toEqual({ kind: "saved" });
    expect(writer.inserted).toHaveLength(1);
  });

  it("no guarda nada para un destinatario dado de baja", async () => {
    const writer = writerFor({ clubId: CLUB_ID, accountStatus: "inactive" });

    const outcome = await notifyMember(writer, ROLE_CHANGED);

    expect(outcome).toEqual({ kind: "recipient_ineligible" });
    expect(writer.inserted).toEqual([]);
  });

  it("no guarda nada para una identidad que no es socia del club", async () => {
    const writer = writerFor(null);

    const outcome = await notifyMember(writer, ROLE_CHANGED);

    expect(outcome).toEqual({ kind: "recipient_ineligible" });
    expect(writer.inserted).toEqual([]);
  });

  it("devuelve el fallo sin lanzar y lo registra cuando la base no guarda", async () => {
    const failure = new Error("relation notifications is on fire");
    const writer: NotificationWriter = {
      findRecipient: async () => ({ clubId: CLUB_ID, accountStatus: "active" }),
      insertNotification: async () => {
        throw failure;
      },
      pruneNotifications: vi.fn(),
      runAfterResponse: vi.fn(),
    };
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyMember(writer, ROLE_CHANGED);

    expect(outcome).toEqual({ kind: "failed", error: failure });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("aviso"),
      expect.objectContaining({
        recipientUserId: RECIPIENT_ID,
        type: "role_changed",
        error: failure,
      }),
    );
  });

  it("devuelve el fallo sin lanzar cuando no se puede leer al destinatario", async () => {
    const failure = new Error("members no responde");
    const writer: NotificationWriter = {
      findRecipient: async () => {
        throw failure;
      },
      insertNotification: vi.fn(),
      pruneNotifications: vi.fn(),
      runAfterResponse: vi.fn(),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyMember(writer, ROLE_CHANGED);

    expect(outcome).toEqual({ kind: "failed", error: failure });
    expect(writer.insertNotification).not.toHaveBeenCalled();
  });

  it("no registra los datos del aviso, que pueden llevar un nombre", async () => {
    const writer: NotificationWriter = {
      findRecipient: async () => ({ clubId: CLUB_ID, accountStatus: "active" }),
      insertNotification: async () => {
        throw new Error("fallo");
      },
      pruneNotifications: vi.fn(),
      runAfterResponse: vi.fn(),
    };
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    await notifyMember(writer, {
      recipientUserId: RECIPIENT_ID,
      type: "role_request_received",
      data: { requesterName: "Ana Buceadora", requestedRole: "Coach" },
    });

    expect(JSON.stringify(logError.mock.calls)).not.toContain("Ana Buceadora");
  });
});

describe("crear un aviso y limpiar después", () => {
  it("deja la limpieza del destinatario para después de responder", async () => {
    const writer = writerFor(ACTIVE_RECIPIENT);

    await notifyMember(writer, ROLE_CHANGED);

    expect(writer.pruneNotifications).not.toHaveBeenCalled();
    expect(writer.deferred).toHaveLength(1);
  });

  it("limpia sólo los avisos del destinatario", async () => {
    const writer = writerFor(ACTIVE_RECIPIENT);
    await notifyMember(writer, ROLE_CHANGED);

    await runDeferredWork(writer);

    expect(writer.pruneNotifications).toHaveBeenCalledWith(RECIPIENT_ID);
  });

  it("no limpia nada si el aviso no se guardó", async () => {
    const writer = writerFor({ clubId: CLUB_ID, accountStatus: "inactive" });

    await notifyMember(writer, ROLE_CHANGED);

    expect(writer.deferred).toEqual([]);
  });

  it("deja el aviso guardado y registra el fallo cuando la limpieza falla", async () => {
    const failure = new Error("la limpieza se cayó");
    const writer = writerFor(ACTIVE_RECIPIENT, async () => {
      throw failure;
    });
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyMember(writer, ROLE_CHANGED);
    await runDeferredWork(writer);

    expect(outcome).toEqual({ kind: "saved" });
    expect(writer.inserted).toHaveLength(1);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("limpieza"),
      expect.objectContaining({
        recipientUserId: RECIPIENT_ID,
        error: failure,
      }),
    );
  });

  it("responde guardado aunque no se pueda dejar la limpieza para después", async () => {
    const failure = new Error("fuera de una petición");
    const writer: NotificationWriter = {
      ...writerFor(ACTIVE_RECIPIENT),
      runAfterResponse: () => {
        throw failure;
      },
    };
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyMember(writer, ROLE_CHANGED);

    expect(outcome).toEqual({ kind: "saved" });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("limpieza"),
      expect.objectContaining({
        recipientUserId: RECIPIENT_ID,
        error: failure,
      }),
    );
  });

  it("deja constancia cuando el socio sigue por encima del tope", async () => {
    const keptCount = MAX_NOTIFICATIONS_PER_MEMBER + 5;
    const writer = writerFor(ACTIVE_RECIPIENT, async () => ({
      deletedCount: 0,
      keptCount,
    }));
    const logWarning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notifyMember(writer, ROLE_CHANGED);
    await runDeferredWork(writer);

    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining("tope"), {
      recipientUserId: RECIPIENT_ID,
      keptCount,
    });
  });

  it("no deja constancia de nada cuando el socio queda dentro del tope", async () => {
    const writer = writerFor(ACTIVE_RECIPIENT, async () => ({
      deletedCount: 3,
      keptCount: MAX_NOTIFICATIONS_PER_MEMBER,
    }));
    const logWarning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notifyMember(writer, ROLE_CHANGED);
    await runDeferredWork(writer);

    expect(logWarning).not.toHaveBeenCalled();
  });
});
