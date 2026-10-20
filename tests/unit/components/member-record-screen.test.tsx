import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRecordScreen } from "@/components/directory/MemberRecordScreen";
import type { Group } from "@/lib/groups/groups";
import type {
  CoachMemberRecord,
  CommitteeMemberRecord,
  MemberRecord,
  MemberRecordReading,
} from "@/lib/members/member-record";

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
const ROLE_PATH = `/api/v1/members/${MEMBER_ID}/role`;
const WAIVER_PATH = `/api/v1/members/${MEMBER_ID}/membership-waiver`;
const VERIFICATION_PATH = `${RECORD_PATH}/auf-verification`;
const GROUPS_PATH = "/api/v1/groups";
const EVALUATION_PATH = `/api/v1/evaluations/${MEMBER_ID}`;

const RECORD: MemberRecord = {
  view: "admin",
  userId: MEMBER_ID,
  fullName: "Paula Player",
  role: "Player",
  positionName: { en: "Goalkeeper", es: "Portero" },
  experienceLevel: "Intermediate",
  country: "AU",
  email: "paula@example.com",
  membershipPlan: "Full",
  joinedOn: "2024-03-06",
  accountStatus: "active",
  aufNumber: "AUF-1",
  aufExpiry: "2027-03-31",
  isAufVerified: true,
  dateOfBirth: "1990-05-10",
  registeredAt: "2024-03-06T01:00:00.000Z",
  hasGuardianConsent: false,
  membershipStatus: "active",
  membershipWaiver: null,
  phone: "0412 345 678",
  emergencyContact: {
    name: "Rosa Player",
    phone: "0499 111 222",
    relationship: "Mother",
  },
  photoUrl: null,
  isAufExpired: false,
  membershipRenewsOn: "2027-06-30",
  groups: [{ id: SENIOR_ID, name: "Senior Squad" }],
  attendance: {
    percent: 90,
    attended: 9,
    sessions: 10,
    last10: [
      { eventId: "e1", startsOn: "2026-09-01", status: "present" },
      { eventId: "e2", startsOn: "2026-09-08", status: "absent" },
    ],
  },
};

const PHOTO_URL = `https://storage.test/member-photos/${MEMBER_ID}/foto.webp?token=a`;
const LARGE_PHOTO_PATH = `/api/v1/directory/${MEMBER_ID}/photo`;
const LARGE_PHOTO_URL = `https://storage.test/member-photos/${MEMBER_ID}/foto-large.webp?token=l`;

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
  readonly evaluation?: () => Response;
  readonly waive?: (body: unknown) => Response | Promise<Response>;
  readonly removeWaiver?: () => Response | Promise<Response>;
  readonly changeRole?: (body: unknown) => Response | Promise<Response>;
};

const resends: string[] = [];
const statusChanges: unknown[] = [];
const verifications: unknown[] = [];
const waiverRequests: Request[] = [];
const roleChanges: unknown[] = [];

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
 * AUF o sin contacto en la petición, el guardado se queda como estaba. */
function savedRecord(body: unknown): MemberRecord {
  const { groupIds, dateOfBirth, phone, emergencyContact, ...auf } = body as {
    aufNumber?: string | null;
    aufExpiry?: string | null;
    groupIds: string[];
    dateOfBirth: string | null;
    phone?: MemberRecord["phone"];
    emergencyContact?: MemberRecord["emergencyContact"];
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
    phone: phone === undefined ? RECORD.phone : phone,
    emergencyContact:
      emergencyContact === undefined
        ? RECORD.emergencyContact
        : emergencyContact,
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

/** Lo que el servidor respondería a un cambio de rol que aplicó. */
function changedRole(body: unknown): Response {
  const { role } = body as { role: string };
  return jsonResponse(200, {
    data: { userId: MEMBER_ID, previousRole: "Player", role },
  });
}

/** Lo que el servidor respondería a eximir: la exención con el fin como el
 * principio de ese día en Melbourne. */
function waivedResponse(body: unknown): Response {
  const { reason, until } = body as { reason: string; until: string | null };
  return jsonResponse(200, {
    data: {
      userId: MEMBER_ID,
      membershipStatus: "waived",
      waiver: {
        reason,
        until: until === null ? null : `${until}T00:00:00+11:00`,
      },
    },
  });
}

function answerWaiver(
  stub: Stub,
  init?: RequestInit,
): Response | Promise<Response> {
  if (init?.method === "DELETE") {
    waiverRequests.push({ method: "DELETE", body: null });
    return (
      stub.removeWaiver?.() ??
      jsonResponse(200, {
        data: { userId: MEMBER_ID, membershipStatus: "pending", waiver: null },
      })
    );
  }
  const body: unknown = JSON.parse(String(init?.body));
  waiverRequests.push({ method: "POST", body });
  return stub.waive?.(body) ?? waivedResponse(body);
}

function stubApi(stub: Stub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === GROUPS_PATH) {
        return jsonResponse(200, { data: { groups: CLUB_GROUPS } });
      }
      if (url === EVALUATION_PATH) {
        return (
          stub.evaluation?.() ??
          jsonResponse(200, {
            data: { status: "not_evaluated", memberId: MEMBER_ID },
          })
        );
      }
      if (url === LARGE_PHOTO_PATH) {
        return jsonResponse(200, { data: { photoUrl: LARGE_PHOTO_URL } });
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
      if (url === WAIVER_PATH) {
        return answerWaiver(stub, init);
      }
      if (url === ROLE_PATH && init?.method === "PATCH") {
        const body: unknown = JSON.parse(String(init.body));
        roleChanges.push(body);
        return stub.changeRole?.(body) ?? changedRole(body);
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

type User = ReturnType<typeof userEvent.setup>;

function aufCard(name = "AUF registration"): HTMLElement {
  return screen.getByRole("region", { name });
}

function clubRecordCard(name = "Club record"): HTMLElement {
  return screen.getByRole("region", { name });
}

async function openAuf(user: User): Promise<HTMLElement> {
  const card = aufCard();
  await user.click(
    within(card).getByRole("button", { name: "Edit AUF registration" }),
  );
  return card;
}

/** El valor de una de las celdas de una tarjeta (#773). */
function cellOf(card: HTMLElement, label: string): HTMLElement {
  const term = within(card).getByText(label, { selector: "dt" });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) {
    throw new Error(`Falta el valor de ${label}.`);
  }
  return value;
}

function saveIn(card: HTMLElement): HTMLElement {
  return within(card).getByRole("button", { name: /^(Save|Saving…)$/ });
}

/** Las acciones del Admin viven en el menú ⋯ de la cabecera (#775): se abre
 * y se elige una. */
async function chooseAdminAction(
  user: User,
  action: string,
  menuLabel = "More actions",
): Promise<void> {
  await user.click(screen.getByRole("button", { name: menuLabel }));
  await user.click(screen.getByRole("button", { name: action }));
}

beforeEach(() => {
  patches.length = 0;
  resends.length = 0;
  statusChanges.length = 0;
  verifications.length = 0;
  waiverRequests.length = 0;
  roleChanges.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ficha en pantalla: carga", () => {
  it("enseña el AUF, el ingreso y los grupos del miembro", async () => {
    stubApi();

    await renderScreen();

    expect(cellOf(aufCard(), "Number")).toHaveTextContent("AUF-1");
    expect(screen.getByText("Member since March 2024")).toBeInTheDocument();
    const groups = screen.getByRole("region", { name: "Groups" });
    expect(within(groups).getByText("Senior Squad")).toBeVisible();
    expect(within(groups).queryByText("Masters Squad")).toBeNull();
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

  it("enseña el estado de la membresía (#453)", async () => {
    stubApi({ record: { ...RECORD, membershipStatus: "past_due" } });

    await renderScreen();

    expect(
      within(screen.getByRole("banner")).getByText("Payment overdue"),
    ).toBeInTheDocument();
  });

  it("dice que no tiene membresía quien no la tiene (#453)", async () => {
    stubApi({ record: { ...RECORD, membershipStatus: null } });

    await renderScreen();

    expect(screen.getByText("No membership")).toBeInTheDocument();
  });

  it("ofrece volver al directorio", async () => {
    stubApi();

    await renderScreen();

    expect(screen.getByRole("link", { name: "Directory" })).toHaveAttribute(
      "href",
      "/directorio",
    );
  });

  it("dice que el miembro no existe cuando la API responde 404", async () => {
    stubApi({
      load: () => errorResponse(404, "not_found", "member_not_found"),
    });

    render(<MemberRecordScreen locale="en" userId={MEMBER_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That member isn't in the club.",
    );
    expect(screen.getByRole("link", { name: "Directory" })).toBeInTheDocument();
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

    expect(cellOf(aufCard("Registro AUF"), "Número")).toHaveTextContent(
      "AUF-1",
    );
    expect(cellOf(aufCard("Registro AUF"), "Estado")).toHaveTextContent(
      "Verificado",
    );
    expect(clubRecordCard("Ficha del club")).toBeInTheDocument();
    expect(screen.getByText("Miembro desde marzo de 2024")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Grupos" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Directorio" }),
    ).toBeInTheDocument();
  });
});

describe("pantalla de la ficha", () => {
  it("enseña la foto del miembro con su nombre", async () => {
    stubApi({ record: { ...RECORD, photoUrl: PHOTO_URL } });

    await renderScreen();

    expect(
      screen.getByRole("img", { name: "Photo of Paula Player" }),
    ).toHaveAttribute("src", PHOTO_URL);
  });

  it("abre la foto en grande al pulsarla (#355)", async () => {
    stubApi({ record: { ...RECORD, photoUrl: PHOTO_URL } });
    await renderScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Open the photo of Paula Player" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Paula Player" });
    expect(
      await within(dialog).findByRole("img", { name: "Photo of Paula Player" }),
    ).toHaveAttribute("src", LARGE_PHOTO_URL);
  });

  it("nombra la foto en español", async () => {
    stubApi({ record: { ...RECORD, photoUrl: PHOTO_URL } });

    await renderScreen("es");

    expect(
      screen.getByRole("img", { name: "Foto de Paula Player" }),
    ).toBeInTheDocument();
  });

  it("enseña las iniciales sin anunciarlas cuando el miembro no tiene foto", async () => {
    stubApi();

    await renderScreen();

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("PP")).toHaveAttribute("aria-hidden", "true");
  });

  it("cae a las iniciales si la foto no carga, y la ficha sigue funcionando", async () => {
    stubApi({ record: { ...RECORD, photoUrl: PHOTO_URL } });
    await renderScreen();

    fireEvent.error(screen.getByRole("img", { name: "Photo of Paula Player" }));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("PP")).toHaveAttribute("aria-hidden", "true");
    expect(cellOf(aufCard(), "Number")).toHaveTextContent("AUF-1");
    expect(
      within(aufCard()).getByRole("button", { name: "Edit AUF registration" }),
    ).toBeEnabled();
  });
});

