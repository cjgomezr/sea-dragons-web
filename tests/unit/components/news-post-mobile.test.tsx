import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsPostScreen } from "@/components/news/NewsPostScreen";
import type { NewsPinnedFeedItem } from "@/lib/news/news-feed";
import type { NewsPinDuration } from "@/lib/news/news-pin-duration";
import type { NewsPostDetail } from "@/lib/news/news-posts";

/**
 * La publicación en el móvil (#601, RF-11 del PRD de E22): por debajo de
 * 768 px lleva su barra con volver, la categoría y ⋯, y el ⋯ sube una hoja
 * desde la que se edita, se fija y se retira. Fijar es sólo del Admin (D1).
 *
 * El ancho lo dice `matchMedia`, que aquí se simula. Cómo se ve, que la barra
 * se quede arriba y axe los prueba Playwright.
 */

const PHONE_QUERY = "(width < 768px)";
const NOW = new Date("2026-09-26T08:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const POST_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const POST_PATH = `/api/v1/news/${POST_ID}`;
const PIN_PATH = `${POST_PATH}/pin`;
const STATUS_PATH = `/api/v1/news/publish/${POST_ID}/status`;
const FEED_PATH = "/api/v1/news";
const NEWS_SEEN_PATH = "/api/v1/account/news-seen";

/** Lo que ve quien publicó, Committee: la gestiona, pero no fija. */
const COMMITTEE_POST: NewsPostDetail = {
  id: POST_ID,
  category: "news",
  title: "Seadragons take silver at the Island Cup",
  body: "The under-16 squad brought home silver.",
  author: {
    id: "33333333-0000-4000-8000-000000000003",
    fullName: "Dana Whitfield",
    photoUrl: null,
  },
  audience: { kind: "club" },
  publishedAt: "2026-09-15T08:00:00.000Z",
  editedAt: null,
  status: "published",
  canManage: true,
  coverUrl: null,
  isPinned: false,
  pinnedUntil: null,
  canPin: false,
  attachments: [],
};

const ADMIN_POST: NewsPostDetail = { ...COMMITTEE_POST, canPin: true };
const READER_POST: NewsPostDetail = { ...COMMITTEE_POST, canManage: false };
const PINNED_ADMIN_POST: NewsPostDetail = {
  ...ADMIN_POST,
  isPinned: true,
  pinnedUntil: "2026-10-10T08:00:00.000Z",
};

const OTHER_PINNED: NewsPinnedFeedItem = {
  id: "dddddddd-0000-4000-8000-000000000000",
  category: "announcement",
  title: "Spring league registration closes Friday",
  excerpt: "Register now.",
  author: { id: "11111111-0000-4000-8000-000000000001", fullName: "Sofía" },
  publishedAt: "2026-09-20T08:00:00.000Z",
  status: "published",
  attachmentCount: 0,
  coverThumbnailUrl: null,
  coverUrl: null,
  pinnedUntil: null,
};

type Call = {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
};

type Responder = (call: Call) => Response | Promise<Response>;

const calls: Call[] = [];
let responders: Record<string, Responder>;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { error: { code, message: code } });
}

function feedWith(pinned: NewsPinnedFeedItem | null): Responder {
  return () =>
    jsonResponse(200, {
      data: { pinned, posts: [], nextCursor: null, seenAt: null },
    });
}

/** Responde como el servidor: fija con la fecha recibida. */
const acceptPin: Responder = ({ body }) => {
  const { until } = body as { readonly until: string | null };
  return jsonResponse(200, {
    data: { ...ADMIN_POST, isPinned: true, pinnedUntil: until },
  });
};

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const call = {
        method: init?.method ?? "GET",
        pathname: url.pathname,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      const respond = responders[`${call.method} ${call.pathname}`];
      if (respond === undefined) {
        throw new Error(`Petición inesperada: ${call.method} ${input}`);
      }
      return respond(call);
    }),
  );
}

function callsTo(method: string, pathname: string): readonly Call[] {
  return calls.filter(
    (call) => call.method === method && call.pathname === pathname,
  );
}

