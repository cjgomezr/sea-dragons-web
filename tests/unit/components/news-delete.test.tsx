import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsFeedScreen } from "@/components/news/NewsFeedScreen";
import { NewsPostScreen } from "@/components/news/NewsPostScreen";
import type { NewsPostDetail } from "@/lib/news/news-posts";

/**
 * Borrar para siempre una publicación retirada (#958). Delete sólo aparece
 * en una retirada y a quien la gestiona (`canManage`, que decide el
 * servidor). Pide confirmación en línea, en color de peligro, y al borrar
 * vuelve al feed, que lo anuncia. En el móvil va en la hoja ⋯.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const PHONE_QUERY = "(width < 768px)";
const POST_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const POST_PATH = `/api/v1/news/${POST_ID}`;
const MANAGE_PATH = `/api/v1/news/publish/${POST_ID}`;
const FEED_PATH = "/api/v1/news";
const NEWS_SEEN_PATH = "/api/v1/account/news-seen";
const QUESTION =
  "Delete \"Old call-up\"? It's removed for good, with its attachments and images. This can't be undone.";

const WITHDRAWN: NewsPostDetail = {
  id: POST_ID,
  category: "announcement",
  title: "Old call-up",
  body: "No longer applies.",
  author: {
    id: "33333333-0000-4000-8000-000000000003",
    fullName: "Liam",
    photoUrl: null,
  },
  audience: { kind: "club" },
  publishedAt: "2026-09-15T08:00:00.000Z",
  editedAt: null,
  status: "withdrawn",
  canManage: true,
  coverUrl: null,
  isPinned: false,
  pinnedUntil: null,
  canPin: false,
  attachments: [],
};

type Call = { readonly method: string; readonly pathname: string };
type Responder = () => Response;

const calls: Call[] = [];
let responders: Record<string, Responder>;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const call = { method: init?.method ?? "GET", pathname: url.pathname };
      calls.push(call);
      const respond = responders[`${call.method} ${call.pathname}`];
      if (respond === undefined) {
        throw new Error(`Petición inesperada: ${call.method} ${input}`);
      }
      return respond();
    }),
  );
}

function stubScreen(isPhone: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: isPhone && query === PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function deleteCalls(): readonly Call[] {
  return calls.filter(
    (call) => call.method === "DELETE" && call.pathname === MANAGE_PATH,
  );
}

async function openPost(
  post: NewsPostDetail = WITHDRAWN,
  locale: "en" | "es" = "en",
): Promise<void> {
  responders[`GET ${POST_PATH}`] = () => jsonResponse(200, { data: post });
  render(<NewsPostScreen locale={locale} postId={POST_ID} />);
  await screen.findByRole("heading", { level: 1 });
}

async function openConfirmation(): Promise<void> {
  await openPost();
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
}

beforeEach(() => {
  calls.length = 0;
  push.mockReset();
  window.sessionStorage.clear();
  responders = {
    [`POST ${NEWS_SEEN_PATH}`]: () => new Response(null, { status: 204 }),
    [`GET ${FEED_PATH}`]: () =>
      jsonResponse(200, {
        data: { pinned: null, posts: [], nextCursor: null, seenAt: null },
      }),
  };
  stubApi();
  stubScreen(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NewsPostActions: Delete en escritorio", () => {
  it("en una retirada, junto a Publish again, ofrece Delete", async () => {
    await openPost();

    expect(screen.getByRole("button", { name: "Publish again" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
  });

  it("en una publicada no hay Delete, sigue habiendo Withdraw", async () => {
    await openPost({ ...WITHDRAWN, status: "published" });

    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeVisible();
  });

  it("a quien no la gestiona no le ofrece Delete", async () => {
    await openPost({ ...WITHDRAWN, canManage: false });

    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("Delete abre la confirmación con el título, Cancel y Delete post, y el foco pasa a Cancel", async () => {
    await openConfirmation();

    const confirmation = screen.getByRole("group", { name: QUESTION });
    expect(
      within(confirmation).getByRole("button", { name: "Delete post" }),
    ).toBeVisible();
    expect(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
    expect(deleteCalls()).toEqual([]);
  });

  it("Cancel la cierra sin mandar nada y devuelve el foco a Delete", async () => {
    await openConfirmation();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("group", { name: QUESTION })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    expect(deleteCalls()).toEqual([]);
  });

  it("Escape la cierra sin mandar nada y devuelve el foco a Delete", async () => {
    await openConfirmation();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("group", { name: QUESTION })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    expect(deleteCalls()).toEqual([]);
  });

  it("confirmar la borra por la API y vuelve al feed", async () => {
    responders[`DELETE ${MANAGE_PATH}`] = () =>
      new Response(null, { status: 204 });
    await openConfirmation();

    await userEvent.click(screen.getByRole("button", { name: "Delete post" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/noticias"));
    expect(deleteCalls()).toHaveLength(1);
  });

  it("con un 500, lo dice como Withdraw y la publicación sigue", async () => {
    responders[`DELETE ${MANAGE_PATH}`] = () =>
      jsonResponse(500, { error: { code: "internal", message: "internal" } });
    await openConfirmation();

    await userEvent.click(screen.getByRole("button", { name: "Delete post" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't delete it. Try again.",
    );
    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 1, name: "Old call-up" }),
    ).toBeVisible();
  });

  it("sin red, lo dice igual y la publicación sigue", async () => {
    responders[`DELETE ${MANAGE_PATH}`] = () => {
      throw new TypeError("Failed to fetch");
    };
    await openConfirmation();

    await userEvent.click(screen.getByRole("button", { name: "Delete post" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't delete it. Try again.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("dice en español Delete y la confirmación", async () => {
    await openPost(WITHDRAWN, "es");

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(
      screen.getByRole("group", {
        name: '¿Eliminar "Old call-up"? Se borra para siempre, con sus adjuntos e imágenes. No se puede deshacer.',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Eliminar publicación" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });
});

describe("la hoja ⋯ del móvil", () => {
  async function openSheet(post: NewsPostDetail): Promise<HTMLElement> {
    stubScreen(true);
    await openPost(post);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    return screen.getByRole("dialog", { name: "Post actions" });
  }

  it("a una retirada le da Delete, en color de peligro", async () => {
    const sheet = await openSheet(WITHDRAWN);

    const row = within(sheet).getByRole("button", { name: "Delete" });
    expect(row).toHaveClass("news-sheet-action-danger");
  });

  it("a una publicada no le da Delete", async () => {
    const sheet = await openSheet({ ...WITHDRAWN, status: "published" });

    expect(within(sheet).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("Delete abre la misma confirmación con el foco en Cancel", async () => {
    const sheet = await openSheet(WITHDRAWN);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Delete" }),
    );

    expect(within(sheet).getByRole("group", { name: QUESTION })).toBeVisible();
    expect(within(sheet).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(deleteCalls()).toEqual([]);
  });

  it("Cancel vuelve a las acciones sin mandar nada", async () => {
    const sheet = await openSheet(WITHDRAWN);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Delete" }),
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Cancel" }),
    );

    expect(within(sheet).getByRole("button", { name: "Delete" })).toBeVisible();
    expect(deleteCalls()).toEqual([]);
  });

  it("confirmar la borra y vuelve al feed", async () => {
    responders[`DELETE ${MANAGE_PATH}`] = () =>
      new Response(null, { status: 204 });
    const sheet = await openSheet(WITHDRAWN);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Delete" }),
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Delete post" }),
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("/noticias"));
    expect(deleteCalls()).toHaveLength(1);
  });

  it("con un error, la hoja lo dice y la publicación sigue", async () => {
    responders[`DELETE ${MANAGE_PATH}`] = () =>
      jsonResponse(500, { error: { code: "internal", message: "internal" } });
    const sheet = await openSheet(WITHDRAWN);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Delete" }),
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Delete post" }),
    );

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "We couldn't delete it. Try again.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});

describe("el feed tras borrar", () => {
  it("anuncia Post deleted. al volver de borrar", async () => {
    responders[`DELETE ${MANAGE_PATH}`] = () =>
      new Response(null, { status: 204 });
    await openConfirmation();
    await userEvent.click(screen.getByRole("button", { name: "Delete post" }));
    await waitFor(() => expect(push).toHaveBeenCalled());

    render(<NewsFeedScreen locale="en" canPublish canPin={false} />);

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((region) => region.textContent === "Post deleted."),
      ).toBe(true),
    );
  });

  it("el aviso sale una sola vez", async () => {
    window.sessionStorage.setItem("noticias-aviso-borrada", "1");
    const first = render(
      <NewsFeedScreen locale="en" canPublish canPin={false} />,
    );
    await screen.findByText("Post deleted.");
    first.unmount();

    render(<NewsFeedScreen locale="en" canPublish canPin={false} />);

    await screen.findAllByRole("status");
    expect(screen.queryByText("Post deleted.")).toBeNull();
  });
});