/** Las 13:00 del 20 de octubre de 2026 en Melbourne: el día desde el que se
 * cuentan los días del vencimiento y la edad. */
const NOW_IN_CLUB = new Date("2026-10-20T02:00:00.000Z");

describe("ficha en pantalla: Registro AUF (#242, #773)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_IN_CLUB);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lee el AUF en tres celdas, con la etiqueta de Admin", async () => {
    stubApi();
    await renderScreen();

    const card = aufCard();
    expect(within(card).getByText("Admin")).toBeInTheDocument();
    expect(cellOf(card, "Number")).toHaveTextContent("AUF-1");
    expect(cellOf(card, "Expires")).toHaveTextContent(
      "31 March 2027 · in 162 days",
    );
    expect(cellOf(card, "Status")).toHaveTextContent("Verified");
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("lee pendiente el AUF que escribió el miembro", async () => {
    stubApi({ record: PENDING_RECORD });
    await renderScreen();

    expect(cellOf(aufCard(), "Status")).toHaveTextContent("Pending");
  });

  it("pone en aviso un vencimiento a menos de 90 días", async () => {
    stubApi({ record: { ...RECORD, aufExpiry: "2026-12-31" } });
    await renderScreen();

    expect(
      within(cellOf(aufCard(), "Expires")).getByText("· in 72 days"),
    ).toHaveClass("profile-cell-soon");
  });

  it("Editar abre el número y el vencimiento, con el foco en el número", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);

    expect(within(card).getByLabelText("AUF number")).toHaveValue("AUF-1");
    expect(within(card).getByLabelText("Expiry date")).toHaveValue(
      "2027-03-31",
    );
    expect(within(card).getByLabelText("AUF number")).toHaveFocus();
  });

  it("manda el AUF con los grupos y la fecha guardados, sin el contacto", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);
    await user.clear(within(card).getByLabelText("AUF number"));
    await user.type(within(card).getByLabelText("AUF number"), "AUF-99");
    await user.click(saveIn(card));

    expect(await within(card).findByRole("status")).toHaveTextContent(
      "AUF saved",
    );
    expect(patches).toEqual([
      {
        method: "PATCH",
        body: {
          aufNumber: "AUF-99",
          aufExpiry: "2027-03-31",
          groupIds: [SENIOR_ID],
          dateOfBirth: "1990-05-10",
        },
      },
    ]);
    expect(cellOf(card, "Number")).toHaveTextContent("AUF-99");
    expect(
      within(card).getByRole("button", { name: "Edit AUF registration" }),
    ).toHaveFocus();
  });

  it("no manda el AUF si no lo tocó: el miembro puede haberlo cambiado entretanto (#274)", async () => {
    stubApi({ record: PENDING_RECORD });
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);
    await user.click(saveIn(card));

    expect(patches).toEqual([]);
    expect(within(card).queryByLabelText("AUF number")).not.toBeInTheDocument();
  });

  it("manda el número y el vencimiento vacíos como null", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);
    await user.clear(within(card).getByLabelText("AUF number"));
    await user.clear(within(card).getByLabelText("Expiry date"));
    await user.click(saveIn(card));

    expect(patches[0]?.body).toMatchObject({
      aufNumber: null,
      aufExpiry: null,
    });
  });

  it("lee lo que el servidor guardó: sin número tampoco queda vencimiento", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);
    await user.clear(within(card).getByLabelText("AUF number"));
    await user.click(saveIn(card));

    await within(card).findByRole("status");
    expect(cellOf(card, "Expires")).toHaveTextContent("Not set");
    expect(cellOf(card, "Status")).toHaveTextContent("Not added yet");
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

    const card = await openAuf(user);
    await user.type(within(card).getByLabelText("AUF number"), "0");
    await user.click(saveIn(card));

    expect(await screen.findByText("AUF expired")).toBeInTheDocument();
  });

  it("desactiva Guardar mientras guarda", async () => {
    let answer: (response: Response) => void = () => undefined;
    stubApi({
      save: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);
    await user.type(within(card).getByLabelText("AUF number"), "0");
    await user.click(saveIn(card));

    expect(saveIn(card)).toBeDisabled();
    expect(saveIn(card)).toHaveTextContent("Saving…");
    answer(jsonResponse(200, { data: RECORD }));
    expect(await within(card).findByRole("status")).toBeInTheDocument();
  });

  it("no manda un segundo guardado con un doble clic", async () => {
    stubApi({ save: () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);
    await user.type(within(card).getByLabelText("AUF number"), "0");
    await user.dblClick(saveIn(card));

    expect(patches).toHaveLength(1);
  });

  it("Cancelar vuelve a lectura sin mandar nada, con el foco en Editar", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);
    await user.type(within(card).getByLabelText("AUF number"), "0");
    await user.click(within(card).getByRole("button", { name: "Cancel" }));

    expect(patches).toEqual([]);
    expect(cellOf(card, "Number")).toHaveTextContent("AUF-1");
    expect(
      within(card).getByRole("button", { name: "Edit AUF registration" }),
    ).toHaveFocus();
  });
});

describe("ficha en pantalla: errores del AUF", () => {
  it("avisa de un número demasiado largo sin mandar nada", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);
    await user.clear(within(card).getByLabelText("AUF number"));
    await user.type(within(card).getByLabelText("AUF number"), "9".repeat(41));
    await user.click(saveIn(card));

    expect(patches).toEqual([]);
    // La ayuda del campo sigue en la descripción, después del aviso.
    expect(
      within(card).getByLabelText("AUF number"),
    ).toHaveAccessibleDescription(
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

    const card = await openAuf(user);
    await user.clear(within(card).getByLabelText("Expiry date"));
    await user.type(within(card).getByLabelText("Expiry date"), "2001-01-01");
    await user.click(saveIn(card));

    const expiry = within(card).getByLabelText("Expiry date");
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

    const card = await openAuf(user);
    await user.type(within(card).getByLabelText("AUF number"), "0");
    await user.click(saveIn(card));

    await vi.waitFor(() =>
      expect(
        within(card).getByLabelText("Expiry date"),
      ).toHaveAccessibleDescription("That expiry isn't a valid date."),
    );
  });

  it.each([
    [
      "un estado de cuenta que cambió a medias",
      () => errorResponse(409, "conflict", "member_status_changed"),
      "The member's account changed while saving. Reload the record and try again.",
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
  ])(
    "avisa de %s en la tarjeta y deja volver a intentarlo",
    async (_case, save, text) => {
      stubApi({ save });
      const user = userEvent.setup();
      await renderScreen();

      const card = await openAuf(user);
      await user.type(within(card).getByLabelText("AUF number"), "0");
      await user.click(saveIn(card));

      expect(await within(card).findByRole("alert")).toHaveTextContent(text);
      expect(saveIn(card)).toBeEnabled();
      expect(within(card).getByLabelText("AUF number")).toHaveValue("AUF-10");
    },
  );
});

describe("ficha en pantalla: invitación (#243)", () => {
  const PENDING = { ...RECORD, accountStatus: "incomplete" as const };

  it("no ofrece reenviar la invitación a quien ya activó su cuenta", async () => {
    stubApi();
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "More actions" }));

    expect(
      screen.queryByRole("button", { name: "Resend invitation" }),
    ).toBeNull();
  });

  it("reenvía la invitación a quien todavía no activó su cuenta", async () => {
    stubApi({ record: PENDING });
    await renderScreen();
    const user = userEvent.setup();

    await chooseAdminAction(user, "Resend invitation");
    await user.click(screen.getByRole("button", { name: "Resend invitation" }));

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
    const user = userEvent.setup();

    await chooseAdminAction(user, "Resend invitation");
    await user.click(screen.getByRole("button", { name: "Resend invitation" }));

    expect(
      await screen.findByText(
        "This member has already activated their account.",
      ),
    ).toBeVisible();
  });
});

describe("ficha en pantalla: baja y reactivación (#244)", () => {
  const INACTIVE = { ...RECORD, accountStatus: "inactive" as const };

  /** Elige Desactivar socio en el menú y confirma en la franja (#775). */
  async function deactivate(user: User): Promise<void> {
    await chooseAdminAction(user, "Deactivate member");
    await user.click(screen.getByRole("button", { name: "Deactivate" }));
  }

  it("da de baja a quien está activo y pasa a ofrecer reactivarle", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();

    await deactivate(user);

    expect(
      await screen.findByText("Paula Player's account was deactivated."),
    ).toBeVisible();
    expect(statusChanges).toEqual([{ status: "inactive" }]);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.getByRole("button", { name: "Reactivate member" }),
    ).toBeInTheDocument();
  });

  it("reactiva a quien está de baja y vuelve a ofrecer la baja", async () => {
    stubApi({ record: INACTIVE });
    await renderScreen();
    const user = userEvent.setup();

    await chooseAdminAction(user, "Reactivate member");

    expect(
      await screen.findByText("Paula Player's account was reactivated."),
    ).toBeVisible();
    expect(statusChanges).toEqual([{ status: "active" }]);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.getByRole("button", { name: "Deactivate member" }),
    ).toBeInTheDocument();
  });

  it("explica que es el último Admin y deja la ficha como estaba", async () => {
    stubApi({
      changeStatus: () => errorResponse(422, "business_rule", "last_admin"),
    });
    await renderScreen();
    const user = userEvent.setup();

    await deactivate(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This is the club's last Admin, so their account can't be deactivated. Name another Admin first.",
    );
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.getByRole("button", { name: "Deactivate member" }),
    ).toBeEnabled();
  });

  it("explica que un Admin no se da de baja a sí mismo", async () => {
    stubApi({
      changeStatus: () =>
        errorResponse(422, "business_rule", "self_deactivation"),
    });
    await renderScreen();

    await deactivate(userEvent.setup());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can't deactivate your own account. Another Admin has to do it.",
    );
  });

  it("dice que el miembro ya no está cuando el servidor responde 404", async () => {
    stubApi({ changeStatus: () => errorResponse(404, "not_found") });
    await renderScreen();

    await deactivate(userEvent.setup());

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

    await deactivate(userEvent.setup());

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
    await chooseAdminAction(user, "Deactivate member");

    await user.dblClick(screen.getByRole("button", { name: "Deactivate" }));

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
    const user = userEvent.setup();

    await chooseAdminAction(user, "Desactivar miembro", "Más acciones");
    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(
      await screen.findByText("La cuenta de Paula Player quedó desactivada."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Más acciones" }));
    expect(
      screen.getByRole("button", { name: "Reactivar miembro" }),
    ).toBeInTheDocument();
  });
});

