import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_NOTIFICATIONS_PER_MEMBER,
  type NewBroadcast,
  type NotificationBroadcastWriter,
  type NotificationCleanup,
  type NotificationInsert,
  type NotificationRecipient,
  notifyMembers,
} from "@/lib/notifications/notify-member";

/**
 * El mismo aviso a muchos socios de una vez (#332). Es la misma puerta que
 * `notifyMember`, con sus reglas: una cuenta dada de baja no recibe nada, un
 * fallo nunca llega como excepción a quien avisa y la limpieza queda para
 * después de responder. Lo que cambia es que se escribe en una sola vez.
 */

const CLUB_ID = "c1000000-0000-4000-8000-000000000001";
const ANA = "a1000000-0000-4000-8000-000000000001";
const BEA = "b2000000-0000-4000-8000-000000000002";
const CARO = "c3000000-0000-4000-8000-000000000003";

const ACTIVE: NotificationRecipient = {
  clubId: CLUB_ID,
  accountStatus: "active",
};

const POST_PUBLISHED = {
  type: "news_post_published",
  data: {
    postId: "d4000000-0000-4000-8000-000000000004",
    category: "announcement",
    title: "Cambia la piscina",
  },
} as const;

function broadcastTo(recipientUserIds: readonly string[]): NewBroadcast {
  return { ...POST_PUBLISHED, recipientUserIds };
}

type FakeBroadcastWriter = NotificationBroadcastWriter & {
  readonly inserted: NotificationInsert[];
  readonly batches: (readonly NotificationInsert[])[];
  readonly deferred: (() => Promise<void>)[];
};

type FakeOptions = {
  readonly recipients?: Readonly<Record<string, NotificationRecipient>>;
  readonly failBatch?: boolean;
  /** Los destinatarios cuyo aviso suelto también falla. */
  readonly failFor?: readonly string[];
  readonly cleanup?: ReadonlyMap<string, NotificationCleanup>;
};

function broadcastWriter(options: FakeOptions = {}): FakeBroadcastWriter {
  const recipients = options.recipients ?? {
    [ANA]: ACTIVE,
    [BEA]: ACTIVE,
    [CARO]: ACTIVE,
  };
  const inserted: NotificationInsert[] = [];
  const batches: (readonly NotificationInsert[])[] = [];
  const deferred: (() => Promise<void>)[] = [];
  return {
    inserted,
    batches,
    deferred,
    findRecipients: vi.fn(async (userIds: readonly string[]) => {
      const found = userIds.flatMap((id) => {
        const recipient = recipients[id];
        return recipient === undefined ? [] : [[id, recipient] as const];
      });
      return new Map(found);
    }),
    insertNotifications: vi.fn(async (rows: readonly NotificationInsert[]) => {
      if (options.failBatch === true) {
        throw new Error("la escritura en lote se cayó");
      }
      batches.push(rows);
      inserted.push(...rows);
    }),
    insertNotification: vi.fn(async (row: NotificationInsert) => {
      if (options.failFor?.includes(row.userId) === true) {
        throw new Error(`no se guardó el aviso de ${row.userId}`);
      }
      inserted.push(row);
    }),
    pruneNotificationsOf: vi.fn(async () => options.cleanup ?? new Map()),
    runAfterResponse: (work) => {
      deferred.push(work);
    },
  };
}

async function runDeferredWork(writer: FakeBroadcastWriter): Promise<void> {
  for (const work of writer.deferred) {
    await work();
  }
}

