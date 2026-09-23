import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRecordScreen } from "@/components/directory/MemberRecordScreen";
import type { Group } from "@/lib/groups/groups";
import type { MemberRecord } from "@/lib/members/member-record";

/**
 * La ficha reservada al Admin en pantalla (#242, RF-4 del PRD de E5): carga la
 * ficha y los grupos del club por la API v1, guarda todo en una sola
 * petición y enseña lo que el servidor respondió. Desde #274 marca el AUF sin
 * verificar y deja al Admin verificarlo.
 */

const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000001";
const MASTERS_ID = "9a9a9a9a-0000-4000-8000-000000000002";
const RECORD_PATH = `/api/v1/members/${MEMBER_ID}/record`;
const INVITATION_PATH = `/api/v1/members/${MEMBER_ID}/invitation`;
const STATUS_PATH = `/api/v1/members/${MEMBER_ID}/status`;
const VERIFICATION_PATH = `${RECORD_PATH}/auf-verification`;
const GROUPS_PATH = "/api/v1/groups";

const RECORD: MemberRecord = {
  userId: MEMBER_ID,
  fullName: "Paula Player",
  joinedOn: "2024-03-06",
  accountStatus: "active",
  aufNumber: "AUF-1",
  aufExpiry: "2027-03-31",
  isAufVerified: true,
  dateOfBirth: "1990-05-10",
  registeredAt: "2024-03-06T01:00:00.000Z",
  hasGuardianConsent: false,
  isAufExpired: false,
  groups: [{ id: SENIOR_ID, name: "Senior Squad" }],
};

/** Un AUF que escribió el miembro y ningún Admin ha mirado. */
const PENDING_RECORD: MemberRecord = { ...RECORD, isAufVerified: false };

/** 14 años el día del registro. */
const MINOR_BIRTH = "2010-01-01";

const CLUB_GROUPS: readonly Group[] = [
  { id: MASTERS_ID, name: "Masters Squad", memberCount: 3 },
  { id: SENIOR_ID, name: "Senior Squad", memberCount: 5 },
];

type Request = { readonly method: string; readonly body: unknown };

const patches: Request[] = [];

type Stub = {
  readonly record?: MemberRecord;
  readonly load?: () => Response | Promise<Response>;
  readonly save?: (body: unknown) => Response | Promise<Response>;
  readonly resend?: () => Response;
  readonly changeStatus?: (body: unknown) => Response | Promise<Response>;
  readonly verify?: (body: unknown) => Response | Promise<Response>;
};

const resends: string[] = [];
const statusChanges: unknown[] = [];
const verifications: unknown[] = [];

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

/** Lo que el servidor respondería al guardar: la ficha con lo pedido. Sin
 * AUF en la petición, el guardado se queda como estaba. */
function savedRecord(body: unknown): MemberRecord {
  const { groupIds, dateOfBirth, ...auf } = body as {
    aufNumber?: string | null;
    aufExpiry?: string | null;
    groupIds: string[];
    dateOfBirth: string | null;
  };
  const aufNumber =
    auf.aufNumber === undefined ? RECORD.aufNumber : auf.aufNumber;
  const aufExpiry =
    auf.aufExpiry === undefined ? RECORD.aufExpiry : auf.aufExpiry;
  return {
    ...RECORD,
    dateOfBirth,
    aufNumber,
    aufExpiry: aufNumber === null ? null : aufExpiry,
    // Lo que escribe un Admin nace verificado.
    isAufVerified: aufNumber !== null,
    groups: CLUB_GROUPS.filter((group) => groupIds.includes(group.id)).map(
      ({ id, name }) => ({ id, name }),
    ),
  };
}

/** Lo que el servidor respondería a un cambio de estado que aplicó. */
function changedStatus(body: unknown): Response {
  const { status } = body as { status: string };
  return jsonResponse(200, {
    data: { userId: MEMBER_ID, previousStatus: "active", status },
  });
}

