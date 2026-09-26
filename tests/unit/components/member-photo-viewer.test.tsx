import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Abrir la foto de perfil en grande (#355): la miniatura es un botón que abre
 * un diálogo con la versión grande, que se pide al abrir y no antes.
 */

const MEMBER_ID = "22222222-0000-4000-8000-000000000002";
const LARGE_PHOTO_PATH = `/api/v1/directory/${MEMBER_ID}/photo`;
const THUMBNAIL_URL = `https://storage.test/member-photos/${MEMBER_ID}/a-thumb.webp?token=t`;
const LARGE_URL = `https://storage.test/member-photos/${MEMBER_ID}/a-large.webp?token=l`;
/** Una foto de antes de #353: una sola versión, que hace de las dos. */
const LEGACY_URL = `https://storage.test/member-photos/${MEMBER_ID}/a.png?token=v`;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const requestedUrls: string[] = [];

function stubLargePhoto(
  respond: () => Response | Promise<Response> = () =>
    jsonResponse(200, { data: { photoUrl: LARGE_URL } }),
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url !== LARGE_PHOTO_PATH) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      return respond();
    }),
  );
}

function renderAvatar(
  options: {
    readonly photoUrl?: string | null;
    readonly locale?: Locale;
  } = {},
): void {
  render(
    <>
      <MemberAvatar
        className="directory-avatar"
        fullName="Mateo Restrepo"
        photoUrl={
          options.photoUrl === undefined ? THUMBNAIL_URL : options.photoUrl
        }
        size={40}
        viewer={{
          userId: MEMBER_ID,
          translate: createTranslator(options.locale ?? "en"),
        }}
      />
      <button type="button">Something behind</button>
    </>,
  );
}

function photoButton(): HTMLElement {
  return screen.getByRole("button", {
    name: "Open the photo of Mateo Restrepo",
  });
}

async function openPhoto(): Promise<HTMLElement> {
  await userEvent.click(photoButton());
  return screen.getByRole("dialog", { name: "Mateo Restrepo" });
}

function closeButton(): HTMLElement {
  return screen.getByRole("button", { name: "Close the photo" });
}

function largePhoto(): HTMLElement {
  return screen.getByRole("img", { name: "Photo of Mateo Restrepo" });
}

afterEach(() => {
  requestedUrls.length = 0;
  vi.unstubAllGlobals();
});

