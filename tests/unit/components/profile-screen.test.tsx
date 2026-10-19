import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileScreen } from "@/components/account/ProfileScreen";
import { ACCOUNT_PROFILE_API_PATH } from "@/lib/auth/routes";
import { listCountryOptions } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/locale";
import type { MemberAttendance } from "@/lib/attendance/attendance-stats";
import type {
  EmergencyContactProposal,
  OwnAuf,
  OwnProfile,
} from "@/lib/members/own-profile";
import type {
  MembershipPlan,
  MembershipStatus,
} from "@/lib/membership/membership";
import type { ClubPosition, ClubPositions } from "@/lib/club/club-positions";
import {
  DEFENDER,
  FORWARD,
  GOALKEEPER,
  SEEDED_POSITIONS,
} from "../helpers/seeded-positions";

/**
 * La pantalla de perfil (#241): Mi cuenta convertida en perfil. Enseña lo
 * que ya enseñaba (rol, solicitud de rol y grupos) y suma el formulario de la
 * ficha editable. Lo que se prueba es que sólo da un cambio por hecho cuando
 * el servidor lo confirmó. Desde #274 la ficha lleva también el AUF, que el
 * miembro escribe y queda pendiente hasta que un Admin lo verifique. Desde
 * #772, Sobre mí y Contacto son tarjetas que se leen primero y se editan
 * aparte, cada una con su Guardar.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const PROFILE: OwnProfile = {
  fullName: "Nerea Ruiz",
  country: "AU",
  positionId: DEFENDER.id,
  experienceLevel: "Intermediate",
  gender: "female",
  phone: null,
  emergencyContact: null,
  auf: { status: "none" },
};

const EMPTY_PROFILE: OwnProfile = {
  fullName: "Nerea Ruiz",
  country: "AU",
  positionId: null,
  experienceLevel: null,
  gender: null,
  phone: null,
  emergencyContact: null,
  auf: { status: "none" },
};

const PENDING_AUF: OwnAuf = {
  status: "pending",
  number: "AUF-100",
  expiry: "2027-06-30",
};

const VERIFIED_AUF: OwnAuf = {
  status: "verified",
  number: "AUF-100",
  expiry: "2027-06-30",
};

type ApiCall = { readonly url: string; readonly body: unknown };

const calls: ApiCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(respond: (body: unknown) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body: unknown = JSON.parse(String(init.body));
      calls.push({ url, body });
      return respond(body);
    }),
  );
}

/** Lo que el servidor guardaría: el AUF que llega queda pendiente, y sin
 * AUF en la petición se queda el que había. */
function savedProfileOf(body: unknown, previousAuf: OwnAuf): unknown {
  const { aufNumber, aufExpiry, ...fields } = body as Record<string, unknown>;
  const auf =
    typeof aufNumber === "string"
      ? { status: "pending", number: aufNumber, expiry: aufExpiry }
      : previousAuf;
  return { ...fields, auf };
}

function echoSavedProfile(previousAuf: OwnAuf = { status: "none" }): void {
  stubFetch((body) =>
    jsonResponse(200, { data: savedProfileOf(body, previousAuf) }),
  );
}

/** Una posición que el club archivó, con nombre sólo en inglés (#299). */
const UTILITY: ClubPosition = {
  id: "90000000-0000-4000-8000-000000000004",
  names: { en: "Utility", es: null },
  isArchived: true,
};

function renderScreen(
  options: {
    readonly locale?: Locale;
    readonly profile?: OwnProfile;
    readonly positionOptions?: ClubPositions;
    readonly attendance?: MemberAttendance;
    readonly membershipPlan?: MembershipPlan | null;
    readonly membershipStatus?: MembershipStatus | null;
    readonly emergencyContactProposal?: EmergencyContactProposal | null;
  } = {},
): ReturnType<typeof render> {
  return render(profileScreen(options));
}

function profileScreen(
  options: Parameters<typeof renderScreen>[0] = {},
): React.JSX.Element {
  const locale = options.locale ?? "en";
  return (
    <ProfileScreen
      locale={locale}
      userId="cccccccc-0000-4000-8000-00000000000c"
      email="nerea@example.com"
      account={{ fullName: "Nerea Ruiz", role: "Player", latestRequest: null }}
      profile={options.profile ?? PROFILE}
      positionOptions={options.positionOptions ?? SEEDED_POSITIONS}
      emergencyContactProposal={options.emergencyContactProposal ?? null}
      photoUrl={null}
      groups={[{ id: "g1", name: "Senior Squad" }]}
      evaluation={{ visibility: "staff_only" }}
      attendance={options.attendance ?? { kind: "no_data" }}
      countries={listCountryOptions(locale)}
      membershipPlan={
        options.membershipPlan === undefined ? "Full" : options.membershipPlan
      }
      membershipStatus={
        options.membershipStatus === undefined
          ? "active"
          : options.membershipStatus
      }
      joinedOn="2024-03-06"
    />
  );
}

/** El Guardar del AUF, que sigue siendo un formulario (otro ticket de E30). */
function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save changes" });
}

type User = ReturnType<typeof userEvent.setup>;

function aboutCard(name = "About"): HTMLElement {
  return screen.getByRole("region", { name });
}

function contactCard(name = "Contact"): HTMLElement {
  return screen.getByRole("region", { name });
}

/** La etiqueta de la lista de lectura, sin lo que la acompaña (el candado
 * del género). */
function termOf(card: HTMLElement, label: string): HTMLElement {
  return within(card).getByText(
    (_, element) =>
      element?.tagName === "DT" && element.firstChild?.textContent === label,
  );
}

/** El valor que la lista de lectura enseña junto a una etiqueta. */
function readValueOf(card: HTMLElement, label: string): string {
  const term = termOf(card, label);
  return term.nextElementSibling?.textContent ?? "";
}

async function openAbout(user: User): Promise<HTMLElement> {
  const card = aboutCard();
  await user.click(within(card).getByRole("button", { name: "Edit About" }));
  return card;
}

async function openContact(user: User): Promise<HTMLElement> {
  const card = contactCard();
  await user.click(within(card).getByRole("button", { name: "Edit Contact" }));
  return card;
}

function saveIn(card: HTMLElement): HTMLElement {
  return within(card).getByRole("button", { name: /^(Save|Saving…)$/ });
}