function stubApi(stub: Stub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === GROUPS_PATH) {
        return jsonResponse(200, { data: { groups: CLUB_GROUPS } });
      }
      if (url === INVITATION_PATH && init?.method === "POST") {
        resends.push(url);
        return (
          stub.resend?.() ?? jsonResponse(200, { data: { invitation: "sent" } })
        );
      }
      if (url === VERIFICATION_PATH && init?.method === "POST") {
        const body: unknown = JSON.parse(String(init.body));
        verifications.push(body);
        return (
          stub.verify?.(body) ??
          jsonResponse(200, { data: { ...RECORD, isAufVerified: true } })
        );
      }
      if (url === STATUS_PATH && init?.method === "PATCH") {
        const body: unknown = JSON.parse(String(init.body));
        statusChanges.push(body);
        return stub.changeStatus?.(body) ?? changedStatus(body);
      }
      if (url !== RECORD_PATH) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      if (init?.method === "PATCH") {
        const body: unknown = JSON.parse(String(init.body));
        patches.push({ method: "PATCH", body });
        return (
          stub.save?.(body) ?? jsonResponse(200, { data: savedRecord(body) })
        );
      }
      return (
        stub.load?.() ?? jsonResponse(200, { data: stub.record ?? RECORD })
      );
    }),
  );
}

async function renderScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(<MemberRecordScreen locale={locale} userId={MEMBER_ID} />);
  await screen.findByRole("heading", { level: 1, name: "Paula Player" });
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /save the record|saving/i });
}

beforeEach(() => {
  patches.length = 0;
  resends.length = 0;
  statusChanges.length = 0;
  verifications.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ficha en pantalla: carga", () => {
  it("enseña el AUF, el ingreso y los grupos del miembro", async () => {
    stubApi();

    await renderScreen();

    expect(screen.getByLabelText("AUF number")).toHaveValue("AUF-1");
    expect(screen.getByLabelText("Expiry date")).toHaveValue("2027-03-31");
    expect(screen.getByText(/Member since 6 March 2024/)).toBeInTheDocument();
    const groups = screen.getByRole("group", { name: "Groups" });
    expect(
      within(groups).getByRole("checkbox", { name: "Senior Squad" }),
    ).toBeChecked();
    expect(
      within(groups).getByRole("checkbox", { name: "Masters Squad" }),
    ).not.toBeChecked();
  });

  it("marca el AUF vencido", async () => {
    stubApi({
      record: { ...RECORD, aufExpiry: "2025-01-31", isAufExpired: true },
    });

    await renderScreen();

    expect(screen.getByText("AUF expired")).toBeInTheDocument();
  });

  it("no marca nada con el AUF al día", async () => {
    stubApi();

    await renderScreen();

    expect(screen.queryByText("AUF expired")).not.toBeInTheDocument();
  });

  it("ofrece volver al directorio", async () => {
    stubApi();

    await renderScreen();

    expect(
      screen.getByRole("link", { name: /back to the directory/i }),
    ).toHaveAttribute("href", "/directorio");
  });

  it("dice que el miembro no existe cuando la API responde 404", async () => {
    stubApi({
      load: () => errorResponse(404, "not_found", "member_not_found"),
    });

    render(<MemberRecordScreen locale="en" userId={MEMBER_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That member isn't in the club.",
    );
    expect(
      screen.getByRole("link", { name: /back to the directory/i }),
    ).toBeInTheDocument();
  });

  it("dice que la ficha es sólo del Admin cuando la API responde 403", async () => {
    stubApi({ load: () => errorResponse(403, "forbidden") });

    render(<MemberRecordScreen locale="en" userId={MEMBER_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only an Admin can see and edit this record.",
    );
  });

  it("sale entera en español", async () => {
    stubApi();

    await renderScreen("es");

    expect(screen.getByLabelText("Número de AUF")).toHaveValue("AUF-1");
    expect(screen.getByLabelText("Vencimiento")).toBeInTheDocument();
    expect(
      screen.getByText(/Miembro desde el 6 de marzo de 2024/),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Grupos" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar la ficha" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /volver al directorio/i }),
    ).toBeInTheDocument();
  });
});

