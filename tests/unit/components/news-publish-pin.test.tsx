import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsEditScreen } from "@/components/news/NewsEditScreen";
import { NewsFeedScreen } from "@/components/news/NewsFeedScreen";
import { NewsPublishScreen } from "@/components/news/NewsPublishScreen";
import { formatClubShortDay } from "@/lib/i18n/format";
import type { EditableNewsPost } from "@/lib/news/news-management";

/**
 * La caja de fijar del formulario (#599, RF-8 y RF-3 del PRD de E22). Solo
 * el Admin la ve. Encendida, elige cuánto dura el fijado, dice cuándo se
 * desfija y avisa si reemplaza a otra. Publicar o editar mandan `pin` solo
 * cuando la caja cambió algo; quién puede fijar lo vuelve a decidir el
 * servidor (#592).
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const NOW = new Date("2026-10-13T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const GROUPS_PATH = "/api/v1/groups";
const PUBLISH_PATH = "/api/v1/news/publish";
const FEED_PATH = "/api/v1/news";
const POST_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const MANAGE_PATH = `/api/v1/news/publish/${POST_ID}`;
const PINNED_UNTIL = "2026-10-20T00:00:00.000Z";

const EDITABLE: EditableNewsPost = {
  id: POST_ID,
  category: "announcement",
  title: "Pool change on Tuesday",
  body: "We train at MSAC.",
  audience: { kind: "club" },
  editedAt: null,
  status: "published",
  coverUploadId: null,
  coverUrl: null,
  isPinned: false,
  pinnedUntil: null,
};

type FeedPinned = { readonly id: string; readonly title: string } | null;

type Call = {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
};

const calls: Call[] = [];
let feedPinned: FeedPinned;
let editable: EditableNewsPost;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function feedItem(pinned: NonNullable<FeedPinned>): Record<string, unknown> {
  return {
    id: pinned.id,
    category: "news",
    title: pinned.title,
    excerpt: "…",
    author: { id: "33333333-0000-4000-8000-000000000003", fullName: "Liam" },
    publishedAt: "2026-10-01T08:00:00.000Z",
    status: "published",
    attachmentCount: 0,
    coverThumbnailUrl: null,
    coverUrl: null,
    pinnedUntil: null,
  };
}

function savedPost(): Record<string, unknown> {
  return {
    id: POST_ID,
    category: "announcement",
    title: EDITABLE.title,
    body: EDITABLE.body,
    author: {
      id: "33333333-0000-4000-8000-000000000003",
      fullName: "Liam",
      photoUrl: null,
    },
    audience: { kind: "club" },
    publishedAt: "2026-10-01T08:00:00.000Z",
    editedAt: NOW.toISOString(),
    status: "published",
    canManage: true,
    coverUrl: null,
    isPinned: false,
    pinnedUntil: null,
    canPin: true,
    attachments: [],
  };
}

function readBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? JSON.parse(init.body) : null;
}

function respondTo(call: Call): Response {
  const route = `${call.method} ${call.pathname}`;
  switch (route) {
    case `GET ${GROUPS_PATH}`:
      return jsonResponse(200, { data: { groups: [] } });
    case `GET ${FEED_PATH}`:
      return jsonResponse(200, {
        data: {
          pinned: feedPinned === null ? null : feedItem(feedPinned),
          posts: [],
          nextCursor: null,
          seenAt: null,
        },
      });
    case `POST ${PUBLISH_PATH}`:
      return jsonResponse(201, { data: { id: POST_ID, category: "news" } });
    case `GET ${MANAGE_PATH}`:
      return jsonResponse(200, { data: editable });
    case `PATCH ${MANAGE_PATH}`:
      return jsonResponse(200, { data: savedPost() });
    default:
      throw new Error(`Petición inesperada: ${route}`);
  }
}

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const call = {
        method: init?.method ?? "GET",
        pathname: new URL(input, "http://localhost").pathname,
        body: readBody(init),
      };
      calls.push(call);
      return respondTo(call);
    }),
  );
}

function sentBody(method: string, pathname: string): Record<string, unknown> {
  const call = calls.find(
    (candidate) =>
      candidate.method === method && candidate.pathname === pathname,
  );
  if (call === undefined) {
    throw new Error(`No se mandó ${method} ${pathname}`);
  }
  return call.body as Record<string, unknown>;
}

function shortDay(iso: string): string {
  return formatClubShortDay("en", new Date(iso));
}

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString();
}

async function openPublish(canPin = true): Promise<void> {
  render(<NewsPublishScreen locale="en" canPin={canPin} />);
  await screen.findByLabelText("Title");
}

async function openEdit(post: EditableNewsPost): Promise<void> {
  editable = post;
  render(<NewsEditScreen locale="en" postId={POST_ID} canPin />);
  await screen.findByLabelText("Title");
}

async function fillValidDraft(): Promise<void> {
  await userEvent.type(screen.getByLabelText("Title"), "Spring league");
  await userEvent.type(screen.getByLabelText("Message"), "Sign up by Friday.");
}

function pinSwitch(): HTMLElement {
  return screen.getByRole("switch", { name: "Pin to the top of the feed" });
}

function durationRadio(name: string): HTMLElement {
  return screen.getByRole("radio", { name });
}

async function turnPinOn(): Promise<void> {
  await userEvent.click(pinSwitch());
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: /^(Publish|Save)/ });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  calls.length = 0;
  feedPinned = null;
  editable = EDITABLE;
  push.mockReset();
  window.sessionStorage.clear();
  stubApi();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("quién ve la caja", () => {
  it("el Admin la ve con su pista, apagada", async () => {
    await openPublish();

    expect(pinSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(
        "It stays as the featured post. Everything else is listed newest first.",
      ),
    ).toBeInTheDocument();
  });

  it("el Committee no la ve", async () => {
    await openPublish(false);

    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("el Committee no pide el feed para buscar la fijada", async () => {
    await openPublish(false);

    expect(calls.some((call) => call.pathname === FEED_PATH)).toBe(false);
  });

  it("apagada no enseña las duraciones", async () => {
    await openPublish();

    expect(screen.queryByRole("radio", { name: "2 weeks" })).toBeNull();
  });
});

describe("encender y elegir la duración", () => {
  it("encendida anuncia su estado y sale con 2 semanas", async () => {
    await openPublish();

    await turnPinOn();

    expect(pinSwitch()).toHaveAttribute("aria-checked", "true");
    expect(durationRadio("2 weeks")).toBeChecked();
    expect(
      screen.getByText(`Unpins automatically on ${shortDay(daysFromNow(14))}.`),
    ).toBeInTheDocument();
  });

  it("se enciende con el teclado", async () => {
    await openPublish();

    pinSwitch().focus();
    await userEvent.keyboard(" ");

    expect(pinSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it.each([
    ["1 week", 7],
    ["4 weeks", 28],
  ])("con %s dice el día en que se desfija", async (name, days) => {
    await openPublish();
    await turnPinOn();

    await userEvent.click(durationRadio(name));

    expect(
      screen.getByText(
        `Unpins automatically on ${shortDay(daysFromNow(days))}.`,
      ),
    ).toBeInTheDocument();
  });

  it("hasta que la desfije dice que se queda", async () => {
    await openPublish();
    await turnPinOn();

    await userEvent.click(durationRadio("Until I unpin"));

    expect(screen.getByText("Stays until you unpin it.")).toBeInTheDocument();
  });
});

describe("aviso de reemplazo", () => {
  it("con otra fijada vigente, al encender nombra a la que reemplaza", async () => {
    feedPinned = { id: OTHER_ID, title: "Club AGM" };
    await openPublish();

    await turnPinOn();

    expect(
      screen.getByText("Replaces the post pinned now: “Club AGM”"),
    ).toBeInTheDocument();
  });

  it("apagada no avisa aunque haya otra fijada", async () => {
    feedPinned = { id: OTHER_ID, title: "Club AGM" };
    await openPublish();

    expect(screen.queryByText(/^Replaces the post pinned now/)).toBeNull();
  });

  it("sin otra fijada no avisa", async () => {
    await openPublish();

    await turnPinOn();

    expect(screen.queryByText(/^Replaces the post pinned now/)).toBeNull();
  });

  it("al editar la que ya está fijada no se avisa a sí misma", async () => {
    feedPinned = { id: POST_ID, title: EDITABLE.title };
    await openEdit({ ...EDITABLE, isPinned: true, pinnedUntil: PINNED_UNTIL });

    expect(screen.queryByText(/^Replaces the post pinned now/)).toBeNull();
  });
});

describe("publicar", () => {
  it("con la caja encendida manda pin con la fecha de fin", async () => {
    await openPublish();
    await fillValidDraft();
    await turnPinOn();

    await userEvent.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/noticias"));
    expect(sentBody("POST", PUBLISH_PATH).pin).toEqual({
      until: daysFromNow(14),
    });
  });

  it("hasta que la desfije manda pin sin fecha de fin", async () => {
    await openPublish();
    await fillValidDraft();
    await turnPinOn();
    await userEvent.click(durationRadio("Until I unpin"));

    await userEvent.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentBody("POST", PUBLISH_PATH).pin).toEqual({ until: null });
  });

  it("con la caja apagada no manda pin", async () => {
    await openPublish();
    await fillValidDraft();

    await userEvent.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentBody("POST", PUBLISH_PATH)).not.toHaveProperty("pin");
  });
});

describe("aviso del feed tras publicar fijada", () => {
  async function publishAndOpenFeed(): Promise<void> {
    await userEvent.click(submitButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/noticias"));
    cleanup();
    render(<NewsFeedScreen locale="en" canPublish canPin />);
  }

  it("dice hasta cuándo quedó fijada", async () => {
    await openPublish();
    await fillValidDraft();
    await turnPinOn();

    await publishAndOpenFeed();

    expect(
      await screen.findByText(
        `Published and pinned until ${shortDay(daysFromNow(14))} · we notified the whole club`,
      ),
    ).toBeInTheDocument();
  });

  it("sin fecha de fin dice solo que quedó fijada", async () => {
    await openPublish();
    await fillValidDraft();
    await turnPinOn();
    await userEvent.click(durationRadio("Until I unpin"));

    await publishAndOpenFeed();

    expect(
      await screen.findByText(
        "Published and pinned · we notified the whole club",
      ),
    ).toBeInTheDocument();
  });
});

describe("editar", () => {
  it("una fijada abre la caja encendida con su fecha de fin", async () => {
    await openEdit({ ...EDITABLE, isPinned: true, pinnedUntil: PINNED_UNTIL });

    expect(pinSwitch()).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(`Unpins automatically on ${shortDay(PINNED_UNTIL)}.`),
    ).toBeInTheDocument();
  });

  it("una fijada sin fecha de fin abre con hasta que la desfije", async () => {
    await openEdit({ ...EDITABLE, isPinned: true, pinnedUntil: null });

    expect(durationRadio("Until I unpin")).toBeChecked();
    expect(screen.getByText("Stays until you unpin it.")).toBeInTheDocument();
  });

  it("apagar la caja de una fijada y guardar manda pin null", async () => {
    await openEdit({ ...EDITABLE, isPinned: true, pinnedUntil: PINNED_UNTIL });

    await userEvent.click(pinSwitch());
    await userEvent.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentBody("PATCH", MANAGE_PATH).pin).toBeNull();
  });

  it("sin tocar la caja de una fijada no manda pin", async () => {
    await openEdit({ ...EDITABLE, isPinned: true, pinnedUntil: PINNED_UNTIL });

    await userEvent.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentBody("PATCH", MANAGE_PATH)).not.toHaveProperty("pin");
  });

  it("sin tocar la caja de una sin fijar no manda pin", async () => {
    await openEdit(EDITABLE);

    await userEvent.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentBody("PATCH", MANAGE_PATH)).not.toHaveProperty("pin");
  });

  it("cambiar la duración de una fijada manda la fecha nueva", async () => {
    await openEdit({ ...EDITABLE, isPinned: true, pinnedUntil: PINNED_UNTIL });

    await userEvent.click(durationRadio("4 weeks"));
    await userEvent.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentBody("PATCH", MANAGE_PATH).pin).toEqual({
      until: daysFromNow(28),
    });
  });

  it("fijar al editar una sin fijar manda pin", async () => {
    await openEdit(EDITABLE);

    await turnPinOn();
    await userEvent.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentBody("PATCH", MANAGE_PATH).pin).toEqual({
      until: daysFromNow(14),
    });
  });
});
