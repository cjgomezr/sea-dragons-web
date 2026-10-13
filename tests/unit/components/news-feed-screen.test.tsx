import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsFeedScreen } from "@/components/news/NewsFeedScreen";
import type {
  NewsFeedItem,
  NewsFeedResponsePage,
  NewsPinnedFeedItem,
} from "@/lib/news/news-feed";

/**
 * El feed de noticias en pantalla (#329, RF-4 del PRD de E11). El orden y la
 * audiencia los decide el servidor (#327): lo que se prueba aquí es que la
 * pantalla enseña lo que respondió, en ese orden, y que pide la página
 * siguiente con el cursor que le dieron sin perder las filas que ya tenía.
 *
 * Desde E22 (#594) la primera queda arriba como tarjeta destacada: la fijada
 * si hay una para quien mira, y si no la más reciente. La lista de debajo
 * nunca la repite.
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
  status: "published",
  attachmentCount: 2,
  coverThumbnailUrl: null,
  coverUrl: null,
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
  status: "published",
  attachmentCount: 0,
  coverThumbnailUrl: null,
  coverUrl: null,
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
  status: "published",
  attachmentCount: 1,
  coverThumbnailUrl: null,
  coverUrl: null,
};

/** Fijada hasta el 30 de octubre por la tarde en Melbourne. */
const PINNED: NewsPinnedFeedItem = {
  id: "dddddddd-0000-4000-8000-00000000000d",
  category: "announcement",
  title: "Spring league registration closes Friday",
  excerpt: "Have your AUF number and a recent photo ready.",
  author: {
    id: "44444444-0000-4000-8000-000000000004",
    fullName: "Camilo Gómez",
  },
  publishedAt: "2026-09-18T08:00:00.000Z",
  status: "published",
  attachmentCount: 1,
  coverThumbnailUrl: null,
  coverUrl: null,
  pinnedUntil: "2026-10-30T08:00:00.000Z",
};

/** La última visita fue ahora: nada de lo de prueba cuenta como nuevo. */
const SEEN_NOTHING_NEW = NOW.toISOString();
/** Hace tres días: SHORTLIST es nueva; WINTER y las anteriores, no. */
const SEEN_THREE_DAYS_AGO = "2026-09-23T08:00:00.000Z";

type FeedStub = (cursor: string | null) => Response | Promise<Response>;

const requestedCursors: (string | null)[] = [];
const NEWS_SEEN_PATH = "/api/v1/account/news-seen";
const newsVisits: string[] = [];
const requestLog: string[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type StubbedPage = Omit<NewsFeedResponsePage, "seenAt"> & {
  readonly seenAt?: string | null;
};

function pageResponse({
  seenAt = SEEN_NOTHING_NEW,
  ...page
}: StubbedPage): Response {
  return jsonResponse(200, { data: { ...page, seenAt } });
}

function stubFeed(respond: FeedStub): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      requestLog.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === NEWS_SEEN_PATH) {
        newsVisits.push(init?.method ?? "GET");
        return new Response(null, { status: 204 });
      }
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
  stubFeed(() => pageResponse({ pinned: null, posts, nextCursor: null }));
}

function stubPinnedPage(
  pinned: NewsPinnedFeedItem,
  posts: readonly NewsFeedItem[],
): void {
  stubFeed(() => pageResponse({ pinned, posts, nextCursor: null }));
}

/** Otra publicación con los datos de `post`, para llenar una página. */
function aPostLike(post: NewsFeedItem, idPrefix: string): NewsFeedItem {
  return {
    ...post,
    id: `${idPrefix}-0000-4000-8000-000000000000`,
    title: `${post.title} (${idPrefix})`,
  };
}

function feedList(): HTMLElement {
  return screen.getByRole("list", { name: /^(earlier|latest)$/i });
}

function listTitles(): (string | null)[] {
  return within(feedList())
    .getAllByRole("link")
    .map((link) => link.textContent);
}

function featuredCard(title: string): HTMLElement {
  return screen.getByRole("article", { name: title });
}

function rowOf(title: string): HTMLElement {
  const row = screen.getByRole("link", { name: title }).closest("li");
  if (row === null) {
    throw new Error(`"${title}" no está en ninguna fila de la lista.`);
  }
  return row;
}

