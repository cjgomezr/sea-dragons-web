import { describe, expect, it } from "vitest";
import { readLimitedBody } from "@/lib/api/read-limited-body";

/** El cuerpo de una petición leído con tope (#245): se corta en cuanto pasa
 * del límite, aunque llegue en varios trozos. */

function requestInChunks(chunks: readonly number[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) {
        controller.enqueue(new Uint8Array(size).fill(7));
      }
      controller.close();
    },
  });
  return new Request("http://localhost/", {
    method: "PUT",
    body: stream,
    // Node exige declararlo para un cuerpo en stream.
    duplex: "half",
  } as RequestInit);
}

describe("lectura del cuerpo con tope", () => {
  it("acepta un cuerpo que mide justo el límite, uniendo sus trozos", async () => {
    const body = await readLimitedBody(requestInChunks([4, 3, 3]), 10);

    expect(body).toEqual({
      kind: "complete",
      bytes: new Uint8Array(10).fill(7),
    });
  });

  it("corta un cuerpo que cruza el límite a mitad de un trozo", async () => {
    const body = await readLimitedBody(requestInChunks([6, 6]), 10);

    expect(body).toEqual({ kind: "too_large" });
  });

  it("lee un cuerpo ausente como vacío", async () => {
    const body = await readLimitedBody(
      new Request("http://localhost/", { method: "PUT" }),
      10,
    );

    expect(body).toEqual({ kind: "complete", bytes: new Uint8Array(0) });
  });
});