const EMERGENCY_CONTACT = {
  name: "Lucía Ruiz",
  phone: "0412 345 678",
  relationship: "Sister",
} as const;

beforeEach(() => {
  calls.length = 0;
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("pantalla de perfil: el tipo de membresía (#456)", () => {
  it("enseña el tipo de membresía sin dejar editarlo, y enlaza a Pagos", () => {
    renderScreen({ membershipPlan: "Student" });

    const membership = screen.getByRole("region", { name: "Membership" });
    expect(
      within(membership).getByText("Membership type: Student"),
    ).toBeInTheDocument();
    expect(
      within(membership).getByRole("link", { name: "Change it in Payments" }),
    ).toHaveAttribute("href", "/pagos");
    expect(screen.queryByLabelText(/membership type/i)).toBeNull();
  });

  it("dice que aún no hay tipo a quien no lo eligió", () => {
    renderScreen({ membershipPlan: null });

    expect(
      within(screen.getByRole("region", { name: "Membership" })).getByText(
        "You haven't chosen a membership type yet.",
      ),
    ).toBeInTheDocument();
  });

  it("lo dice en español", () => {
    renderScreen({ locale: "es", membershipPlan: "Full" });

    const membership = screen.getByRole("region", { name: "Membresía" });
    expect(
      within(membership).getByText("Tipo de membresía: Full"),
    ).toBeInTheDocument();
    expect(
      within(membership).getByRole("link", { name: "Cambiarlo en Pagos" }),
    ).toHaveAttribute("href", "/pagos");
  });

  it("no manda el tipo de membresía al guardar Sobre mí", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openAbout(user);

    await user.click(saveIn(card));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).not.toHaveProperty("membershipType");
  });
});