describe("ficha en pantalla: guardado", () => {
  it("manda el AUF y la lista entera de grupos en una sola petición", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await user.clear(screen.getByLabelText("AUF number"));
    await user.type(screen.getByLabelText("AUF number"), "AUF-99");
    await user.click(screen.getByRole("checkbox", { name: "Masters Squad" }));
    await user.click(screen.getByRole("checkbox", { name: "Senior Squad" }));
    await user.click(saveButton());

    expect(patches).toEqual([
      {
        method: "PATCH",
        body: {
          aufNumber: "AUF-99",
          aufExpiry: "2027-03-31",
          groupIds: [MASTERS_ID],
          dateOfBirth: "1990-05-10",
        },
      },
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Record saved.",
    );
    expect(
      screen.getByRole("checkbox", { name: "Masters Squad" }),
    ).toBeChecked();
  });

  it("no manda el AUF si no lo tocó: el miembro puede haberlo cambiado entretanto (#274)", async () => {
    stubApi({ record: PENDING_RECORD });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(screen.getByRole("checkbox", { name: "Masters Squad" }));
    await user.click(saveButton());

    await screen.findByRole("status");
    expect(patches[0]?.body).not.toHaveProperty("aufNumber");
    expect(patches[0]?.body).not.toHaveProperty("aufExpiry");
  });

  it("manda el número y el vencimiento vacíos como null", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await user.clear(screen.getByLabelText("AUF number"));
    await user.clear(screen.getByLabelText("Expiry date"));
    await user.click(saveButton());

    expect(patches[0]?.body).toMatchObject({
      aufNumber: null,
      aufExpiry: null,
    });
  });

  it("enseña lo que el servidor guardó: sin número tampoco queda vencimiento", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await user.clear(screen.getByLabelText("AUF number"));
    await user.click(saveButton());

    await screen.findByRole("status");
    expect(screen.getByLabelText("Expiry date")).toHaveValue("");
  });

  it("marca vencido lo que el servidor devuelve vencido", async () => {
    stubApi({
      save: (body) =>
        jsonResponse(200, {
          data: { ...savedRecord(body), isAufExpired: true },
        }),
    });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(saveButton());

    expect(await screen.findByText("AUF expired")).toBeInTheDocument();
  });

  it("desactiva el botón mientras guarda", async () => {
    let answer: (response: Response) => void = () => undefined;
    stubApi({
      save: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(saveButton());

    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveTextContent("Saving…");
    expect(screen.getByLabelText("AUF number")).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Masters Squad" }),
    ).toBeDisabled();
    answer(jsonResponse(200, { data: RECORD }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    expect(screen.getByLabelText("AUF number")).toBeEnabled();
  });

  it("no manda un segundo guardado con un doble clic", async () => {
    stubApi({ save: () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await renderScreen();

    await user.dblClick(saveButton());

    expect(patches).toHaveLength(1);
  });
});

describe("ficha en pantalla: errores", () => {
  it("avisa de un número demasiado largo sin mandar nada", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await user.clear(screen.getByLabelText("AUF number"));
    await user.type(screen.getByLabelText("AUF number"), "9".repeat(41));
    await user.click(saveButton());

    expect(patches).toEqual([]);
    // La ayuda del campo sigue en la descripción, después del aviso.
    expect(screen.getByLabelText("AUF number")).toHaveAccessibleDescription(
      /^The AUF number can have at most 40 characters\./,
    );
  });

  it("explica junto al vencimiento que no puede ser anterior al ingreso", async () => {
    stubApi({
      save: () =>
        errorResponse(400, "validation_error", "auf_expiry_before_joined"),
    });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(saveButton());

    const expiry = screen.getByLabelText("Expiry date");
    await vi.waitFor(() =>
      expect(expiry).toHaveAccessibleDescription(
        "The expiry can't be before the date they joined (6 March 2024).",
      ),
    );
    expect(expiry).toHaveAttribute("aria-invalid", "true");
  });

  it("explica una fecha que no es válida", async () => {
    stubApi({
      save: () =>
        errorResponse(400, "validation_error", "auf_expiry_not_a_date"),
    });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(saveButton());

    await vi.waitFor(() =>
      expect(screen.getByLabelText("Expiry date")).toHaveAccessibleDescription(
        "That expiry isn't a valid date.",
      ),
    );
  });

  it.each([
    [
      "un miembro dado de baja",
      () => errorResponse(422, "business_rule", "member_inactive"),
      "A member with a deactivated account can't be added to groups.",
    ],
    [
      "un estado de cuenta que cambió a medias",
      () => errorResponse(409, "conflict", "member_status_changed"),
      "The member's account changed while saving. Reload the record and try again.",
    ],
    [
      "un grupo que ya no existe",
      () => errorResponse(404, "not_found", "group_not_found"),
      "One of those groups is no longer in the club. Reload the record.",
    ],
    [
      "un fallo de red",
      () => Promise.reject(new TypeError("fetch failed")),
      "We couldn't reach the server. Check your connection and try again.",
    ],
    [
      "un 500",
      () => errorResponse(500, "internal_error"),
      "We couldn't save the record. Try again.",
    ],
  ])("avisa de %s y deja volver a intentarlo", async (_case, save, text) => {
    stubApi({ save });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(saveButton()).toBeEnabled();
  });
});

describe("ficha en pantalla: invitación (#243)", () => {
  const PENDING = { ...RECORD, accountStatus: "incomplete" as const };

  it("no ofrece reenviar la invitación a quien ya activó su cuenta", async () => {
    stubApi();

    await renderScreen();

    expect(
      screen.queryByRole("button", { name: "Resend invitation" }),
    ).toBeNull();
  });

  it("reenvía la invitación a quien todavía no activó su cuenta", async () => {
    stubApi({ record: PENDING });
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Resend invitation" }));

    expect(
      await screen.findByText("We sent Paula Player a new invitation."),
    ).toBeVisible();
    expect(resends).toEqual([INVITATION_PATH]);
  });

  it("dice que ya entró cuando el servidor responde que no hay invitación pendiente", async () => {
    stubApi({
      record: PENDING,
      resend: () => errorResponse(409, "conflict", "invitation_not_pending"),
    });
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Resend invitation" }));

    expect(
      await screen.findByText(
        "This member has already activated their account.",
      ),
    ).toBeVisible();
  });
});

describe("ficha en pantalla: baja y reactivación (#244)", () => {
  const INACTIVE = { ...RECORD, accountStatus: "inactive" as const };

  it("da de baja a quien está activo y pasa a ofrecer reactivarle", async () => {
    stubApi();
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Deactivate account" }));

    expect(
      await screen.findByText("Paula Player's account was deactivated."),
    ).toBeVisible();
    expect(statusChanges).toEqual([{ status: "inactive" }]);
    expect(
      screen.getByRole("button", { name: "Reactivate account" }),
    ).toBeInTheDocument();
  });

  it("reactiva a quien está de baja y vuelve a ofrecer la baja", async () => {
    stubApi({ record: INACTIVE });
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Reactivate account" }));

    expect(
      await screen.findByText("Paula Player's account was reactivated."),
    ).toBeVisible();
    expect(statusChanges).toEqual([{ status: "active" }]);
    expect(
      screen.getByRole("button", { name: "Deactivate account" }),
    ).toBeInTheDocument();
  });

  it("explica que es el último Admin y deja la ficha como estaba", async () => {
    stubApi({
      changeStatus: () => errorResponse(422, "business_rule", "last_admin"),
    });
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Deactivate account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This is the club's last Admin, so their account can't be deactivated. Name another Admin first.",
    );
    expect(
      screen.getByRole("button", { name: "Deactivate account" }),
    ).toBeEnabled();
  });

  it("explica que un Admin no se da de baja a sí mismo", async () => {
    stubApi({
      changeStatus: () =>
        errorResponse(422, "business_rule", "self_deactivation"),
    });
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Deactivate account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can't deactivate your own account. Another Admin has to do it.",
    );
  });

  it("dice que el miembro ya no está cuando el servidor responde 404", async () => {
    stubApi({ changeStatus: () => errorResponse(404, "not_found") });
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Deactivate account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That member isn't in the club.",
    );
  });

  it("dice que el cambio quedó sin bitácora en vez de pedir reintentar", async () => {
    stubApi({
      changeStatus: () =>
        errorResponse(500, "internal_error", "audit_not_recorded"),
    });
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Deactivate account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The membership changed, but it couldn't be logged.",
    );
  });

  it("no manda una segunda baja con un doble clic", async () => {
    let release: (() => void) | null = null;
    stubApi({
      changeStatus: (body) =>
        new Promise<Response>((resolve) => {
          release = () => resolve(changedStatus(body));
        }),
    });
    await renderScreen();
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Deactivate account" });

    await user.dblClick(button);

    expect(statusChanges).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    release!();
    expect(
      await screen.findByText("Paula Player's account was deactivated."),
    ).toBeVisible();
  });

  it("sale en español", async () => {
    stubApi();
    await renderScreen("es");

    expect(
      screen.getByRole("heading", { level: 2, name: "Membresía" }),
    ).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Desactivar cuenta" }));

    expect(
      await screen.findByText("La cuenta de Paula Player quedó desactivada."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reactivar cuenta" }),
    ).toBeInTheDocument();
  });
});