beforeEach(() => {
  requestedCursors.length = 0;
  newsVisits.length = 0;
  requestLog.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("feed de noticias", () => {
  it("registra la visita a Noticias una sola vez al abrirse (#424)", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    await waitFor(() => expect(newsVisits).toEqual(["POST"]));
  });

  it("registra la visita después de leer el feed, que así trae la visita anterior y no esta", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    await waitFor(() =>
      expect(requestLog).toEqual([
        `GET ${FEED_PATH}`,
        `POST ${NEWS_SEEN_PATH}`,
      ]),
    );
  });

  it("reintentar la carga no es otra visita", async () => {
    let attempts = 0;
    stubFeed(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      return pageResponse({
        pinned: null,
        posts: [SHORTLIST],
        nextCursor: null,
      });
    });
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await screen.findByRole("link", { name: SHORTLIST.title });
    await waitFor(() => expect(newsVisits).toEqual(["POST"]));
  });

  it("enseña las publicaciones en el orden en que las sirve el servidor, de la más reciente a la más antigua", async () => {
    stubSinglePage([SHORTLIST, WINTER, POLICY]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      [SHORTLIST.title, WINTER.title, POLICY.title],
    );
  });

  it("cada fila trae su categoría, hace cuánto, el autor, el título y el extracto", async () => {
    stubSinglePage([WINTER, SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    const inRow = within(rowOf(SHORTLIST.title));
    expect(inRow.getByText("Announcement")).toBeInTheDocument();
    expect(inRow.getByText("2 days ago")).toBeInTheDocument();
    expect(inRow.getByText("Sofía Castro")).toBeInTheDocument();
    expect(inRow.getByText(SHORTLIST.excerpt)).toBeInTheDocument();
  });

  it("la fila abre la publicación", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    expect(
      await screen.findByRole("link", { name: SHORTLIST.title }),
    ).toHaveAttribute("href", `/noticias/${SHORTLIST.id}`);
  });

  it("la marca de adjuntos dice cuántos son", async () => {
    stubSinglePage([SHORTLIST, POLICY]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(screen.getByText("2 attachments")).toBeInTheDocument();
    expect(screen.getByText("1 attachment")).toBeInTheDocument();
  });

  it("una publicación sin adjuntos no lleva marca", async () => {
    stubSinglePage([WINTER]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: WINTER.title });
    expect(screen.queryByText(/attachment/)).not.toBeInTheDocument();
  });

  it("dice en español la categoría, el tiempo y los adjuntos", async () => {
    stubSinglePage([SHORTLIST, WINTER]);

    render(<NewsFeedScreen locale="es" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(screen.getByText("Aviso")).toBeInTheDocument();
    expect(screen.getByText("hace 4 días")).toBeInTheDocument();
    expect(screen.getByText("2 adjuntos")).toBeInTheDocument();
  });

  it("explica con una frase que no hay nada publicado para quien mira", async () => {
    stubSinglePage([]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    expect(
      await screen.findByText("Nothing has been published for you yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("carga las siguientes con el cursor recibido y conserva las que ya había", async () => {
    stubFeed((cursor) =>
      cursor === null
        ? pageResponse({
            pinned: null,
            posts: [SHORTLIST, WINTER],
            nextCursor: "pagina-2",
          })
        : pageResponse({ pinned: null, posts: [POLICY], nextCursor: null }),
    );
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    await screen.findByRole("link", { name: POLICY.title });
    expect(requestedCursors).toEqual([null, "pagina-2"]);
    expect(featuredCard(SHORTLIST.title)).toBeInTheDocument();
    expect(listTitles()).toEqual([WINTER.title, POLICY.title]);
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("tras cargar más, el foco queda en la primera publicación nueva, no al principio de la página", async () => {
    stubFeed((cursor) =>
      cursor === null
        ? pageResponse({
            pinned: null,
            posts: [SHORTLIST, WINTER],
            nextCursor: "pagina-2",
          })
        : pageResponse({
            pinned: null,
            posts: [POLICY, aPostLike(POLICY, "eeeeeeee")],
            nextCursor: null,
          }),
    );
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    const firstNew = await screen.findByRole("link", { name: POLICY.title });
    await waitFor(() => expect(firstNew).toHaveFocus());
  });

  it("no ofrece cargar más en la última página", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

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
      return pageResponse({
        pinned: null,
        posts: [SHORTLIST],
        nextCursor: null,
      });
    });
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" canPublish={false} />);

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
        return pageResponse({
          pinned: null,
          posts: [SHORTLIST],
          nextCursor: "pagina-2",
        });
      }
      moreAttempts += 1;
      if (moreAttempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      return pageResponse({ pinned: null, posts: [WINTER], nextCursor: null });
    });
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" canPublish={false} />);

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

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session ended. Sign in again to see the news.",
    );
  });
});

describe("la cabecera del feed", () => {
  it("lleva la etiqueta de la sección y el título", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Club feed" }),
    ).toBeInTheDocument();
    expect(screen.getByText("News & documents")).toBeInTheDocument();
    await screen.findByRole("link", { name: SHORTLIST.title });
  });

  it("ofrece publicar a quien puede", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish />);

    expect(screen.getByRole("link", { name: "+ Publish" })).toHaveAttribute(
      "href",
      "/noticias/publicar",
    );
    await screen.findByRole("link", { name: SHORTLIST.title });
  });

  it("no ofrece publicar a quien no puede", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(
      screen.queryByRole("link", { name: "+ Publish" }),
    ).not.toBeInTheDocument();
  });
});

