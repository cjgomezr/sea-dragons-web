import { render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceScreen } from "@/components/attendance/AttendanceScreen";
import { SidebarNav } from "@/components/SidebarNav";
import type {
  AttendanceSheet,
  AttendanceSheetEntry,
} from "@/lib/attendance/attendance-sheet";
import type { AttendanceSession } from "@/lib/attendance/attendance-sessions";
import { ROLES } from "@/lib/auth/roles";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * La pantalla de Asistencia (#395, RF-8 del PRD de E8). Quién sale en la
 * hoja, en qué orden y qué se puede guardar lo decide el servidor (#393): lo
 * que se prueba aquí es que la pantalla pinta lo que responde la API, cuenta
 * en vivo lo que se marca y no da por guardado lo que no se guardó.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/asistencia" }));

const navigate = vi.fn();

/** Como el `Link` de Next: un `onClick` que cancela el clic cancela también
 * la navegación. Aquí la navegación sólo queda anotada. */
vi.mock("next/link", () => ({
  default: ({
    href,
    onClick,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          navigate(href);
        }
        event.preventDefault();
      }}
    />
  ),
}));

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
const NOAH = member("44444444-0000-4000-8000-000000000004", "Noah Williams", {
  status: "absent",
  rsvpResponse: "no",
});
const CHLOE = member("55555555-0000-4000-8000-000000000005", "Chloe Nguyen", {
  rsvpResponse: "yes",
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
    viewer: "coach",
    members,
  };
}

const POOL_SHEET = sheetFor(POOL_TRAINING, [MATEO, VALENTINA, RUBY]);
const ADMIN_POOL_SHEET: AttendanceSheet = { ...POOL_SHEET, viewer: "admin" };

