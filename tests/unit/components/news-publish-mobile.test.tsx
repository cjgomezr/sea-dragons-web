import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsEditScreen } from "@/components/news/NewsEditScreen";
import { NewsPublishScreen } from "@/components/news/NewsPublishScreen";
import type { EditableNewsPost } from "@/lib/news/news-management";

/**
 * El formulario de publicar y editar en el móvil (#602, RF-12 del PRD de
 * E22): por debajo de 768 px lleva su barra con Cancelar, el nombre de la
 * pantalla y el botón principal. La lógica es la del escritorio; aquí se
 * prueba la barra. Las medidas, que se quede arriba, el scroll de lado y axe
 * los prueba Playwright.
 *
 * El ancho lo dice `matchMedia`, que aquí se simula.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const PHONE_QUERY = "(width < 768px)";
const GROUPS_PATH = "/api/v1/groups";
const PUBLISH_PATH = "/api/v1/news/publish";
const UPLOADS_PATH = "/api/v1/news/publish/uploads";
const POST_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const MANAGE_PATH = `/api/v1/news/publish/${POST_ID}`;
const PUBLISHED_ID = "c2c2c2c2-0000-4000-8000-00000000000c";

const SENIOR = { id: "9a9a9a9a-0000-4000-8000-000000000009", name: "Senior" };

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

type Responder = () => Response | Promise<Response>;

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
      const { pathname } = new URL(input, "http://localhost");
      const key = `${init?.method ?? "GET"} ${pathname}`;
      const respond = responders[key];
      if (respond === undefined) {
        throw new Error(`Petición inesperada: ${key}`);
      }
      return respond();
    }),
  );
}

function stubPhone(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

async function openPublish(): Promise<void> {
  render(<NewsPublishScreen locale="en" canPin={false} />);
  await screen.findByLabelText("Title");
}

async function openEdit(): Promise<void> {
  render(<NewsEditScreen locale="en" postId={POST_ID} canPin={false} />);
  await screen.findByLabelText("Title");
}

async function fillValidDraft(): Promise<void> {
  await userEvent.type(screen.getByLabelText("Title"), "Cambia la piscina");
  await userEvent.type(
    screen.getByLabelText("Message"),
    "El martes entrenamos en MSAC.",
  );
}

function bar(): HTMLElement {
  return screen.getByRole("group", { name: /^(New|Edit) post$/ });
}

beforeEach(() => {
  push.mockReset();
  responders = {
    [`GET ${GROUPS_PATH}`]: () =>
      jsonResponse(200, {
        data: { groups: [{ ...SENIOR, memberCount: 3 }] },
      }),
    [`GET ${MANAGE_PATH}`]: () => jsonResponse(200, { data: EDITABLE }),
    [`PATCH ${MANAGE_PATH}`]: () => jsonResponse(200, { data: EDITABLE }),
    [`POST ${PUBLISH_PATH}`]: () =>
      jsonResponse(201, {
        data: {
          id: PUBLISHED_ID,
          category: "news",
          title: "Cambia la piscina",
          body: "El martes entrenamos en MSAC.",
          author: { id: SENIOR.id, fullName: "Carla" },
          publishedAt: "2026-09-27T10:00:00.000Z",
          editedAt: null,
          status: "published",
          attachments: [],
        },
      }),
  };
  stubApi();
  stubPhone();
  URL.createObjectURL = vi.fn(() => "blob:portada");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("barra del formulario en el móvil", () => {
  it("al publicar lleva Cancelar, Nueva publicación y Publicar, y no repite el botón abajo", async () => {
    await openPublish();

    expect(
      within(bar()).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    expect(
      within(bar()).getByRole("heading", { level: 1, name: "New post" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Publish/ })).toEqual([
      within(bar()).getByRole("button", { name: "Publish" }),
    ]);
    expect(screen.queryByRole("link", { name: /Back to News/ })).toBeNull();
  });

  it("al editar dice Editar publicación y el botón es Guardar", async () => {
    await openEdit();

    expect(
      within(bar()).getByRole("heading", { level: 1, name: "Edit post" }),
    ).toBeInTheDocument();
    expect(
      within(bar()).getByRole("button", { name: "Save" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("deja Publicar desactivado mientras el formulario no vale", async () => {
    await openPublish();

    expect(
      within(bar()).getByRole("button", { name: "Publish" }),
    ).toBeDisabled();
  });

  it("deja Publicar desactivado mientras se sube la portada", async () => {
    responders[`POST ${UPLOADS_PATH}`] = () => new Promise<Response>(() => {});
    await openPublish();
    await fillValidDraft();

    await userEvent.upload(
      screen.getByLabelText("Choose a cover photo"),
      new File([new Uint8Array(2_048)], "portada.png", { type: "image/png" }),
    );

    expect(
      within(bar()).getByRole("button", { name: "Publish" }),
    ).toBeDisabled();
  });

  it("al publicar bien dice ✓ Publicada y vuelve al feed con el aviso", async () => {
    await openPublish();
    await fillValidDraft();

    await userEvent.click(
      within(bar()).getByRole("button", { name: "Publish" }),
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("/noticias"));
    expect(
      within(bar()).getByRole("button", { name: "✓ Posted" }),
    ).toBeDisabled();
    expect(window.sessionStorage.length).toBe(1);
  });

  it("sin cambios, Cancelar sale al feed sin preguntar", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    await openPublish();

    await userEvent.click(
      within(bar()).getByRole("button", { name: "Cancel" }),
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/noticias");
  });

  it("con cambios, Cancelar pregunta y se queda si no se confirma", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    await openPublish();
    await userEvent.type(screen.getByLabelText("Title"), "Borrador");

    await userEvent.click(
      within(bar()).getByRole("button", { name: "Cancel" }),
    );

    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Leave and discard them?",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("con cambios, Cancelar sale si se confirma", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    await openPublish();
    await userEvent.click(screen.getByRole("radio", { name: "Announcement" }));

    await userEvent.click(
      within(bar()).getByRole("button", { name: "Cancel" }),
    );

    expect(confirm).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/noticias");
  });

  it("al editar sin cambios, Cancelar vuelve a la publicación", async () => {
    await openEdit();

    await userEvent.click(
      within(bar()).getByRole("button", { name: "Cancel" }),
    );

    expect(push).toHaveBeenCalledWith(`/noticias/${POST_ID}`);
  });

  it("al editar, deshacer lo escrito deja de contar como cambio", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    await openEdit();
    const title = screen.getByLabelText("Title");
    await userEvent.type(title, "!");
    await userEvent.type(title, "{Backspace}");

    await userEvent.click(
      within(bar()).getByRole("button", { name: "Cancel" }),
    );

    expect(confirm).not.toHaveBeenCalled();
  });
});