function recipientsOf(writer: FakeBroadcastWriter): string[] {
  return writer.inserted.map((row) => row.userId);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("avisar a varios socios", () => {
  it("guarda un aviso por socio, con su club, su tipo y sus datos, en una sola escritura", async () => {
    const writer = broadcastWriter();

    const outcome = await notifyMembers(writer, broadcastTo([ANA, BEA]));

    expect(outcome).toEqual({
      kind: "notified",
      savedCount: 2,
      failedCount: 0,
    });
    expect(writer.batches).toEqual([
      [
        { ...POST_PUBLISHED, clubId: CLUB_ID, userId: ANA },
        { ...POST_PUBLISHED, clubId: CLUB_ID, userId: BEA },
      ],
    ]);
    expect(writer.insertNotification).not.toHaveBeenCalled();
  });

  it("avisa una sola vez a un socio que llega repetido", async () => {
    const writer = broadcastWriter();

    await notifyMembers(writer, broadcastTo([ANA, BEA, ANA]));

    expect(recipientsOf(writer)).toEqual([ANA, BEA]);
  });

  it("no avisa a un socio dado de baja", async () => {
    const writer = broadcastWriter({
      recipients: {
        [ANA]: ACTIVE,
        [BEA]: { clubId: CLUB_ID, accountStatus: "inactive" },
      },
    });

    const outcome = await notifyMembers(writer, broadcastTo([ANA, BEA]));

    expect(outcome).toEqual({
      kind: "notified",
      savedCount: 1,
      failedCount: 0,
    });
    expect(recipientsOf(writer)).toEqual([ANA]);
  });

  it("no avisa a una identidad que no es socia de ningún club", async () => {
    const writer = broadcastWriter({ recipients: { [ANA]: ACTIVE } });

    await notifyMembers(writer, broadcastTo([ANA, BEA]));

    expect(recipientsOf(writer)).toEqual([ANA]);
  });

  it("no escribe nada cuando no queda nadie a quien avisar", async () => {
    const writer = broadcastWriter();

    const outcome = await notifyMembers(writer, broadcastTo([]));

    expect(outcome).toEqual({
      kind: "notified",
      savedCount: 0,
      failedCount: 0,
    });
    expect(writer.insertNotifications).not.toHaveBeenCalled();
    expect(writer.deferred).toEqual([]);
  });
});

describe("avisar a varios socios cuando algo falla", () => {
  it("si la escritura en lote falla, guarda uno por uno y los demás llegan", async () => {
    const writer = broadcastWriter({ failBatch: true, failFor: [BEA] });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyMembers(writer, broadcastTo([ANA, BEA, CARO]));

    expect(outcome).toEqual({
      kind: "notified",
      savedCount: 2,
      failedCount: 1,
    });
    expect(recipientsOf(writer)).toEqual([ANA, CARO]);
  });

  it("registra el aviso que no se guardó, sin sus datos", async () => {
    const writer = broadcastWriter({ failBatch: true, failFor: [BEA] });
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    await notifyMembers(writer, broadcastTo([ANA, BEA]));

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("aviso sin guardar"),
      expect.objectContaining({
        recipientUserId: BEA,
        type: "news_post_published",
        error: expect.any(Error),
      }),
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      "Cambia la piscina",
    );
  });

  it("devuelve el fallo sin lanzar y lo registra cuando no se pueden leer los destinatarios", async () => {
    const failure = new Error("members no responde");
    const writer: FakeBroadcastWriter = {
      ...broadcastWriter(),
      findRecipients: async () => {
        throw failure;
      },
    };
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyMembers(writer, broadcastTo([ANA]));

    expect(outcome).toEqual({ kind: "failed", error: failure });
    expect(writer.inserted).toEqual([]);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("destinatarios"),
      expect.objectContaining({ type: "news_post_published", error: failure }),
    );
  });
});

describe("avisar a varios socios y limpiar después", () => {
  it("limpia a todos los que recibieron el aviso en una sola llamada, después de responder", async () => {
    const writer = broadcastWriter({ failBatch: true, failFor: [BEA] });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await notifyMembers(writer, broadcastTo([ANA, BEA, CARO]));
    expect(writer.pruneNotificationsOf).not.toHaveBeenCalled();
    await runDeferredWork(writer);

    expect(writer.pruneNotificationsOf).toHaveBeenCalledTimes(1);
    expect(writer.pruneNotificationsOf).toHaveBeenCalledWith([ANA, CARO]);
  });

  it("deja constancia de cada socio que sigue por encima del tope", async () => {
    const keptCount = MAX_NOTIFICATIONS_PER_MEMBER + 1;
    const writer = broadcastWriter({
      cleanup: new Map([
        [ANA, { deletedCount: 0, keptCount }],
        [BEA, { deletedCount: 2, keptCount: MAX_NOTIFICATIONS_PER_MEMBER }],
      ]),
    });
    const logWarning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notifyMembers(writer, broadcastTo([ANA, BEA]));
    await runDeferredWork(writer);

    expect(logWarning).toHaveBeenCalledTimes(1);
    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining("tope"), {
      recipientUserId: ANA,
      keptCount,
    });
  });

  it("deja los avisos guardados y registra el fallo cuando la limpieza falla", async () => {
    const failure = new Error("la limpieza se cayó");
    const writer: FakeBroadcastWriter = {
      ...broadcastWriter(),
      pruneNotificationsOf: async () => {
        throw failure;
      },
    };
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyMembers(writer, broadcastTo([ANA, BEA]));
    await runDeferredWork(writer);

    expect(outcome).toEqual({
      kind: "notified",
      savedCount: 2,
      failedCount: 0,
    });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("limpieza"),
      expect.objectContaining({ recipientUserIds: [ANA, BEA], error: failure }),
    );
  });
});
