import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteMemberPanel } from "@/components/directory/InviteMemberPanel";
import { COUNTRY_CODES } from "@/lib/geo/countries";
import type { Group } from "@/lib/groups/groups";
import {
  DEFENDER,
  FORWARD,
  GOALKEEPER,
  asDirectoryPosition,
} from "../helpers/seeded-positions";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * La invitación de un miembro como panel del Directorio (#862, RF-9 y D11 del
 * PRD de E33): quién, los grupos en fichas, los datos de jugador plegados, el
 * resumen de errores con enlaces, el correo que ya es de un miembro y la vista
 * previa de la invitación. Después de enviar (#863, RF-10): enviada, o no
 * salió con Reenviar, Invitar a otro con los grupos y el enlace a la ficha; y
 * en el móvil, una ventana que ocupa la pantalla.
 */

const NEW_USER_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
const EXISTING_USER_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000001";
const MASTERS_ID = "9a9a9a9a-0000-4000-8000-000000000002";
const MEMBERS_PATH = "/api/v1/members";
const GROUPS_PATH = "/api/v1/groups";
const POSITIONS_PATH = "/api/v1/club/positions";
const COMMON_COUNTRIES_PATH = "/api/v1/club/common-countries";
const INVITATION_PATH = `/api/v1/members/${NEW_USER_ID}/invitation`;
const CLUB_NAME = "Victoria Seadragons";

/** En el orden del club, que no es el alfabético (#299). */
const CLUB_POSITIONS = [FORWARD, GOALKEEPER, DEFENDER].map(asDirectoryPosition);

const CLUB_GROUPS: readonly Group[] = [
  { id: MASTERS_ID, name: "Masters Squad", memberCount: 3 },
  { id: SENIOR_ID, name: "Senior Squad", memberCount: 5 },
];

type Call = { readonly url: string; readonly body: unknown };

const calls: Call[] = [];

type Stub = {
  readonly groups?: readonly Group[];
  readonly positions?: readonly unknown[];
  /** Los países más comunes del club (#864), o `"failed"` si la petición
   * falla. */
  readonly commonCountries?: readonly string[] | "failed";
  readonly create?: () => Response | Promise<Response>;
  readonly resend?: () => Response;
};

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(
  status: number,
  code: string,
  reason?: string,
): Response {
  return jsonResponse(status, { error: { code, message: "x", reason } });
}

function createdResponse(invitation: "sent" | "not_sent"): Response {
  return jsonResponse(201, {
    data: {
      member: {
        userId: NEW_USER_ID,
        fullName: "Nerea Silva",
        email: "nerea@example.com",
      },
      invitation,
    },
  });
}

function stubApi(stub: Stub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === GROUPS_PATH) {
        return jsonResponse(200, {
          data: { groups: stub.groups ?? CLUB_GROUPS },
        });
      }
      if (url === POSITIONS_PATH) {
        return jsonResponse(200, {
          data: { positions: stub.positions ?? CLUB_POSITIONS },
        });
      }
      if (url === COMMON_COUNTRIES_PATH) {
        return stub.commonCountries === "failed"
          ? errorResponse(500, "internal_error")
          : jsonResponse(200, {
              data: { countries: stub.commonCountries ?? ["NZ", "AU"] },
            });
      }
      const body: unknown =
        init?.body === undefined ? null : JSON.parse(String(init.body));
      calls.push({ url, body });
      if (url === MEMBERS_PATH && init?.method === "POST") {
        return stub.create?.() ?? createdResponse("sent");
      }
      if (url === INVITATION_PATH && init?.method === "POST") {
        return (
          stub.resend?.() ?? jsonResponse(200, { data: { invitation: "sent" } })
        );
      }
      throw new Error(`Petición inesperada: ${url}`);
    }),
  );
}

async function renderPanel(
  options: {
    readonly locale?: "en" | "es";
    readonly onClose?: () => void;
    readonly onMemberCreated?: () => void;
  } = {},
): Promise<void> {
  render(
    <InviteMemberPanel
      locale={options.locale ?? "en"}
      clubName={CLUB_NAME}
      onClose={options.onClose ?? (() => undefined)}
      onMemberCreated={options.onMemberCreated ?? (() => undefined)}
    />,
  );
  await screen.findByLabelText(options.locale === "es" ? "Correo" : "Email");
}

