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

/**
 * El correo del directorio en la pantalla (#501, RF-6 del PRD de E19): el
 * formulario con los destinatarios, el diálogo que confirma antes de mandar
 * nada y el resultado. El servidor es de mentira: lo que hace de verdad lo
 * prueban el dominio y la ruta.
 */

const EMAILS_PATH = "/api/v1/directory/emails";
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

function stubApi(stub: ApiStub = {}): void {
  const quotaAnswers = [...(stub.quota ?? [quotaResponse(38)])];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body =
        init?.body === undefined ? null : JSON.parse(String(init.body));
      calls.push({ url, method, body });
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
      screen.getByText("La lista está vacía: no hay a quién mandarlo."),
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
    render(<DirectoryScreen locale="es" />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Escribir correo" }));

    const recipients = screen.getByRole("list", { name: "1 destinatario" });
    expect(within(recipients).getByText("Nerea Ruiz")).toBeTruthy();
  });

  it("con la lista vacía el botón está deshabilitado y dice por qué", async () => {
    stubDirectory("committee", []);
    render(<DirectoryScreen locale="es" />);

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
    render(<DirectoryScreen locale="es" />);

    await screen.findByText("Nerea Ruiz");

    expect(
      screen.queryByRole("button", { name: "Escribir correo" }),
    ).toBeNull();
  });
});
