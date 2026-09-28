import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendanceScreen } from "@/components/attendance/AttendanceScreen";
import { SidebarNav } from "@/components/SidebarNav";
import type {
  AttendanceSheet,
  AttendanceSheetEntry,
} from "@/lib/attendance/attendance-sheet";
import type { AttendanceSession } from "@/lib/attendance/attendance-sessions";
import { ROLES } from "@/lib/auth/roles";

/**
 * La pantalla de Asistencia (#395, RF-8 del PRD de E8). Quién sale en la
 * hoja, en qué orden y qué se puede guardar lo decide el servidor (#393): lo
 * que se prueba aquí es que la pantalla pinta lo que responde la API, cuenta
 * en vivo lo que se marca y no da por guardado lo que no se guardó.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/asistencia" }));

const SESSIONS_PATH = "/api/v1/attendance/sessions";

const POOL_TRAINING: AttendanceSession = {
  eventId: "aaaaaaaa-0000-4000-8000-00000000000a",
  title: "Pool Training",
  // Martes 23 de junio, 19:00 en Melbourne.
  startsAt: "2026-06-23T09:00:00.000Z",
  hasSheet: false,
  totals: { present: 0, late: 0, absent: 0 },
};

const SKILLS: AttendanceSession = {
  eventId: "bbbbbbbb-0000-4000-8000-00000000000b",
  title: "Skills & Conditioning",
  startsAt: "2026-06-18T09:00:00.000Z",
  hasSheet: true,
  totals: { present: 2, late: 0, absent: 0 },
};

const OLD_TRAINING_ID = "cccccccc-0000-4000-8000-00000000000c";

const FORWARD = {
  id: "f0f0f0f0-0000-4000-8000-00000000000f",
  names: { en: "Forward", es: "Ataque" },
};

function member(
  userId: string,
  fullName: string,
  changes: Partial<AttendanceSheetEntry> = {},
): AttendanceSheetEntry {
  return {
    userId,
    fullName,
    photoUrl: null,
    position: null,
    status: "present",
    rsvpResponse: null,
    isInactive: false,
    ...changes,
  };
}

const MATEO = member("11111111-0000-4000-8000-000000000001", "Mateo Restrepo", {
  position: FORWARD,
  rsvpResponse: "yes",
});
const VALENTINA = member(
  "22222222-0000-4000-8000-000000000002",
  "Valentina Gómez",
  { rsvpResponse: "maybe" },
);
const RUBY = member("33333333-0000-4000-8000-000000000003", "Ruby Tan", {
  status: "absent",
});

function sheetFor(
  session: { readonly eventId: string; readonly title: string },
  members: readonly AttendanceSheetEntry[],
  startsAt = POOL_TRAINING.startsAt,
): AttendanceSheet {
  return {
    eventId: session.eventId,
    title: session.title,
    startsAt,
    isSaved: false,
    members,
  };
}

const POOL_SHEET = sheetFor(POOL_TRAINING, [MATEO, VALENTINA, RUBY]);
const SKILLS_SHEET = sheetFor(SKILLS, [VALENTINA], SKILLS.startsAt);

type Respond = (request: {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}) => Response | Promise<Response>;

type RecordedRequest = {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
};

const requests: RecordedRequest[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sheetPath(eventId: string): string {
  return `/api/v1/attendance/${eventId}`;
}

function stubApi(respond: Respond): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      requests.push({ method, path: url.pathname, body });
      return respond({ method, path: url.pathname, body });
    }),
  );
}

function savedResponse(eventId: string, body: unknown): Response {
  const records = (
    body as { records: { status: "present" | "late" | "absent" }[] }
  ).records;
  const count = (status: string) =>
    records.filter((record) => record.status === status).length;
  return jsonResponse(200, {
    data: {
      eventId,
      totals: {
        present: count("present"),
        late: count("late"),
        absent: count("absent"),
      },
    },
  });
}

/** Las sesiones y sus hojas, y guardar responde con los totales de lo que
 * llega. */