const THUMBNAIL_URL = `https://storage.test/member-photos/${MATEO.userId}/thumb.webp?token=t`;
const LARGE_URL = `https://storage.test/member-photos/${MATEO.userId}/large.webp?token=l`;
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
    if (path === `/api/v1/directory/${MATEO.userId}/photo`) {
      return jsonResponse(200, { data: { photoUrl: LARGE_URL } });
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

/** Cada grupo de la hoja, por su cabecera, con los nombres de sus filas. */
function groupedRows(): [string, (string | null)[]][] {
  return screen.getAllByRole("heading", { level: 2 }).map((heading) => {
    const name = String(heading.textContent);
    const region = screen.getByRole("region", { name });
    const rows = within(within(region).getByRole("list", { name }))
      .getAllByRole("listitem")
      .map((row) => within(row).getByRole("group").getAttribute("aria-label"));
    return [name, rows];
  });
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

function recordLink(name: string): HTMLElement {
  return screen.getByRole("link", { name: `Open ${name}'s record` });
}

beforeEach(() => {
  stubScreenWidth(false);
});

afterEach(() => {
  navigate.mockReset();
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

  it("pinta cada miembro con iniciales y posición, sin la pista del RSVP", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    const mateo = await findRow(MATEO.fullName);
    expect(within(mateo).getByText("MR")).toBeInTheDocument();
    expect(within(mateo).getByText("Forward")).toBeInTheDocument();
    expect(within(mateo).queryByText(/RSVP/)).not.toBeInTheDocument();
  });

  it("agrupa las filas en Going, Maybe, No reply y Can't go, cada grupo una región con sus filas", async () => {
    stubClub(
      [POOL_TRAINING],
      [sheetFor(POOL_TRAINING, [MATEO, CHLOE, VALENTINA, RUBY, NOAH])],
    );

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(groupedRows()).toEqual([
      ["Going", [MATEO.fullName, CHLOE.fullName]],
      ["Maybe", [VALENTINA.fullName]],
      ["No reply", [RUBY.fullName]],
      ["Can't go", [NOAH.fullName]],
    ]);
  });

  it("no pinta el grupo de quien dijo que no cuando nadie lo dijo", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(groupedRows().map(([name]) => name)).toEqual([
      "Going",
      "Maybe",
      "No reply",
    ]);
    expect(
      screen.queryByRole("heading", { name: "Can't go" }),
    ).not.toBeInTheDocument();
  });

  it("con todos en un solo grupo deja esa única cabecera", async () => {
    stubClub([POOL_TRAINING], [sheetFor(POOL_TRAINING, [RUBY])]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(RUBY.fullName);
    expect(groupedRows()).toEqual([["No reply", [RUBY.fullName]]]);
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
    expect(saveButton()).toHaveAccessibleName("Save attendance 1 unsaved");
  });

  it("guarda la hoja entera y confirma con los totales guardados", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await userEvent.click(choice(await findRow(VALENTINA.fullName), "Late"));

    await userEvent.click(saveButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved · 1 present, 1 late, 1 absent",
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

    expect(await screen.findByRole("status")).toHaveTextContent("Saved · ");
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
    expect(saveButton()).toHaveAccessibleName("Save attendance 1 unsaved");
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

  it("ofrece un enlace a las sesiones anteriores que lleva al calendario", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    const sessions = await screen.findByRole("group", { name: "Sessions" });
    const older = within(sessions).getByRole("link", {
      name: /^Older sessions/,
    });
    expect(older).toHaveTextContent("Older sessions");
    expect(older).toHaveAttribute("href", "/calendario");
  });

  it("el enlace nombra adónde lleva", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    expect(
      await screen.findByRole("link", {
        name: "Older sessions: open the calendar",
      }),
    ).toBeInTheDocument();
  });

  it("sin sesiones recientes muestra un solo enlace al calendario", async () => {
    stubClub([], []);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await screen.findByText("No training has started in the last 30 days.");
    const toCalendar = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/calendario");
    expect(toCalendar).toHaveLength(1);
    expect(
      screen.queryByRole("link", { name: /^Older sessions/ }),
    ).not.toBeInTheDocument();
  });

  it("en español el enlace dice Sesiones anteriores", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="es" initialSessionId={null} />);

    const older = await screen.findByRole("link", {
      name: "Sesiones anteriores: abrir el calendario",
    });
    expect(older).toHaveTextContent("Sesiones anteriores");
  });

  it("con cambios sin guardar el enlace a las sesiones anteriores pregunta y, si no se acepta, se queda", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(
      screen.getByRole("link", { name: /^Older sessions/ }),
    );

    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved changes on this session. Discard them?",
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(choice(mateo, "Late")).toHaveAttribute("aria-pressed", "true");
  });

  it("con cambios sin guardar el enlace a las sesiones anteriores navega si se acepta descartarlos", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await userEvent.click(choice(await findRow(MATEO.fullName), "Late"));

    await userEvent.click(
      screen.getByRole("link", { name: /^Older sessions/ }),
    );

    expect(navigate).toHaveBeenCalledWith("/calendario");
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

  it("escribe las cabeceras de los grupos en español", async () => {
    stubClub(
      [POOL_TRAINING],
      [sheetFor(POOL_TRAINING, [MATEO, VALENTINA, RUBY, NOAH])],
    );

    render(<AttendanceScreen locale="es" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(groupedRows().map(([name]) => name)).toEqual([
      "Van",
      "Quizás",
      "Sin respuesta",
      "No van",
    ]);
  });

  it("escribe la hoja en español", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="es" initialSessionId={null} />);

    const mateo = await findRow(MATEO.fullName);
    expect(within(mateo).getByText("Ataque")).toBeInTheDocument();
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

describe("la fila como en el directorio (#414)", () => {
  it("a un Admin el nombre le abre la ficha del socio", async () => {
    stubClub([POOL_TRAINING], [ADMIN_POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(recordLink(MATEO.fullName)).toHaveAttribute(
      "href",
      `/directorio/${MATEO.userId}`,
    );
    expect(recordLink(MATEO.fullName)).toHaveTextContent(MATEO.fullName);
  });

  it("a un Coach el nombre es texto, sin enlace", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    const mateo = await findRow(MATEO.fullName);
    expect(within(mateo).getByText(MATEO.fullName)).toBeInTheDocument();
    expect(within(mateo).queryByRole("link")).not.toBeInTheDocument();
  });

  it("nombra el enlace a la ficha en español", async () => {
    stubClub([POOL_TRAINING], [ADMIN_POOL_SHEET]);

    render(<AttendanceScreen locale="es" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(
      screen.getByRole("link", { name: "Abrir la ficha de Mateo Restrepo" }),
    ).toBeInTheDocument();
  });

  it("sin cambios el nombre navega sin preguntar", async () => {
    stubClub([POOL_TRAINING], [ADMIN_POOL_SHEET]);
    const confirm = vi.spyOn(window, "confirm");
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await findRow(MATEO.fullName);

    await userEvent.click(recordLink(MATEO.fullName));

    expect(confirm).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`/directorio/${MATEO.userId}`);
  });

  it("con cambios sin guardar el nombre pregunta y, si no se acepta, se queda con lo marcado", async () => {
    stubClub([POOL_TRAINING], [ADMIN_POOL_SHEET]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(recordLink(MATEO.fullName));

    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved changes on this session. Discard them?",
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(choice(mateo, "Late")).toHaveAttribute("aria-pressed", "true");
  });

  it("con cambios sin guardar el nombre navega si se acepta descartarlos", async () => {
    stubClub([POOL_TRAINING], [ADMIN_POOL_SHEET]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await userEvent.click(choice(await findRow(MATEO.fullName), "Late"));

    await userEvent.click(recordLink(MATEO.fullName));

    expect(navigate).toHaveBeenCalledWith(`/directorio/${MATEO.userId}`);
  });

  it("abre la foto en grande y al cerrarla devuelve el foco a la foto", async () => {
    stubClub(
      [POOL_TRAINING],
      [sheetFor(POOL_TRAINING, [{ ...MATEO, photoUrl: THUMBNAIL_URL }])],
    );
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const photo = within(await findRow(MATEO.fullName)).getByRole("button", {
      name: "Open the photo of Mateo Restrepo",
    });

    await userEvent.click(photo);
    const dialog = screen.getByRole("dialog", { name: MATEO.fullName });
    expect(
      await within(dialog).findByRole("img", {
        name: "Photo of Mateo Restrepo",
      }),
    ).toHaveAttribute("src", LARGE_URL);
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(photo).toHaveFocus();
  });

  it("nombra el botón de la foto en español", async () => {
    stubClub(
      [POOL_TRAINING],
      [sheetFor(POOL_TRAINING, [{ ...MATEO, photoUrl: THUMBNAIL_URL }])],
    );

    render(<AttendanceScreen locale="es" initialSessionId={null} />);

    expect(
      within(await findRow(MATEO.fullName)).getByRole("button", {
        name: "Abrir la foto de Mateo Restrepo",
      }),
    ).toHaveAttribute("aria-haspopup", "dialog");
  });

  it.each([
    ["coach", false],
    ["admin", true],
  ] as const)(
    "a un %s se le ofrece abrir la foto de un socio de baja: %s",
    async (viewer, canOpen) => {
      stubClub(
        [POOL_TRAINING],
        [
          {
            ...sheetFor(POOL_TRAINING, [
              { ...MATEO, photoUrl: THUMBNAIL_URL, isInactive: true },
            ]),
            viewer,
          },
        ],
      );

      render(<AttendanceScreen locale="en" initialSessionId={null} />);

      const photoButton = within(await findRow(MATEO.fullName)).queryByRole(
        "button",
        { name: "Open the photo of Mateo Restrepo" },
      );
      expect(photoButton !== null).toBe(canOpen);
    },
  );

  it("con cambios sin guardar, abrir la ficha en otra pestaña no pregunta", async () => {
    stubClub([POOL_TRAINING], [ADMIN_POOL_SHEET]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await userEvent.click(choice(await findRow(MATEO.fullName), "Late"));

    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(recordLink(MATEO.fullName));
    await user.keyboard("{/Control}");

    expect(confirm).not.toHaveBeenCalled();
  });

  it("quien no tiene foto enseña sus iniciales, que no se pulsan", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    const ruby = await findRow(RUBY.fullName);
    expect(within(ruby).getByText("RT")).toBeInTheDocument();
    expect(
      within(ruby).queryByRole("button", { name: /Open the photo/ }),
    ).not.toBeInTheDocument();
  });
});

describe("permisos", () => {
  it.each(ROLES)("el menú de un %s", (role) => {
    render(
      <SidebarNav locale="en" access={{ role, membershipCurrent: true }} />,
    );

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
        "Saved · 2 present, 0 late, 1 absent",
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("la fila compacta (#764)", () => {
  it("al Admin el enlace del nombre lleva el icono de abrir, sin nombrarlo", async () => {
    stubClub([POOL_TRAINING], [ADMIN_POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    const link = recordLink(MATEO.fullName);
    expect(link).toHaveAccessibleName("Open Mateo Restrepo's record");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("al Coach el nombre es texto sin icono", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    const name = within(await findRow(MATEO.fullName)).getByText(
      MATEO.fullName,
    );
    expect(name.querySelector("svg")).toBeNull();
  });

  it("cada estado del segmento lleva su icono sin cambiar su nombre", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    const mateo = await findRow(MATEO.fullName);
    for (const status of ["Present", "Late", "Absent"]) {
      expect(choice(mateo, status).querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
  });

  it("cada estado del segmento lleva su texto en una etiqueta aparte, que la tableta esconde a la vista", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    const mateo = await findRow(MATEO.fullName);
    for (const status of ["Present", "Late", "Absent"]) {
      expect(
        choice(mateo, status).querySelector(".attendance-choice-label"),
      ).toHaveTextContent(status);
    }
  });

  it("una hoja recién abierta no lleva ningún punto de sin guardar", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(screen.queryByTitle("Not saved yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Not saved yet")).not.toBeInTheDocument();
  });

  it("al cambiar a un socio su fila lleva el punto y lo anuncia", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);

    await userEvent.click(choice(mateo, "Late"));

    expect(within(mateo).getByTitle("Not saved yet")).toBeInTheDocument();
    expect(within(mateo).getByText("Not saved yet")).toBeInTheDocument();
    expect(
      within(await findRow(RUBY.fullName)).queryByTitle("Not saved yet"),
    ).not.toBeInTheDocument();
  });

  it("el punto desaparece cuando el socio vuelve a su estado guardado", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(choice(mateo, "Present"));

    expect(within(mateo).queryByTitle("Not saved yet")).not.toBeInTheDocument();
  });

  it("el punto desaparece al guardar", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(saveButton());

    await waitFor(() =>
      expect(
        within(mateo).queryByTitle("Not saved yet"),
      ).not.toBeInTheDocument(),
    );
  });

  it("si guardar falla, el punto se queda", async () => {
    stubApi(({ method, path }) => {
      if (path === SESSIONS_PATH) {
        return jsonResponse(200, { data: { sessions: [POOL_TRAINING] } });
      }
      if (method === "PUT") {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, { data: POOL_SHEET });
    });
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(saveButton());

    await screen.findByRole("alert");
    expect(within(mateo).getByTitle("Not saved yet")).toBeInTheDocument();
  });

  it("en español el punto dice Sin guardar todavía", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="es" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);

    await userEvent.click(choice(mateo, "Tarde"));

    expect(within(mateo).getByTitle("Sin guardar todavía")).toHaveTextContent(
      "Sin guardar todavía",
    );
  });
});

/** Los tramos de la barra apilada, en orden, con lo que ocupa cada uno. La
 * barra es decoración (los números van escritos al lado), así que no tiene
 * rol por el que buscarla. */
function barSegments(): [string, string][] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".attendance-totals-segment"),
  ).map((segment) => [segment.dataset.status ?? "", segment.style.flexGrow]);
}

describe("la cabecera, las sesiones, el aviso y los totales (#765)", () => {
  it("encabeza la hoja con Take attendance sobre el título", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(screen.getByText("Take attendance")).toBeInTheDocument();
  });

  it("en español encabeza la hoja con Pasar lista", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="es" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(screen.getByText("Pasar lista")).toBeInTheDocument();
  });

  it("sin sesiones recientes también encabeza con Take attendance", async () => {
    stubClub([], []);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    expect(
      await screen.findByRole("link", { name: "Go to the calendar" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Take attendance")).toBeInTheDocument();
  });

  it("Guardar lleva el icono del disquete, sin nombrarlo", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(saveButton()).toHaveAccessibleName("Save attendance");
    expect(saveButton().querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("Guardar cuenta los socios cambiados y baja al deshacer uno", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    const ruby = await findRow(RUBY.fullName);
    await userEvent.click(choice(mateo, "Late"));
    await userEvent.click(choice(ruby, "Late"));
    expect(saveButton()).toHaveAccessibleName("Save attendance 2 unsaved");

    await userEvent.click(choice(ruby, "Absent"));

    expect(saveButton()).toHaveAccessibleName("Save attendance 1 unsaved");
  });

  it("cambiar dos veces al mismo socio cuenta uno", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);

    await userEvent.click(choice(mateo, "Late"));
    await userEvent.click(choice(mateo, "Absent"));

    expect(saveButton()).toHaveAccessibleName("Save attendance 1 unsaved");
  });

  it("al deshacer todos los cambios Guardar pierde el número", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(choice(mateo, "Present"));

    expect(saveButton()).toHaveAccessibleName("Save attendance");
    expect(screen.queryByText(/unsaved/)).not.toBeInTheDocument();
  });

  it("en español Guardar dice cuántos faltan por guardar", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="es" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);

    await userEvent.click(choice(mateo, "Tarde"));

    expect(
      screen.getByRole("button", { name: /^Guardar asistencia/ }),
    ).toHaveAccessibleName("Guardar asistencia 1 sin guardar");
  });

  it("cada ficha de sesión dice su día y su tipo", async () => {
    stubClub([POOL_TRAINING, SKILLS], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(sessionChip("Tue 23 · Pool Training")).toHaveTextContent(
      "Tue 23 · Pool Training",
    );
  });

  it("el enlace a las sesiones anteriores lleva la flecha, sin nombrarla", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    const older = screen.getByRole("link", {
      name: "Older sessions: open the calendar",
    });
    expect(older).toHaveTextContent("Older sessions");
    expect(older.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("al guardar confirma con los tres números y el icono de hecho", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await userEvent.click(choice(await findRow(VALENTINA.fullName), "Late"));

    await userEvent.click(saveButton());

    const notice = await screen.findByRole("status");
    await waitFor(() =>
      expect(notice).toHaveTextContent("Saved · 1 present, 1 late, 1 absent"),
    );
    expect(notice.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("en español confirma con Guardado y los tres números", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="es" initialSessionId={null} />);
    await userEvent.click(choice(await findRow(VALENTINA.fullName), "Tarde"));

    await userEvent.click(
      screen.getByRole("button", { name: /^Guardar asistencia/ }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Guardado · 1 presentes, 1 tarde, 1 ausentes",
      ),
    );
  });

  it("antes de guardar el aviso está vacío y sin icono", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("dice cuántos vinieron de los que hay en la hoja, contando a los que llegaron tarde", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const ruby = await findRow(RUBY.fullName);
    expect(screen.getByText("2 of 3 came")).toBeInTheDocument();

    await userEvent.click(choice(ruby, "Late"));

    expect(screen.getByText("3 of 3 came")).toBeInTheDocument();
  });

  it("en español dice Vinieron n de total", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="es" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(screen.getByText("Vinieron 2 de 3")).toBeInTheDocument();
  });

  it("la barra lleva un tramo por estado, del tamaño de su número, y ninguno para el que está a 0", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(barSegments()).toEqual([
      ["present", "2"],
      ["absent", "1"],
    ]);
  });

  it("la barra cambia al marcar", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);

    await userEvent.click(choice(mateo, "Late"));

    expect(barSegments()).toEqual([
      ["present", "1"],
      ["late", "1"],
      ["absent", "1"],
    ]);
  });

  it("cada grupo dice cuántos socios tiene junto a su nombre", async () => {
    stubClub(
      [POOL_TRAINING],
      [sheetFor(POOL_TRAINING, [MATEO, CHLOE, VALENTINA, RUBY])],
    );

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(
      within(screen.getByRole("region", { name: "Going" })).getByText("2"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Maybe" })).getByText("1"),
    ).toBeInTheDocument();
  });
});

