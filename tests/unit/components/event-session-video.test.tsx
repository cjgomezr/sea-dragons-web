import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSessionVideo } from "@/components/calendar/EventSessionVideo";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * El bloque del vídeo de una sesión en la pantalla del evento (#965, RF-4 del
 * PRD de E37): quien ve el evento abre el vídeo en YouTube; Admin, Committee
 * y Coach lo ponen, lo cambian y lo quitan sin recargar.
 */

const EVENT_ID = "e1e1e1e1-0000-4000-8000-00000000000e";
const VIDEO_PATH = `/api/v1/events/${EVENT_ID}/video`;
const VIDEO = "https://youtu.be/abc123";

type Call = {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
};

const calls: Call[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubApi(answer: (call: Call) => Response | Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const call = {
        method: init?.method ?? "GET",
        pathname: new URL(input, "http://localhost").pathname,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      return answer(call);
    }),
  );
}

function stubSavingApi(): void {
  stubApi((call) => {
    if (call.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    const { url } = call.body as { url: string };
    return jsonResponse(200, { data: { eventId: EVENT_ID, url } });
  });
}

/** El bloque con su vídeo en estado, como lo tiene la fila. */
function VideoHarness({
  initialUrl,
  canEdit,
  isCancelled,
  locale,
}: {
  readonly initialUrl: string | null;
  readonly canEdit: boolean;
  readonly isCancelled: boolean;
  readonly locale: "en" | "es";
}): React.JSX.Element {
  const [videoUrl, setVideoUrl] = useState(initialUrl);
  return (
    <EventSessionVideo
      translate={createTranslator(locale)}
      eventId={EVENT_ID}
      videoUrl={videoUrl}
      canEdit={canEdit}
      isCancelled={isCancelled}
      onChange={setVideoUrl}
    />
  );
}

function renderVideo(
  options: {
    readonly videoUrl?: string | null;
    readonly canEdit?: boolean;
    readonly isCancelled?: boolean;
    readonly locale?: "en" | "es";
  } = {},
): void {
  render(
    <VideoHarness
      initialUrl={options.videoUrl ?? null}
      canEdit={options.canEdit ?? true}
      isCancelled={options.isCancelled ?? false}
      locale={options.locale ?? "en"}
    />,
  );
}

async function pasteAndSave(url: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add video" }));
  const field = screen.getByRole("textbox", { name: "YouTube link" });
  await user.clear(field);
  if (url !== "") {
    await user.type(field, url);
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("EventSessionVideo", () => {
  it("ofrece Add video a quien puede ponerlo en una sesión sin vídeo", () => {
    renderVideo({ canEdit: true });

    expect(
      screen.getByRole("button", { name: "Add video" }),
    ).toBeInTheDocument();
  });

  it("no pinta nada a un Player en una sesión sin vídeo", () => {
    const { container } = render(
      <EventSessionVideo
        translate={createTranslator("en")}
        eventId={EVENT_ID}
        videoUrl={null}
        canEdit={false}
        isCancelled={false}
        onChange={() => undefined}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("no ofrece Add video en un evento cancelado", () => {
    renderVideo({ canEdit: true, isCancelled: true });

    expect(
      screen.queryByRole("button", { name: "Add video" }),
    ).not.toBeInTheDocument();
  });

  it("guarda el enlace pegado y enseña Watch session video sin recargar", async () => {
    stubSavingApi();
    renderVideo();

    await pasteAndSave(VIDEO);

    const link = await screen.findByRole("link", {
      name: /Watch session video/,
    });
    expect(link).toHaveAttribute("href", VIDEO);
    expect(calls).toEqual([
      { method: "PUT", pathname: VIDEO_PATH, body: { url: VIDEO } },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("Video saved.");
  });

  it("no guarda un enlace que no es de un vídeo de YouTube y lo dice en el campo", async () => {
    stubSavingApi();
    renderVideo();

    await pasteAndSave("https://www.youtube.com/@club");

    const field = screen.getByRole("textbox", { name: "YouTube link" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "Paste a link to a YouTube video.",
    );
    expect(calls).toEqual([]);
  });

  it("no guarda un enlace de más de 300 caracteres y explica el límite", async () => {
    stubSavingApi();
    renderVideo();

    await pasteAndSave(`https://youtu.be/${"a".repeat(290)}`);

    expect(
      screen.getByRole("textbox", { name: "YouTube link" }),
    ).toHaveAccessibleDescription("The link can be up to 300 characters.");
    expect(calls).toEqual([]);
  });

  it("enseña el motivo que devuelve el servidor", async () => {
    stubApi(() =>
      jsonResponse(400, {
        error: {
          code: "validation_error",
          message: "x",
          reason: "not_youtube_video",
        },
      }),
    );
    renderVideo();

    await pasteAndSave(VIDEO);

    expect(
      await screen.findByText("Paste a link to a YouTube video."),
    ).toBeInTheDocument();
  });

  it("deja el campo abierto con el enlace tras un fallo de red", async () => {
    stubApi(() => Promise.reject(new TypeError("Failed to fetch")));
    renderVideo();

    await pasteAndSave(VIDEO);

    const field = await screen.findByRole("textbox", { name: "YouTube link" });
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(
        "We couldn't save the video. Try again.",
      ),
    );
    expect(field).toHaveValue(VIDEO);
  });

  it("vuelve a Add video al cancelar, con el foco en el botón", async () => {
    const user = userEvent.setup();
    renderVideo();
    await user.click(screen.getByRole("button", { name: "Add video" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Add video" })).toHaveFocus();
  });

  it("abre el vídeo en una pestaña nueva, también a un Player", () => {
    renderVideo({ videoUrl: VIDEO, canEdit: false });

    const link = screen.getByRole("link", { name: /Watch session video/ });
    expect(link).toHaveAttribute("href", VIDEO);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.queryByRole("button", { name: /Change|Remove/ }),
    ).not.toBeInTheDocument();
  });

  it("sigue enseñando el vídeo de un evento cancelado", () => {
    renderVideo({ videoUrl: VIDEO, isCancelled: true });

    expect(
      screen.getByRole("link", { name: /Watch session video/ }),
    ).toBeInTheDocument();
  });

  it("cambia el enlace con el actual ya en el campo", async () => {
    const user = userEvent.setup();
    stubSavingApi();
    renderVideo({ videoUrl: VIDEO });
    await user.click(screen.getByRole("button", { name: "Change video" }));
    const field = screen.getByRole("textbox", { name: "YouTube link" });
    expect(field).toHaveValue(VIDEO);

    await user.clear(field);
    await user.type(field, "https://www.youtube.com/watch?v=xyz789");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("link", { name: /Watch session video/ }),
    ).toHaveAttribute("href", "https://www.youtube.com/watch?v=xyz789");
  });

  it("pide confirmación para quitar y devuelve el foco a Remove al no quitarlo", async () => {
    const user = userEvent.setup();
    renderVideo({ videoUrl: VIDEO });
    await user.click(screen.getByRole("button", { name: "Remove video" }));

    expect(
      screen.getByRole("group", {
        name: "Remove the video from this session?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep it" }));

    expect(screen.getByRole("button", { name: "Remove video" })).toHaveFocus();
    expect(calls).toEqual([]);
  });

  it("quita el vídeo al confirmar y vuelve a ofrecer Add video", async () => {
    const user = userEvent.setup();
    stubSavingApi();
    renderVideo({ videoUrl: VIDEO });
    await user.click(screen.getByRole("button", { name: "Remove video" }));

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(
      await screen.findByRole("button", { name: "Add video" }),
    ).toBeInTheDocument();
    expect(calls).toEqual([
      { method: "DELETE", pathname: VIDEO_PATH, body: null },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("Video removed.");
  });

  it("deja quitar el vídeo de un evento cancelado, pero no cambiarlo", () => {
    renderVideo({ videoUrl: VIDEO, isCancelled: true });

    expect(
      screen.getByRole("button", { name: "Remove video" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Change video" }),
    ).not.toBeInTheDocument();
  });

  it("dice que no se pudo quitar si falla", async () => {
    const user = userEvent.setup();
    stubApi(() => Promise.reject(new TypeError("Failed to fetch")));
    renderVideo({ videoUrl: VIDEO });
    await user.click(screen.getByRole("button", { name: "Remove video" }));

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't remove the video. Try again.",
    );
  });

  it("habla español", async () => {
    const user = userEvent.setup();
    renderVideo({ videoUrl: VIDEO, locale: "es" });

    expect(
      screen.getByRole("link", { name: /Ver el vídeo de la sesión/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quitar vídeo" }));
    expect(
      screen.getByRole("group", { name: "¿Quitar el vídeo de esta sesión?" }),
    ).toBeInTheDocument();
  });
});
