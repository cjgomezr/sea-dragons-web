import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsAttachmentDownload } from "@/lib/news/news-attachments";
import type { NewsPostDetail } from "@/lib/news/news-posts";

/**
 * La publicación abierta en pantalla (#329, RF-5 del PRD de E11): el cuerpo
 * entero como texto, su autor, su fecha, si se editó y sus adjuntos. Lo que no
 * le corresponde a quien mira ya llega del servidor como 404 (#327), y la
 * pantalla lo trata igual que lo que no existe.
 */

const startDownload = vi.fn<(url: string) => void>();

vi.mock("@/components/news/start-download", () => ({
  startDownload: (url: string) => startDownload(url),
}));

const { NewsPostScreen } = await import("@/components/news/NewsPostScreen");

const POST_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const POST_PATH = `/api/v1/news/${POST_ID}`;
const RULES_ID = "d1d1d1d1-0000-4000-8000-0000000000d1";
const MAP_ID = "d2d2d2d2-0000-4000-8000-0000000000d2";
const RULES_PATH = `${POST_PATH}/attachments/${RULES_ID}`;
const SIGNED_URL = "https://storage.test/news/reglamento.pdf?token=firmado";

const POST: NewsPostDetail = {
  id: POST_ID,
  category: "document",
  title: "Updated pool safety policy",
  body: "Please review the revised buddy-check policy.\nSignature required.\n\nThanks, the committee.",
  author: {
    id: "33333333-0000-4000-8000-000000000003",
    fullName: "Liam O'Connor",
  },
  publishedAt: "2026-09-15T08:00:00.000Z",
  editedAt: null,
  status: "published",
  attachments: [
    {
      id: RULES_ID,
      fileName: "reglamento.pdf",
      contentType: "application/pdf",
      sizeBytes: Math.round(2.4 * 1024 * 1024),
    },
    {
      id: MAP_ID,
      fileName: "mapa-piscina.png",
      contentType: "image/png",
      sizeBytes: 240 * 1024,
    },
  ],
};

type Stub = {
  readonly post?: () => Response | Promise<Response>;
  readonly attachment?: () => Response;
};

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notFound(): Response {
  return jsonResponse(404, {
    error: { code: "not_found", message: "La publicación no existe." },
  });
}

function download(value: NewsAttachmentDownload): Response {
  return jsonResponse(200, { data: value });
}

function stubApi(stub: Stub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === POST_PATH) {
        return stub.post?.() ?? jsonResponse(200, { data: POST });
      }
      if (url === RULES_PATH) {
        return (
          stub.attachment?.() ??
          download({
            status: "available",
            fileName: "reglamento.pdf",
            url: SIGNED_URL,
          })
        );
      }
      throw new Error(`Petición inesperada: ${url}`);
    }),
  );
}

function stubPost(post: NewsPostDetail): void {
  stubApi({ post: () => jsonResponse(200, { data: post }) });
}

async function renderPost(locale: "en" | "es" = "en"): Promise<void> {
  render(<NewsPostScreen locale={locale} postId={POST_ID} />);
  await screen.findByRole("heading", { level: 1 });
}