function stubClub(
  sessions: readonly AttendanceSession[],
  sheets: readonly AttendanceSheet[],
): void {
  stubApi(({ method, path, body }) => {
    if (path === SESSIONS_PATH) {
      return jsonResponse(200, { data: { sessions } });
    }
    const sheet = sheets.find(
      (candidate) => sheetPath(candidate.eventId) === path,
    );
    if (sheet === undefined) {
      throw new Error(`Petición inesperada: ${method} ${path}`);
    }
    return method === "PUT"
      ? savedResponse(sheet.eventId, body)
      : jsonResponse(200, { data: sheet });
  });
}

function saveRequests(): RecordedRequest[] {
  return requests.filter((request) => request.method === "PUT");
}

async function findRow(name: string): Promise<HTMLElement> {
  const row = (await screen.findByText(name)).closest("li");
  if (row === null) {
    throw new Error(`La fila de ${name} no es un elemento de la lista.`);
  }
  return row;
}

function choice(row: HTMLElement, name: string): HTMLElement {
  return within(row).getByRole("button", { name });
}

function totals(): HTMLElement {
  return screen.getByRole("list", { name: "Totals" });
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Save attendance/ });
}

function sessionChip(name: string): HTMLElement {
  return within(screen.getByRole("group", { name: "Sessions" })).getByRole(
    "button",
    { name },
  );
}

