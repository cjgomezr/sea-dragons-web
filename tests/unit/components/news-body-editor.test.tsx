import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewsBodyEditor } from "@/components/news/NewsBodyEditor";
import type {
  NewsInlineImageUploader,
  NewsInlineImageUploadOutcome,
} from "@/components/news/use-news-inline-images";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * El editor del cuerpo de una noticia (#598, RF-9 del PRD de E22): pestañas
 * Escribir y Vista previa, barra de formato, atajos y la ayuda de formato.
 * Lo que cada formato hace con el texto se prueba en las funciones puras;
 * aquí, que cada botón y atajo llega al área y que el foco no se va.
 */

const MAC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36";

const IMAGE_URL = "/api/v1/news/images/1d1d1d1d-0000-4000-8000-000000000001";

/** Una subida que responde lo que se le diga, cuando se le diga. */
function fakeUploader(
  respond: () => Promise<NewsInlineImageUploadOutcome>,
  isUploading = false,
): NewsInlineImageUploader {
  return { isUploading, upload: vi.fn(respond) };
}

const UPLOADED: NewsInlineImageUploader = fakeUploader(async () => ({
  kind: "uploaded",
  url: IMAGE_URL,
}));

function Harness({
  initialBody,
  locale,
  imageUpload = UPLOADED,
}: {
  readonly initialBody: string;
  readonly locale: Locale;
  readonly imageUpload?: NewsInlineImageUploader;
}): React.JSX.Element {
  const [body, setBody] = useState(initialBody);
  return (
    <NewsBodyEditor
      translate={createTranslator(locale)}
      id="cuerpo"
      value={body}
      onChange={setBody}
      issueId={null}
      imageUpload={imageUpload}
    />
  );
}

function renderEditor(
  initialBody = "",
  locale: Locale = "en",
  imageUpload: NewsInlineImageUploader = UPLOADED,
): void {
  render(
    <Harness
      initialBody={initialBody}
      locale={locale}
      imageUpload={imageUpload}
    />,
  );
}

function picture(name = "equipo.png"): File {
  return new File([new Uint8Array(2_048)], name, { type: "image/png" });
}

async function chooseImage(file: File = picture()): Promise<void> {
  await userEvent.click(
    within(toolbar()).getByRole("button", { name: "Insert image" }),
  );
  await userEvent.upload(screen.getByLabelText("Choose an image"), file, {
    applyAccept: false,
  });
}

function bodyArea(): HTMLTextAreaElement {
  const area = screen.getByLabelText("Message");
  if (!(area instanceof HTMLTextAreaElement)) {
    throw new Error("El cuerpo no es un área de texto.");
  }
  return area;
}

function select(start: number, end: number): void {
  const area = bodyArea();
  area.focus();
  area.setSelectionRange(start, end);
}

function selectedText(): string {
  const area = bodyArea();
  return area.value.slice(area.selectionStart, area.selectionEnd);
}

function toolbar(): HTMLElement {
  return screen.getByRole("group", { name: "Formatting" });
}

function tab(name: string): HTMLElement {
  return screen.getByRole("tab", { name });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("editor del cuerpo", () => {
  it("abre en la pestaña Escribir, con Vista previa al lado", () => {
    renderEditor();

    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual([
      "Write",
      "Preview",
    ]);
    expect(tab("Write")).toHaveAttribute("aria-selected", "true");
    expect(tab("Preview")).toHaveAttribute("aria-selected", "false");
    expect(bodyArea()).toBeVisible();
  });

  it("muestra los botones de formato en el orden del diseño", () => {
    renderEditor();

    expect(
      within(toolbar())
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Bold",
      "Italic",
      "Heading",
      "Bulleted list",
      "Numbered list",
      "Quote",
      "Link",
      "Insert image",
    ]);
  });

  it.each([
    ["Bold", "Bring **caps** and fins"],
    ["Italic", "Bring *caps* and fins"],
    ["Link", "Bring [caps](https://) and fins"],
  ])(
    "%s envuelve lo seleccionado y lo deja seleccionado",
    async (name, expected) => {
      renderEditor("Bring caps and fins");
      select(6, 10);

      await userEvent.click(within(toolbar()).getByRole("button", { name }));

      expect(bodyArea()).toHaveValue(expected);
      expect(selectedText()).toBe("caps");
    },
  );

  it("sin selección, Negrita inserta cuatro asteriscos con el cursor en medio", async () => {
    renderEditor("Bring ");
    select(6, 6);

    await userEvent.click(
      within(toolbar()).getByRole("button", { name: "Bold" }),
    );

    expect(bodyArea()).toHaveValue("Bring ****");
    expect(bodyArea().selectionStart).toBe(8);
    expect(bodyArea().selectionEnd).toBe(8);
  });

  it.each([
    ["Heading", "## "],
    ["Bulleted list", "- "],
    ["Numbered list", "1. "],
    ["Quote", "> "],
  ])("%s prefija cada línea seleccionada", async (name, prefix) => {
    renderEditor("caps\nfins");
    select(0, 9);

    await userEvent.click(within(toolbar()).getByRole("button", { name }));

    expect(bodyArea()).toHaveValue(`${prefix}caps\n${prefix}fins`);
  });

  it("al pulsar un botón el foco se queda en el área", async () => {
    renderEditor("Bring caps");
    select(6, 10);

    await userEvent.click(
      within(toolbar()).getByRole("button", { name: "Italic" }),
    );

    expect(bodyArea()).toHaveFocus();
  });

  it("el botón evita que el clic se lleve el foco del área", () => {
    renderEditor();
    const button = within(toolbar()).getByRole("button", { name: "Bold" });
    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });

    button.dispatchEvent(mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
  });

  it.each([
    ["{Control>}b{/Control}", "Bring **caps**"],
    ["{Meta>}b{/Meta}", "Bring **caps**"],
    ["{Control>}i{/Control}", "Bring *caps*"],
    ["{Meta>}i{/Meta}", "Bring *caps*"],
  ])("el atajo %s hace lo mismo que su botón", async (keys, expected) => {
    renderEditor("Bring caps");
    select(6, 10);

    await userEvent.keyboard(keys);

    expect(bodyArea()).toHaveValue(expected);
    expect(selectedText()).toBe("caps");
  });

  it("el área se describe con la pista del pie", () => {
    renderEditor();

    const hintIds = bodyArea().getAttribute("aria-describedby") ?? "";
    const hints = hintIds
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);

    expect(hints).toContain("Markdown supported · Ctrl+B bold · Ctrl+I italic");
  });
});

