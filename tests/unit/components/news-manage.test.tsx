import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsEditScreen } from "@/components/news/NewsEditScreen";
import { NewsFeedScreen } from "@/components/news/NewsFeedScreen";
import { NewsPostScreen } from "@/components/news/NewsPostScreen";
import type { NewsFeedItem } from "@/lib/news/news-feed";
import type { EditableNewsPost } from "@/lib/news/news-management";
import type { NewsPostDetail } from "@/lib/news/news-posts";

/**
 * Editar y retirar en pantalla (#331, RF-6 del PRD de E11). Quién puede lo
 * decide el servidor (`canManage` y los 403): aquí se prueba que la pantalla
 * ofrece las acciones sólo a quien puede, pide confirmación antes de retirar,
 * reutiliza el formulario de publicar con sus valores cargados y explica un
 * conflicto sin perder lo escrito.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const POST_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const POST_PATH = `/api/v1/news/${POST_ID}`;
const MANAGE_PATH = `/api/v1/news/publish/${POST_ID}`;
const STATUS_PATH = `${MANAGE_PATH}/status`;
const GROUPS_PATH = "/api/v1/groups";
const FEED_PATH = "/api/v1/news";
const EDITED_AT = "2026-09-26T12:00:00.000Z";

const SENIOR = { id: "9a9a9a9a-0000-4000-8000-000000000009", name: "Senior" };
const MASTERS = { id: "8b8b8b8b-0000-4000-8000-000000000008", name: "Masters" };

const POST: NewsPostDetail = {
  id: POST_ID,
  category: "announcement",
  title: "Pool change on Tuesday",
  body: "We train at MSAC.",
  author: { id: "33333333-0000-4000-8000-000000000003", fullName: "Liam" },
  publishedAt: "2026-09-15T08:00:00.000Z",
  editedAt: null,
  status: "published",
  canManage: true,
  attachments: [],
};

const EDITABLE: EditableNewsPost = {
  id: POST_ID,
  category: "announcement",
  title: "Pool change on Tuesday",
  body: "We train at MSAC.",
  audience: { kind: "groups", groupIds: [SENIOR.id] },
  editedAt: EDITED_AT,
  status: "published",
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

function readBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? JSON.parse(init.body) : null;
}

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const call = {
        method: init?.method ?? "GET",
        pathname: url.pathname,
        body: readBody(init),
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

function respondWith(post: NewsPostDetail): Responder {
  return () => jsonResponse(200, { data: post });
}

function callsTo(method: string, pathname: string): readonly Call[] {
  return calls.filter(
    (call) => call.method === method && call.pathname === pathname,
  );
}

async function openPost(post: NewsPostDetail = POST): Promise<void> {
  responders[`GET ${POST_PATH}`] = respondWith(post);
  render(<NewsPostScreen locale="en" postId={POST_ID} />);
  await screen.findByRole("heading", { level: 1 });
}

beforeEach(() => {
  calls.length = 0;
  push.mockReset();
  responders = {
    [`GET ${GROUPS_PATH}`]: () =>
      jsonResponse(200, {
        data: {
          groups: [
            { ...SENIOR, memberCount: 3 },
            { ...MASTERS, memberCount: 2 },
          ],
        },
      }),
    [`GET ${MANAGE_PATH}`]: () => jsonResponse(200, { data: EDITABLE }),
  };
  stubApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("acciones en la publicación abierta", () => {
  it("a quien puede, le ofrece editarla y retirarla", async () => {
    await openPost();

    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      `/noticias/${POST_ID}/editar`,
    );
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeVisible();
  });

  it("a quien no puede, no le ofrece nada", async () => {
    await openPost({ ...POST, canManage: false });

    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });

  it("retirar pide confirmación antes de mandar nada", async () => {
    await openPost();

    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));

    expect(
      screen.getByText(/disappears from everyone's feed/),
    ).toBeInTheDocument();
    expect(callsTo("PUT", STATUS_PATH)).toEqual([]);
  });

  it("cancelar la confirmación no retira nada", async () => {
    await openPost();

    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/disappears from everyone's feed/)).toBeNull();
    expect(callsTo("PUT", STATUS_PATH)).toEqual([]);
  });

  it("confirmar la retira y la deja marcada, con la opción de volver a publicarla", async () => {
    responders[`PUT ${STATUS_PATH}`] = respondWith({
      ...POST,
      status: "withdrawn",
    });
    await openPost();

    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Withdraw post" }),
    );

    expect(await screen.findByText("Withdrawn")).toBeInTheDocument();
    expect(callsTo("PUT", STATUS_PATH).map((call) => call.body)).toEqual([
      { status: "withdrawn" },
    ]);
    expect(screen.getByRole("button", { name: "Publish again" })).toBeVisible();
  });

  it("volver a publicar una retirada no pide confirmación y le quita la marca", async () => {
    responders[`PUT ${STATUS_PATH}`] = respondWith(POST);
    await openPost({ ...POST, status: "withdrawn" });

    await userEvent.click(
      screen.getByRole("button", { name: "Publish again" }),
    );

    await waitFor(() => expect(screen.queryByText("Withdrawn")).toBeNull());
    expect(callsTo("PUT", STATUS_PATH).map((call) => call.body)).toEqual([
      { status: "published" },
    ]);
  });

  it("si no se pudo retirar, lo dice y la deja como estaba", async () => {
    responders[`PUT ${STATUS_PATH}`] = () => errorResponse(500, "internal");
    await openPost();

    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Withdraw post" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't withdraw it. Try again.",
    );
    expect(screen.queryByText("Withdrawn")).toBeNull();
  });

  it("dice en español las acciones y la confirmación", async () => {
    responders[`GET ${POST_PATH}`] = respondWith(POST);
    render(<NewsPostScreen locale="es" postId={POST_ID} />);
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByRole("button", { name: "Retirar" }));

    expect(screen.getByRole("link", { name: "Editar" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Retirar publicación" }),
    ).toBeVisible();
  });
});

describe("el feed de quien publicó", () => {
  it("marca como retirada la suya retirada", async () => {
    const withdrawn: NewsFeedItem = {
      id: POST_ID,
      category: "news",
      title: "Old call-up",
      excerpt: "No longer applies.",
      author: POST.author,
      publishedAt: "2026-09-15T08:00:00.000Z",
      status: "withdrawn",
      attachmentCount: 0,
    };
    responders[`GET ${FEED_PATH}`] = () =>
      jsonResponse(200, { data: { posts: [withdrawn], nextCursor: null } });

    render(<NewsFeedScreen locale="en" canPublish />);

    const row = (
      await screen.findByRole("link", { name: "Old call-up" })
    ).closest("li");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Withdrawn")).toBeVisible();
  });
});

describe("editar", () => {
  async function openEdit(locale: "en" | "es" = "en"): Promise<void> {
    render(<NewsEditScreen locale={locale} postId={POST_ID} />);
    await screen.findByLabelText(locale === "en" ? "Title" : "Título");
  }

  it("abre el formulario de publicar con los valores cargados y sin adjuntos", async () => {
    await openEdit();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Edit post",
    );
    expect(screen.getByLabelText("Category")).toHaveValue("announcement");
    expect(screen.getByLabelText("Title")).toHaveValue(EDITABLE.title);
    expect(screen.getByLabelText("Message")).toHaveValue(EDITABLE.body);
    expect(screen.getByRole("checkbox", { name: /Senior/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Masters/ })).not.toBeChecked();
    expect(screen.queryByLabelText("Choose files")).toBeNull();
  });

  it("guarda con la marca que tenía delante y vuelve a la publicación", async () => {
    responders[`PATCH ${MANAGE_PATH}`] = respondWith({
      ...POST,
      editedAt: "2026-09-27T09:30:00.000Z",
    });
    await openEdit();

    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Pool change: MSAC");
    await userEvent.click(screen.getByRole("checkbox", { name: /Masters/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/noticias/${POST_ID}`),
    );
    expect(callsTo("PATCH", MANAGE_PATH).map((call) => call.body)).toEqual([
      {
        category: "announcement",
        title: "Pool change: MSAC",
        body: EDITABLE.body,
        audience: { kind: "groups", groupIds: [SENIOR.id, MASTERS.id] },
        expectedEditedAt: EDITED_AT,
      },
    ]);
  });

  it("un conflicto lo explica y conserva lo escrito", async () => {
    responders[`PATCH ${MANAGE_PATH}`] = () => errorResponse(409, "conflict");
    await openEdit();

    await userEvent.type(screen.getByLabelText("Title"), " (v2)");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Someone else saved this post while you were editing it/,
    );
    expect(screen.getByLabelText("Title")).toHaveValue(
      `${EDITABLE.title} (v2)`,
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("a quien no puede editarla le dice por qué, sin formulario", async () => {
    responders[`GET ${MANAGE_PATH}`] = () => errorResponse(403, "forbidden");

    render(<NewsEditScreen locale="en" postId={POST_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can only edit your own posts.",
    );
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  it("dice en español el título y el botón de guardar", async () => {
    await openEdit("es");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Editar publicación",
    );
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeVisible();
  });
});
