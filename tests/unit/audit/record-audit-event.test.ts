import { describe, expect, it, vi } from "vitest";
import {
  AuditClubMismatchError,
  AuditValidationError,
  AuditWriteError,
  type AuditAction,
  type AuditLogInsertRow,
  type AuditLogWriter,
  type AuditResult,
  recordAuditEvent,
} from "@/lib/audit/audit-log";

const CLUB_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CLUB_ID = "22222222-2222-2222-2222-222222222222";
const ACTOR_ID = "33333333-3333-3333-3333-333333333333";

function buildInput(
  overrides: Partial<Parameters<typeof recordAuditEvent>[1]> = {},
) {
  return {
    actor: { id: ACTOR_ID, clubId: CLUB_ID },
    clubId: CLUB_ID,
    action: "auth.login_succeeded" as AuditAction,
    entityType: "user",
    entityId: ACTOR_ID,
    result: "success" as AuditResult,
    ...overrides,
  };
}

function buildWriter(
  insertAuditLogRow: AuditLogWriter["insertAuditLogRow"] = vi
    .fn()
    .mockResolvedValue({ error: null }),
): AuditLogWriter {
  return { insertAuditLogRow };
}

describe("recordAuditEvent", () => {
  it("writes exactly one row with the mandatory fields", async () => {
    const insertAuditLogRow = vi.fn().mockResolvedValue({ error: null });
    const writer = buildWriter(insertAuditLogRow);

    await recordAuditEvent(writer, buildInput());

    expect(insertAuditLogRow).toHaveBeenCalledTimes(1);
    const row = insertAuditLogRow.mock.calls[0]?.[0] as AuditLogInsertRow;
    expect(row).toEqual({
      club_id: CLUB_ID,
      actor_id: ACTOR_ID,
      action: "auth.login_succeeded",
      entity_type: "user",
      entity_id: ACTOR_ID,
      result: "success",
      metadata: null,
    });
  });

  it("rejects an empty action", async () => {
    const writer = buildWriter();

    await expect(
      recordAuditEvent(writer, buildInput({ action: "" as AuditAction })),
    ).rejects.toBeInstanceOf(AuditValidationError);
  });

  it("rejects an empty actor id", async () => {
    const writer = buildWriter();

    await expect(
      recordAuditEvent(
        writer,
        buildInput({ actor: { id: "", clubId: CLUB_ID } }),
      ),
    ).rejects.toBeInstanceOf(AuditValidationError);
  });

  it("serializes optional metadata as JSON", async () => {
    const insertAuditLogRow = vi.fn().mockResolvedValue({ error: null });
    const writer = buildWriter(insertAuditLogRow);

    await recordAuditEvent(
      writer,
      buildInput({ metadata: { ip: "10.0.0.1", attempt: 2 } }),
    );

    const row = insertAuditLogRow.mock.calls[0]?.[0] as AuditLogInsertRow;
    expect(row.metadata).toEqual({ ip: "10.0.0.1", attempt: 2 });
  });

  it("does not break the write when metadata is absent", async () => {
    const insertAuditLogRow = vi.fn().mockResolvedValue({ error: null });
    const writer = buildWriter(insertAuditLogRow);

    await recordAuditEvent(writer, buildInput());

    const row = insertAuditLogRow.mock.calls[0]?.[0] as AuditLogInsertRow;
    expect(row.metadata).toBeNull();
  });

  it("throws with context and never resolves when the database client returns an error", async () => {
    const insertAuditLogRow = vi
      .fn()
      .mockResolvedValue({ error: { message: "connection refused" } });
    const writer = buildWriter(insertAuditLogRow);

    const call = recordAuditEvent(writer, buildInput());

    await expect(call).rejects.toBeInstanceOf(AuditWriteError);
    await expect(call).rejects.toThrow(/connection refused/);
  });

  it("rejects an event for a club different from the actor's", async () => {
    const insertAuditLogRow = vi.fn().mockResolvedValue({ error: null });
    const writer = buildWriter(insertAuditLogRow);

    await expect(
      recordAuditEvent(writer, buildInput({ clubId: OTHER_CLUB_ID })),
    ).rejects.toBeInstanceOf(AuditClubMismatchError);
    expect(insertAuditLogRow).not.toHaveBeenCalled();
  });
});

describe("tipos de acción", () => {
  it("rejects an action outside the closed set at runtime", async () => {
    const writer = buildWriter();

    await expect(
      recordAuditEvent(
        writer,
        buildInput({ action: "not.a.real.action" as AuditAction }),
      ),
    ).rejects.toBeInstanceOf(AuditValidationError);
  });

  it("rejects a result outside the closed set at runtime", async () => {
    const writer = buildWriter();

    await expect(
      recordAuditEvent(
        writer,
        buildInput({ result: "unknown" as AuditResult }),
      ),
    ).rejects.toBeInstanceOf(AuditValidationError);
  });
});