describe("la hoja en el móvil (#766)", () => {
  beforeEach(() => {
    stubScreenWidth(true);
  });

  function olderSessionsLink(groupName = "Sessions"): HTMLElement {
    return within(screen.getByRole("group", { name: groupName })).getByRole(
      "link",
    );
  }

  it("encabeza con Take attendance y el título, sin botón de guardar", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(screen.getByText("Take attendance")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Pool Training · Tue 23 Jun",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Save attendance/ }),
    ).not.toBeInTheDocument();
  });

  it("deja las fichas de sesión y cierra la fila con Older, sin cambiar adónde lleva", async () => {
    stubClub([POOL_TRAINING, SKILLS], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(sessionChip("Tue 23 · Pool Training")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(olderSessionsLink()).toHaveTextContent(/^Older$/);
    expect(olderSessionsLink()).toHaveAccessibleName(
      "Older sessions: open the calendar",
    );
  });

  it("en español la fila de sesiones acaba en Anteriores", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="es" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(olderSessionsLink("Sesiones")).toHaveTextContent(/^Anteriores$/);
  });

  it("debajo del nombre pone la posición", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    expect(
      within(await findRow(MATEO.fullName)).getByText("Forward"),
    ).toBeInTheDocument();
  });

  it("a quien no tiene posición le pone No position", async () => {
    const longName = "Maximiliana Alejandra Fernández-Rodríguez de la Torre";
    stubClub(
      [POOL_TRAINING],
      [sheetFor(POOL_TRAINING, [{ ...RUBY, fullName: longName }])],
    );

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    expect(
      within(await findRow(longName)).getByText("No position"),
    ).toBeInTheDocument();
  });

  it("a un socio desactivado le pone la posición y Deactivated en la misma línea", async () => {
    stubClub(
      [POOL_TRAINING],
      [sheetFor(POOL_TRAINING, [{ ...MATEO, isInactive: true }])],
    );

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    expect(
      within(await findRow(MATEO.fullName)).getByText("Forward · Deactivated"),
    ).toBeInTheDocument();
  });

  it("en español dice Sin posición", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="es" initialSessionId={null} />);

    expect(
      within(await findRow(RUBY.fullName)).getByText("Sin posición"),
    ).toBeInTheDocument();
  });

  it("cada botón del segmento es solo icono y se nombra con su estado", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    const segment = within(await findRow(MATEO.fullName)).getByRole("group", {
      name: MATEO.fullName,
    });
    const buttons = within(segment).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Present",
      "Late",
      "Absent",
    ]);
    for (const button of buttons) {
      expect(button).toHaveTextContent(/^$/);
    }
  });

  it("al Admin el nombre le abre la ficha del socio", async () => {
    stubClub([POOL_TRAINING], [ADMIN_POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    await findRow(MATEO.fullName);

    await userEvent.click(recordLink(MATEO.fullName));

    expect(navigate).toHaveBeenCalledWith(`/directorio/${MATEO.userId}`);
  });

  it("sin cambios no hay barra de guardar", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);

    render(<AttendanceScreen locale="en" initialSessionId={null} />);

    await findRow(MATEO.fullName);
    expect(screen.queryByText(/unsaved$/)).not.toBeInTheDocument();
  });

  it("con cambios sale la barra con cuántos faltan y Guardar asistencia", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    const ruby = await findRow(RUBY.fullName);

    await userEvent.click(choice(mateo, "Late"));
    await userEvent.click(choice(ruby, "Late"));

    expect(screen.getByText("2 unsaved")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save attendance" }),
    ).toBeEnabled();
  });

  it("en español la barra dice n sin guardar", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="es" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);

    await userEvent.click(choice(mateo, "Tarde"));

    expect(screen.getByText("1 sin guardar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar asistencia" }),
    ).toBeInTheDocument();
  });

  it("la barra se va al volver al estado guardado", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(choice(mateo, "Present"));

    expect(
      screen.queryByRole("button", { name: /^Save attendance/ }),
    ).not.toBeInTheDocument();
  });

  it("guardar desde la barra manda la hoja, quita la barra y confirma", async () => {
    stubClub([POOL_TRAINING], [POOL_SHEET]);
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(
      screen.getByRole("button", { name: "Save attendance" }),
    );

    expect(
      await screen.findByText("Saved · 1 present, 1 late, 1 absent"),
    ).toBeInTheDocument();
    expect(saveRequests()).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /^Save attendance/ }),
    ).not.toBeInTheDocument();
  });

  it("si guardar desde la barra falla, la barra se queda", async () => {
    stubApi(({ method, path }) => {
      if (path === SESSIONS_PATH) {
        return jsonResponse(200, { data: { sessions: [POOL_TRAINING] } });
      }
      if (method === "PUT") {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, { data: POOL_SHEET });
    });
    render(<AttendanceScreen locale="en" initialSessionId={null} />);
    const mateo = await findRow(MATEO.fullName);
    await userEvent.click(choice(mateo, "Late"));

    await userEvent.click(
      screen.getByRole("button", { name: "Save attendance" }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("1 unsaved")).toBeInTheDocument();
  });
});