describe("ficha en pantalla: exención de cuota (#457)", () => {
  const WAIVED: MemberRecord = {
    ...RECORD,
    membershipStatus: "waived",
    membershipWaiver: {
      reason: "Head coach",
      until: "2027-02-28T13:00:00.000Z",
    },
  };

  async function openWaiverDialog(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<HTMLElement> {
    await chooseAdminAction(user, "Waive membership fee");
    return screen.getByRole("dialog", {
      name: "Waive Paula Player's membership fee",
    });
  }

  it("exime con motivo y fecha de fin, y la ficha pasa a enseñarla", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();

    const dialog = await openWaiverDialog(user);
    await user.type(within(dialog).getByLabelText("Reason"), "Head coach");
    fireEvent.change(within(dialog).getByLabelText(/End date/), {
      target: { value: "2027-03-01" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Waive fee" }));

    expect(
      await screen.findByText("Paula Player's membership fee is waived."),
    ).toBeVisible();
    expect(waiverRequests).toEqual([
      { method: "POST", body: { reason: "Head coach", until: "2027-03-01" } },
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Membership waived")).toBeInTheDocument();
    expect(screen.getByText("Reason: Head coach")).toBeInTheDocument();
    expect(screen.getByText("Ends on 1 March 2027")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove waiver" }),
    ).toBeInTheDocument();
  });

  it("exime sin fecha de fin", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();

    const dialog = await openWaiverDialog(user);
    await user.type(within(dialog).getByLabelText("Reason"), "Volunteer");
    await user.click(within(dialog).getByRole("button", { name: "Waive fee" }));

    await screen.findByText("Paula Player's membership fee is waived.");
    expect(waiverRequests).toEqual([
      { method: "POST", body: { reason: "Volunteer", until: null } },
    ]);
    expect(screen.getByText("No end date")).toBeInTheDocument();
  });

  it("no deja confirmar sin motivo", async () => {
    stubApi();
    await renderScreen();

    const dialog = await openWaiverDialog(userEvent.setup());

    expect(
      within(dialog).getByRole("button", { name: "Waive fee" }),
    ).toBeDisabled();
  });

  it("limita el motivo a 200 caracteres", async () => {
    stubApi();
    await renderScreen();

    const dialog = await openWaiverDialog(userEvent.setup());

    expect(within(dialog).getByLabelText("Reason")).toHaveAttribute(
      "maxlength",
      "200",
    );
  });

  it("cancelar cierra el diálogo sin pedir nada", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();

    const dialog = await openWaiverDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(waiverRequests).toEqual([]);
  });

  it("explica una fecha de fin pasada sin cerrar el diálogo", async () => {
    stubApi({
      waive: () =>
        errorResponse(400, "validation_error", "until_not_after_today"),
    });
    await renderScreen();
    const user = userEvent.setup();

    const dialog = await openWaiverDialog(user);
    await user.type(within(dialog).getByLabelText("Reason"), "Coach");
    fireEvent.change(within(dialog).getByLabelText(/End date/), {
      target: { value: "2020-01-01" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Waive fee" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The end date has to be after today.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("enseña el motivo y la fecha de fin de un socio exento", async () => {
    stubApi({ record: WAIVED });
    await renderScreen();

    await chooseAdminAction(userEvent.setup(), "Remove waiver");

    expect(screen.getByText("Reason: Head coach")).toBeInTheDocument();
    expect(screen.getByText("Ends on 1 March 2027")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Waive membership fee" }),
    ).not.toBeInTheDocument();
  });

  it("retira la exención tras confirmarla, y vuelve a ofrecer eximir", async () => {
    stubApi({ record: WAIVED });
    await renderScreen();
    const user = userEvent.setup();

    await chooseAdminAction(user, "Remove waiver");
    const dialog = screen.getByRole("dialog", {
      name: "Remove Paula Player's waiver?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Remove waiver" }),
    );

    expect(
      await screen.findByText("Paula Player's waiver was removed."),
    ).toBeVisible();
    expect(waiverRequests).toEqual([{ method: "DELETE", body: null }]);
    expect(screen.getByText("Membership pending")).toBeInTheDocument();
    expect(screen.queryByText("Reason: Head coach")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Waive membership fee" }),
    ).toBeInTheDocument();
  });

  it("no retira nada si se cancela la confirmación", async () => {
    stubApi({ record: WAIVED });
    await renderScreen();
    const user = userEvent.setup();

    await chooseAdminAction(user, "Remove waiver");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    expect(waiverRequests).toEqual([]);
    expect(screen.getByText("Reason: Head coach")).toBeInTheDocument();
  });

  it("explica un rechazo al retirar dentro de la confirmación", async () => {
    stubApi({
      record: WAIVED,
      removeWaiver: () => errorResponse(403, "forbidden"),
    });
    await renderScreen();
    const user = userEvent.setup();

    await chooseAdminAction(user, "Remove waiver");
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Remove waiver" }),
    );

    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Reason: Head coach")).toBeInTheDocument();
  });

  it("lo dice todo en español", async () => {
    stubApi();
    render(<MemberRecordScreen locale="es" userId={MEMBER_ID} />);
    await screen.findByRole("heading", { level: 1, name: "Paula Player" });
    const user = userEvent.setup();

    await chooseAdminAction(user, "Eximir de la cuota", "Más acciones");
    const dialog = screen.getByRole("dialog", {
      name: "Eximir de cuota a Paula Player",
    });
    await user.type(within(dialog).getByLabelText("Motivo"), "Entrenadora");
    fireEvent.change(within(dialog).getByLabelText(/Fecha de fin/), {
      target: { value: "2027-03-01" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Eximir" }));

    expect(
      await screen.findByText("La cuota de Paula Player queda exenta."),
    ).toBeVisible();
    expect(screen.getByText("Motivo: Entrenadora")).toBeInTheDocument();
    expect(
      screen.getByText("Termina el 1 de marzo de 2027"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retirar la exención" }),
    ).toBeInTheDocument();
  });

  it("confirma la retirada en español", async () => {
    stubApi({ record: WAIVED });
    render(<MemberRecordScreen locale="es" userId={MEMBER_ID} />);
    await screen.findByRole("heading", { level: 1, name: "Paula Player" });
    const user = userEvent.setup();

    await chooseAdminAction(user, "Retirar la exención", "Más acciones");

    expect(
      screen.getByRole("dialog", {
        name: "¿Retirar la exención de Paula Player?",
      }),
    ).toBeInTheDocument();
  });
});

describe("ficha en pantalla: Ficha del club (#272, #773)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_IN_CLUB);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openClubRecord(user: User): Promise<HTMLElement> {
    const card = clubRecordCard();
    await user.click(
      within(card).getByRole("button", { name: "Edit Club record" }),
    );
    return card;
  }

  it("lee la fecha de nacimiento con la edad y el alta, con la etiqueta de Admin", async () => {
    stubApi();
    await renderScreen();

    const card = clubRecordCard();
    expect(within(card).getByText("Admin")).toBeInTheDocument();
    expect(cellOf(card, "Date of birth")).toHaveTextContent("10 May 1990 · 36");
    expect(cellOf(card, "Joined")).toHaveTextContent("6 March 2024");
  });

  it("sin fecha de nacimiento la deja sin indicar", async () => {
    stubApi({ record: { ...RECORD, dateOfBirth: null } });
    await renderScreen();

    expect(cellOf(clubRecordCard(), "Date of birth")).toHaveTextContent(
      "Not set",
    );
  });

  it("Editar abre sólo la fecha de nacimiento; el alta sigue en lectura (D2)", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openClubRecord(user);

    expect(within(card).getByLabelText("Date of birth")).toHaveValue(
      "1990-05-10",
    );
    expect(within(card).getByLabelText("Date of birth")).toHaveFocus();
    expect(within(card).queryByLabelText(/Joined/)).not.toBeInTheDocument();
    expect(cellOf(card, "Joined")).toHaveTextContent("6 March 2024");
  });

  it("manda la fecha corregida con los grupos guardados, sin el AUF ni el contacto", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openClubRecord(user);
    await user.clear(within(card).getByLabelText("Date of birth"));
    await user.type(within(card).getByLabelText("Date of birth"), "1988-11-02");
    await user.click(saveIn(card));

    expect(await within(card).findByRole("status")).toHaveTextContent(
      "Club record saved",
    );
    expect(patches).toEqual([
      {
        method: "PATCH",
        body: { groupIds: [SENIOR_ID], dateOfBirth: "1988-11-02" },
      },
    ]);
    expect(cellOf(card, "Date of birth")).toHaveTextContent(
      "2 November 1988 · 37",
    );
  });

  it("guardar sin tocar la fecha vuelve a lectura sin mandar nada", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openClubRecord(user);
    await user.click(saveIn(card));

    expect(patches).toEqual([]);
    expect(
      within(card).queryByLabelText("Date of birth"),
    ).not.toBeInTheDocument();
  });

  it("Cancelar vuelve a lectura sin mandar nada", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openClubRecord(user);
    await user.clear(within(card).getByLabelText("Date of birth"));
    await user.type(within(card).getByLabelText("Date of birth"), "1988-11-02");
    await user.click(within(card).getByRole("button", { name: "Cancel" }));

    expect(patches).toEqual([]);
    expect(cellOf(card, "Date of birth")).toHaveTextContent("10 May 1990");
  });

  it("avisa antes de guardar que el miembro tendrá que dar el consentimiento de su tutor", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openClubRecord(user);
    await user.clear(within(card).getByLabelText("Date of birth"));
    await user.type(within(card).getByLabelText("Date of birth"), MINOR_BIRTH);

    expect(
      within(card).getByLabelText("Date of birth"),
    ).toHaveAccessibleDescription(
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

    const card = await openClubRecord(user);
    await user.clear(within(card).getByLabelText("Date of birth"));
    await user.type(within(card).getByLabelText("Date of birth"), dateOfBirth);

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

      const card = await openClubRecord(user);
      await user.clear(within(card).getByLabelText("Date of birth"));
      await user.type(
        within(card).getByLabelText("Date of birth"),
        "1988-11-02",
      );
      await user.click(saveIn(card));

      const dateOfBirth = within(card).getByLabelText("Date of birth");
      await vi.waitFor(() =>
        expect(dateOfBirth).toHaveAccessibleDescription(
          expect.stringContaining(text),
        ),
      );
      expect(dateOfBirth).toHaveAttribute("aria-invalid", "true");
    },
  );

  it("avisa en la tarjeta de un fallo que no es de la fecha", async () => {
    stubApi({ save: () => errorResponse(500, "internal_error") });
    const user = userEvent.setup();
    await renderScreen();

    const card = await openClubRecord(user);
    await user.clear(within(card).getByLabelText("Date of birth"));
    await user.type(within(card).getByLabelText("Date of birth"), "1988-11-02");
    await user.click(saveIn(card));

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "We couldn't save the record. Try again.",
    );
    expect(saveIn(card)).toBeEnabled();
  });

  it("sale en español", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen("es");

    const card = clubRecordCard("Ficha del club");
    expect(cellOf(card, "Alta")).toHaveTextContent("6 de marzo de 2024");
    await user.click(
      within(card).getByRole("button", { name: "Editar Ficha del club" }),
    );
    await user.clear(within(card).getByLabelText("Fecha de nacimiento"));
    await user.type(
      within(card).getByLabelText("Fecha de nacimiento"),
      MINOR_BIRTH,
    );

    expect(
      within(card).getByLabelText("Fecha de nacimiento"),
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

    expect(screen.getByText("AUF pending")).toBeInTheDocument();
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
    expect(screen.queryByText("AUF pending")).not.toBeInTheDocument();
  });

  it("no ofrece verificar mientras el número está editado: guardar ya lo verifica", async () => {
    stubApi({ record: PENDING_RECORD });
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);
    await user.type(within(card).getByLabelText("AUF number"), "0");

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
    expect(screen.getByText("AUF pending")).toBeInTheDocument();
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

    expect(screen.getByText("AUF pendiente")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Verificar AUF" }),
    ).toBeInTheDocument();
  });
});