describe("pantalla de perfil", () => {
  it("explica a un Player que sus notas sólo las ve el personal de entrenamiento", () => {
    renderScreen();

    expect(
      within(screen.getByRole("region", { name: "Evaluation" })).getByText(
        "Evaluation ratings are only visible to the coaching staff.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Overall score")).toBeNull();
  });

  it("no ofrece cambiar la fecha de nacimiento, que sólo corrige un Admin", () => {
    renderScreen();

    expect(screen.queryByLabelText(/date of birth/i)).not.toBeInTheDocument();
  });

  it("sigue mostrando el rol, la solicitud de rol y los grupos propios", () => {
    renderScreen();

    expect(
      within(screen.getByRole("banner")).getByText("Player"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Request a role" }),
    ).toBeInTheDocument();
    const groups = screen.getByRole("region", { name: "My groups" });
    expect(within(groups).getByText("Senior Squad")).toBeInTheDocument();
  });
});

describe("perfil propio: Sobre mí en lectura (#772)", () => {
  it("lista el nombre, el país, la posición, la experiencia y el género", () => {
    renderScreen();

    const card = aboutCard();
    expect(readValueOf(card, "Full name")).toBe("Nerea Ruiz");
    expect(readValueOf(card, "Country")).toBe("Australia");
    expect(readValueOf(card, "Position")).toBe("Defender");
    expect(readValueOf(card, "Experience")).toBe("Intermediate");
    expect(readValueOf(card, "Gender")).toBe("Female");
  });

  it("marca el género como algo que sólo ve el socio", () => {
    renderScreen();

    const term = termOf(aboutCard(), "Gender");
    expect(term).toHaveTextContent("Gender only you");
  });

  it("pinta un guion en los datos vacíos", () => {
    renderScreen({ profile: EMPTY_PROFILE });

    const card = aboutCard();
    expect(readValueOf(card, "Position")).toContain("—");
    expect(readValueOf(card, "Experience")).toContain("—");
    expect(readValueOf(card, "Gender")).toContain("—");
  });

  it("no pinta ningún campo hasta que se pulsa Editar", () => {
    renderScreen();

    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });

  it("se lee en español", () => {
    renderScreen({ locale: "es" });

    const card = aboutCard("Sobre mí");
    expect(readValueOf(card, "País")).toBe("Australia");
    expect(readValueOf(card, "Posición")).toBe("Defensa");
    expect(
      within(card).getByRole("button", { name: "Editar Sobre mí" }),
    ).toBeInTheDocument();
  });
});

describe("perfil propio: editar Sobre mí (#772)", () => {
  it("abre los campos con sus valores y pone el foco en el nombre", async () => {
    const user = userEvent.setup();
    renderScreen();

    const card = await openAbout(user);

    expect(within(card).getByLabelText("Full name")).toHaveFocus();
    expect(within(card).getByLabelText("Full name")).toHaveValue("Nerea Ruiz");
    expect(within(card).getByLabelText("Country")).toHaveValue("AU");
    expect(within(card).getByLabelText("Position")).toHaveDisplayValue(
      "Defender",
    );
    expect(
      within(card).getByRole("radio", { name: "Intermediate" }),
    ).toBeChecked();
    expect(within(card).getByLabelText("Gender")).toHaveValue("female");
  });

  it("la experiencia es un segmento de tres niveles", async () => {
    const user = userEvent.setup();
    renderScreen();

    const card = await openAbout(user);

    const levels = within(card).getByRole("radiogroup", { name: "Experience" });
    expect(
      within(levels)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["Beginner", "Intermediate", "Advanced"]);
  });

  it("dice junto al género que sólo lo ve el socio", async () => {
    const user = userEvent.setup();
    renderScreen();

    const card = await openAbout(user);

    expect(within(card).getByLabelText("Gender")).toHaveAccessibleDescription(
      "only you",
    );
  });

  it("carga vacíos como sin indicar", async () => {
    const user = userEvent.setup();
    renderScreen({ profile: EMPTY_PROFILE });

    const card = await openAbout(user);

    const position = within(card).getByLabelText("Position");
    expect(position).toHaveValue("");
    expect(
      within(position).getByRole("option", { name: "Not set" }),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("radio", { checked: true })).toBeNull();
  });

  it("guarda, vuelve a lectura con lo nuevo, lo dice y devuelve el foco a Editar", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openAbout(user);

    await user.clear(within(card).getByLabelText("Full name"));
    await user.type(within(card).getByLabelText("Full name"), "Nerea Soto");
    await user.click(within(card).getByRole("radio", { name: "Advanced" }));
    await user.click(saveIn(card));

    expect(await within(card).findByRole("status")).toHaveTextContent(
      "About saved",
    );
    expect(within(card).queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(readValueOf(card, "Full name")).toBe("Nerea Soto");
    expect(readValueOf(card, "Experience")).toBe("Advanced");
    expect(
      within(card).getByRole("button", { name: "Edit About" }),
    ).toHaveFocus();
    expect(refresh).toHaveBeenCalled();
  });

  it("manda lo suyo y el contacto guardado, sin el AUF", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen({
      profile: {
        ...PROFILE,
        phone: "0412 999 000",
        emergencyContact: EMERGENCY_CONTACT,
        auf: PENDING_AUF,
      },
    });
    const card = await openAbout(user);

    await user.selectOptions(
      within(card).getByLabelText("Position"),
      "Forward",
    );
    await user.selectOptions(
      within(card).getByLabelText("Gender"),
      "undisclosed",
    );
    await user.click(saveIn(card));

    await within(card).findByRole("status");
    expect(calls).toEqual([
      {
        url: ACCOUNT_PROFILE_API_PATH,
        body: {
          fullName: "Nerea Ruiz",
          country: "AU",
          positionId: FORWARD.id,
          experienceLevel: "Intermediate",
          gender: "undisclosed",
          phone: "0412 999 000",
          emergencyContact: EMERGENCY_CONTACT,
        },
      },
    ]);
  });

  it("manda null por un campo vaciado a propósito", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openAbout(user);

    await user.selectOptions(within(card).getByLabelText("Position"), "");
    await user.click(saveIn(card));

    await within(card).findByRole("status");
    expect(calls[0]?.body).toMatchObject({ positionId: null });
  });

  it("con un nombre vacío sigue abierta, con el aviso en su campo, y no manda nada", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openAbout(user);

    await user.clear(within(card).getByLabelText("Full name"));
    await user.type(within(card).getByLabelText("Full name"), "   ");
    await user.click(saveIn(card));

    const name = within(card).getByLabelText("Full name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Write your name.");
    expect(calls).toEqual([]);
  });

  it("no manda un nombre de más de 120 caracteres y dice el límite", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openAbout(user);

    await user.clear(within(card).getByLabelText("Full name"));
    await user.click(within(card).getByLabelText("Full name"));
    await user.paste("a".repeat(121));
    await user.click(saveIn(card));

    expect(
      within(card).getByText("Your name can be at most 120 characters."),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("desactiva Guardar mientras guarda y un doble clic manda una sola petición", async () => {
    let answer: (response: Response) => void = () => undefined;
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const user = userEvent.setup();
    renderScreen();
    const card = await openAbout(user);

    await user.dblClick(saveIn(card));

    expect(
      within(card).getByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
    expect(calls).toHaveLength(1);
    answer(jsonResponse(200, { data: PROFILE }));
    await within(card).findByRole("status");
  });

  it("si falla la red sigue abierta con el aviso y lo escrito, y deja reintentar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const user = userEvent.setup();
    renderScreen();
    const card = await openAbout(user);
    await user.type(within(card).getByLabelText("Full name"), " Soto");

    await user.click(saveIn(card));

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "We couldn't save your changes. Check your connection and try again.",
    );
    expect(within(card).getByLabelText("Full name")).toHaveValue(
      "Nerea Ruiz Soto",
    );
    expect(refresh).not.toHaveBeenCalled();

    echoSavedProfile();
    await user.click(saveIn(card));

    expect(await within(card).findByRole("status")).toHaveTextContent(
      "About saved",
    );
  });

  it("traduce el motivo de un 400 del servidor", async () => {
    stubFetch(() =>
      jsonResponse(400, {
        error: {
          code: "validation_error",
          message: "x",
          reason: "position_unknown",
        },
      }),
    );
    const user = userEvent.setup();
    renderScreen();
    const card = await openAbout(user);

    await user.click(saveIn(card));

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "Choose a position from the list.",
    );
  });

  it("Cancelar vuelve a lectura sin cambios, sin mandar nada, con el foco en Editar", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openAbout(user);
    await user.type(within(card).getByLabelText("Full name"), " Soto");

    await user.click(within(card).getByRole("button", { name: "Cancel" }));

    expect(readValueOf(card, "Full name")).toBe("Nerea Ruiz");
    expect(
      within(card).getByRole("button", { name: "Edit About" }),
    ).toHaveFocus();
    expect(calls).toEqual([]);
  });

  it("al volver a abrir tras cancelar, enseña lo guardado", async () => {
    const user = userEvent.setup();
    renderScreen();
    const card = await openAbout(user);
    await user.type(within(card).getByLabelText("Full name"), " Soto");
    await user.click(within(card).getByRole("button", { name: "Cancel" }));

    await openAbout(user);

    expect(within(card).getByLabelText("Full name")).toHaveValue("Nerea Ruiz");
  });

  it("en español, los textos, las opciones y los errores salen en español", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const user = userEvent.setup();
    renderScreen({ locale: "es" });
    const card = aboutCard("Sobre mí");

    await user.click(
      within(card).getByRole("button", { name: "Editar Sobre mí" }),
    );

    expect(within(card).getByLabelText("Nombre completo")).toHaveFocus();
    expect(within(card).getByLabelText("País")).toHaveDisplayValue("Australia");
    expect(
      within(card).getByRole("radio", { name: "Intermedio" }),
    ).toBeChecked();
    expect(within(card).getByLabelText("Género")).toHaveAccessibleDescription(
      "solo tú",
    );
    await user.click(within(card).getByRole("button", { name: "Guardar" }));

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "No pudimos guardar tus cambios. Revisa tu conexión y vuelve a intentarlo.",
    );
    await user.click(within(card).getByRole("button", { name: "Cancelar" }));
    expect(
      within(card).getByRole("button", { name: "Editar Sobre mí" }),
    ).toHaveFocus();
  });

  it("dice Sobre mí guardado en español", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen({ locale: "es" });
    const card = aboutCard("Sobre mí");
    await user.click(
      within(card).getByRole("button", { name: "Editar Sobre mí" }),
    );

    await user.click(within(card).getByRole("button", { name: "Guardar" }));

    expect(await within(card).findByRole("status")).toHaveTextContent(
      "Sobre mí guardado",
    );
  });
});

function withAuf(auf: OwnAuf): OwnProfile {
  return { ...PROFILE, auf };
}

