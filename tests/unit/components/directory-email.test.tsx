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

async function openConfirmation(): Promise<HTMLElement> {
  await fillDraft();
  await userEvent.setup().click(screen.getByRole("button", { name: "Enviar" }));
  return screen.findByRole("dialog", { name: "¿Mandar el correo?" });
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

    expect(
      (screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Todavía no hay a quién escribir. Añade miembros por su nombre.",
      ),
    ).toBeTruthy();
  });

  it("con el asunto y el mensaje vacíos, avisa junto a cada campo y no abre el diálogo", async () => {
    renderComposer();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Enviar" }));

    const subject = screen.getByRole("textbox", { name: "Asunto" });
    expect(subject.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Escribe el asunto.")).toBeTruthy();
    expect(screen.getByText("Escribe el mensaje.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("con un mensaje de más de 5.000 caracteres avisa del límite", async () => {
    renderComposer();
    await userEvent
      .setup()
      .type(screen.getByRole("textbox", { name: "Asunto" }), "Entreno");
    fireEvent.change(screen.getByRole("textbox", { name: "Mensaje" }), {
      target: { value: "a".repeat(5_001) },
    });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Enviar" }));

    expect(
      screen.getByText("El mensaje puede tener como mucho 5000 caracteres."),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("con un asunto de más de 150 caracteres avisa del límite", async () => {
    renderComposer();
    fireEvent.change(screen.getByRole("textbox", { name: "Asunto" }), {
      target: { value: "a".repeat(151) },
    });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Enviar" }));

    expect(
      screen.getByText("El asunto puede tener como mucho 150 caracteres."),
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

describe("el diálogo de confirmación", () => {
  it("dice a cuántos va y cuántos quedan hoy, y no manda nada todavía", async () => {
    renderComposer();

    const dialog = await openConfirmation();

    expect(within(dialog).getByText("Va a 2 miembros.")).toBeTruthy();
    expect(
      await within(dialog).findByText("Hoy quedan 38 correos del directorio."),
    ).toBeTruthy();
    expect(posts()).toEqual([]);
  });

  it("cancelar no manda nada y vuelve al formulario con lo escrito", async () => {
    renderComposer();
    const dialog = await openConfirmation();

    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts()).toEqual([]);
    expect(
      (screen.getByRole("textbox", { name: "Asunto" }) as HTMLInputElement)
        .value,
    ).toBe("Entreno");
  });

  it("al confirmar manda el borrador a los que quedan en la lista, con una clave de petición", async () => {
    renderComposer();
    const dialog = await openConfirmation();

    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Mandar" }));

    await screen.findByText("Se mandaron 2 correos.");
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toEqual({
      requestId: expect.stringMatching(UUID_PATTERN),
      subject: "Entreno",
      message: "Nos vemos el sábado.",
      recipientIds: [NEREA.userId, TOMAS.userId],
    });
  });

  it("un doble clic manda una sola vez", async () => {
    let release: () => void = () => undefined;
    stubApi({
      send: () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              jsonResponse(200, {
                data: { sentCount: 2, failed: [], remaining: 10 },
              }),
            );
        }),
    });
    renderComposer();
    const dialog = await openConfirmation();
    const confirm = within(dialog).getByRole("button", { name: "Mandar" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    release();

    await screen.findByText("Se mandaron 2 correos.");
    expect(posts()).toHaveLength(1);
  });
});

describe("el resultado", () => {
  it("si falla a medias dice cuántos salieron y a quiénes no llegó", async () => {
    stubApi({ send: sentResponse(1, [TOMAS]) });
    renderComposer();
    const dialog = await openConfirmation();

    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Mandar" }));

    expect(await screen.findByText("Se mandó 1 correo.")).toBeTruthy();
    const failed = screen.getByRole("list", { name: "No llegó a:" });
    expect(within(failed).getByText("Tomás Gil")).toBeTruthy();
  });

  it("si no caben, no cierra el formulario y dice cuántos caben ahora", async () => {
    stubApi({
      quota: [quotaResponse(5), quotaResponse(1)],
      send: async () =>
        errorResponse(409, "conflict", "directory_email_quota_exceeded"),
    });
    renderComposer();
    const dialog = await openConfirmation();

    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Mandar" }));

    expect(
      await screen.findByText(
        "No caben: hoy el directorio puede mandar 1 correo más. Quita miembros de la lista o inténtalo más tarde.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Asunto" })).toBeTruthy();
  });

  it("si el proveedor no está, dice que el envío no está disponible ahora", async () => {
    stubApi({
      send: async () =>
        errorResponse(503, "service_unavailable", "email_unavailable"),
    });
    renderComposer();
    const dialog = await openConfirmation();

    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Mandar" }));

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
    const dialog = await openConfirmation();

    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Mandar" }));

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
    await openConfirmation();

    rerender("en");

    expect(screen.getByRole("textbox", { name: "Subject" })).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "Send the email?" });
    expect(within(dialog).getByText("It goes to 2 members.")).toBeTruthy();
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