describe("vista previa", () => {
  it("pinta el cuerpo como Markdown y esconde la barra de formato", async () => {
    renderEditor("Bring **caps**");

    await userEvent.click(tab("Preview"));

    const panel = screen.getByRole("tabpanel", { name: "Preview" });
    expect(within(panel).getByText("caps").tagName).toBe("STRONG");
    expect(screen.queryByRole("group", { name: "Formatting" })).toBeNull();
    expect(bodyArea()).not.toBeVisible();
  });

  it.each([
    ["vacío", ""],
    ["con sólo espacios", "  \n "],
  ])(
    "con el cuerpo %s dice que no hay nada que previsualizar",
    async (_case, body) => {
      renderEditor(body);

      await userEvent.click(tab("Preview"));

      expect(
        within(screen.getByRole("tabpanel", { name: "Preview" })).getByText(
          "Nothing to preview yet.",
        ),
      ).toBeVisible();
    },
  );

  it("en español dice que todavía no hay nada que previsualizar", async () => {
    render(<Harness initialBody="" locale="es" />);

    await userEvent.click(screen.getByRole("tab", { name: "Vista previa" }));

    expect(
      screen.getByText("Todavía no hay nada que previsualizar."),
    ).toBeVisible();
  });

  it("volver a Escribir devuelve el área y la barra", async () => {
    renderEditor("Bring caps");
    await userEvent.click(tab("Preview"));

    await userEvent.click(tab("Write"));

    expect(bodyArea()).toBeVisible();
    expect(toolbar()).toBeVisible();
  });
});

describe("pestañas con teclado", () => {
  it("sólo la pestaña activa entra en el orden de tabulación", () => {
    renderEditor();

    expect(tab("Write")).toHaveAttribute("tabindex", "0");
    expect(tab("Preview")).toHaveAttribute("tabindex", "-1");
  });

  it.each([
    ["{ArrowRight}", "Preview"],
    ["{ArrowLeft}", "Preview"],
    ["{End}", "Preview"],
  ])("desde Escribir, %s activa y enfoca %s", async (key, expected) => {
    renderEditor();
    tab("Write").focus();

    await userEvent.keyboard(key);

    expect(tab(expected)).toHaveAttribute("aria-selected", "true");
    expect(tab(expected)).toHaveFocus();
  });

  it.each([
    ["{ArrowRight}", "Write"],
    ["{ArrowLeft}", "Write"],
    ["{Home}", "Write"],
  ])("desde Vista previa, %s activa y enfoca %s", async (key, expected) => {
    renderEditor();
    await userEvent.click(tab("Preview"));

    await userEvent.keyboard(key);

    expect(tab(expected)).toHaveAttribute("aria-selected", "true");
    expect(tab(expected)).toHaveFocus();
  });

  it("cada pestaña controla su panel", () => {
    renderEditor();

    const panelId = tab("Write").getAttribute("aria-controls") ?? "";
    expect(document.getElementById(panelId)).toContainElement(bodyArea());
  });
});