describe("el AUF en el perfil propio", () => {
  it("sin AUF, ofrece escribirlo y dice que un Admin lo revisará", () => {
    renderScreen();

    expect(screen.getByLabelText("AUF number")).toHaveValue("");
    expect(screen.getByLabelText("AUF expiry")).toHaveValue("");
    expect(
      screen.getByText("An Admin checks it before it counts as verified."),
    ).toBeInTheDocument();
  });

  it("guardar sin tocar el AUF vacío no lo manda", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();

    await user.click(saveButton());

    await screen.findByRole("status");
    expect(calls[0]?.body).not.toHaveProperty("aufNumber");
    expect(calls[0]?.body).not.toHaveProperty("aufExpiry");
  });

  it("manda el AUF escrito y después lo enseña pendiente", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText("AUF number"), "AUF-200");
    await user.type(screen.getByLabelText("AUF expiry"), "2028-01-31");
    await user.click(saveButton());

    await screen.findByRole("status");
    expect(calls[0]?.body).toMatchObject({
      aufNumber: "AUF-200",
      aufExpiry: "2028-01-31",
    });
    expect(
      screen.getByText("Pending verification by an Admin."),
    ).toBeInTheDocument();
  });

  it("manda null por un vencimiento que no se conoce", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText("AUF number"), "AUF-200");
    await user.click(saveButton());

    await screen.findByRole("status");
    expect(calls[0]?.body).toMatchObject({
      aufNumber: "AUF-200",
      aufExpiry: null,
    });
  });

  it("un AUF pendiente se enseña en sus campos y como pendiente", () => {
    renderScreen({ profile: withAuf(PENDING_AUF) });

    expect(screen.getByLabelText("AUF number")).toHaveValue("AUF-100");
    expect(screen.getByLabelText("AUF expiry")).toHaveValue("2027-06-30");
    expect(
      screen.getByText("Pending verification by an Admin."),
    ).toBeInTheDocument();
  });

  it("no envía un AUF pendiente vaciado y dice por qué", async () => {
    echoSavedProfile(PENDING_AUF);
    const user = userEvent.setup();
    renderScreen({ profile: withAuf(PENDING_AUF) });

    await user.clear(screen.getByLabelText("AUF number"));
    await user.click(saveButton());

    expect(screen.getByLabelText("AUF number")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("Write your AUF number.")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("no envía un número de más de 40 caracteres y dice el límite", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByLabelText("AUF number"));
    await user.paste("A".repeat(41));
    await user.click(saveButton());

    expect(
      screen.getByText("Your AUF number can be at most 40 characters."),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("un AUF verificado se lee pero no se edita, y no se manda", async () => {
    echoSavedProfile(VERIFIED_AUF);
    const user = userEvent.setup();
    renderScreen({ profile: withAuf(VERIFIED_AUF) });

    expect(screen.queryByLabelText("AUF number")).not.toBeInTheDocument();
    expect(
      screen.getByText("AUF AUF-100 · expires 30 June 2027"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Verified by an Admin. Only an Admin can change it."),
    ).toBeInTheDocument();

    await user.click(saveButton());

    await screen.findByRole("status");
    expect(calls[0]?.body).not.toHaveProperty("aufNumber");
  });

  it("traduce el rechazo de un AUF que un Admin verificó entretanto", async () => {
    stubFetch(() =>
      jsonResponse(403, {
        error: { code: "forbidden", message: "x", reason: "auf_verified" },
      }),
    );
    const user = userEvent.setup();
    renderScreen({ profile: withAuf(PENDING_AUF) });

    await user.clear(screen.getByLabelText("AUF number"));
    await user.type(screen.getByLabelText("AUF number"), "AUF-300");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your AUF is already verified. Only an Admin can change it.",
    );
  });

  it("traduce un vencimiento anterior a su ingreso", async () => {
    stubFetch(() =>
      jsonResponse(400, {
        error: {
          code: "validation_error",
          message: "x",
          reason: "auf_expiry_before_joined",
        },
      }),
    );
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText("AUF number"), "AUF-200");
    await user.type(screen.getByLabelText("AUF expiry"), "2001-01-01");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The expiry can't be before the day you joined the club.",
    );
  });

  it("en español, el AUF y su estado salen en español", () => {
    renderScreen({ locale: "es", profile: withAuf(PENDING_AUF) });

    expect(screen.getByLabelText("Número de AUF")).toHaveValue("AUF-100");
    expect(
      screen.getByText("Pendiente de que un Admin lo verifique."),
    ).toBeInTheDocument();
  });
});

function positionOptionNames(): readonly string[] {
  return within(screen.getByLabelText(/^(Position|Posición)$/))
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

describe("perfil propio: las posiciones del club (#299)", () => {
  it("el desplegable ofrece las posiciones del club, en su orden", async () => {
    const user = userEvent.setup();
    renderScreen({ positionOptions: [FORWARD, GOALKEEPER, DEFENDER] });

    await openAbout(user);

    expect(positionOptionNames()).toEqual([
      "Not set",
      "Forward",
      "Goalkeeper",
      "Defender",
    ]);
  });

  it("quien tiene una posición retirada la sigue viendo, marcada", async () => {
    const user = userEvent.setup();
    renderScreen({
      profile: { ...PROFILE, positionId: UTILITY.id },
      positionOptions: [GOALKEEPER, UTILITY, DEFENDER, FORWARD],
    });

    expect(readValueOf(aboutCard(), "Position")).toBe("Utility (retired)");
    await openAbout(user);
    expect(screen.getByLabelText("Position")).toHaveDisplayValue(
      "Utility (retired)",
    );
  });

  it("al cambiar de la retirada a otra y guardar, la retirada deja de ofrecerse", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen({
      profile: { ...PROFILE, positionId: UTILITY.id },
      positionOptions: [GOALKEEPER, UTILITY, DEFENDER, FORWARD],
    });
    const card = await openAbout(user);

    await user.selectOptions(screen.getByLabelText("Position"), "Forward");
    await user.click(saveIn(card));
    await within(card).findByRole("status");
    await openAbout(user);

    expect(positionOptionNames()).not.toContain("Utility (retired)");
  });

  it("el campo no se muestra si el club no ofrece ninguna posición", async () => {
    const user = userEvent.setup();
    renderScreen({
      profile: { ...PROFILE, positionId: null },
      positionOptions: [],
    });

    expect(
      within(aboutCard()).queryByText("Position"),
    ).toBeNull();
    await openAbout(user);
    expect(screen.queryByLabelText("Position")).not.toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Experience" }),
    ).toBeInTheDocument();
  });

  it("en español, una posición sin nombre en español sale en inglés y marcada", async () => {
    const user = userEvent.setup();
    renderScreen({
      locale: "es",
      profile: { ...PROFILE, positionId: UTILITY.id },
      positionOptions: [GOALKEEPER, UTILITY],
    });

    await user.click(
      within(aboutCard("Sobre mí")).getByRole("button", {
        name: "Editar Sobre mí",
      }),
    );

    expect(screen.getByLabelText("Posición")).toHaveDisplayValue(
      "Utility (retirada)",
    );
    expect(positionOptionNames()).toContain("Portería");
  });
});

