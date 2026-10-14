import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsFeedScreen } from "@/components/news/NewsFeedScreen";
import type { NewsFeedItem, NewsPinnedFeedItem } from "@/lib/news/news-feed";

/**
 * Fijar y desfijar desde el feed de escritorio (#595, RF-5 del PRD de E22).
 * Solo el Admin (D1) ve la chincheta de cada fila, que abre debajo la tira de
 * duración, y el "Fijar" o "Desfijar" de la destacada. Quién puede fijar lo
 * decide el servidor; aquí se prueba que la pantalla manda lo elegido y se
 * recoloca con lo que respondió.
 */

const FEED_PATH = "/api/v1/news";
const NEWS_SEEN_PATH = "/api/v1/account/news-seen";
const NOW = new Date("2026-09-26T08:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function anItem(id: string, title: string, publishedAt: string): NewsFeedItem {
  return {
    id: `${id}-0000-4000-8000-000000000000`,
    category: "news",
    title,
    excerpt: `${title}: the details.`,
    author: {
      id: "11111111-0000-4000-8000-000000000001",
      fullName: "Sofía Castro",
    },
    publishedAt,
    status: "published",
    attachmentCount: 0,
    coverThumbnailUrl: null,
    coverUrl: null,
  };
}

const SHORTLIST = anItem(
  "aaaaaaaa",
  "Nationals squad shortlist announced",
  "2026-09-24T08:00:00.000Z",
);
const WINTER = anItem(
  "bbbbbbbb",
  "Winter training schedule is live",
  "2026-09-22T08:00:00.000Z",
);
const POLICY = anItem(
  "cccccccc",
  "Updated pool safety policy",
  "2026-09-19T08:00:00.000Z",
);
/** Publicada entre WINTER y POLICY: al desfijarla vuelve entre las dos. */
const PINNED: NewsPinnedFeedItem = {
  ...anItem(
    "dddddddd",
    "Spring league registration closes Friday",
    "2026-09-20T08:00:00.000Z",
  ),
  pinnedUntil: "2026-10-30T08:00:00.000Z",
};

type PinRequest = {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
};

type PinResponder = (request: PinRequest) => Response | Promise<Response>;

const pinRequests: PinRequest[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Lo que responde `POST …/pin`: la publicación abierta, ya fijada. */
function pinnedDetail(item: NewsFeedItem, until: string | null): Response {
  return jsonResponse(200, {
    data: {
      id: item.id,
      category: item.category,
      title: item.title,
      body: item.excerpt,
      author: item.author,
      publishedAt: item.publishedAt,
      editedAt: null,
      status: item.status,
      attachments: [],
      canManage: true,
      coverUrl: null,
      isPinned: true,
      pinnedUntil: until,
      canPin: true,
    },
  });
}

function postOf(path: string): NewsFeedItem {
  const found = [SHORTLIST, WINTER, POLICY, PINNED].find((item) =>
    path.includes(item.id),
  );
  if (found === undefined) {
    throw new Error(`Publicación desconocida: ${path}`);
  }
  return found;
}

/** Responde como el servidor: fija con la fecha recibida y desfija con 204. */
const acceptEverything: PinResponder = ({ method, path, body }) => {
  if (method === "DELETE") {
    return new Response(null, { status: 204 });
  }
  const { until } = body as { readonly until: string | null };
  return pinnedDetail(postOf(path), until);
};

function stubFeed({
  pinned,
  posts,
  respondToPin = acceptEverything,
}: {
  readonly pinned: NewsPinnedFeedItem | null;
  readonly posts: readonly NewsFeedItem[];
  readonly respondToPin?: PinResponder;
}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const { pathname } = new URL(input, "http://localhost");
      if (pathname === NEWS_SEEN_PATH) {
        return new Response(null, { status: 204 });
      }
      if (pathname === FEED_PATH) {
        return jsonResponse(200, {
          data: { pinned, posts, nextCursor: null, seenAt: NOW.toISOString() },
        });
      }
      if (pathname.endsWith("/pin")) {
        const request: PinRequest = {
          method: init?.method ?? "GET",
          path: pathname,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        };
        pinRequests.push(request);
        return respondToPin(request);
      }
      throw new Error(`Petición inesperada: ${input}`);
    }),
  );
}