function detailsToggle(): HTMLElement {
  return screen.getByRole("button", { name: /^Player details · optional/ });
}

async function openDetails(): Promise<void> {
  await userEvent.setup().click(detailsToggle());
}

async function typeWho(name: string, email: string): Promise<void> {
  const user = userEvent.setup();
  if (name !== "") {
    await user.type(screen.getByLabelText("Full name"), name);
  }
  if (email !== "") {
    await user.type(screen.getByLabelText("Email"), email);
  }
}

function optionNamesOf(group: HTMLElement): readonly string[] {
  return within(group)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: /^(Send invitation|Sending…)$/ });
}

beforeEach(() => {
  calls.length = 0;
  stubScreenWidth(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el panel de invitar a un socio", () => {
  it("se presenta con su título y su frase", async () => {
    stubApi();

    await renderPanel();

    const panel = screen.getByRole("region", { name: "Invite a member" });
    expect(
      within(panel).getByText(
        "They get an email from the club to set a password and sign in.",
      ),
    ).toBeVisible();
  });

  it("se cierra con la ×", async () => {
    stubApi();
    const onClose = vi.fn();
    await renderPanel({ onClose });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("se cierra con Cancelar", async () => {
    stubApi();
    const onClose = vi.fn();
    await renderPanel({ onClose });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dice en el pie que solo el nombre y el correo son obligatorios", async () => {
    stubApi();

    await renderPanel();

    expect(screen.getByText("Only name and email are required.")).toBeVisible();
    expect(sendButton()).toHaveTextContent("Send invitation");
  });
});

describe("quién", () => {
  it("pide el nombre y el correo, el correo con teclado de correo", async () => {
    stubApi();

    await renderPanel();

    const who = screen.getByRole("group", { name: "Who" });
    expect(within(who).getByLabelText("Full name")).toHaveAttribute(
      "type",
      "text",
    );
    expect(within(who).getByLabelText("Email")).toHaveAttribute(
      "inputMode",
      "email",
    );
  });
});

describe("los grupos", () => {
  it("son fichas apagadas que se encienden al pulsarlas", async () => {
    stubApi();
    await renderPanel();
    const chip = screen.getByRole("button", { name: "Senior Squad" });
    expect(chip).toHaveAttribute("aria-pressed", "false");

    await userEvent.setup().click(chip);

    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("dice ninguno sin grupos elegidos y cuántos al elegir", async () => {
    stubApi();
    await renderPanel();
    const groups = screen.getByRole("group", { name: /^Groups/ });
    expect(groups).toHaveAccessibleName("Groups · none");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Senior Squad" }));
    await user.click(screen.getByRole("button", { name: "Masters Squad" }));

    expect(groups).toHaveAccessibleName("Groups · 2 chosen");
  });

  it("sin grupos en el club, lo dice y enlaza a Grupos", async () => {
    stubApi({ groups: [] });

    await renderPanel();

    expect(screen.getByText("The club has no groups yet.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Create them in Groups" }),
    ).toHaveAttribute("href", "/grupos");
  });

  it("manda los grupos elegidos con el alta", async () => {
    stubApi();
    await renderPanel();
    await typeWho("Nerea Silva", "nerea@example.com");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Senior Squad" }));

    await user.click(sendButton());

    await screen.findByText(/^Invitation sent to/);
    expect(calls[0]?.body).toMatchObject({ groupIds: [SENIOR_ID] });
  });
});

describe("los datos de jugador", () => {
  it("salen plegados y el botón dice qué controla", async () => {
    stubApi();

    await renderPanel();

    const toggle = detailsToggle();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controlled = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    expect(controlled).not.toBeNull();
    expect(controlled).not.toBeVisible();
  });

  it("se abren al pulsarlos", async () => {
    stubApi();
    await renderPanel();

    await openDetails();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Country")).toBeVisible();
  });

  it("dicen que los rellena el socio, con su nombre de pila cuando ya está", async () => {
    stubApi();
    await renderPanel();
    expect(
      screen.getByText(
        "Leave them empty and the member fills them in after signing in.",
      ),
    ).toBeVisible();

    await typeWho("Nerea Silva", "");

    expect(
      screen.getByText(
        "Leave them empty and Nerea fills them in after signing in.",
      ),
    ).toBeVisible();
  });

  it("cuentan cuántos de los 6 están rellenos", async () => {
    stubApi();
    await renderPanel();
    expect(detailsToggle()).toHaveTextContent("0 of 6");
    await openDetails();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Country"), "AU");
    await user.click(screen.getByRole("radio", { name: "Intermediate" }));

    expect(detailsToggle()).toHaveTextContent("2 of 6");
  });

  it("ofrecen todos los países, ordenados por su nombre en el idioma de la pantalla", async () => {
    stubApi();
    await renderPanel({ locale: "es" });
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: /^Datos de jugador · opcional/ }),
      );

    const names = optionNamesOf(
      within(screen.getByLabelText("País")).getByRole("group", {
        name: "Todos los países",
      }),
    );

    expect(names).toHaveLength(COUNTRY_CODES.length);
    expect(names).toContain("España");
    expect(names).toEqual(
      [...names].sort((first, second) => first.localeCompare(second, "es")),
    );
  });

  it("proponen primero los más comunes del club, en el orden de la API y en el idioma de la pantalla", async () => {
    stubApi({ commonCountries: ["NZ", "AU"] });
    await renderPanel({ locale: "es" });
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: /^Datos de jugador · opcional/ }),
      );

    const groups = within(await screen.findByLabelText("País")).getAllByRole(
      "group",
    );

    expect(groups.map((group) => group.getAttribute("label"))).toEqual([
      "Más comunes en el club",
      "Todos los países",
    ]);
    expect(optionNamesOf(groups[0]!)).toEqual(["Nueva Zelanda", "Australia"]);
  });

  it("si la petición de los más comunes falla, sólo ofrecen todos los países", async () => {
    stubApi({ commonCountries: "failed" });
    await renderPanel();
    await openDetails();

    const groups = within(screen.getByLabelText("Country")).getAllByRole(
      "group",
    );

    expect(groups.map((group) => group.getAttribute("label"))).toEqual([
      "All countries",
    ]);
  });

  it("si la petición de los más comunes falla, se invita igual con un país", async () => {
    stubApi({ commonCountries: "failed" });
    await renderPanel();
    await openDetails();
    const user = userEvent.setup();
    await typeWho("Nerea Silva", "nerea@example.com");

    await user.selectOptions(screen.getByLabelText("Country"), "CO");
    await user.click(sendButton());

    await screen.findByText(/^Invitation sent to/);
    expect(calls[0]?.body).toMatchObject({ country: "CO" });
  });

  it("elegir un país de los más comunes lo guarda", async () => {
    stubApi({ commonCountries: ["NZ", "AU"] });
    await renderPanel();
    await openDetails();
    const user = userEvent.setup();
    const commonGroup = within(
      await screen.findByRole("group", { name: "Most common in the club" }),
    );

    await user.selectOptions(
      screen.getByLabelText("Country"),
      commonGroup.getByRole("option", { name: "New Zealand" }),
    );

    expect(screen.getByLabelText("Country")).toHaveValue("NZ");
  });

  it("ofrecen las posiciones activas del club, en su orden", async () => {
    stubApi();
    await renderPanel();
    await openDetails();

    expect(
      within(screen.getByLabelText("Position"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Choose one", "Forward", "Goalkeeper", "Defender"]);
  });

  it("sin posiciones activas no piden posición y cuentan 5", async () => {
    stubApi({ positions: [] });
    await renderPanel();
    await openDetails();

    expect(screen.queryByLabelText("Position")).not.toBeInTheDocument();
    expect(detailsToggle()).toHaveTextContent("0 of 5");
  });

  it("avisan de que el género solo lo ven los Admin y el socio", async () => {
    stubApi();
    await renderPanel();
    await openDetails();

    expect(screen.getByLabelText("Gender")).toHaveAccessibleDescription(
      "only Admins and the member",
    );
  });

  it("la experiencia es un grupo de 3 que se desmarca al volver a pulsar", async () => {
    stubApi();
    await renderPanel();
    await openDetails();
    const levels = screen.getByRole("radiogroup", { name: "Experience" });
    expect(within(levels).getAllByRole("radio")).toHaveLength(3);
    const intermediate = within(levels).getByRole("radio", {
      name: "Intermediate",
    });
    const user = userEvent.setup();

    await user.click(intermediate);
    expect(intermediate).toBeChecked();
    await user.click(intermediate);

    expect(intermediate).not.toBeChecked();
  });

  it("el AUF pide número y vencimiento, los dos o ninguno", async () => {
    stubApi();
    await renderPanel();
    await openDetails();

    const auf = screen.getByRole("group", { name: "AUF registration" });
    expect(within(auf).getByText("Both or neither")).toBeVisible();
    expect(within(auf).getByLabelText("Number")).toBeVisible();
    expect(within(auf).getByLabelText("Expires")).toHaveAttribute(
      "type",
      "date",
    );
  });

  it("mandan lo que se rellenó", async () => {
    stubApi();
    await renderPanel();
    await typeWho("Nerea Silva", "nerea@example.com");
    await openDetails();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Country"), "AU");
    await user.selectOptions(screen.getByLabelText("Position"), "Forward");
    await user.click(screen.getByRole("radio", { name: "Intermediate" }));
    await user.selectOptions(screen.getByLabelText("Gender"), "female");
    await user.type(screen.getByLabelText("Number"), "AUF-2210");
    await user.type(screen.getByLabelText("Expires"), "2099-06-30");

    await user.click(sendButton());

    await screen.findByText(/^Invitation sent to/);
    expect(calls).toEqual([
      {
        url: MEMBERS_PATH,
        body: {
          fullName: "Nerea Silva",
          email: "nerea@example.com",
          country: "AU",
          positionId: FORWARD.id,
          experienceLevel: "Intermediate",
          gender: "female",
          aufNumber: "AUF-2210",
          aufExpiry: "2099-06-30",
          groupIds: [],
        },
      },
    ]);
  });
});

describe("los errores antes de enviar", () => {
  it("resume arriba cuántas cosas hay que arreglar y se lleva el foco", async () => {
    stubApi();
    await renderPanel();

    await userEvent.setup().click(sendButton());

    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent("2 things to fix before sending");
    expect(summary).toHaveFocus();
    expect(calls).toEqual([]);
  });

  it("marca cada campo con su error", async () => {
    stubApi();
    await renderPanel();

    await userEvent.setup().click(sendButton());

    const name = screen.getByLabelText("Full name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Write the member's name.");
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Write a valid email address.",
    );
  });

  it("enlaza cada error a su campo", async () => {
    stubApi();
    await renderPanel();
    const user = userEvent.setup();
    await user.click(sendButton());

    await user.click(
      within(screen.getByRole("alert")).getByRole("link", {
        name: "Email: Write a valid email address.",
      }),
    );

    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("abre los datos de jugador si el campo del error está dentro", async () => {
    stubApi();
    await renderPanel();
    await typeWho("Nerea Silva", "nerea@example.com");
    await openDetails();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Number"), "AUF-2210");
    await user.click(detailsToggle());

    await user.click(sendButton());
    await user.click(
      screen.getByRole("link", {
        name: "AUF expiry: Add the expiry date that goes with the AUF number.",
      }),
    );

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Expires")).toHaveFocus();
  });

  it("el botón de los datos de jugador dice cuántos hay por arreglar", async () => {
    stubApi();
    await renderPanel();
    await typeWho("Nerea Silva", "nerea@example.com");
    await openDetails();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Number"), "AUF-2210");

    await user.click(sendButton());

    expect(detailsToggle()).toHaveTextContent("1 to fix");
  });

  it("dice que es una sola cosa cuando es una", async () => {
    stubApi();
    await renderPanel();
    await typeWho("Nerea Silva", "");

    await userEvent.setup().click(sendButton());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "1 thing to fix before sending",
    );
  });

  it("los errores se van al volver a escribir", async () => {
    stubApi();
    await renderPanel();
    const user = userEvent.setup();
    await user.click(sendButton());

    await user.type(screen.getByLabelText("Full name"), "N");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});

describe("el correo que ya es de un miembro", () => {
  function emailTakenBy(existingMember: unknown): Response {
    return jsonResponse(409, {
      error: {
        existingMember,
        code: "conflict",
        message: "x",
        reason: "email_taken",
      },
    });
  }

  it("lo dice junto al correo y enlaza a la ficha de ese socio", async () => {
    stubApi({
      create: () =>
        emailTakenBy({ userId: EXISTING_USER_ID, fullName: "Sofia Reyes" }),
    });
    await renderPanel();
    await typeWho("Nerea Silva", "sofia@example.com");

    await userEvent.setup().click(sendButton());

    const email = screen.getByLabelText("Email");
    expect(
      await screen.findByRole("link", { name: "Open Sofia Reyes's profile" }),
    ).toHaveAttribute("href", `/directorio/${EXISTING_USER_ID}`);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription(
      /^This email already belongs to a member\./,
    );
    expect(screen.getByLabelText("Full name")).toHaveValue("Nerea Silva");
  });

  it("lo cuenta también en el resumen", async () => {
    stubApi({
      create: () =>
        emailTakenBy({ userId: EXISTING_USER_ID, fullName: "Sofia Reyes" }),
    });
    await renderPanel();
    await typeWho("Nerea Silva", "sofia@example.com");

    await userEvent.setup().click(sendButton());

    expect(
      await screen.findByRole("link", {
        name: "Email: This email already belongs to a member.",
      }),
    ).toBeVisible();
  });

  it("sin socio que nombrar, lo dice sin enlace", async () => {
    stubApi({ create: () => errorResponse(409, "conflict", "email_taken") });
    await renderPanel();
    await typeWho("Nerea Silva", "sofia@example.com");

    await userEvent.setup().click(sendButton());

    expect(
      await screen.findByText("This email already belongs to a member.", {
        selector: "p",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /profile/ }),
    ).not.toBeInTheDocument();
  });
});

describe("los fallos del envío", () => {
  it.each([
    [
      "network",
      () => Promise.reject(new TypeError("offline")),
      "Check your connection",
    ],
    [
      "429",
      () => errorResponse(429, "rate_limited"),
      "Several invitations were sent in a row. Wait a few minutes before asking for another.",
    ],
    [
      "403",
      () => errorResponse(403, "forbidden"),
      "Only an Admin can invite members.",
    ],
  ] as const)(
    "un fallo de %s sale en el banner, encima de la vista previa",
    async (_name, create, text) => {
      stubApi({ create });
      await renderPanel();
      await typeWho("Nerea Silva", "nerea@example.com");

      await userEvent.setup().click(sendButton());

      const banner = await screen.findByRole("alert");
      expect(banner).toHaveTextContent(text);
      const preview = screen.getByRole("button", {
        name: "What Nerea will receive",
      });
      expect(
        banner.compareDocumentPosition(preview) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );
});

describe("la vista previa de la invitación", () => {
  it("sale plegada, nombrada por quien la recibe", async () => {
    stubApi();
    await renderPanel();
    expect(
      screen.getByRole("button", { name: "What they will receive" }),
    ).toHaveAttribute("aria-expanded", "false");

    await typeWho("Nerea Silva", "");

    expect(
      screen.getByRole("button", { name: "What Nerea will receive" }),
    ).toBeVisible();
  });

  it("enseña el correo de verdad de la invitación", async () => {
    stubApi();
    await renderPanel();
    await typeWho("Nerea Silva", "nerea@example.com");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "What Nerea will receive" }));

    const preview = screen.getByRole("region", {
      name: "What Nerea will receive",
    });
    expect(preview).toHaveTextContent(
      `From ${CLUB_NAME} · to nerea@example.com`,
    );
    expect(
      within(preview).getByText(`You're invited to ${CLUB_NAME}`),
    ).toBeVisible();
    expect(
      within(preview).getByText(
        `The club has invited you to ${CLUB_NAME} with this address.`,
      ),
    ).toBeVisible();
    expect(
      within(preview).getByText(
        "The link works once and expires in 60 minutes.",
      ),
    ).toBeVisible();
    expect(within(preview).getByText("Activate my account")).toBeVisible();
  });
});

describe("mientras se envía", () => {
  it("desactiva el formulario, dice Enviando y no manda dos veces", async () => {
    let answer: (response: Response) => void = () => undefined;
    stubApi({
      create: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await renderPanel();
    await typeWho("Nerea Silva", "nerea@example.com");
    const user = userEvent.setup();

    await user.dblClick(sendButton());

    expect(
      screen.getByRole("group", { name: "Who" }).closest("fieldset"),
    ).toBeDisabled();
    expect(sendButton()).toHaveTextContent("Sending…");
    expect(calls).toHaveLength(1);
    answer(createdResponse("sent"));
    await screen.findByText(/^Invitation sent to/);
  });
});

describe("después de enviar", () => {
  async function inviteNerea(
    options: { readonly group?: string; readonly locale?: "en" | "es" } = {},
  ): Promise<void> {
    const user = userEvent.setup();
    const isSpanish = options.locale === "es";
    await user.type(
      screen.getByLabelText(isSpanish ? "Nombre completo" : "Full name"),
      "Nerea Silva",
    );
    await user.type(
      screen.getByLabelText(isSpanish ? "Correo" : "Email"),
      "nerea@example.com",
    );
    if (options.group !== undefined) {
      await user.click(screen.getByRole("button", { name: options.group }));
    }
    await user.click(
      screen.getByRole("button", {
        name: isSpanish ? "Enviar invitación" : "Send invitation",
      }),
    );
  }

  it("dice a quién salió la invitación, que sale como Invitado y cuánto dura el enlace", async () => {
    stubApi();
    await renderPanel();

    await inviteNerea();

    const sent = await screen.findByRole("status");
    expect(
      within(sent).getByRole("heading", {
        name: "Invitation sent to nerea@example.com",
      }),
    ).toBeVisible();
    expect(sent).toHaveTextContent(
      "Nerea Silva shows as Invited in the directory until they sign in. The link works for 60 minutes and you can resend it from their profile.",
    );
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it.each(["sent", "not_sent"] as const)(
    "avisa al directorio de que hay un socio nuevo (%s)",
    async (invitation) => {
      stubApi({ create: () => createdResponse(invitation) });
      const onMemberCreated = vi.fn();
      await renderPanel({ onMemberCreated });

      await inviteNerea();

      await screen.findByRole("link", { name: "Open Nerea's profile" });
      expect(onMemberCreated).toHaveBeenCalledTimes(1);
    },
  );

  it("cuando el correo no sale, lo dice y ofrece reenviarlo", async () => {
    stubApi({ create: () => createdResponse("not_sent") });
    await renderPanel();

    await inviteNerea();

    const notSent = await screen.findByRole("alert");
    expect(
      within(notSent).getByRole("heading", {
        name: "Nerea was added, but the email didn't go out",
      }),
    ).toBeVisible();
    expect(notSent).toHaveTextContent(
      "Nerea Silva is in the directory as Invited. Try sending the invitation again; if it keeps failing, check the address.",
    );
    expect(
      screen.getByRole("button", { name: "Resend invitation" }),
    ).toBeVisible();
  });

  it("reenviada con éxito, pasa a enviada otra vez", async () => {
    stubApi({ create: () => createdResponse("not_sent") });
    await renderPanel();
    await inviteNerea();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Resend invitation" }),
    );

    const sent = await screen.findByRole("status");
    expect(
      within(sent).getByRole("heading", {
        name: "Invitation sent again to nerea@example.com",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Resend invitation" }),
    ).not.toBeInTheDocument();
    expect(calls.map((call) => call.url)).toEqual([
      MEMBERS_PATH,
      INVITATION_PATH,
    ]);
  });

  it("si el reenvío vuelve a fallar, lo dice y deja reintentar", async () => {
    let resends = 0;
    stubApi({
      create: () => createdResponse("not_sent"),
      resend: () => {
        resends += 1;
        return resends === 1
          ? errorResponse(503, "service_unavailable", "invitation_not_sent")
          : jsonResponse(200, { data: { invitation: "sent" } });
      },
    });
    await renderPanel();
    await inviteNerea();
    const user = userEvent.setup();
    const resend = await screen.findByRole("button", {
      name: "Resend invitation",
    });

    await user.click(resend);

    expect(
      await screen.findByText(/^The invitation could not be sent/),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Resend invitation" }));
    expect(
      await screen.findByRole("heading", {
        name: "Invitation sent again to nerea@example.com",
      }),
    ).toBeVisible();
  });

  it.each(["sent", "not_sent"] as const)(
    "Invitar a otro vacía el formulario y conserva los grupos (%s)",
    async (invitation) => {
      stubApi({ create: () => createdResponse(invitation) });
      await renderPanel();
      await inviteNerea({ group: "Senior Squad" });

      await userEvent
        .setup()
        .click(await screen.findByRole("button", { name: "Invite another" }));

      expect(screen.getByLabelText("Full name")).toHaveValue("");
      expect(screen.getByLabelText("Full name")).toHaveFocus();
      expect(screen.getByLabelText("Email")).toHaveValue("");
      expect(
        screen.getByRole("button", { name: "Senior Squad" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("button", { name: "Masters Squad" }),
      ).toHaveAttribute("aria-pressed", "false");
      expect(
        screen.getByRole("group", { name: /^Groups/ }),
      ).toHaveAccessibleName("Groups · 1 chosen");
    },
  );

  it("Invitar a otro tras un reenvío fallido no deja el aviso", async () => {
    stubApi({
      create: () => createdResponse("not_sent"),
      resend: () =>
        errorResponse(503, "service_unavailable", "invitation_not_sent"),
    });
    await renderPanel();
    await inviteNerea();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Resend invitation" }),
    );
    await screen.findByText(/^The invitation could not be sent/);

    await user.click(screen.getByRole("button", { name: "Invite another" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("el grupo conservado sale con el alta siguiente", async () => {
    stubApi();
    await renderPanel();
    await inviteNerea({ group: "Senior Squad" });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Invite another" }),
    );

    await typeWho("Ona Pujol", "ona@example.com");
    await user.click(sendButton());

    await screen.findByRole("status");
    expect(calls[1]?.body).toMatchObject({
      fullName: "Ona Pujol",
      groupIds: [SENIOR_ID],
    });
  });

  it.each(["sent", "not_sent"] as const)(
    "enlaza a la ficha del socio nuevo (%s)",
    async (invitation) => {
      stubApi({ create: () => createdResponse(invitation) });
      await renderPanel();

      await inviteNerea();

      expect(
        await screen.findByRole("link", { name: "Open Nerea's profile" }),
      ).toHaveAttribute("href", `/directorio/${NEW_USER_ID}`);
    },
  );

  it("lo dice en español", async () => {
    stubApi({ create: () => createdResponse("not_sent") });
    await renderPanel({ locale: "es" });
    await inviteNerea({ locale: "es" });

    expect(
      await screen.findByRole("heading", {
        name: "Nerea quedó añadido, pero el correo no salió",
      }),
    ).toBeVisible();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Reenviar invitación" }));

    expect(
      await screen.findByRole("heading", {
        name: "Invitación enviada otra vez a nerea@example.com",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Abrir la ficha de Nerea" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Invitar a otro" }),
    ).toBeVisible();
  });
});

/* Por debajo de 768 px (#863) el panel es una ventana modal que ocupa la
   pantalla. Cómo se ve, el scroll del cuerpo y el pie fijo los prueba
   Playwright a 320 y 375 px. */
describe("en el móvil", () => {
  beforeEach(() => {
    stubScreenWidth(true);
  });

  it("abre el panel en una ventana modal", async () => {
    stubApi();

    await renderPanel();

    const window = screen.getByRole("dialog", { name: "Invite a member" });
    expect(window).toHaveAttribute("open");
    expect(within(window).getByLabelText("Email")).toBeVisible();
  });

  it.each(["Cancel", "Close"])(
    "%s cierra la ventana antes de avisar",
    async (button) => {
      stubApi();
      const onClose = vi.fn();
      await renderPanel({ onClose });
      const window = screen.getByRole("dialog", { name: "Invite a member" });

      await userEvent
        .setup()
        .click(within(window).getByRole("button", { name: button }));

      expect(window).not.toHaveAttribute("open");
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );
});

describe("en español", () => {
  it("escribe el panel en español", async () => {
    stubApi();

    await renderPanel({ locale: "es" });

    expect(
      screen.getByRole("region", { name: "Invitar a un miembro" }),
    ).toBeVisible();
    expect(
      screen.getByText("Solo el nombre y el correo son obligatorios."),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Grupos · ninguno" }),
    ).toBeVisible();
  });

  it("cuenta los errores y el correo repetido en español", async () => {
    stubApi({
      create: () =>
        jsonResponse(409, {
          error: {
            existingMember: {
              userId: EXISTING_USER_ID,
              fullName: "Sofia Reyes",
            },
            code: "conflict",
            message: "x",
            reason: "email_taken",
          },
        }),
    });
    await renderPanel({ locale: "es" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Enviar invitación" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "2 cosas por arreglar antes de enviar",
    );
    await user.type(screen.getByLabelText("Nombre completo"), "Nerea Silva");
    await user.type(screen.getByLabelText("Correo"), "sofia@example.com");

    await user.click(screen.getByRole("button", { name: "Enviar invitación" }));

    expect(
      await screen.findByRole("link", {
        name: "Abrir la ficha de Sofia Reyes",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("Correo")).toHaveAccessibleDescription(
      /^Este correo ya es de un miembro\./,
    );
  });
});
