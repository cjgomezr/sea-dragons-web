import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryEmailComposer } from "@/components/directory/DirectoryEmailComposer";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import type { CommitteeDirectoryMember } from "@/lib/directory/directory";
import type { Locale } from "@/lib/i18n/locale";
import { QUIET_CLUB_SUMMARY } from "../helpers/club-summary";

/**
 * El correo del directorio en la pantalla (#501, RF-6 del PRD de E19): el
 * formulario con los destinatarios, el diálogo que confirma antes de mandar
 * nada y el resultado. El servidor es de mentira: lo que hace de verdad lo
 * prueban el dominio y la ruta.
 */

const EMAILS_PATH = "/api/v1/directory/emails";
const DIRECTORY_LIST_PATH = "/api/v1/directory?";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const NEREA = {
  userId: "b1b1b1b1-0000-4000-8000-00000000000b",
  fullName: "Nerea Ruiz",
};
const TOMAS = {
  userId: "b2b2b2b2-0000-4000-8000-00000000000c",
  fullName: "Tomás Gil",
};

type ApiCall = {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
};

type Respond = () => Promise<Response>;

type ApiStub = {
  readonly quota?: readonly Respond[];
  readonly send?: Respond;
  /** Lo que responde `GET /api/v1/directory`, que pide el buscador. */
  readonly directory?: Respond;
};

const calls: ApiCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, code: string, reason: string): Response {
  return jsonResponse(status, { error: { code, message: "x", reason } });
}

function quotaResponse(remaining: number): Respond {
  return async () => jsonResponse(200, { data: { limit: 50, remaining } });
}

function sentResponse(
  sentCount: number,
  failed: readonly { userId: string; fullName: string }[] = [],
): Respond {
  return async () =>
    jsonResponse(200, { data: { sentCount, failed, remaining: 10 } });
}

type ListedMember = {
  readonly userId: string;
  readonly fullName: string;
  readonly role?: "Admin" | "Committee" | "Coach" | "Player";
  readonly status?: "incomplete" | "active" | "inactive";
};

function directoryResponse(members: readonly ListedMember[]): Respond {
  return async () =>
    jsonResponse(200, {
      data: {
        kind: "member",
        availableFilters: [],
        total: members.length,
        members: members.map((member) => ({
          country: null,
          experienceLevel: null,
          role: "Player",
          position: null,
          status: "active",
          invitedOn: null,
          photoUrl: null,
          attendance: { kind: "no_data" },
          ...member,
        })),
      },
    });
}

function stubApi(stub: ApiStub = {}): void {
  const quotaAnswers = [...(stub.quota ?? [quotaResponse(38)])];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body =
        init?.body === undefined ? null : JSON.parse(String(init.body));
      calls.push({ url, method, body });
      if (url.startsWith(DIRECTORY_LIST_PATH)) {
        return (stub.directory ?? directoryResponse([]))();
      }
      if (url !== EMAILS_PATH) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      if (method === "GET") {
        const next =
          quotaAnswers.length > 1 ? quotaAnswers.shift() : quotaAnswers[0];
        if (next === undefined) {
          throw new Error("sin respuesta para el cupo");
        }
        return next();
      }
      return (stub.send ?? sentResponse(2))();
    }),
  );
}

function posts(): ApiCall[] {
  return calls.filter((call) => call.method === "POST");
}

function renderComposer(locale: Locale = "es"): {
  readonly onClose: ReturnType<typeof vi.fn>;
  readonly rerender: (locale: Locale) => void;
} {
  const onClose = vi.fn();
  const view = render(
    <DirectoryEmailComposer
      locale={locale}
      recipients={[NEREA, TOMAS]}
      onClose={onClose}
    />,
  );
  return {
    onClose,
    rerender: (next) =>
      view.rerender(
        <DirectoryEmailComposer
          locale={next}
          recipients={[NEREA, TOMAS]}
          onClose={onClose}
        />,
      ),
  };
}

async function fillDraft(
  subject = "Entreno",
  message = "Nos vemos el sábado.",
): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Asunto" }), subject);
  await user.type(screen.getByRole("textbox", { name: "Mensaje" }), message);
}

function sendButton(count = 2): HTMLButtonElement {
  return screen.getByRole("button", {
    name: `Enviar a ${count}`,
  }) as HTMLButtonElement;
}

function subjectBox(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Asunto" }) as HTMLInputElement;
}

function messageBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: "Mensaje",
  }) as HTMLTextAreaElement;
}

/** Espera a que el pie diga cuántos correos quedan hoy. */
async function waitForQuota(remaining: number): Promise<void> {
  await screen.findByText(`${remaining} de 50 correos libres hoy`);
}

async function openConfirmation(): Promise<HTMLElement> {
  await fillDraft();
  await userEvent.setup().click(sendButton());
  return screen.findByRole("dialog", { name: "¿Enviar a 2 miembros?" });
}