/** El ancho de la pantalla, que se puede cambiar con la publicación abierta. */
function stubScreen(isPhone: boolean): (isPhone: boolean) => void {
  let matches = isPhone;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches(): boolean {
      return matches && query === PHONE_QUERY;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
    dispatchEvent: () => false,
  }));
  return (nextIsPhone) => {
    matches = nextIsPhone;
    act(() => listeners.forEach((listener) => listener()));
  };
}

async function openPost(
  post: NewsPostDetail,
  locale: "en" | "es" = "en",
): Promise<void> {
  responders[`GET ${POST_PATH}`] = () => jsonResponse(200, { data: post });
  render(<NewsPostScreen locale={locale} postId={POST_ID} />);
  await screen.findByRole("heading", { level: 1 });
}

function moreButton(name = "More actions"): HTMLElement {
  return screen.getByRole("button", { name });
}

async function openSheet(post: NewsPostDetail): Promise<HTMLElement> {
  await openPost(post);
  await userEvent.click(moreButton());
  return screen.getByRole("dialog", { name: "Post actions" });
}

async function chooseDuration(duration: string): Promise<HTMLElement> {
  const sheet = await openSheet(ADMIN_POST);
  await userEvent.click(
    within(sheet).getByRole("button", { name: /^Pin to top/ }),
  );
  await userEvent.click(within(sheet).getByRole("button", { name: duration }));
  return sheet;
}

