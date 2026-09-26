import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsFeedScreen } from "@/components/news/NewsFeedScreen";
import { NewsPublishScreen } from "@/components/news/NewsPublishScreen";
import { NEWS_ATTACHMENT_MAX_BYTES } from "@/lib/news/news-attachments";

/**
 * El formulario de publicar (#330, RF-2 y RF-3 del PRD de E11). Qué se guarda
 * lo decide el servidor (#327, #328): aquí se prueba que la pantalla manda lo
 * que se escribió, avisa junto a cada campo antes de mandar nada, sube cada
 * adjunto al elegirlo y no deja publicar a medias.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const GROUPS_PATH = "/api/v1/groups";
const PUBLISH_PATH = "/api/v1/news/publish";
const UPLOADS_PATH = "/api/v1/news/publish/uploads";
const FEED_PATH = "/api/v1/news";

const SENIOR = { id: "9a9a9a9a-0000-4000-8000-000000000009", name: "Senior" };
const MASTERS = { id: "8b8b8b8b-0000-4000-8000-000000000008", name: "Masters" };
const PUBLISHED_ID = "c2c2c2c2-0000-4000-8000-00000000000c";

type Call = {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
  readonly body: unknown;
};

type Responder = (call: Call) => Response | Promise<Response>;

const calls: Call[] = [];
let respondToPublish: Responder;
let respondToUpload: Responder;
let uploadCount = 0;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function uploadIdFor(index: number): string {
  return `a7a7a7a7-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function uploadedResponse(call: Call): Response {
  uploadCount += 1;
  return jsonResponse(201, {
    data: {
      id: uploadIdFor(uploadCount),
      fileName: new URLSearchParams(call.search).get("name"),
      contentType: "application/pdf",
      sizeBytes: 2_048,
    },
  });
}

function publishedResponse(): Response {
  return jsonResponse(201, {
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
  });
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
        search: url.search,
        body: readBody(init),
      };
      calls.push(call);
      if (url.pathname === GROUPS_PATH) {
        return jsonResponse(200, {
          data: {
            groups: [
              { ...SENIOR, memberCount: 3 },
              { ...MASTERS, memberCount: 2 },
            ],
          },
        });
      }
      if (url.pathname === PUBLISH_PATH) {
        return respondToPublish(call);
      }
      if (url.pathname === UPLOADS_PATH) {
        return respondToUpload(call);
      }
      if (url.pathname.startsWith(`${UPLOADS_PATH}/`)) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Petición inesperada: ${call.method} ${input}`);
    }),
  );
}

function callsTo(method: string, pathname: string): readonly Call[] {
  return calls.filter(
    (call) => call.method === method && call.pathname === pathname,
  );
}

function pdf(name: string, size = 2_048): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

async function openForm(): Promise<void> {
  render(<NewsPublishScreen locale="en" />);
  await screen.findByLabelText("Title");
}

async function fillValidDraft(): Promise<void> {
  await userEvent.type(screen.getByLabelText("Title"), "Cambia la piscina");
  await userEvent.type(
    screen.getByLabelText("Message"),
    "El martes entrenamos en MSAC.",
  );
}

async function attach(...files: File[]): Promise<void> {
  await userEvent.upload(screen.getByLabelText("Choose files"), files, {
    applyAccept: false,
  });
}

function publishButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Publish/ });
}

function attachmentList(): HTMLElement {
  return screen.getByRole("list", { name: "Attachments" });
}

/** El aviso que describe a un control, el que lee un lector de pantalla. */
function describedIssue(control: HTMLElement): string {
  const ids = control.getAttribute("aria-describedby") ?? "";
  return ids
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

beforeEach(() => {
  calls.length = 0;
  uploadCount = 0;
  push.mockReset();
  respondToPublish = publishedResponse;
  respondToUpload = uploadedResponse;
  stubApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formulario de publicar", () => {
  it("abre con categoría, título, cuerpo, audiencia y adjuntos", async () => {
    await openForm();

    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Who sees it" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Choose files")).toBeInTheDocument();
  });

  it("publica para todo el club y vuelve al feed sin recargar la pantalla", async () => {
    await openForm();
    await fillValidDraft();
    await userEvent.selectOptions(
      screen.getByLabelText("Category"),
      "announcement",
    );

    await userEvent.click(publishButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/noticias"));
    expect(callsTo("POST", PUBLISH_PATH).map((call) => call.body)).toEqual([
      {
        category: "announcement",
        title: "Cambia la piscina",
        body: "El martes entrenamos en MSAC.",
        audience: { kind: "club" },
        attachmentUploadIds: [],
      },
    ]);
  });

  it("ofrece los grupos vigentes del club y publica para los marcados", async () => {
    await openForm();
    await fillValidDraft();

    await userEvent.click(
      screen.getByRole("radio", { name: /Specific groups/ }),
    );
    const groups = screen.getByRole("group", { name: "Groups" });
    expect(within(groups).getByLabelText("Senior")).not.toBeChecked();
    expect(within(groups).getByLabelText("Masters")).not.toBeChecked();
    await userEvent.click(within(groups).getByLabelText("Masters"));
    await userEvent.click(publishButton());

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(callsTo("POST", PUBLISH_PATH)[0]?.body).toMatchObject({
      audience: { kind: "groups", groupIds: [MASTERS.id] },
    });
  });

  it("explica que hay que elegir al menos un grupo, sin mandar nada", async () => {
    await openForm();
    await fillValidDraft();
    await userEvent.click(
      screen.getByRole("radio", { name: /Specific groups/ }),
    );

    await userEvent.click(publishButton());

    const groups = screen.getByRole("group", { name: "Groups" });
    expect(describedIssue(groups)).toMatch(/Choose at least one group/);
    expect(callsTo("POST", PUBLISH_PATH)).toEqual([]);
  });

  it.each([
    ["un título vacío", "", "Give the post a title."],
    [
      "un título de 121 caracteres",
      "a".repeat(121),
      "The title can have up to 120 characters.",
    ],
  ])(
    "con %s avisa junto al título y no manda nada",
    async (_case, title, issue) => {
      await openForm();
      if (title !== "") {
        await userEvent.type(screen.getByLabelText("Title"), title);
      }
      await userEvent.type(screen.getByLabelText("Message"), "Hola.");

      await userEvent.click(publishButton());

      const input = screen.getByLabelText("Title");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(describedIssue(input)).toContain(issue);
      expect(callsTo("POST", PUBLISH_PATH)).toEqual([]);
    },
  );

  it("con el cuerpo vacío avisa junto al cuerpo y no manda nada", async () => {
    await openForm();
    await userEvent.type(screen.getByLabelText("Title"), "Cambia la piscina");

    await userEvent.click(publishButton());

    const body = screen.getByLabelText("Message");
    expect(body).toHaveAttribute("aria-invalid", "true");
    expect(describedIssue(body)).toContain("Write the message.");
    expect(callsTo("POST", PUBLISH_PATH)).toEqual([]);
  });

  it("un doble clic en publicar manda una sola publicación", async () => {
    let finish: (response: Response) => void = () => undefined;
    respondToPublish = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await openForm();
    await fillValidDraft();

    await userEvent.dblClick(publishButton());
    await act(async () => finish(publishedResponse()));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(callsTo("POST", PUBLISH_PATH)).toHaveLength(1);
  });

  it("tras un fallo de red conserva lo escrito y los adjuntos, y se puede reintentar", async () => {
    respondToPublish = () => {
      throw new TypeError("Failed to fetch");
    };
    await openForm();
    await fillValidDraft();
    await attach(pdf("acta.pdf"));
    await within(attachmentList()).findByText("acta.pdf");

    await userEvent.click(publishButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/,
    );
    expect(screen.getByLabelText("Title")).toHaveValue("Cambia la piscina");
    expect(within(attachmentList()).getByText("acta.pdf")).toBeInTheDocument();

    respondToPublish = publishedResponse;
    await userEvent.click(publishButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/noticias"));
    expect(callsTo("POST", PUBLISH_PATH)[1]?.body).toMatchObject({
      attachmentUploadIds: [uploadIdFor(1)],
    });
  });
});

describe("adjuntos en el formulario", () => {
  it("sube cada archivo al elegirlo y lo enseña con su tamaño", async () => {
    await openForm();

    await attach(pdf("acta.pdf"), pdf("mapa.pdf"));

    const list = attachmentList();
    expect(await within(list).findByText("acta.pdf")).toBeInTheDocument();
    expect(await within(list).findByText("mapa.pdf")).toBeInTheDocument();
    expect(within(list).getAllByText("2 KB")).toHaveLength(2);
    expect(callsTo("POST", UPLOADS_PATH).map((call) => call.search)).toEqual([
      "?name=acta.pdf",
      "?name=mapa.pdf",
    ]);
  });

  it("quitar un adjunto lo borra del almacenamiento y de la lista", async () => {
    await openForm();
    await attach(pdf("acta.pdf"));
    await within(attachmentList()).findByText("acta.pdf");

    await userEvent.click(
      screen.getByRole("button", { name: "Remove acta.pdf" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("acta.pdf")).not.toBeInTheDocument(),
    );
    expect(callsTo("DELETE", `${UPLOADS_PATH}/${uploadIdFor(1)}`)).toHaveLength(
      1,
    );
  });

  it("con cinco puestos, dice el límite y no sube el sexto", async () => {
    await openForm();
    await attach(...[1, 2, 3, 4, 5].map((index) => pdf(`acta-${index}.pdf`)));
    await within(attachmentList()).findByText("acta-5.pdf");

    await attach(pdf("acta-6.pdf"));

    expect(
      await screen.findByText(/at most 5 attachments/),
    ).toBeInTheDocument();
    expect(callsTo("POST", UPLOADS_PATH)).toHaveLength(5);
    expect(within(attachmentList()).getAllByRole("listitem")).toHaveLength(5);
  });

  it("un archivo demasiado grande no se sube, dice por qué y conserva los demás", async () => {
    await openForm();
    await attach(pdf("acta.pdf"));
    await within(attachmentList()).findByText("acta.pdf");

    await attach(pdf("video.pdf", NEWS_ATTACHMENT_MAX_BYTES + 1));

    expect(
      await screen.findByText(/video\.pdf.*up to 10 MB/),
    ).toBeInTheDocument();
    expect(callsTo("POST", UPLOADS_PATH)).toHaveLength(1);
    expect(within(attachmentList()).getByText("acta.pdf")).toBeInTheDocument();
  });

  it("un tipo no admitido dice por qué y conserva los demás", async () => {
    respondToUpload = (call) =>
      call.search.includes("foto.gif")
        ? jsonResponse(400, {
            error: {
              code: "validation_error",
              message: "Tipo no admitido.",
              reason: "attachment_type_unsupported",
            },
          })
        : uploadedResponse(call);
    await openForm();

    await attach(pdf("acta.pdf"), new File(["GIF89a"], "foto.gif"));

    expect(
      await screen.findByText(/foto\.gif.*Only PDF, images/),
    ).toBeInTheDocument();
    expect(
      await within(attachmentList()).findByText("acta.pdf"),
    ).toBeInTheDocument();
    expect(within(attachmentList()).queryByText("foto.gif")).toBeNull();
  });

  it("mientras sube, lo dice y no deja publicar", async () => {
    let finish: (response: Response) => void = () => undefined;
    respondToUpload = (call) =>
      new Promise((resolve) => {
        finish = () => resolve(uploadedResponse(call));
      });
    await openForm();
    await fillValidDraft();

    await attach(pdf("acta.pdf"));

    expect(
      within(attachmentList()).getByText("Uploading…"),
    ).toBeInTheDocument();
    expect(publishButton()).toBeDisabled();
    await userEvent.click(publishButton());
    expect(callsTo("POST", PUBLISH_PATH)).toEqual([]);

    await act(async () => finish(new Response()));
    await waitFor(() => expect(publishButton()).toBeEnabled());
  });
});

describe("permisos", () => {
  function stubEmptyFeed(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (new URL(input, "http://localhost").pathname !== FEED_PATH) {
          throw new Error(`Petición inesperada: ${input}`);
        }
        return jsonResponse(200, { data: { posts: [], nextCursor: null } });
      }),
    );
  }

  it("quien puede publicar ve el botón de publicar en Noticias", async () => {
    stubEmptyFeed();

    render(<NewsFeedScreen locale="en" canPublish />);

    expect(
      await screen.findByRole("link", { name: "+ Publish" }),
    ).toHaveAttribute("href", "/noticias/publicar");
  });

  it("un Coach o un Player no ven el botón de publicar", async () => {
    stubEmptyFeed();

    render(<NewsFeedScreen locale="en" canPublish={false} />);

    await screen.findByText(/Nothing has been published/);
    expect(screen.queryByRole("link", { name: "+ Publish" })).toBeNull();
  });
});
