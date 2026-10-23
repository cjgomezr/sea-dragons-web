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

/**
 * La invitación de un miembro como panel del Directorio (#862, RF-9 y D11 del
 * PRD de E33): quién, los grupos en fichas, los datos de jugador plegados, el
 * resumen de errores con enlaces, el correo que ya es de un miembro y la vista
 * previa de la invitación. Los estados de después de enviar llegan con #863.
 */

const NEW_USER_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
const EXISTING_USER_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000001";
const MASTERS_ID = "9a9a9a9a-0000-4000-8000-000000000002";
const MEMBERS_PATH = "/api/v1/members";
const GROUPS_PATH = "/api/v1/groups";
const POSITIONS_PATH = "/api/v1/club/positions";
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
  } = {},
): Promise<void> {
  render(
    <InviteMemberPanel
      locale={options.locale ?? "en"}
      clubName={CLUB_NAME}
      onClose={options.onClose ?? (() => undefined)}
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

function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: /^(Send invitation|Sending…)$/ });
}

beforeEach(() => {
  calls.length = 0;
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

    await screen.findByText(/was invited/);
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

    const names = within(screen.getByLabelText("País"))
      .getAllByRole("option")
      .slice(1)
      .map((option) => option.textContent ?? "");

    expect(names).toHaveLength(COUNTRY_CODES.length);
    expect(names).toContain("España");
    expect(names).toEqual(
      [...names].sort((first, second) => first.localeCompare(second, "es")),
    );
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

    await screen.findByText(/was invited/);
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
    await screen.findByText(/was invited/);
  });
});

describe("después de enviar", () => {
  it("dice que salió la invitación", async () => {
    stubApi();
    await renderPanel();
    await typeWho("Nerea Silva", "nerea@example.com");

    await userEvent.setup().click(sendButton());

    expect(
      await screen.findByText(
        "Nerea Silva was invited. We sent the invitation to nerea@example.com.",
      ),
    ).toBeVisible();
  });

  it("cuando la invitación no sale, ofrece reenviarla", async () => {
    stubApi({ create: () => createdResponse("not_sent") });
    await renderPanel();
    await typeWho("Nerea Silva", "nerea@example.com");
    const user = userEvent.setup();
    await user.click(sendButton());

    await user.click(
      await screen.findByRole("button", { name: "Resend invitation" }),
    );

    expect(
      await screen.findByText("We sent a new invitation to nerea@example.com."),
    ).toBeVisible();
    expect(calls.map((call) => call.url)).toEqual([
      MEMBERS_PATH,
      INVITATION_PATH,
    ]);
  });
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