describe("la tarjeta destacada", () => {
  it("es la fijada vigente, con hasta cuándo está fijada", async () => {
    stubPinnedPage(PINNED, [SHORTLIST, WINTER]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: PINNED.title });
    const inCard = within(featuredCard(PINNED.title));
    expect(inCard.getByText("Pinned · until 30 Oct")).toBeInTheDocument();
    expect(inCard.queryByText("Latest")).not.toBeInTheDocument();
  });

  it("dice sólo que está fijada cuando no tiene fecha de fin", async () => {
    stubPinnedPage({ ...PINNED, pinnedUntil: null }, [SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: PINNED.title });
    expect(
      within(featuredCard(PINNED.title)).getByText("Pinned"),
    ).toBeInTheDocument();
  });

  it("dice en español hasta cuándo está fijada", async () => {
    stubPinnedPage(PINNED, [SHORTLIST]);

    render(<NewsFeedScreen locale="es" canPublish={false} />);

    await screen.findByRole("link", { name: PINNED.title });
    expect(
      within(featuredCard(PINNED.title)).getByText("Fijada · hasta el 30 oct"),
    ).toBeInTheDocument();
  });

  it("sin fijada es la más reciente, marcada como lo último", async () => {
    stubSinglePage([SHORTLIST, WINTER]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    const inCard = within(featuredCard(SHORTLIST.title));
    expect(inCard.getByText("Latest")).toBeInTheDocument();
    expect(inCard.queryByText(/^Pinned/)).not.toBeInTheDocument();
  });

  it("trae su categoría, hace cuánto, el autor, el título, el extracto y la invitación a leerla", async () => {
    stubSinglePage([SHORTLIST, WINTER]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    const inCard = within(featuredCard(SHORTLIST.title));
    expect(
      inCard.getByRole("heading", { level: 2, name: SHORTLIST.title }),
    ).toBeInTheDocument();
    expect(inCard.getByText("Announcement")).toBeInTheDocument();
    expect(inCard.getByText("2 days ago")).toBeInTheDocument();
    expect(inCard.getByText("Sofía Castro")).toBeInTheDocument();
    expect(inCard.getByText(SHORTLIST.excerpt)).toBeInTheDocument();
    expect(inCard.getByText("Read post")).toBeInTheDocument();
    expect(inCard.getByText("2 attachments")).toBeInTheDocument();
  });

  it("enseña su portada grande cuando la tiene", async () => {
    stubSinglePage([
      {
        ...SHORTLIST,
        coverUrl: "https://archivos.test/portada-grande.webp",
        coverThumbnailUrl: "https://archivos.test/portada-mini.webp",
      },
    ]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(featuredCard(SHORTLIST.title).querySelector("img")).toHaveAttribute(
      "src",
      "https://archivos.test/portada-grande.webp",
    );
  });

  it("sin portada no pinta ninguna imagen: lleva el fondo de su categoría", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(featuredCard(SHORTLIST.title).querySelector("img")).toBeNull();
  });

  it("una portada que no carga deja el fondo de su categoría y no un icono roto", async () => {
    stubSinglePage([
      {
        ...SHORTLIST,
        coverUrl: "https://archivos.test/caducada.webp",
        coverThumbnailUrl: "https://archivos.test/caducada-mini.webp",
      },
    ]);
    render(<NewsFeedScreen locale="en" canPublish={false} />);
    await screen.findByRole("link", { name: SHORTLIST.title });
    const cover = featuredCard(SHORTLIST.title).querySelector("img");
    expect(cover).not.toBeNull();

    fireEvent.error(cover as HTMLImageElement);

    expect(featuredCard(SHORTLIST.title).querySelector("img")).toBeNull();
  });
});

describe("la lista bajo la destacada", () => {
  it("con una fijada se titula lo último y no la repite", async () => {
    stubPinnedPage(PINNED, [SHORTLIST, WINTER]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: PINNED.title });
    expect(
      screen.getByRole("heading", { level: 2, name: "Latest" }),
    ).toBeInTheDocument();
    expect(listTitles()).toEqual([SHORTLIST.title, WINTER.title]);
    expect(screen.getAllByRole("link", { name: PINNED.title })).toHaveLength(1);
  });

  it("sin fijada se titula anteriores y empieza en la segunda", async () => {
    stubSinglePage([SHORTLIST, WINTER, POLICY]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(
      screen.getByRole("heading", { level: 2, name: "Earlier" }),
    ).toBeInTheDocument();
    expect(listTitles()).toEqual([WINTER.title, POLICY.title]);
  });

  it("dice en español sus etiquetas", async () => {
    stubSinglePage([SHORTLIST, WINTER]);

    render(<NewsFeedScreen locale="es" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(
      screen.getByRole("heading", { level: 2, name: "Anteriores" }),
    ).toBeInTheDocument();
    expect(
      within(featuredCard(SHORTLIST.title)).getByText("Lo último"),
    ).toBeInTheDocument();
  });

  it("con una sola publicación no hay lista ni etiqueta de lista", async () => {
    stubSinglePage([SHORTLIST]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(featuredCard(SHORTLIST.title)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^(Latest|Earlier)$/ }),
    ).not.toBeInTheDocument();
  });

  it("con sólo la fijada tampoco hay lista", async () => {
    stubPinnedPage(PINNED, []);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: PINNED.title });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing has been published/)).toBeNull();
  });

  it("la fila enseña la miniatura de su portada cuando la tiene", async () => {
    stubSinglePage([
      SHORTLIST,
      {
        ...WINTER,
        coverUrl: "https://archivos.test/invierno-grande.webp",
        coverThumbnailUrl: "https://archivos.test/invierno-mini.webp",
      },
    ]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: WINTER.title });
    expect(rowOf(WINTER.title).querySelector("img")).toHaveAttribute(
      "src",
      "https://archivos.test/invierno-mini.webp",
    );
  });

  it("la fila sin portada no pinta ninguna imagen", async () => {
    stubSinglePage([SHORTLIST, WINTER]);

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: WINTER.title });
    expect(rowOf(WINTER.title).querySelector("img")).toBeNull();
  });

  it("cargar más con una fijada la deja arriba y añade a la lista", async () => {
    stubFeed((cursor) =>
      cursor === null
        ? pageResponse({
            pinned: PINNED,
            posts: [SHORTLIST],
            nextCursor: "pagina-2",
          })
        : pageResponse({ pinned: null, posts: [WINTER], nextCursor: null }),
    );
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    const firstNew = await screen.findByRole("link", { name: WINTER.title });
    await waitFor(() => expect(firstNew).toHaveFocus());
    expect(featuredCard(PINNED.title)).toBeInTheDocument();
    expect(listTitles()).toEqual([SHORTLIST.title, WINTER.title]);
  });
});