/** La asistencia en el perfil propio (#396, FR-022): el porcentaje grande y
 * las sesiones debajo, o "Sin datos" a quien no tiene sesiones elegibles. */
describe("perfil propio: la asistencia", () => {
  function attendanceRegion(name = "Attendance"): HTMLElement {
    return screen.getByRole("region", { name });
  }

  it("enseña el porcentaje y cuántas sesiones lleva", () => {
    renderScreen({
      attendance: { kind: "rate", percent: 90, sessions: 18 },
    });

    expect(within(attendanceRegion()).getByText("90%")).toBeVisible();
    expect(within(attendanceRegion()).getByText("18 sessions")).toBeVisible();
  });

  it("dice una sesión en singular", () => {
    renderScreen({ attendance: { kind: "rate", percent: 100, sessions: 1 } });

    expect(within(attendanceRegion()).getByText("1 session")).toBeVisible();
  });

  it("un lector de pantalla oye el porcentaje con su nombre", () => {
    renderScreen({
      attendance: { kind: "rate", percent: 90, sessions: 18 },
    });

    expect(attendanceRegion()).toHaveTextContent("Attendance: 90%");
  });

  it("sin sesiones elegibles dice sin datos, no un 0", () => {
    renderScreen({ attendance: { kind: "no_data" } });

    expect(attendanceRegion()).toHaveTextContent("Attendance: No data");
    expect(within(attendanceRegion()).queryByText(/0%|sessions/)).toBeNull();
  });

  it("en español, con el símbolo separado y las sesiones en español", () => {
    renderScreen({
      locale: "es",
      attendance: { kind: "rate", percent: 90, sessions: 18 },
    });

    const region = attendanceRegion("Asistencia");
    expect(region.textContent).toContain("Asistencia: 90 %");
    expect(within(region).getByText("18 sesiones")).toBeVisible();
  });

  it("en español, sin datos", () => {
    renderScreen({ locale: "es", attendance: { kind: "no_data" } });

    expect(attendanceRegion("Asistencia")).toHaveTextContent(
      "Asistencia: Sin datos",
    );
  });
});

const OWN_PHONE_LABEL = "Your phone (optional)";

/** La mitad de la lectura con el teléfono o con el contacto de emergencia. */
function contactHalf(card: HTMLElement, title: string): HTMLElement {
  const heading = within(card).getByText(title, { selector: "dt" });
  const half = heading.closest("div");
  if (half === null) {
    throw new Error(`Falta la mitad ${title}.`);
  }
  return half;
}

describe("perfil propio: Contacto en lectura (#772)", () => {
  it("enseña el teléfono con el correo debajo y el contacto de emergencia", () => {
    renderScreen({
      profile: {
        ...PROFILE,
        phone: "+61 3 9876 5432",
        emergencyContact: EMERGENCY_CONTACT,
      },
    });

    const card = contactCard();
    const phone = contactHalf(card, "Phone");
    expect(within(phone).getByText("+61 3 9876 5432")).toBeInTheDocument();
    expect(within(phone).getByText("nerea@example.com")).toBeInTheDocument();
    const emergency = contactHalf(card, "Emergency contact");
    expect(
      within(emergency).getByText("Lucía Ruiz · Sister"),
    ).toBeInTheDocument();
    expect(within(emergency).getByText("0412 345 678")).toBeInTheDocument();
  });

  it("sin contacto de emergencia dice que aún no se añadió", () => {
    renderScreen();

    const emergency = contactHalf(contactCard(), "Emergency contact");
    expect(within(emergency).getByText("Not added yet")).toBeInTheDocument();
  });

  it("sin teléfono pinta un guion", () => {
    renderScreen();

    const phone = contactHalf(contactCard(), "Phone");
    expect(phone).toHaveTextContent("—");
  });

  it("no pinta ningún campo hasta que se pulsa Editar", () => {
    renderScreen();

    expect(screen.queryByLabelText(OWN_PHONE_LABEL)).not.toBeInTheDocument();
  });

  it("se lee en español", () => {
    renderScreen({ locale: "es" });

    const card = contactCard("Contacto");
    expect(
      within(contactHalf(card, "Contacto de emergencia")).getByText(
        "Aún no añadido",
      ),
    ).toBeInTheDocument();
    expect(contactHalf(card, "Teléfono")).toBeInTheDocument();
  });
});