beforeEach(() => {
  calls.length = 0;
  stubApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el formulario", () => {
  it("enseña a quién va, el asunto y el mensaje", () => {
    renderComposer();

    const recipients = screen.getByRole("list", { name: "2 destinatarios" });
    expect(within(recipients).getByText("Nerea Ruiz")).toBeTruthy();
    expect(within(recipients).getByText("Tomás Gil")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Asunto" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Mensaje" })).toBeTruthy();
  });

  it("deja quitar a un socio de la lista", async () => {
    renderComposer();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Quitar a Nerea Ruiz" }));

    const recipients = screen.getByRole("list", { name: "1 destinatario" });
    expect(within(recipients).queryByText("Nerea Ruiz")).toBeNull();
  });

  it("sin nadie en la lista no deja enviar y dice por qué", async () => {
    renderComposer();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Quitar a Nerea Ruiz" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Quitar a Tomás Gil" }),
    );

    expect(sendButton(0).disabled).toBe(true);
    expect(
      screen.getByText(
        "Todavía no hay a quién escribir. Añade miembros por su nombre.",
      ),
    ).toBeTruthy();
  });

  it("con el asunto y el mensaje vacíos, avisa junto a cada campo y no abre el diálogo", async () => {
    renderComposer();

    await userEvent.setup().click(sendButton());

    expect(subjectBox().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Añade un asunto.")).toBeTruthy();
    expect(screen.getByText("Escribe un mensaje.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts()).toEqual([]);
  });

  it("con un mensaje de 5.001 caracteres dice cuánto sobra", async () => {
    renderComposer();
    await userEvent.setup().type(subjectBox(), "Entreno");
    fireEvent.change(messageBox(), { target: { value: "a".repeat(5_001) } });

    await userEvent.setup().click(sendButton());

    expect(
      screen.getByText("Al mensaje le sobra 1 carácter. Acórtalo a 5.000."),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("con un asunto de más de 150 caracteres dice cuántos lleva", async () => {
    renderComposer();
    fireEvent.change(subjectBox(), { target: { value: "a".repeat(151) } });

    await userEvent.setup().click(sendButton());

    expect(
      screen.getByText("Deja el asunto en 150 caracteres (ahora tiene 151)."),
    ).toBeTruthy();
  });
});

function memberNumbered(index: number): {
  readonly userId: string;
  readonly fullName: string;
} {
  const suffix = String(index).padStart(12, "0");
  return {
    userId: `c0c0c0c0-0000-4000-8000-${suffix}`,
    fullName: `Socio ${index}`,
  };
}

function membersNumbered(count: number): readonly {
  readonly userId: string;
  readonly fullName: string;
}[] {
  return Array.from({ length: count }, (_, index) => memberNumbered(index + 1));
}

function renderWithRecipients(
  recipients: readonly { readonly userId: string; readonly fullName: string }[],
): void {
  render(
    <DirectoryEmailComposer
      locale="es"
      recipients={recipients}
      onClose={vi.fn()}
    />,
  );
}

function recipientNames(): readonly string[] {
  const list = screen.getByRole("list", { name: /destinatario/ });
  return within(list)
    .queryAllByRole("button", { name: /^Quitar a / })
    .map((button) =>
      (button.getAttribute("aria-label") ?? "").replace("Quitar a ", ""),
    );
}

function searchBox(): HTMLInputElement {
  return screen.getByRole("combobox", {
    name: "Añadir un miembro por su nombre",
  }) as HTMLInputElement;
}

function directoryRequests(): readonly ApiCall[] {
  return calls.filter((call) => call.url.startsWith(DIRECTORY_LIST_PATH));
}

describe("la cabecera", () => {
  it("lleva el título, la frase nueva y una × que cierra", async () => {
    const { onClose } = renderComposer();

    expect(
      screen.getByRole("heading", { name: "Escribir a los miembros" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Cada miembro recibe su propio correo desde la dirección del club. Las respuestas te llegan a ti.",
      ),
    ).toBeTruthy();
    const close = screen.getByRole("button", { name: "Cerrar" });
    expect(close.textContent).toBe("");

    await userEvent.setup().click(close);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("las fichas de los destinatarios", () => {
  it("con 3, pone PARA con la cuenta y una ficha por socio con iniciales, nombre y ×", () => {
    renderWithRecipients([NEREA, TOMAS, memberNumbered(1)]);

    expect(screen.getByText("Para · 3 miembros")).toBeTruthy();
    const list = screen.getByRole("list", { name: "3 destinatarios" });
    const chips = within(list).getAllByRole("listitem");
    expect(chips).toHaveLength(3);
    const nerea = chips[0]!;
    expect(within(nerea).getByText("NR")).toBeTruthy();
    expect(within(nerea).getByText("Nerea Ruiz").getAttribute("title")).toBe(
      "Nerea Ruiz",
    );
    expect(
      within(nerea).getByRole("button", { name: "Quitar a Nerea Ruiz" }),
    ).toBeTruthy();
  });

  it("con 25, enseña 10 y una ficha +15 más que despliega todas y Ver menos", async () => {
    renderWithRecipients(membersNumbered(25));
    const user = userEvent.setup();

    expect(recipientNames()).toHaveLength(10);
    const more = screen.getByRole("button", {
      name: "Ver los 25 destinatarios",
    });
    expect(more.textContent).toBe("+15 más");

    await user.click(more);

    expect(recipientNames()).toHaveLength(25);
    await user.click(screen.getByRole("button", { name: "Ver menos" }));
    expect(recipientNames()).toHaveLength(10);
  });

  it("con 11, las enseña todas sin +N más", () => {
    renderWithRecipients(membersNumbered(11));

    expect(recipientNames()).toHaveLength(11);
    expect(screen.queryByRole("button", { name: /^Ver los / })).toBeNull();
  });

  it("Quitar todos vacía la lista y dice cómo añadir socios", async () => {
    renderComposer();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Quitar todos" }));

    expect(recipientNames()).toEqual([]);
    expect(
      screen.getByText(
        "Todavía no hay a quién escribir. Añade miembros por su nombre.",
      ),
    ).toBeTruthy();
  });

  it("con un solo destinatario no ofrece Quitar todos", () => {
    renderWithRecipients([NEREA]);

    expect(screen.queryByRole("button", { name: "Quitar todos" })).toBeNull();
  });

  it("Retroceso en el buscador vacío quita la última ficha", async () => {
    renderComposer();
    const user = userEvent.setup();

    await user.click(searchBox());
    await user.keyboard("{Backspace}");

    expect(recipientNames()).toEqual(["Nerea Ruiz"]);
  });

  it("Retroceso con texto en el buscador borra texto, no fichas", async () => {
    renderComposer();
    const user = userEvent.setup();

    await user.type(searchBox(), "ne");
    await user.keyboard("{Backspace}");

    expect(searchBox().value).toBe("n");
    expect(recipientNames()).toEqual(["Nerea Ruiz", "Tomás Gil"]);
  });

  it("un clic en la caja fuera de una ficha lleva el foco al buscador", async () => {
    renderComposer();

    await userEvent
      .setup()
      .click(screen.getByRole("list", { name: "2 destinatarios" }));

    expect(document.activeElement).toBe(searchBox());
  });
});

describe("añadir socios por su nombre", () => {
  const MARTA = {
    userId: "d1d1d1d1-0000-4000-8000-000000000001",
    fullName: "Marta Gil",
  };
  const MARIA = {
    userId: "d2d2d2d2-0000-4000-8000-000000000002",
    fullName: "María López",
    role: "Coach" as const,
  };
  const OMAR = {
    userId: "d3d3d3d3-0000-4000-8000-000000000003",
    fullName: "Omar Haddad",
  };
  const MARIO_DE_BAJA = {
    userId: "d4d4d4d4-0000-4000-8000-000000000004",
    fullName: "Mario Baja",
    status: "inactive" as const,
  };

  function stubClub(members: readonly ListedMember[]): void {
    stubApi({ directory: directoryResponse(members) });
  }

  it("el buscador es un combobox que apunta a su listbox", async () => {
    stubClub([MARTA]);
    renderComposer();
    const box = searchBox();

    expect(box.getAttribute("aria-autocomplete")).toBe("list");
    expect(box.getAttribute("aria-expanded")).toBe("false");

    await userEvent.setup().type(box, "mar");

    const listbox = await screen.findByRole("listbox");
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(box.getAttribute("aria-controls")).toBe(listbox.id);
  });

  it("pide la lista del club la primera vez que recibe el foco, y sólo esa", async () => {
    stubClub([MARTA]);
    renderComposer();
    const user = userEvent.setup();

    await user.click(searchBox());
    await waitFor(() => expect(directoryRequests()).toHaveLength(1));
    await user.click(screen.getByRole("textbox", { name: "Asunto" }));
    await user.type(searchBox(), "mar");
    await screen.findByRole("option", { name: /Marta Gil/ });

    expect(directoryRequests()).toHaveLength(1);
  });

  it("enseña a los activos que no están, con la parte que coincide en negrita", async () => {
    stubClub([MARTA, MARIA, OMAR, MARIO_DE_BAJA, { ...NEREA }]);
    renderComposer();

    await userEvent.setup().type(searchBox(), "MAR");

    const options = await screen.findAllByRole("option");
    expect(
      options.map((option) => option.querySelector("strong")?.textContent),
    ).toEqual(["Mar", "Mar", "mar"]);
    expect(within(options[1]!).getByText("Coach")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Mario Baja/ })).toBeNull();
  });

  it("con ↓ y Enter añade el resaltado, vacía el campo y deja el foco en él", async () => {
    stubClub([MARTA, MARIA]);
    renderComposer();
    const user = userEvent.setup();

    await user.type(searchBox(), "mar");
    await screen.findAllByRole("option");
    await user.keyboard("{ArrowDown}");
    expect(
      screen
        .getByRole("option", { name: /María López/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await user.keyboard("{Enter}");

    expect(recipientNames()).toEqual([
      "Nerea Ruiz",
      "Tomás Gil",
      "María López",
    ]);
    expect(searchBox().value).toBe("");
    expect(document.activeElement).toBe(searchBox());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("↑ desde el primero va al último", async () => {
    stubClub([MARTA, MARIA]);
    renderComposer();
    const user = userEvent.setup();

    await user.type(searchBox(), "mar");
    await screen.findAllByRole("option");
    await user.keyboard("{ArrowUp}{Enter}");

    expect(recipientNames()).toEqual([
      "Nerea Ruiz",
      "Tomás Gil",
      "María López",
    ]);
  });

  it("un clic en una opción la añade y deja el foco en el buscador", async () => {
    stubClub([MARTA]);
    renderComposer();
    const user = userEvent.setup();

    await user.type(searchBox(), "mar");
    await user.click(await screen.findByRole("option", { name: /Marta Gil/ }));

    expect(recipientNames()).toEqual(["Nerea Ruiz", "Tomás Gil", "Marta Gil"]);
    expect(document.activeElement).toBe(searchBox());
  });

  it("Esc vacía la búsqueda", async () => {
    stubClub([MARTA]);
    renderComposer();
    const user = userEvent.setup();

    await user.type(searchBox(), "mar");
    await screen.findAllByRole("option");
    await user.keyboard("{Escape}");

    expect(searchBox().value).toBe("");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("sin coincidencias lo dice con lo buscado", async () => {
    stubClub([MARTA]);
    renderComposer();

    await userEvent.setup().type(searchBox(), "zz");

    expect(
      await screen.findByText('Ningún miembro coincide con "zz".'),
    ).toBeTruthy();
  });

  it("si todos los que coinciden ya están, lo dice", async () => {
    stubClub([{ ...NEREA }]);
    renderComposer();

    await userEvent.setup().type(searchBox(), "nerea");

    expect(
      await screen.findByText(
        'Todos los que coinciden con "nerea" ya están en la lista.',
      ),
    ).toBeTruthy();
  });

  it("si la lista no llega, avisa con Reintentar y el resto sigue funcionando", async () => {
    stubApi({ directory: async () => errorResponse(500, "internal", "x") });
    renderComposer();
    const user = userEvent.setup();

    await user.type(searchBox(), "mar");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "No pudimos cargar a los miembros del club.",
    );
    await user.type(screen.getByRole("textbox", { name: "Asunto" }), "Hola");
    expect(
      (screen.getByRole("textbox", { name: "Asunto" }) as HTMLInputElement)
        .value,
    ).toBe("Hola");

    stubApi({ directory: directoryResponse([MARTA]) });
    await user.click(within(alert).getByRole("button", { name: "Reintentar" }));
    await user.click(searchBox());

    expect(
      await screen.findByRole("option", { name: /Marta Gil/ }),
    ).toBeTruthy();
  });
});

/** Selecciona en el área desde `from` (incluido) hasta `to` (excluido). */
function selectInMessage(from: number, to: number): void {
  const area = messageBox();
  area.focus();
  area.setSelectionRange(from, to);
}

function selectedInMessage(): string {
  const area = messageBox();
  return area.value.slice(area.selectionStart, area.selectionEnd);
}

describe("la barra de formato", () => {
  it("es una barra de herramientas con los cinco formatos", () => {
    renderComposer();

    const toolbar = screen.getByRole("toolbar", {
      name: "Formato del mensaje",
    });
    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Negrita",
      "Cursiva",
      "Añadir enlace",
      "Lista de viñetas",
      "Lista numerada",
    ]);
  });

  it("Negrita envuelve la selección en ** y la deja seleccionada", async () => {
    renderComposer();
    fireEvent.change(messageBox(), { target: { value: "El sábado a las 8" } });
    selectInMessage(3, 9);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Negrita" }));

    expect(messageBox().value).toBe("El **sábado** a las 8");
    expect(selectedInMessage()).toBe("sábado");
  });

  it("sin selección, Negrita inserta el texto de ejemplo seleccionado", async () => {
    renderComposer();
    selectInMessage(0, 0);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Negrita" }));

    expect(messageBox().value).toBe("**texto en negrita**");
    expect(selectedInMessage()).toBe("texto en negrita");
  });

  it("Ctrl+B pone negrita y Ctrl+I cursiva", async () => {
    renderComposer();
    const user = userEvent.setup();
    fireEvent.change(messageBox(), { target: { value: "Trae aletas" } });
    selectInMessage(5, 11);

    await user.keyboard("{Control>}b{/Control}");
    await user.keyboard("{Control>}i{/Control}");

    expect(messageBox().value).toBe("Trae **_aletas_**");
  });

  it("⌘+K convierte la selección en enlace con https:// seleccionado", async () => {
    renderComposer();
    fireEvent.change(messageBox(), { target: { value: "Mira la hoja" } });
    selectInMessage(5, 12);

    await userEvent.setup().keyboard("{Meta>}k{/Meta}");

    expect(messageBox().value).toBe("Mira [la hoja](https://)");
    expect(selectedInMessage()).toBe("https://");
  });

  it("Lista numerada numera las líneas y cambia las viñetas que ya tenían", async () => {
    renderComposer();
    const text = "- Aletas\n- Gorro\n- Tubo";
    fireEvent.change(messageBox(), { target: { value: text } });
    selectInMessage(0, text.length);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Lista numerada" }));

    expect(messageBox().value).toBe("1. Aletas\n2. Gorro\n3. Tubo");
  });

  it("un formato que no cambia el texto no mueve el cursor en la tecla siguiente", async () => {
    renderComposer();
    const user = userEvent.setup();
    const text = "- a\n- b";
    fireEvent.change(messageBox(), { target: { value: text } });
    selectInMessage(0, text.length);

    await user.click(screen.getByRole("button", { name: "Lista de viñetas" }));
    selectInMessage(text.length, text.length);
    await user.keyboard("cd");

    expect(messageBox().value).toBe("- a\n- bcd");
  });

  it("los botones no le quitan el foco al área", () => {
    renderComposer();
    const toolbar = screen.getByRole("toolbar", {
      name: "Formato del mensaje",
    });

    const pressed = within(toolbar)
      .getAllByRole("button")
      .map((button) => fireEvent.mouseDown(button));

    // `fireEvent` devuelve `false` cuando el evento se canceló.
    expect(pressed).toEqual([false, false, false, false, false]);
  });

  it("las flechas mueven el foco por la barra, con un solo botón en el tabulador", async () => {
    renderComposer();
    const user = userEvent.setup();
    const bold = screen.getByRole("button", { name: "Negrita" });

    bold.focus();
    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cursiva" }),
    );
    expect(bold.tabIndex).toBe(-1);
  });
});

async function showPreview(): Promise<HTMLElement> {
  await userEvent
    .setup()
    .click(screen.getByRole("tab", { name: "Vista previa" }));
  return screen.getByRole("tabpanel", { name: "Vista previa" });
}

describe("la vista previa", () => {
  it("las pestañas siguen el patrón de WAI-ARIA", async () => {
    renderComposer();

    const tablist = screen.getByRole("tablist", {
      name: "Cómo ver el mensaje",
    });
    const [write, preview] = within(tablist).getAllByRole("tab");
    expect(write?.getAttribute("aria-selected")).toBe("true");
    expect(preview?.getAttribute("aria-selected")).toBe("false");

    const panel = await showPreview();

    expect(preview?.getAttribute("aria-selected")).toBe("true");
    expect(preview?.getAttribute("aria-controls")).toBe(panel.id);
    expect(screen.queryByRole("textbox", { name: "Mensaje" })).toBeNull();
  });

  it("enseña de quién, para quién y el asunto", async () => {
    renderComposer();
    await fillDraft("Entreno a las 8", "Hola");

    const panel = await showPreview();

    expect(panel).toHaveTextContent(
      "De Victoria Seadragons · las respuestas te llegan a ti",
    );
    expect(panel).toHaveTextContent(
      "Para 2 miembros · cada uno recibe su copia",
    );
    expect(within(panel).getByText("Entreno a las 8")).toBeTruthy();
  });

  it("con un solo destinatario pone su nombre", async () => {
    renderWithRecipients([NEREA]);

    const panel = await showPreview();

    expect(panel).toHaveTextContent("Para Nerea Ruiz");
  });

  it("sin asunto ni mensaje lo dice", async () => {
    renderComposer();

    const panel = await showPreview();

    expect(within(panel).getByText("Todavía sin asunto")).toBeTruthy();
    expect(
      within(panel).getByText("Todavía no hay nada que ver."),
    ).toBeTruthy();
  });

  it("pinta el cuerpo con el árbol del correo: negrita, cursiva, enlace y listas", async () => {
    renderComposer();
    fireEvent.change(messageBox(), {
      target: {
        value:
          "Este **sábado** a las _8_.\n\n- Aletas\n- [La hoja](https://club.org)\n\n1. Uno\n2. Dos",
      },
    });

    const panel = await showPreview();

    expect(within(panel).getByText("sábado").tagName).toBe("STRONG");
    expect(within(panel).getByText("8").tagName).toBe("EM");
    expect(
      within(panel).getByRole("link", { name: "La hoja" }).getAttribute("href"),
    ).toBe("https://club.org");
    const [bullets, numbers] = within(panel).getAllByRole("list");
    expect(bullets?.tagName).toBe("UL");
    expect(within(bullets!).getAllByRole("listitem")).toHaveLength(2);
    expect(numbers?.tagName).toBe("OL");
    expect(within(numbers!).getAllByRole("listitem")).toHaveLength(2);
  });

  it("lo que no es de la lista sale como se escribió, y los saltos se respetan", async () => {
    renderComposer();
    fireEvent.change(messageBox(), {
      target: { value: "<b>Hola</b>\nAdiós\n[x](javascript:alert(1))" },
    });

    const panel = await showPreview();

    expect(panel).toHaveTextContent("<b>Hola</b>");
    expect(panel).toHaveTextContent("[x](javascript:alert(1))");
    expect(panel.querySelector("b")).toBeNull();
    expect(within(panel).queryByRole("link")).toBeNull();
    expect(panel.querySelectorAll("br")).toHaveLength(2);
  });
});

describe("los contadores", () => {
  it("cuentan los caracteres del asunto y del mensaje", async () => {
    renderComposer();

    await fillDraft("Entreno", "Hola");

    expect(screen.getByText("7 / 150")).toBeTruthy();
    expect(screen.getByText("4 / 5.000")).toBeTruthy();
  });

  it("el del mensaje se nota pasado el 90 % y se marca pasado el 100 %", () => {
    renderComposer();

    fireEvent.change(messageBox(), { target: { value: "a".repeat(4_500) } });
    expect(
      screen.getByText("4.500 / 5.000").getAttribute("data-level"),
    ).toBeNull();

    fireEvent.change(messageBox(), { target: { value: "a".repeat(4_501) } });
    expect(screen.getByText("4.501 / 5.000").getAttribute("data-level")).toBe(
      "near",
    );

    fireEvent.change(messageBox(), { target: { value: "a".repeat(5_001) } });
    expect(screen.getByText("5.001 / 5.000").getAttribute("data-level")).toBe(
      "over",
    );
  });
});

describe("el cupo en el pie", () => {
  it("dice cuántos correos quedan hoy en cuanto carga", async () => {
    renderComposer();

    await waitForQuota(38);
    expect(
      calls.filter((call) => call.url === EMAILS_PATH && call.method === "GET"),
    ).toHaveLength(1);
  });

  it("con menos de 10 la barra avisa", async () => {
    stubApi({ quota: [quotaResponse(9)] });
    renderComposer();

    await waitForQuota(9);

    expect(
      screen.getByRole("meter", { name: "9 de 50 correos libres hoy" }),
    ).toHaveAttribute("data-level", "low");
  });

  it("si no se pudo cargar lo dice y deja enviar", async () => {
    stubApi({ quota: [async () => errorResponse(500, "internal", "x")] });
    renderComposer();

    expect(
      await screen.findByText(
        "No se pudo saber cuántos correos quedan hoy. Puedes enviar igual.",
      ),
    ).toBeTruthy();
    await fillDraft();
    await userEvent.setup().click(sendButton());
    const dialog = await screen.findByRole("dialog", {
      name: "¿Enviar a 2 miembros?",
    });
    expect(
      within(dialog).getByText("No se pudo saber cuántos correos quedan hoy."),
    ).toBeTruthy();
  });

  it("con más destinatarios que correos libres avisa y no deja enviar", async () => {
    stubApi({ quota: [quotaResponse(41)] });
    renderWithRecipients(membersNumbered(45));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "Solo quedan 41 correos hoy. Quita a 4 personas o envía el resto mañana.",
    );
    expect(sendButton(45).disabled).toBe(true);
  });

  it("con tantos destinatarios como correos libres deja enviar", async () => {
    stubApi({ quota: [quotaResponse(2)] });
    renderComposer();

    await waitForQuota(2);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(sendButton().disabled).toBe(false);
  });
});

describe("los errores", () => {
  it("sin asunto y con 5.240 caracteres marca los dos campos, los cuenta y lleva el foco al asunto", async () => {
    renderComposer();
    fireEvent.change(messageBox(), { target: { value: "a".repeat(5_240) } });

    await userEvent.setup().click(sendButton());

    const subjectError = screen.getByText("Añade un asunto.");
    const messageError = screen.getByText(
      "Al mensaje le sobran 240 caracteres. Acórtalo a 5.000.",
    );
    expect(subjectBox()).toHaveAttribute("aria-invalid", "true");
    expect(subjectBox().getAttribute("aria-describedby")).toContain(
      subjectError.id,
    );
    expect(messageBox()).toHaveAttribute("aria-invalid", "true");
    expect(messageBox().getAttribute("aria-describedby")).toContain(
      messageError.id,
    );
    expect(screen.getByText("2 cosas por arreglar")).toBeTruthy();
    expect(document.activeElement).toBe(subjectBox());
  });

  it("si la vista previa estaba abierta vuelve a Escribir con el foco en el mensaje", async () => {
    renderComposer();
    await userEvent.setup().type(subjectBox(), "Entreno");
    await showPreview();

    await userEvent.setup().click(sendButton());

    expect(
      screen
        .getByRole("tab", { name: "Escribir" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.activeElement).toBe(messageBox());
    expect(screen.getByText("1 cosa por arreglar")).toBeTruthy();
  });

  it("si la vista previa estaba abierta y sólo falla el asunto, también vuelve a Escribir", async () => {
    renderComposer();
    await userEvent.setup().type(messageBox(), "Hola");
    await showPreview();

    await userEvent.setup().click(sendButton());

    expect(
      screen
        .getByRole("tab", { name: "Escribir" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.activeElement).toBe(subjectBox());
  });

  it("los errores no salen hasta intentar enviar", () => {
    renderComposer();

    expect(subjectBox()).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(/por arreglar/)).toBeNull();
  });
});

describe("el diálogo de confirmación", () => {
  it("es un diálogo modal que dice a cuántos va, con qué asunto y el cupo antes y después", async () => {
    stubApi({ quota: [quotaResponse(41)] });
    renderWithRecipients(membersNumbered(25));
    await waitForQuota(41);
    await fillDraft("Entreno a las 8");

    await userEvent.setup().click(sendButton(25));

    const dialog = await screen.findByRole("dialog", {
      name: "¿Enviar a 25 miembros?",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent(
      "Cada uno recibe su propio correo de Victoria Seadragons con el asunto “Entreno a las 8”. Las respuestas te llegan a ti.",
    );
    expect(dialog).toHaveTextContent("Correos libres hoy 41 → 16 de 50");
    expect(dialog).toHaveTextContent("Mañana vuelven a ser 50.");
    expect(posts()).toEqual([]);
  });

  it("con un destinatario pregunta por su nombre", async () => {
    renderWithRecipients([NEREA]);
    await fillDraft();

    await userEvent.setup().click(sendButton(1));

    expect(
      await screen.findByRole("dialog", { name: "¿Enviar a Nerea Ruiz?" }),
    ).toBeTruthy();
  });

  it("si después quedan menos de 10, la nota lo dice", async () => {
    stubApi({ quota: [quotaResponse(11)] });
    renderComposer();
    await waitForQuota(11);

    const dialog = await openConfirmation();

    expect(dialog).toHaveTextContent("11 → 9 de 50");
    expect(dialog).toHaveTextContent(
      "Después de esto, solo quedan 9 hasta mañana.",
    );
  });

  it("si usa los últimos de hoy, lo dice", async () => {
    stubApi({ quota: [quotaResponse(2)] });
    renderComposer();
    await waitForQuota(2);

    const dialog = await openConfirmation();

    expect(dialog).toHaveTextContent("Esto usa los últimos correos de hoy.");
  });

  it("cancelar no manda nada y vuelve al formulario con lo escrito", async () => {
    renderComposer();
    const dialog = await openConfirmation();

    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts()).toEqual([]);
    expect(subjectBox().value).toBe("Entreno");
  });

  it("al confirmar manda el borrador a los que quedan en la lista, con una clave de petición", async () => {
    renderComposer();
    const dialog = await openConfirmation();

    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Enviar 2 correos" }));

    await screen.findByText("2 correos enviados");
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toEqual({
      requestId: expect.stringMatching(UUID_PATTERN),
      subject: "Entreno",
      message: "Nos vemos el sábado.",
      recipientIds: [NEREA.userId, TOMAS.userId],
    });
  });

  it("mientras manda dice Enviando… y desactiva los dos botones", async () => {
    let release: () => void = () => undefined;
    stubApi({
      send: () =>
        new Promise((resolve) => {
          release = () => resolve(jsonResponse(200, SENT_TO_BOTH));
        }),
    });
    renderComposer();
    const dialog = await openConfirmation();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Enviar 2 correos" }),
    );

    const sending = await within(dialog).findByRole("button", {
      name: "Enviando…",
    });
    expect(sending).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Cancelar" }),
    ).toBeDisabled();
    release();
    await screen.findByText("2 correos enviados");
  });

  it("un doble clic manda una sola vez", async () => {
    let release: () => void = () => undefined;
    stubApi({
      send: () =>
        new Promise((resolve) => {
          release = () => resolve(jsonResponse(200, SENT_TO_BOTH));
        }),
    });
    renderComposer();
    const dialog = await openConfirmation();
    const confirm = within(dialog).getByRole("button", {
      name: "Enviar 2 correos",
    });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    release();

    await screen.findByText("2 correos enviados");
    expect(posts()).toHaveLength(1);
  });
});

const SENT_TO_BOTH = { data: { sentCount: 2, failed: [], remaining: 10 } };

async function sendDraft(): Promise<void> {
  const dialog = await openConfirmation();
  await userEvent
    .setup()
    .click(within(dialog).getByRole("button", { name: "Enviar 2 correos" }));
}

describe("el envío hecho", () => {
  it("dice cuántos salieron y cuántos correos quedan hoy", async () => {
    renderComposer();

    await sendDraft();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("2 correos enviados");
    expect(status).toHaveTextContent(
      "Las respuestas te llegarán a tu correo. 10 de 50 correos libres hoy",
    );
    expect(screen.queryByRole("textbox", { name: "Asunto" })).toBeNull();
  });

  it("Escribir otro vacía el asunto y el mensaje y conserva los destinatarios", async () => {
    renderComposer();
    await sendDraft();

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Escribir otro" }));

    expect(subjectBox().value).toBe("");
    expect(messageBox().value).toBe("");
    expect(recipientNames()).toEqual(["Nerea Ruiz", "Tomás Gil"]);
    expect(screen.getByText("10 de 50 correos libres hoy")).toBeTruthy();
    expect(screen.queryByText(/por arreglar/)).toBeNull();
    expect(document.activeElement).toBe(subjectBox());
  });

  it("al enviar, el foco pasa al estado Enviado y no se pierde", async () => {
    renderComposer();

    await sendDraft();

    const status = await screen.findByRole("status");
    await waitFor(() =>
      expect(status.contains(document.activeElement)).toBe(true),
    );
  });

  it("Cerrar cierra el redactor", async () => {
    const { onClose } = renderComposer();
    await sendDraft();

    const closeButtons = await screen.findAllByRole("button", {
      name: "Cerrar",
    });
    await userEvent.setup().click(closeButtons.at(-1)!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("si falla a medias dice cuántos salieron y a quiénes no llegó", async () => {
    stubApi({ send: sentResponse(1, [TOMAS]) });
    renderComposer();

    await sendDraft();

    expect(await screen.findByText("1 correo enviado")).toBeTruthy();
    const failed = screen.getByRole("list", { name: "No llegó a:" });
    expect(within(failed).getByText("Tomás Gil")).toBeTruthy();
  });
});

describe("cuando el servidor dice que no", () => {
  it("si no caben, vuelve a leer el cupo y avisa de cuántos sobran", async () => {
    stubApi({
      quota: [quotaResponse(5), quotaResponse(1)],
      send: async () =>
        errorResponse(409, "conflict", "directory_email_quota_exceeded"),
    });
    renderComposer();
    await waitForQuota(5);

    await sendDraft();

    expect(
      await screen.findByText(
        "Solo queda 1 correo hoy. Quita a 1 persona o envía el resto mañana.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(subjectBox().value).toBe("Entreno");
    expect(sendButton().disabled).toBe(true);
  });

  it("si no caben y no se puede volver a leer el cupo, lo dice", async () => {
    stubApi({
      quota: [
        quotaResponse(5),
        async () => errorResponse(500, "internal", "x"),
      ],
      send: async () =>
        errorResponse(409, "conflict", "directory_email_quota_exceeded"),
    });
    renderComposer();
    await waitForQuota(5);

    await sendDraft();

    expect(
      await screen.findByText(
        "No caben en lo que el directorio puede mandar hoy. Quita miembros de la lista o inténtalo más tarde.",
      ),
    ).toBeTruthy();
  });

  it("si el proveedor no está, dice que el envío no está disponible ahora", async () => {
    stubApi({
      send: async () =>
        errorResponse(503, "service_unavailable", "email_unavailable"),
    });
    renderComposer();

    await sendDraft();

    expect(
      await screen.findByText(
        "El envío de correos no está disponible ahora. Inténtalo más tarde.",
      ),
    ).toBeTruthy();
  });

  it("si al Committee le quitaron el rol, se lo dice", async () => {
    stubApi({
      send: async () =>
        errorResponse(403, "forbidden", "directory_email_forbidden"),
    });
    renderComposer();

    await sendDraft();

    expect(
      await screen.findByText(
        "Tu rol ya no puede mandar correos desde el directorio.",
      ),
    ).toBeTruthy();
  });
});

describe("el idioma", () => {
  it("el formulario y el diálogo cambian con el interruptor", async () => {
    const { rerender } = renderComposer();
    await waitForQuota(38);
    await openConfirmation();

    rerender("en");

    expect(screen.getByRole("textbox", { name: "Subject" })).toBeTruthy();
    expect(screen.getByText("38 of 50 emails left today")).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "Send to 2 members?" });
    expect(dialog).toHaveTextContent("Emails left today 38 → 36 of 50");
    expect(
      within(dialog).getByRole("button", { name: "Send 2 emails" }),
    ).toBeTruthy();
  });

  it("los contadores escriben los miles a la inglesa", () => {
    renderComposer("en");

    expect(screen.getByText("0 / 5,000")).toBeTruthy();
  });
});
describe("en el directorio", () => {
  const MEMBER: CommitteeDirectoryMember = {
    userId: NEREA.userId,
    fullName: NEREA.fullName,
    country: "ES",
    experienceLevel: "Beginner",
    role: "Player",
    position: null,
    status: "active",
    invitedOn: null,
    photoUrl: null,
    attendance: { kind: "no_data" },
    email: "nerea@club.test",
    phone: null,
    emergencyContact: null,
  };

  function stubDirectory(
    kind: "committee" | "member",
    members: readonly unknown[],
  ): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/v1/directory")) {
          return jsonResponse(200, {
            data: {
              kind,
              members,
              availableFilters: ["position"],
              total: members.length,
              summary: QUIET_CLUB_SUMMARY,
            },
          });
        }
        if (url === "/api/v1/club/positions") {
          return jsonResponse(200, { data: { positions: [] } });
        }
        throw new Error(`Petición inesperada: ${url}`);
      }),
    );
  }

  it("un Committee abre el formulario con la lista que está viendo", async () => {
    stubDirectory("committee", [MEMBER]);
    render(<DirectoryScreen clubName="Victoria Seadragons" locale="es" />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Escribir correo" }));

    const recipients = screen.getByRole("list", { name: "1 destinatario" });
    expect(within(recipients).getByText("Nerea Ruiz")).toBeTruthy();
  });

  it("con la lista vacía el botón está deshabilitado y dice por qué", async () => {
    stubDirectory("committee", []);
    render(<DirectoryScreen clubName="Victoria Seadragons" locale="es" />);

    const button = (await screen.findByRole("button", {
      name: "Escribir correo",
    })) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(
      screen.getByText("No hay miembros en la lista a quien escribir."),
    ).toBeTruthy();
  });

  it("a un Player no le ofrece escribir correos", async () => {
    stubDirectory("member", [MEMBER]);
    render(<DirectoryScreen clubName="Victoria Seadragons" locale="es" />);

    await screen.findByText("Nerea Ruiz");

    expect(
      screen.queryByRole("button", { name: "Escribir correo" }),
    ).toBeNull();
  });
});