beforeEach(() => {
  startDownload.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publicación abierta", () => {
  it("enseña el título, la categoría, el autor, la fecha y el cuerpo entero", async () => {
    stubApi();

    await renderPost();

    expect(
      screen.getByRole("heading", { level: 1, name: POST.title }),
    ).toBeInTheDocument();
    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.getByText(/Liam O'Connor/)).toBeInTheDocument();
    expect(screen.getByText(/15 September 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Thanks, the committee\./).textContent).toBe(
      POST.body,
    );
  });

  it("pinta el cuerpo tal cual, con sus saltos de línea", async () => {
    stubApi();

    await renderPost();

    const body = screen.getByText(/Signature required/);
    expect(body.textContent).toContain(
      "buddy-check policy.\nSignature required.\n\nThanks",
    );
  });

  it("enseña las etiquetas HTML del cuerpo como texto, sin interpretarlas", async () => {
    stubPost({
      ...POST,
      body: '<b>negrita</b> <img src=x onerror="alert(1)"> <script>alert(2)</script>',
    });

    const { container } = render(
      <NewsPostScreen locale="en" postId={POST_ID} />,
    );
    await screen.findByRole("heading", { level: 1 });

    expect(screen.getByText(/<b>negrita<\/b>/)).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("lista los adjuntos con su nombre y su tamaño", async () => {
    stubApi();

    await renderPost();

    const list = screen.getByRole("list", { name: "Attachments" });
    expect(list).toHaveTextContent("reglamento.pdf");
    expect(list).toHaveTextContent("2.4 MB");
    expect(list).toHaveTextContent("mapa-piscina.png");
    expect(list).toHaveTextContent("240 KB");
  });

  it("pulsar un adjunto lo descarga con la dirección firmada que da el servidor", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderPost();

    await user.click(
      screen.getByRole("button", { name: /Download reglamento\.pdf/ }),
    );

    expect(startDownload).toHaveBeenCalledWith(SIGNED_URL);
  });

  it("avisa si el archivo del adjunto ya no está disponible", async () => {
    stubApi({
      attachment: () =>
        download({ status: "unavailable", fileName: "reglamento.pdf" }),
    });
    const user = userEvent.setup();
    await renderPost();

    await user.click(
      screen.getByRole("button", { name: /Download reglamento\.pdf/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "reglamento.pdf is no longer available.",
    );
    expect(startDownload).not.toHaveBeenCalled();
  });

  it("avisa si la descarga no llega al servidor", async () => {
    stubApi({
      attachment: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const user = userEvent.setup();
    await renderPost();

    await user.click(
      screen.getByRole("button", { name: /Download reglamento\.pdf/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server.",
    );
  });

  it("una publicación sin adjuntos no enseña la lista", async () => {
    stubPost({ ...POST, attachments: [] });

    await renderPost();

    expect(
      screen.queryByRole("list", { name: "Attachments" }),
    ).not.toBeInTheDocument();
  });

  it("una publicación editada dice que lo fue y cuándo", async () => {
    stubPost({ ...POST, editedAt: "2026-09-20T08:00:00.000Z" });

    await renderPost();

    expect(screen.getByText(/Edited 20 September 2026/)).toBeInTheDocument();
  });

  it("marca como retirada la que su autor abre después de retirarla", async () => {
    stubPost({ ...POST, status: "withdrawn" });

    await renderPost();

    expect(screen.getByText("Withdrawn")).toBeInTheDocument();
  });

  it("una publicación vigente no lleva la marca de retirada", async () => {
    stubApi();

    await renderPost();

    expect(screen.queryByText("Withdrawn")).not.toBeInTheDocument();
  });

  it("mientras pide la dirección, el adjunto no se puede volver a pulsar", async () => {
    let answer: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === POST_PATH
          ? jsonResponse(200, { data: POST })
          : new Promise<Response>((resolve) => {
              answer = resolve;
            }),
      ),
    );
    const user = userEvent.setup();
    await renderPost();
    const button = screen.getByRole("button", {
      name: /Download reglamento\.pdf/,
    });

    await user.click(button);

    expect(button).toBeDisabled();
    answer(
      download({
        status: "available",
        fileName: "reglamento.pdf",
        url: SIGNED_URL,
      }),
    );
    await vi.waitFor(() => expect(startDownload).toHaveBeenCalledTimes(1));
    expect(button).toBeEnabled();
  });

  it("una publicación sin editar no lo menciona", async () => {
    stubApi();

    await renderPost();

    expect(screen.queryByText(/Edited/)).not.toBeInTheDocument();
  });

  it("dice en español la categoría, la edición y el tamaño", async () => {
    stubPost({ ...POST, editedAt: "2026-09-20T08:00:00.000Z" });

    await renderPost("es");

    expect(screen.getByText("Documento")).toBeInTheDocument();
    expect(
      screen.getByText(/Editada el 20 de septiembre de 2026/),
    ).toBeInTheDocument();
    expect(screen.getByText("2,4 MB")).toBeInTheDocument();
  });

  it("una publicación que no le corresponde da la pantalla de no existe, sin pistas", async () => {
    stubApi({ post: notFound });

    await renderPost();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This post doesn't exist",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/permission|allowed|audience/i)).toBeNull();
    expect(screen.getByRole("link", { name: /Back to News/ })).toHaveAttribute(
      "href",
      "/noticias",
    );
  });

  it("un id con barras no sale del camino de la publicación", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);
        return notFound();
      }),
    );

    render(<NewsPostScreen locale="en" postId="../directory" />);
    await screen.findByRole("heading", { level: 1 });

    expect(requested).toEqual(["/api/v1/news/..%2Fdirectory"]);
  });

  it("un fallo de red al abrirla lo dice y deja reintentar", async () => {
    let attempts = 0;
    stubApi({
      post: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return jsonResponse(200, { data: POST });
      },
    });
    const user = userEvent.setup();
    render(<NewsPostScreen locale="en" postId={POST_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: POST.title }),
    ).toBeInTheDocument();
  });
});