function renderFeed({
  canPin = true,
  locale = "en",
}: { readonly canPin?: boolean; readonly locale?: "en" | "es" } = {}): void {
  render(<NewsFeedScreen locale={locale} canPublish canPin={canPin} />);
}

function rowOf(title: string): HTMLElement {
  const row = screen.getByRole("link", { name: title }).closest("li");
  if (row === null) {
    throw new Error(`"${title}" no está en ninguna fila de la lista.`);
  }
  return row;
}

function featuredCard(title: string): HTMLElement {
  return screen.getByRole("article", { name: title });
}

function listTitles(): (string | null)[] {
  return within(screen.getByRole("list", { name: /^(earlier|latest)$/i }))
    .getAllByRole("link")
    .map((link) => link.textContent);
}

function pinStrip(): HTMLElement {
  return screen.getByRole("group", { name: "Pin to the top for" });
}

beforeEach(() => {
  pinRequests.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("la chincheta de cada fila", () => {
  it("el Admin ve en cada fila un botón para fijarla con su título", async () => {
    stubFeed({ pinned: PINNED, posts: [SHORTLIST, WINTER] });
    renderFeed();

    await screen.findByRole("link", { name: SHORTLIST.title });

    expect(
      within(rowOf(SHORTLIST.title)).getByRole("button", {
        name: `Pin ${SHORTLIST.title}`,
      }),
    ).toBeInTheDocument();
    expect(
      within(rowOf(WINTER.title)).getByRole("button", {
        name: `Pin ${WINTER.title}`,
      }),
    ).toBeInTheDocument();
  });

  it("dice en español fijar con el título", async () => {
    stubFeed({ pinned: PINNED, posts: [SHORTLIST] });
    renderFeed({ locale: "es" });

    await screen.findByRole("link", { name: SHORTLIST.title });

    expect(
      screen.getByRole("button", { name: `Fijar ${SHORTLIST.title}` }),
    ).toBeInTheDocument();
  });

  it.each([
    ["con una fijada", PINNED],
    ["sin fijada", null],
  ])(
    "quien no es Admin no ve chincheta, Fijar ni Desfijar %s",
    async (_case, pinned) => {
      stubFeed({ pinned, posts: [SHORTLIST, WINTER] });
      renderFeed({ canPin: false });

      await screen.findByRole("link", { name: WINTER.title });

      expect(
        screen.queryByRole("button", { name: /^(Pin|Unpin)\b/ }),
      ).not.toBeInTheDocument();
    },
  );
});

describe("la tira de duración", () => {
  it("se abre debajo de la fila con las cuatro duraciones y Cancelar", async () => {
    stubFeed({ pinned: null, posts: [SHORTLIST, WINTER, POLICY] });
    const user = userEvent.setup();
    renderFeed();

    await user.click(
      await screen.findByRole("button", { name: `Pin ${WINTER.title}` }),
    );

    const strip = within(rowOf(WINTER.title)).getByRole("group", {
      name: "Pin to the top for",
    });
    expect(
      within(strip)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["1 week", "2 weeks", "4 weeks", "Until I unpin"]);
    expect(
      within(rowOf(WINTER.title)).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
  });

  it("la chincheta dice si su tira está abierta", async () => {
    stubFeed({ pinned: null, posts: [SHORTLIST, WINTER] });
    const user = userEvent.setup();
    renderFeed();
    const pin = await screen.findByRole("button", {
      name: `Pin ${WINTER.title}`,
    });

    await user.click(pin);

    expect(pin).toHaveAttribute("aria-expanded", "true");
  });

  it("dice en español sus textos", async () => {
    stubFeed({ pinned: PINNED, posts: [SHORTLIST] });
    const user = userEvent.setup();
    renderFeed({ locale: "es" });

    await user.click(
      await screen.findByRole("button", { name: `Fijar ${SHORTLIST.title}` }),
    );

    const strip = screen.getByRole("group", { name: "Fijar arriba durante" });
    expect(
      within(strip)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["1 semana", "2 semanas", "4 semanas", "Hasta que la desfije"]);
    expect(
      screen.getByText("Reemplaza a la que está fijada ahora."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeVisible();
  });

  it("con otra fijada avisa de que la reemplaza", async () => {
    stubFeed({ pinned: PINNED, posts: [SHORTLIST] });
    const user = userEvent.setup();
    renderFeed();

    await user.click(
      await screen.findByRole("button", { name: `Pin ${SHORTLIST.title}` }),
    );

    expect(
      within(rowOf(SHORTLIST.title)).getByText("Replaces the post pinned now."),
    ).toBeInTheDocument();
  });

  it("sin fijada no avisa de nada", async () => {
    stubFeed({ pinned: null, posts: [SHORTLIST, WINTER] });
    const user = userEvent.setup();
    renderFeed();

    await user.click(
      await screen.findByRole("button", { name: `Pin ${WINTER.title}` }),
    );

    expect(
      screen.queryByText("Replaces the post pinned now."),
    ).not.toBeInTheDocument();
  });

  it("Cancelar la cierra y devuelve el foco a la chincheta", async () => {
    stubFeed({ pinned: null, posts: [SHORTLIST, WINTER] });
    const user = userEvent.setup();
    renderFeed();
    const pin = await screen.findByRole("button", {
      name: `Pin ${WINTER.title}`,
    });
    await user.click(pin);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(pin).toHaveFocus();
    expect(pin).toHaveAttribute("aria-expanded", "false");
  });

  it("Esc la cierra y devuelve el foco a la chincheta", async () => {
    stubFeed({ pinned: null, posts: [SHORTLIST, WINTER] });
    const user = userEvent.setup();
    renderFeed();
    const pin = await screen.findByRole("button", {
      name: `Pin ${WINTER.title}`,
    });
    await user.click(pin);
    within(pinStrip()).getByRole("button", { name: "2 weeks" }).focus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(pin).toHaveFocus();
  });

  it("abrir la de otra fila cierra la primera", async () => {
    stubFeed({ pinned: null, posts: [SHORTLIST, WINTER, POLICY] });
    const user = userEvent.setup();
    renderFeed();
    await user.click(
      await screen.findByRole("button", { name: `Pin ${WINTER.title}` }),
    );

    await user.click(
      screen.getByRole("button", { name: `Pin ${POLICY.title}` }),
    );

    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(
      within(rowOf(POLICY.title)).getByRole("group", {
        name: "Pin to the top for",
      }),
    ).toBeInTheDocument();
  });
});

describe("fijar con una duración", () => {
  it.each([
    ["1 week", new Date(NOW.getTime() + 7 * DAY_MS).toISOString()],
    ["2 weeks", new Date(NOW.getTime() + 14 * DAY_MS).toISOString()],
    ["4 weeks", new Date(NOW.getTime() + 28 * DAY_MS).toISOString()],
    ["Until I unpin", null],
  ])("con %s pide fijarla hasta %s", async (duration, until) => {
    stubFeed({ pinned: null, posts: [SHORTLIST, WINTER] });
    const user = userEvent.setup();
    renderFeed();
    await user.click(
      await screen.findByRole("button", { name: `Pin ${WINTER.title}` }),
    );

    await user.click(
      within(pinStrip()).getByRole("button", { name: duration }),
    );

    await waitFor(() =>
      expect(pinRequests).toEqual([
        {
          method: "POST",
          path: `${FEED_PATH}/${WINTER.id}/pin`,
          body: { until },
        },
      ]),
    );
  });

  it("la fijada pasa a la destacada y la anterior vuelve a la lista por fecha", async () => {
    stubFeed({ pinned: PINNED, posts: [SHORTLIST, WINTER, POLICY] });
    const user = userEvent.setup();
    renderFeed();
    await user.click(
      await screen.findByRole("button", { name: `Pin ${SHORTLIST.title}` }),
    );

    await user.click(
      within(pinStrip()).getByRole("button", { name: "1 week" }),
    );

    expect(
      await within(featuredCard(SHORTLIST.title)).findByText(
        "Pinned · until 3 Oct",
      ),
    ).toBeInTheDocument();
    expect(listTitles()).toEqual([WINTER.title, PINNED.title, POLICY.title]);
  });

  it("sin fijada antes, la destacada que era la más reciente vuelve a la lista", async () => {
    stubFeed({ pinned: null, posts: [SHORTLIST, WINTER, POLICY] });
    const user = userEvent.setup();
    renderFeed();
    await user.click(
      await screen.findByRole("button", { name: `Pin ${POLICY.title}` }),
    );

    await user.click(
      within(pinStrip()).getByRole("button", { name: "Until I unpin" }),
    );

    expect(
      await within(featuredCard(POLICY.title)).findByText("Pinned", {
        selector: "p",
      }),
    ).toBeInTheDocument();
    expect(listTitles()).toEqual([SHORTLIST.title, WINTER.title]);
  });

  it("tras fijar, el foco pasa a Desfijar en la destacada", async () => {
    stubFeed({ pinned: null, posts: [SHORTLIST, WINTER] });
    const user = userEvent.setup();
    renderFeed();
    await user.click(
      await screen.findByRole("button", { name: `Pin ${WINTER.title}` }),
    );

    await user.click(
      within(pinStrip()).getByRole("button", { name: "1 week" }),
    );

    await waitFor(() =>
      expect(
        within(featuredCard(WINTER.title)).getByRole("button", {
          name: "Unpin",
        }),
      ).toHaveFocus(),
    );
  });

  it("un doble clic en una duración manda una sola petición", async () => {
    let release: () => void = () => undefined;
    stubFeed({
      pinned: null,
      posts: [SHORTLIST, WINTER],
      respondToPin: (request) =>
        new Promise((resolve) => {
          release = () => resolve(acceptEverything(request) as Response);
        }),
    });
    const user = userEvent.setup();
    renderFeed();
    await user.click(
      await screen.findByRole("button", { name: `Pin ${WINTER.title}` }),
    );

    await user.dblClick(
      within(pinStrip()).getByRole("button", { name: "2 weeks" }),
    );
    await act(async () => release());

    await within(featuredCard(WINTER.title)).findByText(/^Pinned/, {
      selector: "p",
    });
    expect(pinRequests).toHaveLength(1);
  });

  it("si el servidor lo rechaza lo dice dentro de la fila y el feed no cambia", async () => {
    stubFeed({
      pinned: PINNED,
      posts: [SHORTLIST, WINTER],
      respondToPin: () =>
        jsonResponse(409, {
          error: {
            code: "conflict",
            message: "La publicación está retirada.",
            reason: "news_post_withdrawn",
          },
        }),
    });
    const user = userEvent.setup();
    renderFeed();
    await user.click(
      await screen.findByRole("button", { name: `Pin ${WINTER.title}` }),
    );

    await user.click(
      within(pinStrip()).getByRole("button", { name: "1 week" }),
    );

    expect(
      await within(rowOf(WINTER.title)).findByRole("alert"),
    ).toHaveTextContent("This post was withdrawn, so it can't be pinned.");
    expect(featuredCard(PINNED.title)).toBeInTheDocument();
    expect(listTitles()).toEqual([SHORTLIST.title, WINTER.title]);
  });

  it("un fallo inesperado al fijar pide volver a intentarlo", async () => {
    stubFeed({
      pinned: null,
      posts: [SHORTLIST, WINTER],
      respondToPin: () =>
        jsonResponse(500, {
          error: { code: "internal_error", message: "Algo falló." },
        }),
    });
    const user = userEvent.setup();
    renderFeed();
    await user.click(
      await screen.findByRole("button", { name: `Pin ${WINTER.title}` }),
    );

    await user.click(
      within(pinStrip()).getByRole("button", { name: "1 week" }),
    );

    expect(
      await within(rowOf(WINTER.title)).findByRole("alert"),
    ).toHaveTextContent("We couldn't pin this post. Try again.");
  });
});

describe("Fijar y Desfijar en la destacada", () => {
  it("la fijada ofrece desfijarla", async () => {
    stubFeed({ pinned: PINNED, posts: [SHORTLIST] });
    renderFeed();

    await screen.findByRole("link", { name: PINNED.title });

    expect(
      within(featuredCard(PINNED.title)).getByRole("button", {
        name: "Unpin",
      }),
    ).toBeInTheDocument();
  });

  it("desfijar la quita y la destacada pasa a ser la más reciente", async () => {
    stubFeed({ pinned: PINNED, posts: [SHORTLIST, WINTER, POLICY] });
    const user = userEvent.setup();
    renderFeed();
    await screen.findByRole("link", { name: PINNED.title });

    await user.click(
      within(featuredCard(PINNED.title)).getByRole("button", {
        name: "Unpin",
      }),
    );

    expect(
      await within(featuredCard(SHORTLIST.title)).findByText("Latest"),
    ).toBeInTheDocument();
    expect(pinRequests).toEqual([
      { method: "DELETE", path: `${FEED_PATH}/${PINNED.id}/pin`, body: null },
    ]);
    expect(listTitles()).toEqual([WINTER.title, PINNED.title, POLICY.title]);
  });

  it("tras desfijar, el foco pasa a Fijar en la nueva destacada", async () => {
    stubFeed({ pinned: PINNED, posts: [SHORTLIST, WINTER] });
    const user = userEvent.setup();
    renderFeed();
    await screen.findByRole("link", { name: PINNED.title });

    await user.click(
      within(featuredCard(PINNED.title)).getByRole("button", {
        name: "Unpin",
      }),
    );

    await waitFor(() =>
      expect(
        within(featuredCard(SHORTLIST.title)).getByRole("button", {
          name: "Pin",
        }),
      ).toHaveFocus(),
    );
  });

  it("si el servidor no la desfija lo dice en la tarjeta y sigue fijada", async () => {
    stubFeed({
      pinned: PINNED,
      posts: [SHORTLIST],
      respondToPin: () =>
        jsonResponse(403, {
          error: { code: "forbidden", message: "Solo el Admin." },
        }),
    });
    const user = userEvent.setup();
    renderFeed();
    await screen.findByRole("link", { name: PINNED.title });

    await user.click(
      within(featuredCard(PINNED.title)).getByRole("button", {
        name: "Unpin",
      }),
    );

    expect(
      await within(featuredCard(PINNED.title)).findByRole("alert"),
    ).toHaveTextContent("Only an Admin can pin or unpin posts.");
    expect(
      within(featuredCard(PINNED.title)).getByText("Pinned · until 30 Oct"),
    ).toBeInTheDocument();
  });

  it("la más reciente sin fijar ofrece fijarla con la misma tira en la tarjeta", async () => {
    stubFeed({ pinned: null, posts: [SHORTLIST, WINTER] });
    const user = userEvent.setup();
    renderFeed();
    await screen.findByRole("link", { name: SHORTLIST.title });

    await user.click(
      within(featuredCard(SHORTLIST.title)).getByRole("button", {
        name: "Pin",
      }),
    );
    await user.click(
      within(featuredCard(SHORTLIST.title)).getByRole("button", {
        name: "4 weeks",
      }),
    );

    expect(
      await within(featuredCard(SHORTLIST.title)).findByText(
        "Pinned · until 24 Oct",
      ),
    ).toBeInTheDocument();
    expect(pinRequests).toEqual([
      {
        method: "POST",
        path: `${FEED_PATH}/${SHORTLIST.id}/pin`,
        body: { until: new Date(NOW.getTime() + 28 * DAY_MS).toISOString() },
      },
    ]);
  });

  it("dice en español Fijar y Desfijar", async () => {
    stubFeed({ pinned: PINNED, posts: [SHORTLIST] });
    renderFeed({ locale: "es" });

    await screen.findByRole("link", { name: PINNED.title });

    expect(
      within(featuredCard(PINNED.title)).getByRole("button", {
        name: "Desfijar",
      }),
    ).toBeInTheDocument();
  });
});