describe("perfil propio: editar Contacto (#772)", () => {
  it("abre el teléfono y el contacto de emergencia con lo guardado, con el foco en el teléfono", async () => {
    const user = userEvent.setup();
    renderScreen({
      profile: {
        ...PROFILE,
        phone: "+61 3 9876 5432",
        emergencyContact: EMERGENCY_CONTACT,
      },
    });

    const card = await openContact(user);

    expect(within(card).getByLabelText(OWN_PHONE_LABEL)).toHaveFocus();
    expect(within(card).getByLabelText(OWN_PHONE_LABEL)).toHaveValue(
      "+61 3 9876 5432",
    );
    const emergency = within(card).getByRole("group", {
      name: "Emergency contact",
    });
    expect(within(emergency).getByLabelText("Contact name")).toHaveValue(
      "Lucía Ruiz",
    );
    expect(within(emergency).getByLabelText("Relationship")).toHaveValue(
      "Sister",
    );
    expect(within(emergency).getByLabelText("Contact phone")).toHaveValue(
      "0412 345 678",
    );
  });

  it("guarda, vuelve a lectura con lo nuevo, lo dice y devuelve el foco a Editar", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openContact(user);

    await user.type(
      within(card).getByLabelText(OWN_PHONE_LABEL),
      "+61 3 9876 5432",
    );
    await user.type(within(card).getByLabelText("Contact name"), "Lucía Ruiz");
    await user.type(
      within(card).getByLabelText("Contact phone"),
      "0412 345 678",
    );
    await user.type(within(card).getByLabelText("Relationship"), "Sister");
    await user.click(saveIn(card));

    expect(await within(card).findByRole("status")).toHaveTextContent(
      "Contact saved",
    );
    expect(
      within(card).queryByLabelText(OWN_PHONE_LABEL),
    ).not.toBeInTheDocument();
    expect(within(card).getByText("Lucía Ruiz · Sister")).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Edit Contact" }),
    ).toHaveFocus();
    expect(refresh).toHaveBeenCalled();
  });

  it("manda lo suyo y el Sobre mí guardado, sin el AUF", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen({ profile: { ...PROFILE, auf: PENDING_AUF } });
    const card = await openContact(user);

    await user.type(
      within(card).getByLabelText(OWN_PHONE_LABEL),
      "0412 999 000",
    );
    await user.click(saveIn(card));

    await within(card).findByRole("status");
    expect(calls).toEqual([
      {
        url: ACCOUNT_PROFILE_API_PATH,
        body: {
          fullName: "Nerea Ruiz",
          country: "AU",
          positionId: DEFENDER.id,
          experienceLevel: "Intermediate",
          gender: "female",
          phone: "0412 999 000",
          emergencyContact: null,
        },
      },
    ]);
  });

  it("con un teléfono con letras sigue abierta con el aviso junto al campo", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openContact(user);

    await user.type(within(card).getByLabelText(OWN_PHONE_LABEL), "0412 ABC");
    await user.click(saveIn(card));

    const phone = within(card).getByLabelText(OWN_PHONE_LABEL);
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAccessibleDescription(
      "Use only digits, spaces, hyphens, brackets and a + at the start.",
    );
    expect(calls).toEqual([]);
  });

  it("no manda un teléfono de 7 dígitos y dice cuántos hacen falta", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openContact(user);

    await user.type(within(card).getByLabelText(OWN_PHONE_LABEL), "4123456");
    await user.click(saveIn(card));

    expect(
      within(card).getByLabelText(OWN_PHONE_LABEL),
    ).toHaveAccessibleDescription("A phone number needs at least 8 digits.");
    expect(calls).toEqual([]);
  });

  it("no manda un contacto a medias y avisa junto a cada dato que falta", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openContact(user);

    await user.type(within(card).getByLabelText("Contact name"), "Lucía Ruiz");
    await user.click(saveIn(card));

    expect(
      within(card).getByLabelText("Contact phone"),
    ).toHaveAccessibleDescription(
      expect.stringContaining(
        "Add the contact's phone, or leave all three empty.",
      ),
    );
    expect(
      within(card).getByLabelText("Relationship"),
    ).toHaveAccessibleDescription(
      expect.stringContaining(
        "Add how you're related, or leave all three empty.",
      ),
    );
    expect(within(card).getByLabelText("Contact name")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    expect(calls).toEqual([]);
  });

  it("borra el aviso de un dato en cuanto se escribe", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();
    const card = await openContact(user);
    await user.type(within(card).getByLabelText("Contact name"), "Lucía Ruiz");
    await user.click(saveIn(card));

    await user.type(within(card).getByLabelText("Contact phone"), "0");

    expect(within(card).getByLabelText("Contact phone")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    expect(within(card).getByLabelText("Relationship")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("no manda un nombre de contacto de más de 100 caracteres", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen({
      profile: {
        ...PROFILE,
        emergencyContact: { ...EMERGENCY_CONTACT, name: "a".repeat(101) },
      },
    });
    const card = await openContact(user);

    await user.click(saveIn(card));

    expect(
      within(card).getByLabelText("Contact name"),
    ).toHaveAccessibleDescription(
      expect.stringContaining("This can be at most 100 characters."),
    );
    expect(calls).toEqual([]);
  });

  it("avisa de que el contacto debería ser otra persona, pero guarda", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen({
      profile: {
        ...PROFILE,
        phone: "0412 345 678",
        emergencyContact: { ...EMERGENCY_CONTACT, phone: "0412-345-678" },
      },
    });
    const card = await openContact(user);

    expect(
      within(card).getByLabelText("Contact phone"),
    ).toHaveAccessibleDescription(
      expect.stringContaining(
        "This is your own phone. Your emergency contact should be someone else.",
      ),
    );

    await user.click(saveIn(card));

    expect(await within(card).findByRole("status")).toHaveTextContent(
      "Contact saved",
    );
  });

  it("si falla la red sigue abierta con el aviso y lo escrito", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const user = userEvent.setup();
    renderScreen();
    const card = await openContact(user);
    await user.type(
      within(card).getByLabelText(OWN_PHONE_LABEL),
      "0412 999 000",
    );

    await user.click(saveIn(card));

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "We couldn't save your changes. Check your connection and try again.",
    );
    expect(within(card).getByLabelText(OWN_PHONE_LABEL)).toHaveValue(
      "0412 999 000",
    );
  });

  it("traduce el motivo de un 400 del servidor sobre el contacto", async () => {
    stubFetch(() =>
      jsonResponse(400, {
        error: {
          code: "validation_error",
          message: "no vale",
          reason: "emergency_contact_phone_too_long",
        },
      }),
    );
    const user = userEvent.setup();
    renderScreen();
    const card = await openContact(user);

    await user.click(saveIn(card));

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "A phone number can have at most 15 digits.",
    );
  });

  it("Cancelar vuelve a lectura sin cambios y con el foco en Editar", async () => {
    const user = userEvent.setup();
    renderScreen();
    const card = await openContact(user);
    await user.type(
      within(card).getByLabelText(OWN_PHONE_LABEL),
      "0412 999 000",
    );

    await user.click(within(card).getByRole("button", { name: "Cancel" }));

    expect(contactHalf(card, "Phone")).toHaveTextContent("—");
    expect(
      within(card).getByRole("button", { name: "Edit Contact" }),
    ).toHaveFocus();
    expect(calls).toEqual([]);
  });

  it("en español, la sección y los avisos salen en español", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen({ locale: "es" });
    const card = contactCard("Contacto");
    await user.click(
      within(card).getByRole("button", { name: "Editar Contacto" }),
    );

    expect(
      within(card).getByRole("group", { name: "Contacto de emergencia" }),
    ).toBeInTheDocument();
    await user.type(
      within(card).getByLabelText("Tu teléfono (opcional)"),
      "12",
    );
    await user.type(within(card).getByLabelText("Nombre del contacto"), "Ana");
    await user.click(within(card).getByRole("button", { name: "Guardar" }));

    expect(
      within(card).getByLabelText("Tu teléfono (opcional)"),
    ).toHaveAccessibleDescription("Un teléfono necesita al menos 8 dígitos.");
    expect(
      within(card).getByLabelText("Teléfono del contacto"),
    ).toHaveAccessibleDescription(
      expect.stringContaining(
        "Escribe el teléfono del contacto o deja los tres datos vacíos.",
      ),
    );
  });
});

