import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewMemberScreen } from "@/components/directory/NewMemberScreen";
import { listCountryOptions } from "@/lib/geo/countries";
import type { Group } from "@/lib/groups/groups";

/**
 * La pantalla de alta de un miembro (#243, RF-5 del PRD de E5): el formulario
 * con los datos del miembro y sus grupos, el aviso de la invitación y el
 * reenvío cuando no salió.
 */

const NEW_USER_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000001";
const MASTERS_ID = "9a9a9a9a-0000-4000-8000-000000000002";
const MEMBERS_PATH = "/api/v1/members";
const GROUPS_PATH = "/api/v1/groups";
const INVITATION_PATH = `/api/v1/members/${NEW_USER_ID}/invitation`;

const CLUB_GROUPS: readonly Group[] = [
  { id: MASTERS_ID, name: "Masters Squad", memberCount: 3 },
  { id: SENIOR_ID, name: "Senior Squad", memberCount: 5 },
];

type Call = { readonly url: string; readonly body: unknown };

const calls: Call[] = [];

type Stub = {
  readonly create?: () => Response;
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
        return jsonResponse(200, { data: { groups: CLUB_GROUPS } });
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

async function renderScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(
    <NewMemberScreen locale={locale} countries={listCountryOptions(locale)} />,
  );
  await screen.findByRole("checkbox", { name: "Senior Squad" });
}

async function fillValidForm(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Full name"), "Nerea Silva");
  await user.type(screen.getByLabelText("Email"), "nerea@example.com");
  await user.selectOptions(screen.getByLabelText("Country"), "AU");
  await user.selectOptions(screen.getByLabelText("Position"), "Forward");
  await user.selectOptions(
    screen.getByLabelText("Experience level"),
    "Intermediate",
  );
  await user.selectOptions(screen.getByLabelText("Gender"), "female");
  await user.type(screen.getByLabelText("AUF number"), "AUF-2210");
  await user.type(screen.getByLabelText("AUF expiry date"), "2099-06-30");
  await user.click(screen.getByRole("checkbox", { name: "Senior Squad" }));
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: /^add member|adding/i });
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formulario de alta", () => {
  it("ofrece los grupos del club para asignarlos", async () => {
    stubApi();

    await renderScreen();

    const groups = screen.getByRole("group", { name: "Groups" });
    expect(
      within(groups)
        .getAllByRole("checkbox")
        .map((box) => box.textContent),
    ).toHaveLength(2);
    expect(
      within(groups).getByRole("checkbox", { name: "Masters Squad" }),
    ).not.toBeChecked();
  });

  it("marca todos los campos obligatorios vacíos sin llamar a la API", async () => {
    stubApi();
    await renderScreen();

    await userEvent.setup().click(submitButton());

    expect(screen.getByLabelText("Full name")).toHaveAccessibleDescription(
      "Write the member's name.",
    );
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Write a valid email address.",
    );
    expect(screen.getByLabelText("AUF number")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(calls).toEqual([]);
  });

  it("manda el alta con los grupos elegidos y dice que salió la invitación", async () => {
    stubApi();
    await renderScreen();
    await fillValidForm();

    await userEvent.setup().click(submitButton());

    expect(
      await screen.findByText(
        "Nerea Silva was added. We sent the invitation to nerea@example.com.",
      ),
    ).toBeVisible();
    expect(calls).toEqual([
      {
        url: MEMBERS_PATH,
        body: {
          fullName: "Nerea Silva",
          email: "nerea@example.com",
          country: "AU",
          position: "Forward",
          experienceLevel: "Intermediate",
          gender: "female",
          aufNumber: "AUF-2210",
          aufExpiry: "2099-06-30",
          groupIds: [SENIOR_ID],
        },
      },
    ]);
  });

  it("dice junto al correo que ya tiene cuenta, y deja el formulario como estaba", async () => {
    stubApi({ create: () => errorResponse(409, "conflict", "email_taken") });
    await renderScreen();
    await fillValidForm();

    await userEvent.setup().click(submitButton());

    expect(
      await screen.findByText("That email already has an account in the club."),
    ).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Full name")).toHaveValue("Nerea Silva");
  });

  it("cuando la invitación no sale, lo dice y ofrece reenviarla", async () => {
    stubApi({ create: () => createdResponse("not_sent") });
    await renderScreen();
    await fillValidForm();
    const user = userEvent.setup();

    await user.click(submitButton());
    expect(
      await screen.findByText(
        "Nerea Silva was added, but the invitation could not be sent.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Resend invitation" }));

    expect(
      await screen.findByText("We sent a new invitation to nerea@example.com."),
    ).toBeVisible();
    expect(calls.map((call) => call.url)).toEqual([
      MEMBERS_PATH,
      INVITATION_PATH,
    ]);
  });

  it("dice que espere si se reenvió demasiadas veces seguidas", async () => {
    stubApi({
      create: () => createdResponse("not_sent"),
      resend: () => errorResponse(429, "rate_limited"),
    });
    await renderScreen();
    await fillValidForm();
    const user = userEvent.setup();
    await user.click(submitButton());

    await user.click(
      await screen.findByRole("button", { name: "Resend invitation" }),
    );

    expect(
      await screen.findByText(
        "Several invitations were sent in a row. Wait a few minutes before asking for another.",
      ),
    ).toBeVisible();
  });

  it("escribe la pantalla en español", async () => {
    stubApi();

    await renderScreen("es");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Dar de alta a un miembro",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument();
  });
});