describe("ficha en pantalla: fecha de nacimiento", () => {
  it("enseña la fecha de nacimiento del miembro", async () => {
    stubApi();

    await renderScreen();

    expect(screen.getByLabelText("Date of birth")).toHaveValue("1990-05-10");
  });

  it("manda la fecha corregida y enseña la guardada", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await user.clear(screen.getByLabelText("Date of birth"));
    await user.type(screen.getByLabelText("Date of birth"), "1988-11-02");
    await user.click(saveButton());

    expect(patches[0]?.body).toMatchObject({ dateOfBirth: "1988-11-02" });
    await screen.findByRole("status");
    expect(screen.getByLabelText("Date of birth")).toHaveValue("1988-11-02");
  });

  it("manda null si el miembro todavía no tiene fecha y no se da ninguna", async () => {
    stubApi({ record: { ...RECORD, dateOfBirth: null } });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(saveButton());

    expect(patches[0]?.body).toMatchObject({ dateOfBirth: null });
  });

  it("avisa antes de guardar que el miembro tendrá que dar el consentimiento de su tutor", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await user.clear(screen.getByLabelText("Date of birth"));
    await user.type(screen.getByLabelText("Date of birth"), MINOR_BIRTH);

    expect(screen.getByLabelText("Date of birth")).toHaveAccessibleDescription(
      /Paula Player will have to give a guardian's details and consent/,
    );
  });

  it.each([
    ["con la fecha de un mayor", RECORD, "1988-11-02"],
    [
      "si ya tiene consentimiento",
      { ...RECORD, hasGuardianConsent: true },
      MINOR_BIRTH,
    ],
    [
      "si la cuenta todavía no está activa",
      { ...RECORD, accountStatus: "incomplete" },
      MINOR_BIRTH,
    ],
  ] as const)("no avisa del tutor %s", async (_case, record, dateOfBirth) => {
    stubApi({ record });
    const user = userEvent.setup();
    await renderScreen();

    await user.clear(screen.getByLabelText("Date of birth"));
    await user.type(screen.getByLabelText("Date of birth"), dateOfBirth);

    expect(
      screen.queryByText(/will have to give a guardian's details/),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["date_of_birth_in_future", "Date of birth can't be in the future."],
    [
      "date_of_birth_too_early",
      "Date of birth can't be before 1 January 1900.",
    ],
    [
      "date_of_birth_required",
      "A date of birth that's already recorded can't be cleared.",
    ],
  ])(
    "explica junto a la fecha el rechazo %s del servidor",
    async (reason, text) => {
      stubApi({ save: () => errorResponse(400, "validation_error", reason) });
      const user = userEvent.setup();
      await renderScreen();

      await user.click(saveButton());

      const dateOfBirth = screen.getByLabelText("Date of birth");
      await vi.waitFor(() =>
        expect(dateOfBirth).toHaveAccessibleDescription(
          expect.stringContaining(text),
        ),
      );
      expect(dateOfBirth).toHaveAttribute("aria-invalid", "true");
    },
  );

  it("sale en español", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen("es");

    await user.clear(screen.getByLabelText("Fecha de nacimiento"));
    await user.type(screen.getByLabelText("Fecha de nacimiento"), MINOR_BIRTH);

    expect(
      screen.getByLabelText("Fecha de nacimiento"),
    ).toHaveAccessibleDescription(
      /Paula Player tendrá que dar los datos y el consentimiento de su tutor/,
    );
  });
});