describe("abrir la foto en grande", () => {
  it("no pide la foto grande hasta que alguien abre la miniatura", () => {
    stubLargePhoto();

    renderAvatar();

    expect(requestedUrls).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("abre un diálogo con el nombre de la persona y su foto grande", async () => {
    stubLargePhoto();
    renderAvatar();

    await openPhoto();

    expect(requestedUrls).toEqual([LARGE_PHOTO_PATH]);
    expect(
      await screen.findByRole("img", { name: "Photo of Mateo Restrepo" }),
    ).toHaveAttribute("src", LARGE_URL);
  });

  it("anuncia el diálogo y sus botones en español", async () => {
    stubLargePhoto();
    renderAvatar({ locale: "es" });

    await userEvent.click(
      screen.getByRole("button", { name: "Abrir la foto de Mateo Restrepo" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Mateo Restrepo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cerrar la foto" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: "Foto de Mateo Restrepo" }),
    ).toBeInTheDocument();
  });

  it("pone el foco en el botón de cerrar al abrir", async () => {
    stubLargePhoto();
    renderAvatar();

    await openPhoto();

    expect(closeButton()).toHaveFocus();
  });

  it("se cierra con Escape y devuelve el foco a la foto que lo abrió", async () => {
    stubLargePhoto();
    renderAvatar();
    await openPhoto();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(photoButton()).toHaveFocus();
  });

  it("se cierra al pulsar fuera de la foto y devuelve el foco", async () => {
    stubLargePhoto();
    renderAvatar();
    const dialog = await openPhoto();

    // Un clic en el fondo oscuro llega al propio `<dialog>`, fuera del panel.
    await userEvent.click(dialog);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(photoButton()).toHaveFocus();
  });

  it("no se cierra al pulsar sobre la foto", async () => {
    stubLargePhoto();
    renderAvatar();
    await openPhoto();

    await userEvent.click(await screen.findByRole("img"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("se cierra con su botón y devuelve el foco", async () => {
    stubLargePhoto();
    renderAvatar();
    await openPhoto();

    await userEvent.click(closeButton());

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(photoButton()).toHaveFocus();
  });

  it("no deja que el foco se escape a lo que queda detrás", async () => {
    stubLargePhoto();
    renderAvatar();
    await openPhoto();

    await userEvent.tab();
    expect(closeButton()).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(closeButton()).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("mientras llega la grande enseña la miniatura ampliada y dice que carga", async () => {
    stubLargePhoto(() => new Promise<Response>(() => {}));
    renderAvatar();

    const dialog = await openPhoto();

    expect(screen.getByRole("status")).toHaveTextContent("Loading the photo");
    expect(
      dialog.querySelector(`img[src="${THUMBNAIL_URL}"]`),
    ).toBeInTheDocument();
  });

  it("sigue enseñando la miniatura hasta que la grande termina de cargar", async () => {
    stubLargePhoto();
    renderAvatar();
    const dialog = await openPhoto();
    const large = await screen.findByRole("img", {
      name: "Photo of Mateo Restrepo",
    });

    expect(
      dialog.querySelector(`img[src="${THUMBNAIL_URL}"]`),
    ).toBeInTheDocument();
    fireEvent.load(large);

    expect(
      dialog.querySelector(`img[src="${THUMBNAIL_URL}"]`),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("dice que la foto no cargó si el servidor falla, y se puede cerrar", async () => {
    stubLargePhoto(() =>
      jsonResponse(500, { error: { code: "internal_error", message: "x" } }),
    );
    renderAvatar();
    await openPhoto();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The photo couldn't be loaded.",
    );
    await userEvent.click(closeButton());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dice que la foto no cargó si la imagen grande falla", async () => {
    stubLargePhoto();
    renderAvatar();
    await openPhoto();

    fireEvent.error(largePhoto());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The photo couldn't be loaded.",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("dice que la foto no cargó si el socio ya no tiene foto", async () => {
    stubLargePhoto(() => jsonResponse(200, { data: { photoUrl: null } }));
    renderAvatar();
    await openPhoto();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The photo couldn't be loaded.",
    );
  });

  it("enseña la única versión de una foto antigua, aunque sea pequeña", async () => {
    stubLargePhoto(() => jsonResponse(200, { data: { photoUrl: LEGACY_URL } }));
    renderAvatar({ photoUrl: LEGACY_URL });
    await openPhoto();

    expect(
      await screen.findByRole("img", { name: "Photo of Mateo Restrepo" }),
    ).toHaveAttribute("src", LEGACY_URL);
  });

  it("olvida la dirección firmada al cerrar y la vuelve a pedir al reabrir", async () => {
    stubLargePhoto();
    renderAvatar();
    await openPhoto();
    await screen.findByRole("img", { name: "Photo of Mateo Restrepo" });
    await userEvent.click(closeButton());

    expect(document.querySelector(`img[src="${LARGE_URL}"]`)).toBeNull();
    await openPhoto();
    await waitFor(() =>
      expect(requestedUrls).toEqual([LARGE_PHOTO_PATH, LARGE_PHOTO_PATH]),
    );
  });

  it("las iniciales no son un botón y no abren nada", async () => {
    stubLargePhoto();
    renderAvatar({ photoUrl: null });

    await userEvent.click(screen.getByText("MR"));

    expect(
      screen.queryByRole("button", { name: /photo of Mateo/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(requestedUrls).toEqual([]);
  });

  it("una miniatura que no carga cae a las iniciales y deja de abrir", () => {
    stubLargePhoto();
    renderAvatar();

    const thumbnail = document.querySelector(`img[src="${THUMBNAIL_URL}"]`);
    if (thumbnail === null) {
      throw new Error("La miniatura no se pintó.");
    }
    fireEvent.error(thumbnail);

    expect(
      screen.queryByRole("button", { name: /Mateo Restrepo/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("MR")).toHaveAttribute("aria-hidden", "true");
  });
});
