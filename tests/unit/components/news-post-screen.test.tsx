import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsAttachmentDownload } from "@/lib/news/news-attachments";
import type { NewsPostDetail } from "@/lib/news/news-posts";

/**
 * La publicación abierta en pantalla (#329, RF-5 del PRD de E11; #596, RF-7
 * del PRD de E22): la portada, la categoría y la audiencia, el autor con su
 * foto, las fechas, el cuerpo en Markdown y los adjuntos. Lo que no le
 * corresponde a quien mira ya llega del servidor como 404 (#327), y la
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
const COVER_URL = "https://storage.test/covers/portada-grande.webp";
const AUTHOR_PHOTO_URL = "https://storage.test/photos/liam.webp";
const WORD_ID = "d3d3d3d3-0000-4000-8000-0000000000d3";
const NEWS_SEEN_PATH = "/api/v1/account/news-seen";

const newsVisits: string[] = [];

const POST: NewsPostDetail = {
  id: POST_ID,
  category: "document",
  title: "Updated pool safety policy",
  body: "Please review the revised buddy-check policy.\nSignature required.\n\nThanks, the committee.",
  author: {
    id: "33333333-0000-4000-8000-000000000003",
    fullName: "Liam O'Connor",
    photoUrl: null,
  },
  audience: { kind: "club" },
  publishedAt: "2026-09-15T08:00:00.000Z",
  editedAt: null,
  status: "published",
  canManage: false,
  coverUrl: null,
  isPinned: false,
  pinnedUntil: null,
  canPin: false,
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
    {
      id: WORD_ID,
      fileName: "acta.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 18 * 1024,
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
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === POST_PATH) {
        return stub.post?.() ?? jsonResponse(200, { data: POST });
      }
      if (url === NEWS_SEEN_PATH) {
        newsVisits.push(init?.method ?? "GET");
        return new Response(null, { status: 204 });
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
  newsVisits.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publicación abierta", () => {
  it("registra la visita a Noticias al abrirse (#424)", async () => {
    stubApi();

    await renderPost();

    expect(newsVisits).toEqual(["POST"]);
  });

  it("enseña el título, la categoría, el autor, la fecha y el cuerpo entero", async () => {
    stubApi();

    await renderPost();

    expect(
      screen.getByRole("heading", { level: 1, name: POST.title }),
    ).toBeInTheDocument();
    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.getByText(/Liam O'Connor/)).toBeInTheDocument();
    expect(screen.getByText(/15 September 2026/)).toBeInTheDocument();
    expect(screen.getByText(/buddy-check policy\./)).toBeInTheDocument();
    expect(screen.getByText("Thanks, the committee.")).toBeInTheDocument();
  });

  it("pinta el cuerpo con el renderizador de Markdown (#593)", async () => {
    stubPost({
      ...POST,
      body: "The squad took **silver**.\n\n## Highlights\n\n- Four wins",
      attachments: [],
    });

    await renderPost();

    expect(screen.getByText("silver").tagName).toBe("STRONG");
    expect(
      screen.getByRole("heading", { level: 2, name: "Highlights" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("Four wins");
  });

  it("respeta los saltos del texto plano: uno simple parte la línea y uno doble, el párrafo", async () => {
    stubApi();

    await renderPost();

    const firstParagraph = screen.getByText(/buddy-check policy\./);
    expect(firstParagraph.tagName).toBe("P");
    expect(firstParagraph).toHaveTextContent(
      "Please review the revised buddy-check policy. Signature required.",
    );
    expect(firstParagraph.querySelector("br")).not.toBeNull();
    expect(screen.getByText("Thanks, the committee.")).not.toBe(firstParagraph);
  });

  it("enseña la portada arriba cuando la tiene", async () => {
    stubPost({ ...POST, coverUrl: COVER_URL });

    const { container } = render(
      <NewsPostScreen locale="en" postId={POST_ID} />,
    );
    await screen.findByRole("heading", { level: 1 });

    expect(container.querySelector(`img[src="${COVER_URL}"]`)).not.toBeNull();
    expect(container.querySelector(".news-cover-fallback")).toBeNull();
  });

  it("sin portada, enseña en su lugar el fondo de su categoría", async () => {
    stubApi();

    const { container } = render(
      <NewsPostScreen locale="en" postId={POST_ID} />,
    );
    await screen.findByRole("heading", { level: 1 });

    expect(
      container.querySelector(".news-post-cover .news-cover-fallback-document"),
    ).not.toBeNull();
  });

  it("dice que va a todo el club", async () => {
    stubApi();

    await renderPost();

    expect(screen.getByText("For the whole club")).toBeInTheDocument();
  });

  it("nombra los grupos a los que va", async () => {
    stubPost({
      ...POST,
      audience: { kind: "groups", groupNames: ["U16 squad", "Parents"] },
    });

    await renderPost();

    expect(screen.getByText("For U16 squad · Parents")).toBeInTheDocument();
  });

  it("dice la audiencia en español", async () => {
    stubPost({ ...POST, audience: { kind: "groups", groupNames: ["Sub-16"] } });

    await renderPost("es");

    expect(screen.getByText("Para Sub-16")).toBeInTheDocument();
  });

  it("pone la foto del autor junto a su nombre", async () => {
    stubPost({
      ...POST,
      author: { ...POST.author, photoUrl: AUTHOR_PHOTO_URL },
    });

    const { container } = render(
      <NewsPostScreen locale="en" postId={POST_ID} />,
    );
    await screen.findByRole("heading", { level: 1 });

    expect(
      container.querySelector(`img[src="${AUTHOR_PHOTO_URL}"]`),
    ).not.toBeNull();
  });

  it("sin foto, pone las iniciales del autor", async () => {
    stubApi();

    await renderPost();

    expect(screen.getByText("LO")).toBeInTheDocument();
  });

  it("junta en una línea la publicada y la editada", async () => {
    stubPost({ ...POST, editedAt: "2026-09-20T08:00:00.000Z" });

    await renderPost();

    const published = screen.getByText(/Published 15 September 2026/);
    expect(published.parentElement).toHaveTextContent(
      /Published 15 September 2026.* · Edited 20 September 2026/,
    );
  });

  it("a quien puede, le da Editar y Retirar como botones de icono con nombre", async () => {
    stubPost({ ...POST, canManage: true });

    await renderPost();

    const edit = screen.getByRole("link", { name: "Edit" });
    const withdraw = screen.getByRole("button", { name: "Withdraw" });
    expect(edit).toHaveTextContent(/^$/);
    expect(edit.querySelector("svg")).not.toBeNull();
    expect(withdraw).toHaveTextContent(/^$/);
    expect(withdraw.querySelector("svg")).not.toBeNull();
  });

  it("a quien no puede, no le da Editar ni Retirar", async () => {
    stubApi();

    await renderPost();

    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });

  it.each([
    [/Download reglamento\.pdf/, "PDF"],
    [/Download mapa-piscina\.png/, "Image"],
    [/Download acta\.docx/, "Word document"],
  ])("la tarjeta %s lleva el icono de su tipo", async (name, kind) => {
    stubApi();

    await renderPost();

    const card = screen.getByRole("button", { name });
    expect(within(card).getByRole("img", { name: kind })).toBeInTheDocument();
  });

  it("un adjunto de otro tipo lleva el icono de archivo genérico", async () => {
    stubPost({
      ...POST,
      attachments: [
        {
          id: RULES_ID,
          fileName: "resultados.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: 4096,
        },
      ],
    });

    await renderPost();

    const card = screen.getByRole("button", {
      name: /Download resultados\.xlsx/,
    });
    expect(within(card).getByRole("img", { name: "File" })).toBeInTheDocument();
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

    // La visita a Noticias (#424) va a su propio camino fijo, sin el id.
    expect(requested.filter((url) => url !== NEWS_SEEN_PATH)).toEqual([
      "/api/v1/news/..%2Fdirectory",
    ]);
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
