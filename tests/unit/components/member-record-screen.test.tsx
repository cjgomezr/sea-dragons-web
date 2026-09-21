import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRecordScreen } from "@/components/directory/MemberRecordScreen";
import type { Group } from "@/lib/groups/groups";
import type { MemberRecord } from "@/lib/members/member-record";

/**
 * La ficha reservada al Admin en pantalla (#242, RF-4 del PRD de E5): carga la
 * ficha y los grupos del club por la API v1, guarda todo en una sola
 * petición y enseña lo que el servidor respondió.
 */

const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000001";
const MASTERS_ID = "9a9a9a9a-0000-4000-8000-000000000002";
const RECORD_PATH = `/api/v1/members/${MEMBER_ID}/record`;
const GROUPS_PATH = "/api/v1/groups";

const RECORD: MemberRecord = {
  userId: MEMBER_ID,
  fullName: "Paula Player",
  joinedOn: "2024-03-06",
  aufNumber: "AUF-1",
  aufExpiry: "2027-03-31",
  isAufExpired: false,
  groups: [{ id: SENIOR_ID, name: "Senior Squad" }],
};

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

/** Lo que el servidor respondería al guardar: la ficha con lo pedido. */
function savedRecord(body: unknown): MemberRecord {
  const { aufNumber, aufExpiry, groupIds } = body as {
    aufNumber: string | null;
    aufExpiry: string | null;
    groupIds: string[];
  };
  return {
    ...RECORD,
    aufNumber,
    aufExpiry: aufNumber === null ? null : aufExpiry,
    groups: CLUB_GROUPS.filter((group) => groupIds.includes(group.id)).map(
      ({ id, name }) => ({ id, name }),
    ),
  };
}

function stubApi(stub: Stub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === GROUPS_PATH) {
        return jsonResponse(200, { data: { groups: CLUB_GROUPS } });
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
      "A former member can't be added to groups.",
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