describe("perfil propio: la propuesta del tutor (#496, #772)", () => {
  it("a un menor sin contacto le propone a su tutor, sin teléfono", async () => {
    const user = userEvent.setup();
    renderScreen({ emergencyContactProposal: { guardianName: "Marta Soto" } });

    const card = await openContact(user);

    expect(within(card).getByLabelText("Contact name")).toHaveValue(
      "Marta Soto",
    );
    expect(within(card).getByLabelText("Relationship")).toHaveValue("Guardian");
    expect(within(card).getByLabelText("Contact phone")).toHaveValue("");
    expect(
      within(card).getByText(
        "We've suggested your guardian. Add their phone number to save it.",
      ),
    ).toBeInTheDocument();
  });

  it("en lectura la propuesta no cuenta como contacto", () => {
    renderScreen({ emergencyContactProposal: { guardianName: "Marta Soto" } });

    expect(
      within(contactHalf(contactCard(), "Emergency contact")).getByText(
        "Not added yet",
      ),
    ).toBeInTheDocument();
  });

  it("guarda el teléfono sin contacto si el menor no tocó la propuesta", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen({ emergencyContactProposal: { guardianName: "Marta Soto" } });
    const card = await openContact(user);

    await user.type(
      within(card).getByLabelText(OWN_PHONE_LABEL),
      "0412 999 000",
    );
    await user.click(saveIn(card));

    expect(await within(card).findByRole("status")).toHaveTextContent(
      "Contact saved",
    );
    expect(calls[0]?.body).toMatchObject({
      phone: "0412 999 000",
      emergencyContact: null,
    });
  });

  it("pide el teléfono si el menor editó la propuesta y no lo escribió", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen({ emergencyContactProposal: { guardianName: "Marta Soto" } });
    const card = await openContact(user);

    await user.type(within(card).getByLabelText("Contact name"), " Pérez");
    await user.click(saveIn(card));

    expect(within(card).getByLabelText("Contact phone")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(calls).toEqual([]);
  });

  it("guardar Sobre mí no gasta la propuesta", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen({ emergencyContactProposal: { guardianName: "Marta Soto" } });
    const about = await openAbout(user);
    await user.click(saveIn(about));
    await within(about).findByRole("status");

    const card = await openContact(user);

    expect(within(card).getByLabelText("Contact name")).toHaveValue(
      "Marta Soto",
    );
  });

  it("en español, la relación del tutor sale en español", async () => {
    const user = userEvent.setup();
    renderScreen({
      locale: "es",
      emergencyContactProposal: { guardianName: "Marta Soto" },
    });
    const card = contactCard("Contacto");

    await user.click(
      within(card).getByRole("button", { name: "Editar Contacto" }),
    );

    expect(within(card).getByLabelText("Relación")).toHaveValue("Tutor");
  });
});