/** La evaluación del Admin en la columna derecha (#774, D10): la nota global
 * con su fecha, hasta cuatro categorías con su barra y "Abrir". */
describe("ficha en pantalla: evaluación (#324, #774)", () => {
  function evaluationSection(name = "Evaluation"): HTMLElement {
    return screen.getByRole("region", { name });
  }

  function ratingOf(index: number, name: string, rating: number) {
    return {
      categoryId: `ca7e0000-0000-4000-8000-00000000000${index}`,
      name,
      rating,
      isRetired: false,
    };
  }

  function evaluated(ratings: ReturnType<typeof ratingOf>[]): () => Response {
    return () =>
      jsonResponse(200, {
        data: {
          status: "evaluated",
          memberId: MEMBER_ID,
          updatedAt: "2026-09-12T01:02:03.123456+00:00",
          overallRating: 7.2,
          ratings,
          isCurrent: true,
        },
      });
  }

  it("enseña al Admin la nota global con su fecha y las categorías con su nota", async () => {
    stubApi({
      evaluation: evaluated([
        ratingOf(1, "Technique", 7.5),
        ratingOf(2, "Fitness", 6.8),
      ]),
    });
    await renderScreen();

    const section = evaluationSection();
    expect(await within(section).findByText("7.2")).toBeVisible();
    expect(within(section).getByText("overall · 12 Sept")).toBeVisible();
    expect(
      within(within(section).getByRole("list", { name: "Categories" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Technique7.5", "Fitness6.8"]);
  });

  it("enseña como mucho cuatro categorías", async () => {
    stubApi({
      evaluation: evaluated([
        ratingOf(1, "Technique", 7),
        ratingOf(2, "Fitness", 7),
        ratingOf(3, "Game sense", 7),
        ratingOf(4, "Attitude", 7),
        ratingOf(5, "Speed", 7),
      ]),
    });
    await renderScreen();

    const section = evaluationSection();
    const categories = await within(section).findByRole("list", {
      name: "Categories",
    });
    expect(within(categories).getAllByRole("listitem")).toHaveLength(4);
    expect(within(categories).queryByText("Speed")).toBeNull();
  });

  it("lleva Abrir a la evaluación entera", async () => {
    stubApi({ evaluation: evaluated([ratingOf(1, "Technique", 7)]) });
    await renderScreen();

    const section = evaluationSection();
    await within(section).findByText("7.2");
    expect(
      within(section).getByRole("link", { name: "Open the full evaluation" }),
    ).toHaveAttribute("href", `/evaluaciones?miembro=${MEMBER_ID}`);
  });

  it("dice sin evaluar a quien no tiene evaluación, y deja abrirla", async () => {
    stubApi();
    await renderScreen();

    const section = evaluationSection();
    expect(await within(section).findByText("Not evaluated")).toBeVisible();
    expect(
      within(section).getByRole("link", { name: "Open the full evaluation" }),
    ).toHaveAttribute("href", `/evaluaciones?miembro=${MEMBER_ID}`);
  });

  it("dice por qué no pudo leer la evaluación", async () => {
    stubApi({ evaluation: () => errorResponse(403, "forbidden") });
    await renderScreen();

    expect(
      await within(evaluationSection()).findByRole("alert"),
    ).toHaveTextContent("Only coaches and admins can see evaluations.");
  });

  it("se escribe en español", async () => {
    stubApi({ evaluation: evaluated([ratingOf(1, "Técnica", 7)]) });
    await renderScreen("es");

    const section = evaluationSection("Evaluación");
    expect(await within(section).findByText("7,2")).toBeVisible();
    expect(within(section).getByText("global · 12 sept")).toBeVisible();
    expect(
      within(section).getByRole("link", { name: "Abrir la evaluación entera" }),
    ).toBeVisible();
  });

  it("dice sin evaluar en español", async () => {
    stubApi();
    await renderScreen("es");

    expect(
      await within(evaluationSection("Evaluación")).findByText("Sin evaluar"),
    ).toBeVisible();
  });
});

/** La asistencia en la ficha (#774, D9): la de la temporada, la misma
 * tarjeta que el perfil propio. */
describe("ficha en pantalla: asistencia de la temporada (#774)", () => {
  it("enseña el porcentaje, cuántas de cuántas sesiones y las últimas", async () => {
    stubApi();

    await renderScreen();

    const region = screen.getByRole("region", { name: "Attendance" });
    expect(within(region).getByText("This season")).toBeVisible();
    expect(within(region).getByText("90%")).toBeVisible();
    expect(within(region).getByText("9 of 10 sessions")).toBeVisible();
    expect(
      within(region).getByRole("list", { name: "Last 10" }),
    ).toHaveTextContent("1 September 2026: Present8 September 2026: Absent");
  });

  it("dice que no hay sesiones esta temporada", async () => {
    stubApi({ record: { ...RECORD, attendance: null } });

    await renderScreen();

    const region = screen.getByRole("region", { name: "Attendance" });
    expect(
      within(region).getByText("There are no sessions this season yet."),
    ).toBeVisible();
  });

  it("sale en español", async () => {
    stubApi();

    await renderScreen("es");

    const region = screen.getByRole("region", { name: "Asistencia" });
    expect(within(region).getByText("90 %")).toBeVisible();
    expect(within(region).getByText("9 de 10 sesiones")).toBeVisible();
  });
});

describe("ficha en pantalla: membresía (#774)", () => {
  it("enseña el plan y cuándo se renueva, sin el enlace a Pagos", async () => {
    stubApi();

    await renderScreen();

    const region = screen.getByRole("region", { name: "Membership" });
    expect(within(region).getByText("Full")).toBeVisible();
    expect(
      within(region).getByText("Active · renews 30 June 2027"),
    ).toBeVisible();
    expect(within(region).queryByRole("link")).toBeNull();
  });

  it("enseña la exención que el Admin acaba de dar", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await chooseAdminAction(user, "Waive membership fee");
    const dialog = screen.getByRole("dialog", {
      name: "Waive Paula Player's membership fee",
    });
    await user.type(within(dialog).getByLabelText("Reason"), "Volunteer");
    await user.click(within(dialog).getByRole("button", { name: "Waive fee" }));
    await screen.findByText("Paula Player's membership fee is waived.");

    const region = screen.getByRole("region", { name: "Membership" });
    expect(await within(region).findByText("Waived")).toBeVisible();
  });
});

describe("ficha en pantalla: grupos (#774)", () => {
  function groupsRegion(): HTMLElement {
    return screen.getByRole("region", { name: "Groups" });
  }

  it("enseña los grupos como fichas, y sin grupos lo dice", async () => {
    stubApi({ record: { ...RECORD, groups: [] } });

    await renderScreen();

    expect(within(groupsRegion()).getByText("No groups")).toBeVisible();
  });

  it("Editar abre la lista de casillas de los grupos del club", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await user.click(
      within(groupsRegion()).getByRole("button", { name: "Edit Groups" }),
    );

    const field = within(groupsRegion()).getByRole("group", { name: "Groups" });
    expect(
      within(field).getByRole("checkbox", { name: "Senior Squad" }),
    ).toBeChecked();
    expect(
      within(field).getByRole("checkbox", { name: "Masters Squad" }),
    ).not.toBeChecked();
  });

  it("guarda la lista entera de grupos sin tocar el AUF ni el contacto, y enseña lo guardado", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await user.click(
      within(groupsRegion()).getByRole("button", { name: "Edit Groups" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Masters Squad" }));
    await user.click(screen.getByRole("checkbox", { name: "Senior Squad" }));
    await user.click(
      within(groupsRegion()).getByRole("button", { name: "Save" }),
    );

    expect(patches).toEqual([
      {
        method: "PATCH",
        body: { groupIds: [MASTERS_ID], dateOfBirth: "1990-05-10" },
      },
    ]);
    expect(await within(groupsRegion()).findByRole("status")).toHaveTextContent(
      "Groups saved",
    );
    expect(within(groupsRegion()).getByText("Masters Squad")).toBeVisible();
    expect(within(groupsRegion()).queryByRole("checkbox")).toBeNull();
  });

  it("después, guardar el AUF manda los grupos nuevos y no los de antes", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await user.click(
      within(groupsRegion()).getByRole("button", { name: "Edit Groups" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Masters Squad" }));
    await user.click(
      within(groupsRegion()).getByRole("button", { name: "Save" }),
    );
    await within(groupsRegion()).findByRole("status");
    const card = await openAuf(user);
    await user.type(within(card).getByLabelText("AUF number"), "0");
    await user.click(saveIn(card));

    expect(patches[1]?.body).toMatchObject({
      groupIds: [MASTERS_ID, SENIOR_ID],
    });
  });

  it("Cancelar vuelve a la lectura sin mandar nada", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    await user.click(
      within(groupsRegion()).getByRole("button", { name: "Edit Groups" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Masters Squad" }));
    await user.click(
      within(groupsRegion()).getByRole("button", { name: "Cancel" }),
    );

    expect(patches).toEqual([]);
    expect(within(groupsRegion()).queryByText("Masters Squad")).toBeNull();
    expect(
      within(groupsRegion()).getByRole("button", { name: "Edit Groups" }),
    ).toHaveFocus();
  });

  it("si falla, avisa y deja la lista abierta con lo elegido", async () => {
    stubApi({
      save: () => errorResponse(422, "business_rule", "member_inactive"),
    });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(
      within(groupsRegion()).getByRole("button", { name: "Edit Groups" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Masters Squad" }));
    await user.click(
      within(groupsRegion()).getByRole("button", { name: "Save" }),
    );

    expect(await within(groupsRegion()).findByRole("alert")).toHaveTextContent(
      "A member with a deactivated account can't be added to groups.",
    );
    expect(
      screen.getByRole("checkbox", { name: "Masters Squad" }),
    ).toBeChecked();
  });

  it("no manda un segundo guardado con un doble clic", async () => {
    stubApi({ save: () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(
      within(groupsRegion()).getByRole("button", { name: "Edit Groups" }),
    );
    await user.dblClick(
      within(groupsRegion()).getByRole("button", { name: "Save" }),
    );

    expect(patches).toHaveLength(1);
  });

  it("se escribe en español", async () => {
    stubApi({ record: { ...RECORD, groups: [] } });

    await renderScreen("es");

    const region = screen.getByRole("region", { name: "Grupos" });
    expect(within(region).getByText("Sin grupos")).toBeVisible();
    expect(
      within(region).getByRole("button", { name: "Editar Grupos" }),
    ).toBeVisible();
  });
});
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

function contactCard(name = "Contact"): HTMLElement {
  return screen.getByRole("region", { name });
}

async function openContact(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  const card = contactCard();
  await user.click(within(card).getByRole("button", { name: "Edit Contact" }));
  return card;
}

function saveContact(card: HTMLElement): HTMLElement {
  return within(card).getByRole("button", { name: /^(Save|Saving…)$/ });
}

describe("ficha en pantalla: Sobre mí (#772)", () => {
  it("lista el nombre, el país, la posición y la experiencia, sin género", async () => {
    stubApi();

    await renderScreen();

    const card = screen.getByRole("region", { name: "About" });
    expect(readValueOf(card, "Full name")).toBe("Paula Player");
    expect(readValueOf(card, "Country")).toBe("Australia");
    expect(readValueOf(card, "Position")).toBe("Goalkeeper");
    expect(readValueOf(card, "Experience")).toBe("Intermediate");
    expect(within(card).queryByText("Gender")).not.toBeInTheDocument();
  });

  it("es sólo lectura: no lleva Editar", async () => {
    stubApi();

    await renderScreen();

    const card = screen.getByRole("region", { name: "About" });
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("pinta un guion en los datos vacíos", async () => {
    stubApi({
      record: {
        ...RECORD,
        positionName: null,
        experienceLevel: null,
        country: null,
      },
    });

    await renderScreen();

    const card = screen.getByRole("region", { name: "About" });
    expect(readValueOf(card, "Country")).toContain("—");
    expect(readValueOf(card, "Position")).toContain("—");
    expect(readValueOf(card, "Experience")).toContain("—");
  });

  it("se lee en español", async () => {
    stubApi();

    await renderScreen("es");

    const card = screen.getByRole("region", { name: "Sobre mí" });
    expect(readValueOf(card, "Posición")).toBe("Portero");
    expect(readValueOf(card, "Experiencia")).toBe("Intermedio");
  });
});

describe("ficha en pantalla: contacto (#499, #772)", () => {
  it("en lectura enseña el teléfono con el correo y el contacto de emergencia", async () => {
    stubApi();

    await renderScreen();

    const card = contactCard();
    expect(within(card).getByText("0412 345 678")).toBeInTheDocument();
    expect(within(card).getByText("paula@example.com")).toBeInTheDocument();
    expect(within(card).getByText("Rosa Player · Mother")).toBeInTheDocument();
    expect(within(card).getByText("0499 111 222")).toBeInTheDocument();
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("sin contacto de emergencia dice que aún no se añadió", async () => {
    stubApi({ record: { ...RECORD, emergencyContact: null } });

    await renderScreen();

    expect(
      within(contactCard()).getByText("Not added yet"),
    ).toBeInTheDocument();
  });

  it("Editar abre el teléfono y el contacto con lo guardado, con el foco en el teléfono", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openContact(user);

    expect(within(card).getByLabelText("Phone (optional)")).toHaveFocus();
    expect(within(card).getByLabelText("Phone (optional)")).toHaveValue(
      "0412 345 678",
    );
    expect(within(card).getByLabelText("Contact name")).toHaveValue(
      "Rosa Player",
    );
    expect(within(card).getByLabelText("Contact phone")).toHaveValue(
      "0499 111 222",
    );
    expect(within(card).getByLabelText("Relationship")).toHaveValue("Mother");
  });

  it("guardar el AUF no manda el contacto", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();

    const card = await openAuf(user);
    await user.type(within(card).getByLabelText("AUF number"), "0");
    await user.click(saveIn(card));

    await within(card).findByRole("status");
    expect(patches[0]?.body).not.toHaveProperty("phone");
    expect(patches[0]?.body).not.toHaveProperty("emergencyContact");
  });

  it("manda el contacto corregido con los grupos y la fecha guardados, sin el AUF", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();
    const card = await openContact(user);

    await user.clear(within(card).getByLabelText("Phone (optional)"));
    await user.type(
      within(card).getByLabelText("Phone (optional)"),
      "0400 000 111",
    );
    await user.clear(within(card).getByLabelText("Relationship"));
    await user.type(within(card).getByLabelText("Relationship"), "Aunt");
    await user.click(saveContact(card));

    expect(await within(card).findByRole("status")).toHaveTextContent(
      "Contact saved",
    );
    expect(patches).toEqual([
      {
        method: "PATCH",
        body: {
          groupIds: [SENIOR_ID],
          dateOfBirth: "1990-05-10",
          phone: "0400 000 111",
          emergencyContact: {
            name: "Rosa Player",
            phone: "0499 111 222",
            relationship: "Aunt",
          },
        },
      },
    ]);
  });

  it("guardar sin tocar nada vuelve a lectura sin mandar nada", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();
    const card = await openContact(user);

    await user.click(saveContact(card));

    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Edit Contact" }),
    ).toHaveFocus();
    expect(patches).toEqual([]);
  });

  it("al guardar vuelve a lectura con lo nuevo y el foco en Editar", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();
    const card = await openContact(user);

    await user.clear(within(card).getByLabelText("Relationship"));
    await user.type(within(card).getByLabelText("Relationship"), "Aunt");
    await user.click(saveContact(card));

    await within(card).findByRole("status");
    expect(within(card).getByText("Rosa Player · Aunt")).toBeInTheDocument();
    expect(
      within(card).queryByLabelText("Relationship"),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Edit Contact" }),
    ).toHaveFocus();
  });

  it("manda vacíos como null el teléfono y el contacto que se borran", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();
    const card = await openContact(user);

    await user.clear(within(card).getByLabelText("Phone (optional)"));
    await user.clear(within(card).getByLabelText("Contact name"));
    await user.clear(within(card).getByLabelText("Contact phone"));
    await user.clear(within(card).getByLabelText("Relationship"));
    await user.click(saveContact(card));

    await within(card).findByRole("status");
    expect(patches[0]?.body).toMatchObject({
      phone: null,
      emergencyContact: null,
    });
  });

  it("avisa junto al campo de un teléfono con pocos dígitos, sin mandar nada", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();
    const card = await openContact(user);

    await user.clear(within(card).getByLabelText("Phone (optional)"));
    await user.type(within(card).getByLabelText("Phone (optional)"), "1234");
    await user.click(saveContact(card));

    expect(patches).toEqual([]);
    const phone = within(card).getByLabelText("Phone (optional)");
    expect(phone).toHaveAccessibleDescription(
      "A phone number needs at least 8 digits.",
    );
    expect(phone).toHaveAttribute("aria-invalid", "true");
  });

  it("avisa de lo que falta en un contacto de emergencia a medias, sin mandar nada", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();
    const card = await openContact(user);

    await user.clear(within(card).getByLabelText("Relationship"));
    await user.click(saveContact(card));

    expect(patches).toEqual([]);
    expect(
      within(card).getByLabelText("Relationship"),
    ).toHaveAccessibleDescription(
      "Add how they're related, or leave all three empty.",
    );
  });

  it("explica junto al campo el rechazo del servidor y sigue abierta", async () => {
    stubApi({
      save: () => errorResponse(400, "validation_error", "phone_too_long"),
    });
    const user = userEvent.setup();
    await renderScreen();
    const card = await openContact(user);

    await user.type(within(card).getByLabelText("Phone (optional)"), "9");
    await user.click(saveContact(card));

    await vi.waitFor(() =>
      expect(
        within(card).getByLabelText("Phone (optional)"),
      ).toHaveAccessibleDescription(
        "A phone number can have at most 15 digits.",
      ),
    );
  });

  it("si falla la red sigue abierta con el aviso y lo escrito", async () => {
    stubApi({
      save: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const user = userEvent.setup();
    await renderScreen();
    const card = await openContact(user);

    await user.clear(within(card).getByLabelText("Relationship"));
    await user.type(within(card).getByLabelText("Relationship"), "Aunt");
    await user.click(saveContact(card));

    expect(await within(card).findByRole("alert")).toBeInTheDocument();
    expect(within(card).getByLabelText("Relationship")).toHaveValue("Aunt");
  });

  it("Cancelar vuelve a lectura sin cambios y con el foco en Editar", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();
    const card = await openContact(user);
    await user.clear(within(card).getByLabelText("Relationship"));

    await user.click(within(card).getByRole("button", { name: "Cancel" }));

    expect(within(card).getByText("Rosa Player · Mother")).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Edit Contact" }),
    ).toHaveFocus();
    expect(patches).toEqual([]);
  });

  it("avisa si el contacto de emergencia tiene el teléfono del propio socio", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen();
    const card = await openContact(user);

    await user.clear(within(card).getByLabelText("Contact phone"));
    await user.type(
      within(card).getByLabelText("Contact phone"),
      "0412-345-678",
    );

    expect(
      within(card).getByLabelText("Contact phone"),
    ).toHaveAccessibleDescription(
      "This is Paula Player's own phone. The emergency contact should be someone else.",
    );
  });

  it("sale en español", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderScreen("es");
    const card = contactCard("Contacto");

    await user.click(
      within(card).getByRole("button", { name: "Editar Contacto" }),
    );

    expect(
      within(card).getByLabelText("Teléfono (opcional)"),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("group", { name: "Contacto de emergencia" }),
    ).toHaveAccessibleDescription(
      "A quién llama el club si a Paula Player le pasa algo en el agua. Rellena los tres datos o déjalos vacíos.",
    );
    expect(
      within(card).getByLabelText("Nombre del contacto"),
    ).toBeInTheDocument();
  });
});

// #549: la fila del directorio deja de cambiar el rol, y hasta que llegue el
// panel de E21 (#550) el Admin lo cambia aquí. Son los casos que vivían en
// `directory-admin.test.tsx`, con el mismo endpoint.
describe("ficha en pantalla: rol (#549)", () => {
  function roleControl(name = "Role for Paula Player"): HTMLElement {
    return screen.getByRole("combobox", { name });
  }

  function saveRoleButton(): HTMLElement {
    return screen.getByRole("button", {
      name: "Save the role for Paula Player",
    });
  }

  /** El control del rol sale al elegir Cambiar rol en el menú ⋯ (#775). */
  async function renderRolePanel(locale: "en" | "es" = "en"): Promise<void> {
    await renderScreen(locale);
    await (locale === "en"
      ? chooseAdminAction(userEvent.setup(), "Change role")
      : chooseAdminAction(userEvent.setup(), "Cambiar rol", "Más acciones"));
  }

  async function chooseRole(role: string): Promise<void> {
    const user = userEvent.setup();
    await user.selectOptions(roleControl(), role);
    await user.click(saveRoleButton());
  }

  it("enseña un control con el rol del miembro", async () => {
    stubApi();

    await renderRolePanel();

    expect(roleControl()).toHaveValue("Player");
    expect(saveRoleButton()).toBeDisabled();
  });

  it("al confirmar otro rol, lo guarda y lo dice", async () => {
    stubApi();
    await renderRolePanel();

    await chooseRole("Committee");

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Paula Player is now Committee.",
    );
    expect(roleControl()).toHaveValue("Committee");
    expect(roleChanges).toEqual([{ role: "Committee" }]);
  });

  it("con el último Admin explica por qué no se puede y deja el rol igual", async () => {
    stubApi({
      record: { ...RECORD, role: "Admin" },
      changeRole: () => errorResponse(422, "business_rule", "last_admin"),
    });
    await renderRolePanel();

    await chooseRole("Player");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This is the club's last Admin.",
    );
    expect(roleControl()).toHaveValue("Admin");
  });

  it("con un error de red muestra el aviso y deja volver a intentar", async () => {
    const user = userEvent.setup();
    let isOffline = true;
    stubApi({
      changeRole: (body) => {
        if (isOffline) {
          throw new TypeError("Failed to fetch");
        }
        return changedRole(body);
      },
    });
    await renderRolePanel();

    await chooseRole("Coach");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server",
    );
    isOffline = false;
    await user.click(saveRoleButton());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Paula Player is now Coach.",
    );
  });

  it("desactiva el botón mientras el cambio está en curso", async () => {
    let answer: (response: Response) => void = () => undefined;
    stubApi({
      changeRole: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await renderRolePanel();

    await chooseRole("Coach");

    expect(saveRoleButton()).toBeDisabled();
    expect(roleControl()).toBeDisabled();
    await act(async () => {
      answer(changedRole({ role: "Coach" }));
    });
  });

  it("un doble clic manda un solo cambio", async () => {
    const user = userEvent.setup();
    stubApi();
    await renderRolePanel();

    await user.selectOptions(roleControl(), "Committee");
    await user.dblClick(saveRoleButton());

    await screen.findByRole("status");
    expect(roleChanges).toHaveLength(1);
  });

  it("con un miembro que ya no está en el club lo dice del miembro", async () => {
    stubApi({ changeRole: () => errorResponse(404, "not_found") });
    await renderRolePanel();

    await chooseRole("Coach");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That member is no longer in the club.",
    );
  });

  it("con una regla de negocio que no conoce da el aviso genérico", async () => {
    stubApi({
      changeRole: () =>
        errorResponse(422, "business_rule", "regla_desconocida"),
    });
    await renderRolePanel();

    await chooseRole("Coach");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't finish that. Try again in a moment.",
    );
    expect(roleControl()).toHaveValue("Player");
  });

  it("sale en español", async () => {
    stubApi();

    await renderRolePanel("es");

    expect(screen.getByRole("heading", { name: "Rol" })).toBeVisible();
    const role = roleControl("Rol de Paula Player");
    expect(role).toHaveValue("Player");
    expect(
      within(role).getByRole("option", { name: "Jugador" }),
    ).toBeInTheDocument();
  });
});

describe("ficha en pantalla: la cabecera (#771)", () => {
  it("lleva el nombre en H1, la píldora del rol y posición · experiencia · país", async () => {
    stubApi();

    await renderScreen();

    const header = screen.getByRole("banner");
    expect(within(header).getByText("Player")).toBeInTheDocument();
    expect(
      within(header).getByText("Goalkeeper · Intermediate · Australia"),
    ).toBeInTheDocument();
    expect(within(header).getByText("Membership active")).toBeInTheDocument();
    expect(within(header).getByText("AUF verified")).toBeInTheDocument();
    expect(
      within(header).getByText("Member since March 2024"),
    ).toBeInTheDocument();
  });

  it("la foto no lleva cámara: el Admin no cambia la foto de otro", async () => {
    stubApi();

    await renderScreen();

    expect(
      screen.queryByRole("button", { name: /photo/i }),
    ).not.toBeInTheDocument();
  });

  it("enseña el rol que el Admin acaba de cambiar", async () => {
    stubApi({ record: { ...RECORD, role: "Coach" } });

    await renderScreen();

    expect(
      within(screen.getByRole("banner")).getByText("Coach"),
    ).toBeInTheDocument();
  });

  it("se lee en español", async () => {
    stubApi({ record: PENDING_RECORD });

    await renderScreen("es");

    const header = screen.getByRole("banner");
    expect(
      within(header).getByText("Portero · Intermedio · Australia"),
    ).toBeInTheDocument();
    expect(within(header).getByText("Membresía activa")).toBeInTheDocument();
    expect(within(header).getByText("AUF pendiente")).toBeInTheDocument();
    expect(
      within(header).getByText("Miembro desde marzo de 2024"),
    ).toBeInTheDocument();
  });
});

describe("ficha en pantalla: la franja del AUF pendiente (#771)", () => {
  function aufStrip(): HTMLElement {
    return screen.getByRole("note", { name: /added AUF/ });
  }

  it("dice quién añadió qué AUF y cuándo vence, con Verificar AUF", async () => {
    stubApi({ record: PENDING_RECORD });

    await renderScreen();

    const strip = aufStrip();
    expect(strip).toHaveTextContent(
      "Paula Player added AUF AUF-1 (expires 31 March 2027). Check it and verify.",
    );
    expect(within(strip).getByText("AUF-1").tagName).toBe("STRONG");
    expect(
      within(strip).getByRole("button", { name: "Verify AUF" }),
    ).toBeInTheDocument();
  });

  it("sin vencimiento no dice cuándo vence", async () => {
    stubApi({ record: { ...PENDING_RECORD, aufExpiry: null } });

    await renderScreen();

    expect(aufStrip()).toHaveTextContent(
      "Paula Player added AUF AUF-1. Check it and verify.",
    );
  });

  it("al verificar llama a la API, quita la franja y dice AUF verificado", async () => {
    stubApi({ record: PENDING_RECORD });
    const user = userEvent.setup();
    await renderScreen();

    await user.click(
      within(aufStrip()).getByRole("button", { name: "Verify AUF" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "AUF verified.",
    );
    expect(verifications).toEqual([
      { aufNumber: "AUF-1", aufExpiry: "2027-03-31" },
    ]);
    expect(
      screen.queryByRole("note", { name: /added AUF/ }),
    ).not.toBeInTheDocument();
  });

  it("no sale con el AUF verificado ni sin AUF", async () => {
    stubApi({
      record: {
        ...RECORD,
        aufNumber: null,
        aufExpiry: null,
        isAufVerified: false,
      },
    });

    await renderScreen();

    expect(
      screen.queryByRole("note", { name: /added AUF/ }),
    ).not.toBeInTheDocument();
  });

  it("se lee en español", async () => {
    stubApi({ record: PENDING_RECORD });

    await renderScreen("es");

    expect(
      screen.getByRole("note", { name: /añadió el AUF/ }),
    ).toHaveTextContent(
      "Paula Player añadió el AUF AUF-1 (vence el 31 de marzo de 2027). Revísalo y verifícalo.",
    );
  });
});

describe("ficha en pantalla: los botones de contacto (#775)", () => {
  function header(): HTMLElement {
    return screen.getByRole("banner");
  }

  it("escribe, llama y llama al contacto de emergencia desde la cabecera", async () => {
    stubApi();

    await renderScreen();

    expect(
      within(header()).getByRole("link", { name: "Email Paula Player" }),
    ).toHaveAttribute("href", "mailto:paula@example.com");
    expect(
      within(header()).getByRole("link", { name: "Call Paula Player" }),
    ).toHaveAttribute("href", "tel:0412345678");
    expect(
      within(header()).getByRole("link", {
        name: "Call Paula Player's emergency contact",
      }),
    ).toHaveAttribute("href", "tel:0499111222");
  });

  it("desactiva la llamada de quien no tiene teléfono y dice que no hay", async () => {
    stubApi({ record: { ...RECORD, phone: null } });

    await renderScreen();

    expect(
      within(header()).getByRole("button", {
        name: "Call Paula Player (none)",
      }),
    ).toBeDisabled();
  });

  it("desactiva el contacto de emergencia de quien no lo tiene", async () => {
    stubApi({ record: { ...RECORD, emergencyContact: null } });

    await renderScreen();

    expect(
      within(header()).getByRole("button", {
        name: "Call Paula Player's emergency contact (none)",
      }),
    ).toBeDisabled();
  });

  it("dice en español que no hay", async () => {
    stubApi({ record: { ...RECORD, phone: null, emergencyContact: null } });

    await renderScreen("es");

    expect(
      within(header()).getByRole("link", { name: "Escribir a Paula Player" }),
    ).toBeInTheDocument();
    expect(
      within(header()).getByRole("button", {
        name: "Llamar a Paula Player (no hay)",
      }),
    ).toBeDisabled();
    expect(
      within(header()).getByRole("button", {
        name: "Llamar al contacto de emergencia de Paula Player (no hay)",
      }),
    ).toBeDisabled();
  });
});

describe("ficha en pantalla: el menú ⋯ del Admin (#775)", () => {
  const INCOMPLETE: MemberRecord = { ...RECORD, accountStatus: "incomplete" };

  function moreButton(name = "More actions"): HTMLElement {
    return within(screen.getByRole("banner")).getByRole("button", { name });
  }

  /** Las opciones del menú abierto, en orden, por su texto. */
  function menuItemTexts(): string[] {
    const menuId = moreButton().getAttribute("aria-controls");
    const menu = document.getElementById(String(menuId));
    if (menu === null) {
      throw new Error("El menú no está abierto");
    }
    return within(menu)
      .getAllByRole("button")
      .map((item) => item.textContent ?? "");
  }

  it("abre con Cambiar rol (con el rol actual), Eximir y, tras una línea, Desactivar", async () => {
    stubApi();
    await renderScreen();

    await userEvent.setup().click(moreButton());

    expect(moreButton()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", {
        name: "Change role",
        description: "Player",
      }),
    ).toBeInTheDocument();
    expect(menuItemTexts()).toEqual([
      "Change rolePlayer",
      "Waive membership fee",
      "Deactivate member",
    ]);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("ofrece reenviar la invitación sólo con la cuenta sin activar", async () => {
    stubApi({ record: INCOMPLETE });
    await renderScreen();

    await userEvent.setup().click(moreButton());

    expect(menuItemTexts()).toEqual([
      "Change rolePlayer",
      "Waive membership fee",
      "Resend invitation",
      "Deactivate member",
    ]);
  });

  it("ofrece retirar la exención a quien está exento", async () => {
    stubApi({
      record: {
        ...RECORD,
        membershipStatus: "waived",
        membershipWaiver: { reason: "Coach", until: null },
      },
    });
    await renderScreen();

    await userEvent.setup().click(moreButton());

    expect(
      screen.getByRole("button", { name: "Remove waiver" }),
    ).toBeInTheDocument();
  });

  it("con un socio desactivado, la última opción es Reactivar socio", async () => {
    stubApi({ record: { ...RECORD, accountStatus: "inactive" } });
    await renderScreen();

    await userEvent.setup().click(moreButton());

    expect(menuItemTexts().at(-1)).toBe("Reactivate member");
    expect(
      screen.queryByRole("button", { name: "Deactivate member" }),
    ).not.toBeInTheDocument();
  });

  it("se cierra con Escape y devuelve el foco a ⋯", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.click(moreButton());

    await user.keyboard("{Escape}");

    expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Deactivate member" }),
    ).not.toBeInTheDocument();
    expect(moreButton()).toHaveFocus();
  });

  it("se cierra con un clic fuera y devuelve el foco a ⋯", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.click(moreButton());

    await user.click(screen.getByRole("heading", { level: 1 }));

    expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    expect(moreButton()).toHaveFocus();
  });

  it("se cierra al elegir, devuelve el foco a ⋯ y abre el control del rol", async () => {
    stubApi();
    await renderScreen();

    await chooseAdminAction(userEvent.setup(), "Change role");

    expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    expect(moreButton()).toHaveFocus();
    expect(
      screen.getByRole("combobox", { name: "Role for Paula Player" }),
    ).toHaveValue("Player");
  });

  it("Eximir de la cuota abre su confirmación de hoy", async () => {
    stubApi();
    await renderScreen();

    await chooseAdminAction(userEvent.setup(), "Waive membership fee");

    expect(
      screen.getByRole("dialog", {
        name: "Waive Paula Player's membership fee",
      }),
    ).toBeInTheDocument();
  });

  it("Desactivar socio pide confirmación en una franja", async () => {
    stubApi();
    await renderScreen();

    await chooseAdminAction(userEvent.setup(), "Deactivate member");

    expect(
      screen.getByText(
        "Deactivate Paula Player? They won't be able to sign in. Their history stays and you can reactivate them later.",
      ),
    ).toBeVisible();
    expect(statusChanges).toEqual([]);
  });

  it("cancelar la franja no desactiva a nadie y la quita", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await chooseAdminAction(user, "Deactivate member");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(statusChanges).toEqual([]);
    expect(
      screen.queryByText(/Deactivate Paula Player\?/),
    ).not.toBeInTheDocument();
    expect(moreButton()).toHaveFocus();
  });

  it("pide la confirmación en español", async () => {
    stubApi();
    await renderScreen("es");

    await chooseAdminAction(
      userEvent.setup(),
      "Desactivar miembro",
      "Más acciones",
    );

    expect(
      screen.getByText(
        "¿Desactivar a Paula Player? No podrá entrar. Su historial se queda y puedes reactivarlo después.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeVisible();
  });

  it("nombra en español las opciones del menú", async () => {
    stubApi({ record: INCOMPLETE });
    await renderScreen("es");

    await userEvent.setup().click(moreButton("Más acciones"));

    expect(
      screen.getByRole("button", {
        name: "Cambiar rol",
        description: "Jugador",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Eximir de la cuota" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reenviar invitación" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Desactivar miembro" }),
    ).toBeInTheDocument();
  });

  it("los controles del Admin ya no salen sueltos fuera del menú", async () => {
    stubApi({ record: INCOMPLETE });

    await renderScreen();

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    for (const name of [
      "Waive membership fee",
      "Resend invitation",
      "Deactivate account",
      "Deactivate member",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    for (const name of [
      "Role",
      "Membership fee",
      "Account status",
      "Invitation",
    ]) {
      expect(
        screen.queryByRole("heading", { level: 2, name }),
      ).not.toBeInTheDocument();
    }
  });
});

describe("ficha en pantalla: sin la tarjeta Rol (#774)", () => {
  it("no ofrece al staff pedir un rol en la ficha de otro", async () => {
    stubApi();

    await renderScreen();

    expect(
      screen.queryByRole("region", { name: /^Role · / }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request" }),
    ).not.toBeInTheDocument();
  });
});

describe("ficha en pantalla: en lectura para Committee y Coach (#776)", () => {
  const COMMITTEE_RECORD: CommitteeMemberRecord = {
    view: "committee",
    userId: RECORD.userId,
    fullName: RECORD.fullName,
    photoUrl: RECORD.photoUrl,
    role: RECORD.role,
    positionName: RECORD.positionName,
    experienceLevel: RECORD.experienceLevel,
    country: RECORD.country,
    emergencyContact: RECORD.emergencyContact,
    membershipPlan: RECORD.membershipPlan,
    membershipStatus: RECORD.membershipStatus,
    membershipRenewsOn: RECORD.membershipRenewsOn,
    groups: RECORD.groups,
    attendance: RECORD.attendance,
    email: RECORD.email,
    phone: RECORD.phone,
  };
  const COACH_RECORD: CoachMemberRecord = {
    view: "coach",
    userId: RECORD.userId,
    fullName: RECORD.fullName,
    photoUrl: RECORD.photoUrl,
    role: RECORD.role,
    positionName: RECORD.positionName,
    experienceLevel: RECORD.experienceLevel,
    country: RECORD.country,
    emergencyContact: RECORD.emergencyContact,
    membershipPlan: RECORD.membershipPlan,
    membershipStatus: RECORD.membershipStatus,
    membershipRenewsOn: RECORD.membershipRenewsOn,
    groups: RECORD.groups,
    attendance: RECORD.attendance,
  };
  const EMERGENCY_CALL = "Call Paula Player's emergency contact";

  function stubReading(reading: MemberRecordReading): void {
    stubApi({ load: () => jsonResponse(200, { data: reading }) });
  }

  function header(): HTMLElement {
    return screen.getByRole("banner");
  }

  describe("Committee", () => {
    it("pinta la cabecera sin ficha AUF, con su rol, sus datos y la membresía", async () => {
      stubReading(COMMITTEE_RECORD);

      await renderScreen();

      expect(within(header()).getByText("Player")).toBeInTheDocument();
      expect(
        within(header()).getByText("Goalkeeper · Intermediate · Australia"),
      ).toBeInTheDocument();
      expect(
        within(header()).getByText("Membership active"),
      ).toBeInTheDocument();
      expect(within(header()).queryByText(/AUF/)).not.toBeInTheDocument();
    });

    it("lleva los botones de correo, llamada y emergencia", async () => {
      stubReading(COMMITTEE_RECORD);

      await renderScreen();

      expect(
        within(header()).getByRole("link", { name: "Email Paula Player" }),
      ).toHaveAttribute("href", "mailto:paula@example.com");
      expect(
        within(header()).getByRole("link", { name: "Call Paula Player" }),
      ).toHaveAttribute("href", "tel:0412345678");
      expect(
        within(header()).getByRole("link", { name: EMERGENCY_CALL }),
      ).toHaveAttribute("href", "tel:0499111222");
    });

    it("pinta Sobre mí, Contacto, Membresía, Asistencia y Grupos", async () => {
      stubReading(COMMITTEE_RECORD);

      await renderScreen();

      const about = screen.getByRole("region", { name: "About" });
      expect(readValueOf(about, "Position")).toBe("Goalkeeper");
      const contact = contactCard();
      expect(within(contact).getByText("0412 345 678")).toBeInTheDocument();
      expect(
        within(contact).getByText("paula@example.com"),
      ).toBeInTheDocument();
      expect(
        within(contact).getByText("Rosa Player · Mother"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Membership" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Attendance" }),
      ).toBeInTheDocument();
      const groups = screen.getByRole("region", { name: "Groups" });
      expect(within(groups).getByText("Senior Squad")).toBeVisible();
    });

    it("no pinta Registro AUF, Ficha del club, Evaluación, Rol ni el ⋯", async () => {
      stubReading(COMMITTEE_RECORD);

      await renderScreen();

      expect(
        screen.queryByRole("region", { name: "AUF registration" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Club record" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Evaluation" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: /^Role/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "More actions" }),
      ).not.toBeInTheDocument();
    });

    it("no lleva ningún Editar, ni el género", async () => {
      stubReading(COMMITTEE_RECORD);

      await renderScreen();

      expect(
        screen.queryByRole("button", { name: /^Edit/ }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByText("Gender")).not.toBeInTheDocument();
    });

    it("no pinta la franja del AUF pendiente ni pide la evaluación", async () => {
      stubReading(COMMITTEE_RECORD);

      await renderScreen();

      expect(screen.queryByRole("note")).not.toBeInTheDocument();
      const requested = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
      expect(requested).not.toContain(EVALUATION_PATH);
    });

    it("se lee en español", async () => {
      stubReading(COMMITTEE_RECORD);

      await renderScreen("es");

      expect(
        screen.getByRole("region", { name: "Sobre mí" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Grupos" }),
      ).toBeInTheDocument();
      expect(
        within(header()).getByRole("link", { name: "Escribir a Paula Player" }),
      ).toBeInTheDocument();
    });
  });

  describe("Coach", () => {
    it("ve lo mismo que el Committee, sin el ⋯ ni ningún Editar", async () => {
      stubReading(COACH_RECORD);

      await renderScreen();

      expect(screen.getByRole("region", { name: "About" })).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Membership" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Attendance" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Groups" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "AUF registration" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Evaluation" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^Edit|More actions/ }),
      ).not.toBeInTheDocument();
    });

    it("no pinta el correo ni el teléfono en Contacto, pero sí el contacto de emergencia (D3)", async () => {
      stubReading(COACH_RECORD);

      await renderScreen();

      const contact = contactCard();
      expect(within(contact).queryByText("0412 345 678")).toBeNull();
      expect(within(contact).queryByText("paula@example.com")).toBeNull();
      expect(within(contact).queryByText("Phone")).toBeNull();
      expect(
        within(contact).getByText("Rosa Player · Mother"),
      ).toBeInTheDocument();
      expect(within(contact).getByText("0499 111 222")).toBeInTheDocument();
    });

    it("sólo lleva el botón del contacto de emergencia en la cabecera", async () => {
      stubReading(COACH_RECORD);

      await renderScreen();

      expect(
        within(header()).queryByRole("link", { name: "Email Paula Player" }),
      ).not.toBeInTheDocument();
      expect(
        within(header()).queryByRole("link", { name: "Call Paula Player" }),
      ).not.toBeInTheDocument();
      expect(
        within(header()).getByRole("link", { name: EMERGENCY_CALL }),
      ).toHaveAttribute("href", "tel:0499111222");
    });

    it("dice que el socio no tiene contacto de emergencia", async () => {
      stubReading({ ...COACH_RECORD, emergencyContact: null });

      await renderScreen();

      expect(
        within(contactCard()).getByText("Not added yet"),
      ).toBeInTheDocument();
      expect(
        within(header()).getByRole("button", {
          name: `${EMERGENCY_CALL} (none)`,
        }),
      ).toBeDisabled();
    });
  });

  it("pinta la ficha aunque no pueda leer los grupos del club: no los edita", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === RECORD_PATH
          ? jsonResponse(200, { data: COMMITTEE_RECORD })
          : errorResponse(403, "forbidden"),
      ),
    );

    await renderScreen();

    expect(screen.getByRole("region", { name: "Groups" })).toBeInTheDocument();
  });
});

/* La ficha en el móvil (#777, RF-7 y D14 del PRD de E30): la barra de
   arriba con Volver, "Socio" y, para el Admin, el ⋯, que sube una hoja
   inferior con las mismas opciones que el desplegable de escritorio. El
   ancho lo dice `matchMedia`, que aquí se simula; las medidas, el asa y el
   fondo atenuado los mira Playwright. */
describe("ficha en pantalla: en el móvil (#777)", () => {
  const PHONE_QUERY = "(width < 768px)";

  function emulatePhone(): void {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
  }

  function phoneBar(name = "Member"): HTMLElement {
    return screen.getByRole("navigation", { name });
  }

  function barMoreButton(name = "More actions"): HTMLElement {
    return within(phoneBar()).getByRole("button", { name });
  }

  function adminSheet(): HTMLElement {
    return screen.getByRole("dialog", { name: "More actions" });
  }

  beforeEach(() => {
    emulatePhone();
  });

  it("lleva arriba Volver al directorio, el título Socio y el ⋯ del Admin", async () => {
    stubApi();
    await renderScreen();

    const bar = phoneBar();
    expect(within(bar).getByText("Member")).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/directorio",
    );
    expect(barMoreButton()).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).queryByRole("button", {
        name: "More actions",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Directory" }),
    ).not.toBeInTheDocument();
  });

  it("la cabecera dice rol · posición · experiencia", async () => {
    stubApi();
    await renderScreen();

    expect(
      within(screen.getByRole("banner")).getByText(
        "Player · Goalkeeper · Intermediate",
      ),
    ).toBeInTheDocument();
  });

  it("el ⋯ sube una hoja con las opciones de escritorio y Desactivar tras una línea", async () => {
    stubApi({ record: { ...RECORD, accountStatus: "incomplete" } });
    await renderScreen();

    await userEvent.setup().click(barMoreButton());

    const sheet = adminSheet();
    expect(barMoreButton()).toHaveAttribute("aria-expanded", "true");
    expect(
      within(sheet).getByRole("button", {
        name: "Change role",
        description: "Player",
      }),
    ).toBeInTheDocument();
    expect(
      within(sheet)
        .getAllByRole("button")
        .map((item) => item.textContent)
        // El asa no lleva texto: se nombra con su etiqueta.
        .filter((text) => text !== ""),
    ).toEqual([
      "Change rolePlayer",
      "Waive membership fee",
      "Resend invitation",
      "Deactivate member",
    ]);
    expect(within(sheet).getByRole("separator")).toBeInTheDocument();
  });

  it("al abrirse, el foco queda dentro de la hoja", async () => {
    stubApi();
    await renderScreen();

    await userEvent.setup().click(barMoreButton());

    expect(adminSheet()).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it("se cierra con su asa y devuelve el foco al ⋯", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.click(barMoreButton());

    await user.click(
      within(adminSheet()).getByRole("button", { name: "Close actions" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(barMoreButton()).toHaveAttribute("aria-expanded", "false");
    expect(barMoreButton()).toHaveFocus();
  });

  it("se cierra con Escape y devuelve el foco al ⋯", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.click(barMoreButton());

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(barMoreButton()).toHaveFocus();
  });

  it("elegir Eximir cierra la hoja y abre su confirmación", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.click(barMoreButton());

    await user.click(
      within(adminSheet()).getByRole("button", {
        name: "Waive membership fee",
      }),
    );

    expect(
      screen.queryByRole("dialog", { name: "More actions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", {
        name: "Waive Paula Player's membership fee",
      }),
    ).toBeInTheDocument();
  });

  it("elegir Desactivar pide la confirmación y cancelarla devuelve el foco al ⋯", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.click(barMoreButton());
    await user.click(
      within(adminSheet()).getByRole("button", { name: "Deactivate member" }),
    );
    expect(screen.getByText(/Deactivate Paula Player\?/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(statusChanges).toEqual([]);
    expect(barMoreButton()).toHaveFocus();
  });

  it("el Coach lee la barra sin ⋯", async () => {
    stubApi({
      load: () =>
        jsonResponse(200, {
          data: {
            view: "coach",
            userId: RECORD.userId,
            fullName: RECORD.fullName,
            photoUrl: null,
            role: RECORD.role,
            positionName: RECORD.positionName,
            experienceLevel: RECORD.experienceLevel,
            country: RECORD.country,
            emergencyContact: RECORD.emergencyContact,
            membershipPlan: RECORD.membershipPlan,
            membershipStatus: RECORD.membershipStatus,
            membershipRenewsOn: RECORD.membershipRenewsOn,
            groups: RECORD.groups,
            attendance: RECORD.attendance,
          } satisfies CoachMemberRecord,
        }),
    });
    await renderScreen();

    expect(
      within(phoneBar()).getByRole("link", { name: "Back" }),
    ).toBeInTheDocument();
    expect(
      within(phoneBar()).queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
  });

  it("mientras carga ya lleva la barra con Volver", () => {
    stubApi({ load: () => new Promise<Response>(() => {}) });
    render(<MemberRecordScreen locale="en" userId={MEMBER_ID} />);

    expect(
      within(phoneBar()).getByRole("link", { name: "Back" }),
    ).toBeInTheDocument();
  });

  it("se lee en español", async () => {
    stubApi();
    await renderScreen("es");

    const bar = screen.getByRole("navigation", { name: "Miembro" });
    expect(within(bar).getByRole("link", { name: "Volver" })).toBeVisible();
    expect(
      within(bar).getByRole("button", { name: "Más acciones" }),
    ).toBeVisible();
  });
});
