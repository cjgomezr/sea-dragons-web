import { describe, expect, it, vi } from "vitest";
import { runAfterResponse } from "@/lib/api/after-response";

const { after } = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock("next/server", () => ({ after }));

describe("runAfterResponse", () => {
  it("le entrega el trabajo a after de Next.js, que lo corre después de responder", () => {
    const work = async (): Promise<void> => {};

    runAfterResponse(work);

    expect(after).toHaveBeenCalledWith(work);
  });
});