afterEach(() => {
  requests.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la hoja", () => {
  it("abre la sesión más reciente con su título y su fecha", async () => {
    stubClub([POOL_TRAINING, SKILLS], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Pool Training · Tue 23 Jun",
      }),
    ).toBeInTheDocument();
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ["GET", SESSIONS_PATH],
      ["GET", sheetPath(POOL_TRAINING.eventId)],
    ]);
  });

  it("pone una ficha por sesión reciente, con la abierta marcada", async () => {
    stubClub([POOL_TRAINING, SKILLS], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(sessionChip("Tue 23 · Pool Training")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(sessionChip("Thu 18 · Skills & Conditioning")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("pinta cada miembro en el orden del servidor, con iniciales, posición y la pista del RSVP", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    const list = await screen.findByRole("list", { name: "Members" });
    const rows = within(list).getAllByRole("listitem");
    expect(
      rows.map((row) =>
        within(row).getByRole("group").getAttribute("aria-label"),
      ),
    ).toEqual([MATEO.fullName, VALENTINA.fullName, RUBY.fullName]);
    const mateo = await findRow(MATEO.fullName);
    expect(within(mateo).getByText("MR")).toBeInTheDocument();
    expect(within(mateo).getByText("Forward")).toBeInTheDocument();
    expect(within(mateo).getByText("RSVP: Yes")).toBeInTheDocument();
    expect(
      within(await findRow(VALENTINA.fullName)).getByText("RSVP: Maybe"),
    ).toBeInTheDocument();
    expect(
      within(await findRow(RUBY.fullName)).getByText("No RSVP"),
    ).toBeInTheDocument();
  });

  it("marca con aria-pressed el estado de cada fila", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    const ruby = await findRow(RUBY.fullName);
    expect(choice(ruby, "Absent")).toHaveAttribute("aria-pressed", "true");
    expect(choice(ruby, "Present")).toHaveAttribute("aria-pressed", "false");
    expect(choice(ruby, "Late")).toHaveAttribute("aria-pressed", "false");
  });

  it("cuenta los tres estados de la hoja abierta", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(
      within(totals())
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["2Present", "0Late", "1Absent"]);
    expect(totals()).toHaveAttribute("aria-live", "polite");
  });

  it("al tocar un estado cambia los contadores al momento, sin guardar, y el botón avisa", async () => {
    stubClub([POOL_TRAINING], [{ ...POOL_SHEET, isSaved: true }]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    expect(saveButton()).toHaveAccessibleName("Save attendance");

    await userEvent.click(choice(mateo, "Late"));

    expect(choice(mateo, "Late")).toHaveAttribute("aria-pressed", "true");
    expect(choice(mateo, "Present")).toHaveAttribute("aria-pressed", "false");
    expect(
      within(totals())
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["1Present", "1Late", "1Absent"]);
    expect(saveRequests()).toEqual([]);
    expect(saveButton()).toHaveAccessibleName(
      "Save attendance · Unsaved changes",
    );
  });

  it("guarda la hoja entera y confirma con los totales guardados", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await userEvent.click(choice(await findRow(VALENTINA.fullName), "Late"));

    await userEvent.click(saveButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Attendance saved: 1 present, 1 late, 1 absent.",
    );
    expect(saveRequests()).toEqual([
      {
        method: "PUT",
        path: sheetPath(POOL_TRAINING.eventId),
        body: {
          records: [
            { userId: MATEO.userId, status: "present" },
            { userId: VALENTINA.userId, status: "late" },
            { userId: RUBY.userId, status: "absent" },
          ],
        },
      },
    ]);
    expect(saveButton()).toHaveAccessibleName("Save attendance");
  });

  it("un doble toque en guardar manda una sola petición", async () => {
    let finishSave: () => void = () => undefined;
    stubApi(({ method, path, body }) => {
      if (path === SESSIONS_PATH) {
        return jsonResponse(200, { data: { sessions: [POOL_TRAINING] } });
      }
      if (method === "PUT") {
        return new Promise<Response>((resolve) => {
          finishSave = () =>
            resolve(savedResponse(POOL_TRAINING.eventId, body));
        });
      }
      return jsonResponse(200, { data: POOL_SHEET });
    });
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await userEvent.click(choice(await findRow(MATEO.fullName), "Absent"));

    await userEvent.dblClick(saveButton());
    finishSave();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Attendance saved",
    );
    expect(saveRequests()).toHaveLength(1);
  });

  it("si la red falla lo dice, no da nada por guardado y conserva lo marcado", async () => {
    stubApi(({ method, path }) => {
      if (method === "PUT") {
        throw new TypeError("Failed to fetch");
      }
      return path === SESSIONS_PATH
        ? jsonResponse(200, { data: { sessions: [POOL_TRAINING] } })
        : jsonResponse(200, { data: POOL_SHEET });
    });
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(choice(mateo, "Late")).toHaveAttribute("aria-pressed", "true");
    expect(saveButton()).toHaveAccessibleName(
      "Save attendance · Unsaved changes",
    );
  });

  it("traduce el 422 de una sesión cancelada entretanto", async () => {
    stubApi(({ method, path }) => {
      if (method === "PUT") {
        return jsonResponse(422, {
          error: {
            code: "business_rule",
            message: "El entrenamiento está cancelado.",
            reason: "attendance_session_cancelled",
          },
        });
      }
      return path === SESSIONS_PATH
        ? jsonResponse(200, { data: { sessions: [POOL_TRAINING] } })
        : jsonResponse(200, { data: POOL_SHEET });
    });
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await findRow(MATEO.fullName);

    await userEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This training was cancelled: it doesn't take attendance.",
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("cambia de sesión sin preguntar cuando no hay cambios", async () => {
    stubClub([POOL_TRAINING, SKILLS], [POOL_SHEET, SKILLS_SHEET]);
    const confirm = vi.spyOn(window, "confirm");
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await findRow(MATEO.fullName);

    await userEvent.click(sessionChip("Thu 18 · Skills & Conditioning"));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Skills & Conditioning · Thu 18 Jun",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(MATEO.fullName)).not.toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("con cambios sin guardar pregunta antes de cambiar de sesión, y se queda si no se acepta", async () => {
    stubClub([POOL_TRAINING, SKILLS], [POOL_SHEET, SKILLS_SHEET]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(sessionChip("Thu 18 · Skills & Conditioning"));

    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved changes on this session. Discard them?",
    );
    expect(choice(mateo, "Late")).toHaveAttribute("aria-pressed", "true");
    expect(requests.map((request) => request.path)).not.toContain(
      sheetPath(SKILLS.eventId),
    );
  });

  it("con cambios sin guardar cambia de sesión si se acepta descartarlos", async () => {
    stubClub([POOL_TRAINING, SKILLS], [POOL_SHEET, SKILLS_SHEET]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await userEvent.click(choice(await findRow(MATEO.fullName), "Late"));

    await userEvent.click(sessionChip("Thu 18 · Skills & Conditioning"));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Skills & Conditioning · Thu 18 Jun",
      }),
    ).toBeInTheDocument();
  });

  it("dice que la sesión no tiene a nadie y no deja guardar", async () => {
    stubClub([POOL_TRAINING], [sheetFor(POOL_TRAINING, [])]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    expect(
      await screen.findByText("Nobody is expected at this session."),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("dice que no hay entrenamientos recientes y enlaza al calendario", async () => {
    stubClub([], []);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    expect(
      await screen.findByText("No training has started in the last 30 days."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the calendar" }),
    ).toHaveAttribute("href", "/calendario");
    expect(
      screen.queryByRole("button", { name: /^Save attendance/ }),
    ).not.toBeInTheDocument();
  });

  it("con ?sesion= abre esa hoja aunque no esté entre las fichas", async () => {
    const oldSheet = sheetFor(
      { eventId: OLD_TRAINING_ID, title: "Early Season Training" },
      [MATEO],
      "2026-04-14T09:00:00.000Z",
    );
    stubClub([POOL_TRAINING], [POOL_SHEET, oldSheet]);

    render(<AttendanceScreen locale="en" initialSessionId={OLD_TRAINING_ID} />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Early Season Training · Tue 14 Apr",
      }),
    ).toBeInTheDocument();
    expect(sessionChip("Tue 23 · Pool Training")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(requests.map((request) => request.path)).not.toContain(
      sheetPath(POOL_TRAINING.eventId),
    );
  });

  it("si la hoja no se puede abrir lo dice y deja reintentar", async () => {
    let attempts = 0;
    stubApi(({ path }) => {
      if (path === SESSIONS_PATH) {
        return jsonResponse(200, { data: { sessions: [POOL_TRAINING] } });
      }
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, { data: POOL_SHEET });
    });
    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await findRow(MATEO.fullName)).toBeInTheDocument();
  });

  it("escribe la hoja en español", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="es" initialSessionId={null} />);

    const mateo = await findRow(MATEO.fullName);
    expect(within(mateo).getByText("Ataque")).toBeInTheDocument();
    expect(within(mateo).getByText("RSVP: Sí")).toBeInTheDocument();
    expect(choice(mateo, "Presente")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /^Guardar asistencia/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /^Pool Training · / }),
    ).toBeInTheDocument();
  });

  it("marca a quien tiene la cuenta desactivada", async () => {
    stubClub(
      [POOL_TRAINING],
      [sheetFor(POOL_TRAINING, [{ ...RUBY, isInactive: true }])],
    );

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    expect(
      within(await findRow(RUBY.fullName)).getByText("Deactivated"),
    ).toBeInTheDocument();
  });
});

describe("permisos", () => {
  it.each(ROLES)("el menú de un %s", (role) => {
    render(<SidebarNav locale="en" role={role} />);

    const link = screen.queryByRole("link", { name: "Attendance" });
    if (role === "Admin" || role === "Coach") {
      expect(link).toHaveAttribute("href", "/asistencia");
    } else {
      expect(link).not.toBeInTheDocument();
    }
  });
});

describe("guardar tras reintentar", () => {
  it("tras un fallo, un segundo intento guarda y confirma", async () => {
    let attempts = 0;
    stubApi(({ method, path, body }) => {
      if (path === SESSIONS_PATH) {
        return jsonResponse(200, { data: { sessions: [POOL_TRAINING] } });
      }
      if (method === "PUT") {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return savedResponse(POOL_TRAINING.eventId, body);
      }
      return jsonResponse(200, { data: POOL_SHEET });
    });
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await findRow(MATEO.fullName);
    await userEvent.click(saveButton());
    await screen.findByRole("alert");

    await userEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Attendance saved: 2 present, 0 late, 1 absent.",
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