beforeEach(() => {
  calls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  responders = {
    [`POST ${NEWS_SEEN_PATH}`]: () => new Response(null, { status: 204 }),
    [`GET ${FEED_PATH}`]: feedWith(null),
    [`POST ${PIN_PATH}`]: acceptPin,
    [`DELETE ${PIN_PATH}`]: () => new Response(null, { status: 204 }),
  };
  stubApi();
  stubScreen(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("la barra de la publicación en el móvil", () => {
  it("lleva volver a Noticias, el nombre de la categoría y ⋯", async () => {
    await openPost(COMMITTEE_POST);

    const bar = screen.getByRole("navigation", { name: "Post" });
    expect(
      within(bar).getByRole("link", { name: "Back to News" }),
    ).toHaveAttribute("href", "/noticias");
    expect(within(bar).getByText("News")).toBeVisible();
    expect(
      within(bar).getByRole("button", { name: "More actions" }),
    ).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("no repite los botones de escritorio en la línea del autor", async () => {
    await openPost(COMMITTEE_POST);

    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });

  it("a quien no puede editar, retirar ni fijar no le da ⋯", async () => {
    await openPost(READER_POST);

    expect(screen.getByRole("link", { name: "Back to News" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("al Admin que sólo fija, sin gestionarla, también le da ⋯", async () => {
    await openPost({ ...READER_POST, canPin: true });

    expect(moreButton()).toBeInTheDocument();
  });

  it("en escritorio no hay barra: quedan el enlace y los botones de siempre", async () => {
    stubScreen(false);
    await openPost(COMMITTEE_POST);

    expect(screen.queryByRole("navigation", { name: "Post" })).toBeNull();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });
});

describe("las filas de la hoja ⋯", () => {
  it("a quien la gestiona le da Editar publicación y Retirar", async () => {
    const sheet = await openSheet(COMMITTEE_POST);

    expect(
      within(sheet).getByRole("link", { name: "Edit post" }),
    ).toHaveAttribute("href", `/noticias/${POST_ID}/editar`);
    expect(within(sheet).getByRole("button", { name: "Withdraw" })).toHaveClass(
      "news-sheet-action-danger",
    );
    expect(within(sheet).getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("al Committee no le da Fijar arriba ni Desfijar (D1)", async () => {
    const sheet = await openSheet(COMMITTEE_POST);

    expect(
      within(sheet).queryByRole("button", { name: /^Pin to top/ }),
    ).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Unpin" })).toBeNull();
  });

  it("al Admin con la publicación sin fijar le da Fijar arriba con su pista", async () => {
    const sheet = await openSheet(ADMIN_POST);

    const pin = within(sheet).getByRole("button", { name: /^Pin to top/ });
    expect(pin).toHaveAccessibleDescription(
      "Choose 1, 2 or 4 weeks, or until unpinned",
    );
    expect(within(sheet).queryByRole("button", { name: "Unpin" })).toBeNull();
  });

  it("al Admin con la publicación fijada le da Desfijar", async () => {
    const sheet = await openSheet(PINNED_ADMIN_POST);

    expect(within(sheet).getByRole("button", { name: "Unpin" })).toBeVisible();
    expect(
      within(sheet).queryByRole("button", { name: /^Pin to top/ }),
    ).toBeNull();
  });

  it("a una retirada le da Volver a publicar en vez de Retirar", async () => {
    const sheet = await openSheet({ ...COMMITTEE_POST, status: "withdrawn" });

    expect(
      within(sheet).getByRole("button", { name: "Publish again" }),
    ).toBeVisible();
    expect(
      within(sheet).queryByRole("button", { name: "Withdraw" }),
    ).toBeNull();
  });

  it("dice en español las filas, la pista y el nombre de ⋯", async () => {
    await openPost(ADMIN_POST, "es");
    await userEvent.click(moreButton("Más acciones"));
    const sheet = screen.getByRole("dialog", {
      name: "Acciones de la publicación",
    });

    expect(
      within(sheet).getByRole("link", { name: "Editar publicación" }),
    ).toBeVisible();
    expect(
      within(sheet).getByRole("button", { name: /^Fijar arriba/ }),
    ).toHaveAccessibleDescription("1, 2 o 4 semanas, o hasta desfijarla");
    expect(
      within(sheet).getByRole("button", { name: "Retirar" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Volver a Noticias" }),
    ).toBeVisible();
  });
});

describe("fijar desde la hoja", () => {
  it("Fijar arriba enseña las cuatro duraciones", async () => {
    const sheet = await openSheet(ADMIN_POST);

    await userEvent.click(
      within(sheet).getByRole("button", { name: /^Pin to top/ }),
    );

    const durations = within(sheet).getByRole("group", {
      name: "Pin to the top for",
    });
    expect(
      within(durations)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["1 week", "2 weeks", "4 weeks", "Until I unpin"]);
  });

  it.each<[string, NewsPinDuration, string | null]>([
    ["1 week", "oneWeek", new Date(NOW.getTime() + 7 * DAY_MS).toISOString()],
    [
      "2 weeks",
      "twoWeeks",
      new Date(NOW.getTime() + 14 * DAY_MS).toISOString(),
    ],
    [
      "4 weeks",
      "fourWeeks",
      new Date(NOW.getTime() + 28 * DAY_MS).toISOString(),
    ],
    ["Until I unpin", "untilUnpinned", null],
  ])(
    "con %s manda la fecha de fin que toca",
    async (label, _duration, until) => {
      await chooseDuration(label);

      await waitFor(() =>
        expect(callsTo("POST", PIN_PATH).map((call) => call.body)).toEqual([
          { until },
        ]),
      );
    },
  );

  it("al fijar se cierra, anuncia hasta cuándo y devuelve el foco a ⋯", async () => {
    await chooseDuration("2 weeks");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Pinned until 10 Oct.",
    );
    expect(moreButton()).toHaveFocus();
  });

  it("fijada sin fin, lo anuncia y la hoja pasa a ofrecer Desfijar", async () => {
    await chooseDuration("Until I unpin");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(screen.getByRole("status")).toHaveTextContent(
      "Pinned until you unpin it.",
    );
    await userEvent.click(moreButton());
    expect(screen.getByRole("button", { name: "Unpin" })).toBeVisible();
  });

  it("avisa si reemplaza a otra fijada", async () => {
    responders[`GET ${FEED_PATH}`] = feedWith(OTHER_PINNED);
    const sheet = await openSheet(ADMIN_POST);

    await userEvent.click(
      within(sheet).getByRole("button", { name: /^Pin to top/ }),
    );

    expect(
      await within(sheet).findByText("Replaces the post pinned now."),
    ).toBeVisible();
  });

  it("sin otra fijada, no avisa de nada", async () => {
    const sheet = await openSheet(ADMIN_POST);

    await userEvent.click(
      within(sheet).getByRole("button", { name: /^Pin to top/ }),
    );
    await waitFor(() => expect(callsTo("GET", FEED_PATH)).toHaveLength(1));

    expect(
      within(sheet).queryByText("Replaces the post pinned now."),
    ).toBeNull();
  });

  it("si el servidor no deja fijar, la hoja lo dice y la publicación no cambia", async () => {
    responders[`POST ${PIN_PATH}`] = () => errorResponse(403, "forbidden");
    const sheet = await chooseDuration("1 week");

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "Only an Admin can pin or unpin posts.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("desfijar desde la hoja", () => {
  it("manda DELETE, se cierra y lo anuncia", async () => {
    const sheet = await openSheet(PINNED_ADMIN_POST);

    await userEvent.click(within(sheet).getByRole("button", { name: "Unpin" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsTo("DELETE", PIN_PATH)).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Unpinned.");
    await userEvent.click(moreButton());
    expect(
      screen.getByRole("button", { name: /^Pin to top/ }),
    ).toBeInTheDocument();
  });

  it("si el servidor no deja desfijar, la hoja lo dice y sigue fijada", async () => {
    responders[`DELETE ${PIN_PATH}`] = () => errorResponse(500, "unexpected");
    const sheet = await openSheet(PINNED_ADMIN_POST);

    await userEvent.click(within(sheet).getByRole("button", { name: "Unpin" }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "We couldn't unpin this post. Try again.",
    );
    expect(within(sheet).getByRole("button", { name: "Unpin" })).toBeVisible();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("retirar desde la hoja", () => {
  it("pide la misma confirmación antes de mandar nada", async () => {
    const sheet = await openSheet(COMMITTEE_POST);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Withdraw" }),
    );

    expect(
      within(sheet).getByText(/disappears from everyone's feed/),
    ).toBeVisible();
    expect(callsTo("PUT", STATUS_PATH)).toEqual([]);
  });

  it("confirmar la retira, cierra la hoja y la deja marcada", async () => {
    responders[`PUT ${STATUS_PATH}`] = () =>
      jsonResponse(200, { data: { ...COMMITTEE_POST, status: "withdrawn" } });
    const sheet = await openSheet(COMMITTEE_POST);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Withdraw" }),
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Withdraw post" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsTo("PUT", STATUS_PATH).map((call) => call.body)).toEqual([
      { status: "withdrawn" },
    ]);
    expect(screen.getByText("Withdrawn")).toBeVisible();
  });
});

describe("retirar o volver a publicar: lo que puede salir mal y lo que se anuncia", () => {
  it("si el servidor no deja retirar, la hoja lo dice y la publicación no cambia", async () => {
    responders[`PUT ${STATUS_PATH}`] = () => errorResponse(500, "unexpected");
    const sheet = await openSheet(COMMITTEE_POST);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Withdraw" }),
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Withdraw post" }),
    );

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "We couldn't withdraw it. Try again.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("volver a publicar manda published, cierra la hoja y lo anuncia", async () => {
    responders[`PUT ${STATUS_PATH}`] = () =>
      jsonResponse(200, { data: COMMITTEE_POST });
    const sheet = await openSheet({ ...COMMITTEE_POST, status: "withdrawn" });

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Publish again" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsTo("PUT", STATUS_PATH).map((call) => call.body)).toEqual([
      { status: "published" },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("Published again.");
  });
});

describe("cerrar la hoja", () => {
  it("Esc la cierra y devuelve el foco a ⋯", async () => {
    await openSheet(ADMIN_POST);

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(moreButton()).toHaveFocus();
  });

  it("un toque en el fondo la cierra y devuelve el foco a ⋯", async () => {
    await openSheet(ADMIN_POST);

    fireEvent.mouseDown(document.body);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(moreButton()).toHaveFocus();
  });

  it("Cancelar la cierra sin mandar nada y devuelve el foco a ⋯", async () => {
    const sheet = await openSheet(ADMIN_POST);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(moreButton()).toHaveFocus();
    expect(callsTo("POST", PIN_PATH)).toEqual([]);
  });

  it("si la ventana pasa de 768 px, se cierra y quedan los botones de escritorio", async () => {
    const resize = stubScreen(true);
    await openPost(COMMITTEE_POST);
    await userEvent.click(moreButton());

    resize(false);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeVisible();
  });
});