describe("lo que no se ha leído", () => {
  it("la destacada nueva lo dice con la palabra", async () => {
    stubFeed(() =>
      pageResponse({
        pinned: null,
        posts: [SHORTLIST, WINTER],
        nextCursor: null,
        seenAt: SEEN_THREE_DAYS_AGO,
      }),
    );

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(
      within(featuredCard(SHORTLIST.title)).getByText("New"),
    ).toBeInTheDocument();
    expect(within(rowOf(WINTER.title)).queryByText("New")).toBeNull();
  });

  it("la fila nueva lleva su punto con texto para el lector de pantalla", async () => {
    stubFeed(() =>
      pageResponse({
        pinned: PINNED,
        posts: [SHORTLIST, WINTER],
        nextCursor: null,
        seenAt: SEEN_THREE_DAYS_AGO,
      }),
    );

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByRole("link", { name: PINNED.title });
    expect(within(rowOf(SHORTLIST.title)).getByText("New")).toBeInTheDocument();
    expect(within(rowOf(WINTER.title)).queryByText("New")).toBeNull();
    expect(within(featuredCard(PINNED.title)).queryByText("New")).toBeNull();
  });

  it("dice en español que es nueva", async () => {
    stubFeed(() =>
      pageResponse({
        pinned: null,
        posts: [SHORTLIST],
        nextCursor: null,
        seenAt: SEEN_THREE_DAYS_AGO,
      }),
    );

    render(<NewsFeedScreen locale="es" canPublish={false} />);

    await screen.findByRole("link", { name: SHORTLIST.title });
    expect(
      within(featuredCard(SHORTLIST.title)).getByText("Nueva"),
    ).toBeInTheDocument();
  });

  it("lo que llega con cargar más se compara con la visita de antes de abrir, no con la que acaba de registrar", async () => {
    const olderButUnread: NewsFeedItem = {
      ...POLICY,
      publishedAt: "2026-09-23T20:00:00.000Z",
    };
    stubFeed((cursor) =>
      cursor === null
        ? pageResponse({
            pinned: null,
            posts: [SHORTLIST, WINTER],
            nextCursor: "pagina-2",
            seenAt: SEEN_THREE_DAYS_AGO,
          })
        : pageResponse({
            pinned: null,
            posts: [olderButUnread],
            nextCursor: null,
            seenAt: NOW.toISOString(),
          }),
    );
    const user = userEvent.setup();
    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    await screen.findByRole("link", { name: POLICY.title });
    expect(within(rowOf(POLICY.title)).getByText("New")).toBeInTheDocument();
  });
});