function verifyButton(): HTMLElement {
  return screen.getByRole("button", { name: /verify aUF|verifying/i });
}

describe("ficha en pantalla: verificar el AUF (#274)", () => {
  it("marca sin verificar el AUF que escribió el miembro", async () => {
    stubApi({ record: PENDING_RECORD });

    await renderScreen();

    expect(screen.getByText("AUF not verified")).toBeInTheDocument();
    expect(screen.queryByText("AUF verified")).not.toBeInTheDocument();
  });

  it("marca verificado un AUF verificado, sin ofrecer verificarlo", async () => {
    stubApi();

    await renderScreen();

    expect(screen.getByText("AUF verified")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /verify AUF/i }),
    ).not.toBeInTheDocument();
  });

  it("marca a la vez verificado y vencido un AUF verificado que venció", async () => {
    stubApi({
      record: { ...RECORD, aufExpiry: "2025-01-31", isAufExpired: true },
    });

    await renderScreen();

    expect(screen.getByText("AUF verified")).toBeInTheDocument();
    expect(screen.getByText("AUF expired")).toBeInTheDocument();
  });

  it("no marca nada sin AUF", async () => {
    stubApi({
      record: {
        ...RECORD,
        aufNumber: null,
        aufExpiry: null,
        isAufVerified: false,
      },
    });

    await renderScreen();

    expect(screen.queryByText(/AUF (not )?verified/)).not.toBeInTheDocument();
  });

  it("verifica el AUF que el Admin tiene delante y lo marca verificado", async () => {
    stubApi({ record: PENDING_RECORD });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(verifyButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "AUF verified.",
    );
    expect(verifications).toEqual([
      { aufNumber: "AUF-1", aufExpiry: "2027-03-31" },
    ]);
    expect(screen.getByText("AUF verified")).toBeInTheDocument();
    expect(screen.queryByText("AUF not verified")).not.toBeInTheDocument();
  });

  it("no ofrece verificar mientras el número está editado: guardar ya lo verifica", async () => {
    stubApi({ record: PENDING_RECORD });
    const user = userEvent.setup();
    await renderScreen();

    await user.type(screen.getByLabelText("AUF number"), "0");

    expect(
      screen.queryByRole("button", { name: /verify AUF/i }),
    ).not.toBeInTheDocument();
  });

  it("dice que el miembro cambió el AUF cuando el servidor responde 409", async () => {
    stubApi({
      record: PENDING_RECORD,
      verify: () => errorResponse(409, "conflict", "auf_changed"),
    });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(verifyButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The member changed the AUF after you opened the record. Reload it before verifying.",
    );
    expect(screen.getByText("AUF not verified")).toBeInTheDocument();
  });

  it("no manda una segunda verificación con un doble clic", async () => {
    let answer: (response: Response) => void = () => undefined;
    stubApi({
      record: PENDING_RECORD,
      verify: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const user = userEvent.setup();
    await renderScreen();

    await user.dblClick(verifyButton());

    expect(verifications).toHaveLength(1);
    expect(verifyButton()).toBeDisabled();
    answer(jsonResponse(200, { data: RECORD }));
    await screen.findByRole("status");
  });

  it("sale en español", async () => {
    stubApi({ record: PENDING_RECORD });

    await renderScreen("es");

    expect(screen.getByText("AUF sin verificar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Verificar AUF" }),
    ).toBeInTheDocument();
  });
});