describe("pie y ayuda de formato", () => {
  it("fuera de Mac nombra los atajos con Ctrl", () => {
    renderEditor();

    expect(
      screen.getByText("Markdown supported · Ctrl+B bold · Ctrl+I italic"),
    ).toBeVisible();
  });

  it("en un Mac nombra los atajos con ⌘", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      MAC_USER_AGENT,
    );
    renderEditor();

    expect(
      screen.getByText("Markdown supported · ⌘B bold · ⌘I italic"),
    ).toBeVisible();
  });

  it("en español dice que admite Markdown", () => {
    renderEditor("", "es");

    expect(
      screen.getByText("Admite Markdown · Ctrl+B negrita · Ctrl+I cursiva"),
    ).toBeVisible();
  });

  it("la ayuda de formato empieza plegada", () => {
    renderEditor();

    expect(
      screen.getByRole("button", { name: "Formatting help" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("**bold text**")).toBeNull();
  });

  it("la ayuda de formato despliega la chuleta de la sintaxis", async () => {
    renderEditor();

    await userEvent.click(
      screen.getByRole("button", { name: "Formatting help" }),
    );

    expect(
      screen.getByRole("button", { name: "Formatting help" }),
    ).toHaveAttribute("aria-expanded", "true");
    const sheet = screen.getByRole("region", { name: "Formatting help" });
    for (const syntax of [
      "**bold text**",
      "*italic text*",
      "## Heading",
      "- Item",
      "1. Item",
      "> Quote",
      "[link text](https://…)",
    ]) {
      expect(within(sheet).getByText(syntax)).toBeVisible();
    }
  });

  it("la chuleta también está en español", async () => {
    renderEditor("", "es");

    await userEvent.click(
      screen.getByRole("button", { name: "Ayuda de formato" }),
    );

    const sheet = screen.getByRole("region", { name: "Ayuda de formato" });
    expect(within(sheet).getByText("**texto en negrita**")).toBeVisible();
    expect(
      within(sheet).getByText("[texto del enlace](https://…)"),
    ).toBeVisible();
  });
});

describe("imágenes del cuerpo (#603)", () => {
  it("Imagen sube la elegida y la inserta donde estaba el cursor, con el cursor en el pie", async () => {
    renderEditor("Antes después");
    select(6, 6);

    await chooseImage();

    expect(UPLOADED.upload).toHaveBeenCalledWith(expect.any(File));
    expect(bodyArea()).toHaveValue(`Antes ![](${IMAGE_URL})después`);
    expect(bodyArea().selectionStart).toBe(8);
    expect(bodyArea().selectionEnd).toBe(8);
    expect(bodyArea()).toHaveFocus();
  });

  it("el selector sólo ofrece JPEG, PNG y WebP", () => {
    renderEditor();

    expect(screen.getByLabelText("Choose an image")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
  });

  it("si la imagen no vale, no inserta nada y dice por qué", async () => {
    renderEditor(
      "Antes",
      "en",
      fakeUploader(async () => ({
        kind: "rejected",
        issue: { kind: "rejected", code: "inline_image_too_large" },
      })),
    );

    await chooseImage();

    expect(bodyArea()).toHaveValue("Antes");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Each image can be up to 10 MB.",
    );
  });

  it("si la subida falla, no inserta nada y dice por qué", async () => {
    renderEditor(
      "Antes",
      "en",
      fakeUploader(async () => ({
        kind: "rejected",
        issue: {
          kind: "uploadFailed",
          failure: { kind: "failed", failure: "network", reason: null },
        },
      })),
    );

    await chooseImage();

    expect(bodyArea()).toHaveValue("Antes");
    expect(await screen.findByRole("alert")).toHaveTextContent(/connection/i);
  });

  it("elegir otra imagen quita el aviso de la anterior", async () => {
    let outcome: NewsInlineImageUploadOutcome = {
      kind: "rejected",
      issue: { kind: "rejected", code: "inline_image_type_unsupported" },
    };
    renderEditor(
      "",
      "en",
      fakeUploader(async () => outcome),
    );
    await chooseImage();
    await screen.findByRole("alert");

    outcome = { kind: "uploaded", url: IMAGE_URL };
    await chooseImage();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("mientras sube, lo dice", () => {
    renderEditor(
      "",
      "en",
      fakeUploader(() => new Promise(() => undefined), true),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Uploading the image…",
    );
  });

  it("la vista previa enseña la imagen recién subida", async () => {
    let finish: () => void = () => undefined;
    renderEditor(
      "",
      "en",
      fakeUploader(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ kind: "uploaded", url: IMAGE_URL });
          }),
      ),
    );
    await chooseImage();
    await act(async () => finish());

    await userEvent.click(tab("Preview"));

    // Sin pie, el alt va vacío: es decorativa, así que su rol no es "img".
    expect(
      screen.getByRole("tabpanel", { name: "Preview" }).querySelector("img"),
    ).toHaveAttribute("src", IMAGE_URL);
  });
});