describe("perfil propio: una tarjeta abierta a la vez (#772)", () => {
  it("sin cambios, abrir otra cierra la primera sin preguntar", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    renderScreen();
    await openAbout(user);

    const card = await openContact(user);

    expect(confirm).not.toHaveBeenCalled();
    expect(within(aboutCard()).queryByLabelText("Full name")).toBeNull();
    expect(within(card).getByLabelText(OWN_PHONE_LABEL)).toHaveFocus();
    confirm.mockRestore();
  });

  it("con cambios, pregunta; si se descartan, abre la otra", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderScreen();
    const about = await openAbout(user);
    await user.type(within(about).getByLabelText("Full name"), " Soto");

    const card = await openContact(user);

    expect(confirm).toHaveBeenCalledWith(
      "You have changes you haven't saved. Discard them?",
    );
    expect(readValueOf(about, "Full name")).toBe("Nerea Ruiz");
    expect(within(card).getByLabelText(OWN_PHONE_LABEL)).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("con cambios, si no se descartan, la primera sigue abierta con lo escrito", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderScreen();
    const about = await openAbout(user);
    await user.type(within(about).getByLabelText("Full name"), " Soto");

    await openContact(user);

    expect(within(about).getByLabelText("Full name")).toHaveValue(
      "Nerea Ruiz Soto",
    );
    expect(
      within(contactCard()).queryByLabelText(OWN_PHONE_LABEL),
    ).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("escribir y deshacer lo escrito no cuenta como cambio", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    renderScreen();
    const about = await openAbout(user);
    await user.type(within(about).getByLabelText("Full name"), "x");
    await user.type(within(about).getByLabelText("Full name"), "{Backspace}");

    await openContact(user);

    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("la propuesta del tutor sin tocar no cuenta como cambio", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    renderScreen({ emergencyContactProposal: { guardianName: "Marta Soto" } });
    await openContact(user);

    await openAbout(user);

    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("pregunta en español", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderScreen({ locale: "es" });
    const about = aboutCard("Sobre mí");
    await user.click(
      within(about).getByRole("button", { name: "Editar Sobre mí" }),
    );
    await user.type(within(about).getByLabelText("Nombre completo"), " Soto");

    await user.click(
      within(contactCard("Contacto")).getByRole("button", {
        name: "Editar Contacto",
      }),
    );

    expect(confirm).toHaveBeenCalledWith(
      "Tienes cambios sin guardar. ¿Los descartas?",
    );
    confirm.mockRestore();
  });
});

const SISTER = {
  name: "Lucía Ruiz",
  phone: "0412 999 888",
  relationship: "Sister",
} as const;

describe("pantalla de perfil: la cabecera (#771)", () => {
  it("lleva el nombre en H1, la píldora del rol y posición · experiencia · país", () => {
    renderScreen();

    const header = screen.getByRole("banner");
    expect(
      within(header).getByRole("heading", { level: 1, name: "Nerea Ruiz" }),
    ).toBeInTheDocument();
    expect(within(header).getByText("Player")).toBeInTheDocument();
    expect(
      within(header).getByText("Defender · Intermediate · Australia"),
    ).toBeInTheDocument();
  });

  it("deja fuera de la línea lo que no tiene", () => {
    renderScreen({ profile: EMPTY_PROFILE });

    expect(
      within(screen.getByRole("banner")).getByText("Australia"),
    ).toBeInTheDocument();
  });

  it("enseña la membresía activa, el AUF pendiente y desde cuándo es socio", () => {
    renderScreen({ profile: { ...PROFILE, auf: PENDING_AUF } });

    const header = screen.getByRole("banner");
    expect(within(header).getByText("Membership active")).toBeInTheDocument();
    expect(within(header).getByText("AUF pending")).toBeInTheDocument();
    expect(
      within(header).getByText("Member since March 2024"),
    ).toBeInTheDocument();
  });

  it("marca el AUF verificado", () => {
    renderScreen({ profile: { ...PROFILE, auf: VERIFIED_AUF } });

    expect(
      within(screen.getByRole("banner")).getByText("AUF verified"),
    ).toBeInTheDocument();
  });

  it("sin AUF no lleva ficha del AUF", () => {
    renderScreen();

    expect(
      within(screen.getByRole("banner")).queryByText(/^AUF/),
    ).not.toBeInTheDocument();
  });

  it("dice el estado de una membresía que no está al día", () => {
    renderScreen({ membershipStatus: "past_due" });

    const header = screen.getByRole("banner");
    expect(within(header).getByText("Payment overdue")).toBeInTheDocument();
    expect(
      within(header).queryByText("Membership active"),
    ).not.toBeInTheDocument();
  });

  it("la foto lleva el botón de cámara que abre el selector de foto", async () => {
    const user = userEvent.setup();
    renderScreen();
    const input = screen.getByLabelText<HTMLInputElement>("Choose a photo");
    const opened = vi.fn();
    input.addEventListener("click", opened);

    await user.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Add photo",
      }),
    );

    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("se lee en español", () => {
    renderScreen({ locale: "es", profile: { ...PROFILE, auf: PENDING_AUF } });

    const header = screen.getByRole("banner");
    expect(within(header).getByText("Jugador")).toBeInTheDocument();
    expect(
      within(header).getByText("Defensa · Intermedio · Australia"),
    ).toBeInTheDocument();
    expect(within(header).getByText("Membresía activa")).toBeInTheDocument();
    expect(within(header).getByText("AUF pendiente")).toBeInTheDocument();
    expect(
      within(header).getByText("Miembro desde marzo de 2024"),
    ).toBeInTheDocument();
  });
});

describe("pantalla de perfil: la franja de lo que falta (#771)", () => {
  function completionStrip(): HTMLElement {
    return screen.getByRole("note", {
      name: "Your profile is almost complete. Missing:",
    });
  }

  it("sin contacto de emergencia pide ese dato con el 80 %", () => {
    renderScreen({
      profile: { ...PROFILE, phone: "0412 345 678", emergencyContact: null },
    });

    const strip = completionStrip();
    expect(
      within(strip).getByRole("progressbar", { name: "Profile completeness" }),
    ).toHaveAttribute("aria-valuenow", "80");
    expect(within(strip).getByText("80%")).toBeInTheDocument();
    expect(
      within(strip)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Emergency contact"]);
  });

  it("pide cada dato que falta, con el 40 % si faltan los tres", () => {
    renderScreen({
      profile: {
        ...PROFILE,
        country: null,
        phone: null,
        emergencyContact: null,
      },
    });

    const strip = completionStrip();
    expect(within(strip).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
    expect(
      within(strip)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Emergency contact", "Phone", "Country"]);
  });

  it.each([
    ["Emergency contact", "Contact name"],
    ["Phone", "Your phone (optional)"],
    ["Country", "Country"],
  ])(
    "la ficha %s abre su tarjeta y pone el foco en su campo",
    async (item, field) => {
      const user = userEvent.setup();
      renderScreen({
        profile: {
          ...PROFILE,
          country: null,
          phone: null,
          emergencyContact: null,
        },
      });

      await user.click(
        within(completionStrip()).getByRole("button", { name: item }),
      );

      expect(screen.getByLabelText(field)).toHaveFocus();
    },
  );

  it("con el perfil completo no sale, ni el aviso de contacto de antes", () => {
    renderScreen({
      profile: { ...PROFILE, phone: "0412 345 678", emergencyContact: SISTER },
    });

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("desaparece cuando la página vuelve con el dato guardado", () => {
    const view = renderScreen({
      profile: { ...PROFILE, phone: "0412 345 678", emergencyContact: null },
    });

    view.rerender(
      profileScreen({
        profile: {
          ...PROFILE,
          phone: "0412 345 678",
          emergencyContact: SISTER,
        },
      }),
    );

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("con la tarjeta ya abierta, pone el foco en el campo", async () => {
    const user = userEvent.setup();
    renderScreen({ profile: { ...PROFILE, emergencyContact: null } });
    await openContact(user);

    await user.click(
      within(completionStrip()).getByRole("button", {
        name: "Emergency contact",
      }),
    );

    expect(screen.getByLabelText("Contact name")).toHaveFocus();
  });

  it("con otra tarjeta abierta y con cambios, pregunta antes de abrir", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderScreen({ profile: { ...PROFILE, emergencyContact: null } });
    const about = await openAbout(user);
    await user.type(within(about).getByLabelText("Full name"), " Soto");

    await user.click(
      within(completionStrip()).getByRole("button", {
        name: "Emergency contact",
      }),
    );

    expect(confirm).toHaveBeenCalled();
    expect(within(about).getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Contact name")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("se lee en español", () => {
    renderScreen({
      locale: "es",
      profile: { ...PROFILE, phone: null, emergencyContact: null },
    });

    const strip = screen.getByRole("note", {
      name: "Tu perfil está casi completo. Falta:",
    });
    expect(
      within(strip).getByRole("progressbar", { name: "Perfil completado" }),
    ).toBeInTheDocument();
    expect(
      within(strip)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Contacto de emergencia", "Teléfono"]);
  });
});
