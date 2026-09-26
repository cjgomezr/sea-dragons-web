import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsFeedScreen } from "@/components/news/NewsFeedScreen";
import type { NewsFeedItem, NewsFeedPage } from "@/lib/news/news-feed";

/**
 * El feed de noticias en pantalla (#329, RF-4 del PRD de E11). El orden y la
 * audiencia los decide el servidor (#327): lo que se prueba aquí es que la
 * pantalla enseña lo que respondió, en ese orden, y que pide la página
 * siguiente con el cursor que le dieron sin perder las filas que ya tenía.
 */

const FEED_PATH = "/api/v1/news";
const NOW = new Date("2026-09-26T08:00:00.000Z");
const TWO_DAYS_AGO = "2026-09-24T08:00:00.000Z";
const FOUR_DAYS_AGO = "2026-09-22T08:00:00.000Z";

const SHORTLIST: NewsFeedItem = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  category: "announcement",
  title: "Nationals squad shortlist announced",
  excerpt: "Twelve Seadragons named in the extended squad.",
  author: {
    id: "11111111-0000-4000-8000-000000000001",
    fullName: "Sofía Castro",
  },
  publishedAt: TWO_DAYS_AGO,
  attachmentCount: 2,
};

const WINTER: NewsFeedItem = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  category: "news",
  title: "Winter training schedule is live",
  excerpt: "Two sessions a week through July.",
  author: {
    id: "22222222-0000-4000-8000-000000000002",
    fullName: "Santiago Holguín",
  },
  publishedAt: FOUR_DAYS_AGO,
  attachmentCount: 0,
};

const POLICY: NewsFeedItem = {
  id: "cccccccc-0000-4000-8000-00000000000c",
  category: "document",
  title: "Updated pool safety policy",
  excerpt: "Please review the buddy-check policy.",
  author: {
    id: "33333333-0000-4000-8000-000000000003",
    fullName: "Liam O'Connor",
  },
  publishedAt: "2026-09-19T08:00:00.000Z",
  attachmentCount: 1,
};

type FeedStub = (cursor: string | null) => Response | Promise<Response>;

const requestedCursors: (string | null)[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pageResponse(page: NewsFeedPage): Response {
  return jsonResponse(200, { data: page });
}

function stubFeed(respond: FeedStub): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname !== FEED_PATH) {
        throw new Error(`Petición inesperada: ${input}`);
      }
      const cursor = url.searchParams.get("cursor");
      requestedCursors.push(cursor);
      return respond(cursor);
    }),
  );
}

function stubSinglePage(posts: readonly NewsFeedItem[]): void {
  stubFeed(() => pageResponse({ posts, nextCursor: null }));
}

function feedList(): HTMLElement {
  return screen.getByRole("list", { name: /club feed/i });
}

beforeEach(() => {
  requestedCursors.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("feed de noticias", () => {
  it("enseña las publicaciones en el orden en que las sirve el servidor, de la más reciente a la más antigua", async () => {
    stubSinglePage([SHORTLIST, WINTER, POLICY]);

    render(<NewsFeedScreen locale="en" />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    const links = within(feedList()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      SHORTLIST.title,
      WINTER.title,
      POLICY.title,
    ]);
  });

  it("cada fila trae su categoría, hace cuánto, el autor, el título y el extracto", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" />);

    const link = await screen.findByRole("link", { name: SHORTLIST.title });
    const row = link.closest("li");
    expect(row).not.toBeNull();
    const inRow = within(row as HTMLElement);
    expect(inRow.getByText("Announcement")).toBeInTheDocument();
    expect(inRow.getByText("2 days ago")).toBeInTheDocument();
    expect(inRow.getByText("Sofía Castro")).toBeInTheDocument();
    expect(inRow.getByText(SHORTLIST.excerpt)).toBeInTheDocument();
  });

  it("la fila abre la publicación", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" />);

    expect(
      await screen.findByRole("link", { name: SHORTLIST.title }),
    ).toHaveAttribute("href", `/noticias/${SHORTLIST.id}`);
  });

  it("la marca de adjuntos dice cuántos son", async () => {
    stubSinglePage([SHORTLIST, POLICY]);

    render(<NewsFeedScreen locale="en" />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(screen.getByText("2 attachments")).toBeInTheDocument();
    expect(screen.getByText("1 attachment")).toBeInTheDocument();
  });

  it("una publicación sin adjuntos no lleva marca", async () => {
    stubSinglePage([WINTER]);

    render(<NewsFeedScreen locale="en" />);

    await screen.findByRole("link", { name: WINTER.title });
    expect(screen.queryByText(/attachment/)).not.toBeInTheDocument();
  });

  it("dice en español la categoría, el tiempo y los adjuntos", async () => {
    stubSinglePage([SHORTLIST, WINTER]);

    render(<NewsFeedScreen locale="es" />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(screen.getByText("Aviso")).toBeInTheDocument();
    expect(screen.getByText("hace 4 días")).toBeInTheDocument();
    expect(screen.getByText("2 adjuntos")).toBeInTheDocument();
  });

  it("explica con una frase que no hay nada publicado para quien mira", async () => {
    stubSinglePage([]);

    render(<NewsFeedScreen locale="en" />);

    expect(
      await screen.findByText("Nothing has been published for you yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("carga las siguientes con el cursor recibido y conserva las que ya había", async () => {
    stubFeed((cursor) =>
      cursor === null
        ? pageResponse({ posts: [SHORTLIST, WINTER], nextCursor: "pagina-2" })
        : pageResponse({ posts: [POLICY], nextCursor: null }),
    );
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" />);

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    await screen.findByRole("link", { name: POLICY.title });
    expect(requestedCursors).toEqual([null, "pagina-2"]);
    expect(within(feedList()).getAllByRole("link")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("tras cargar más, el foco queda en la primera publicación nueva, no al principio de la página", async () => {
    stubFeed((cursor) =>
      cursor === null
        ? pageResponse({ posts: [SHORTLIST], nextCursor: "pagina-2" })
        : pageResponse({ posts: [WINTER, POLICY], nextCursor: null }),
    );
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" />);

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    const firstNew = await screen.findByRole("link", { name: WINTER.title });
    await waitFor(() => expect(firstNew).toHaveFocus());
  });

  it("no ofrece cargar más en la última página", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("un fallo de red al cargar lo dice y deja reintentar", async () => {
    let attempts = 0;
    stubFeed(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      return pageResponse({ posts: [SHORTLIST], nextCursor: null });
    });
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("link", { name: SHORTLIST.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un fallo al cargar más lo dice sin quitar lo que ya estaba, y deja reintentar", async () => {
    let moreAttempts = 0;
    stubFeed((cursor) => {
      if (cursor === null) {
        return pageResponse({ posts: [SHORTLIST], nextCursor: "pagina-2" });
      }
      moreAttempts += 1;
      if (moreAttempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      return pageResponse({ posts: [WINTER], nextCursor: null });
    });
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" />);

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server.",
    );
    expect(
      screen.getByRole("link", { name: SHORTLIST.title }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(
      await screen.findByRole("link", { name: WINTER.title }),
    ).toBeInTheDocument();
    expect(requestedCursors).toEqual([null, "pagina-2", "pagina-2"]);
  });

  it("una sesión caducada pide volver a entrar", async () => {
    stubFeed(() =>
      jsonResponse(401, {
        error: { code: "unauthenticated", message: "x" },
      }),
    );

    render(<NewsFeedScreen locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session ended. Sign in again to see the news.",
    );
  });
});
