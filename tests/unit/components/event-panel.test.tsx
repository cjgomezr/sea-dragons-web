import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import type {
  AgendaEvent,
  EventSeriesSummary,
  MemberEventDetail,
  OrganizerEventDetail,
} from "@/lib/events/event-agenda";
import type { RsvpResponse } from "@/lib/events/event-rsvp";

const saveFile = vi.fn<(file: Blob, filename: string) => void>();
vi.mock("@/components/save-file", () => ({
  saveFile: (file: Blob, filename: string) => saveFile(file, filename),
}));

/**
 * El panel del evento en escritorio (#648, RF-4 y RF-7 del PRD de E24): elegir
 * una fila llena el panel de la derecha con todo lo del evento, en lugar del
 * acordeón de antes. Lo que el panel enseña sale de la agenda y del detalle
 * que sirve la API v1.
 */

const AGENDA_PATH = "/api/v1/events";

const TRIVIA_NIGHT: AgendaEvent = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  startsOn: "2026-10-14",
  startTime: "18:00",
  endTime: "19:30",
  endsOn: null,
  title: "Fundraiser trivia night",
  eventType: "social",
  location: "Seadragons Clubhouse",
  place: {
    name: "Seadragons Clubhouse",
    address: "12 Beach Rd, St Kilda VIC 3182",
    lat: -37.8676,
    lng: 144.9741,
  },
  placeDetail: null,
  status: "scheduled",
  seriesId: null,
  goingCount: 3,
  maybeCount: 1,
  myResponse: null,
  inAudience: true,
  coverThumbUrl: "https://storage.example/thumb.webp",
};

const SERIES_ID = "5e5e5e5e-0000-4000-8000-000000000005";

const OPEN_TRAINING: AgendaEvent = {
  ...TRIVIA_NIGHT,
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  startsOn: "2026-10-21",
  title: "Tuesday–Wednesday open training",
  eventType: "training",
  location: "Princes Park, Oval 2",
  place: null,
  seriesId: SERIES_ID,
  goingCount: 12,
  maybeCount: 2,
  coverThumbUrl: null,
};

const CAMP: AgendaEvent = {
  ...TRIVIA_NIGHT,
  id: "cccccccc-0000-4000-8000-00000000000c",
  startsOn: "2026-10-24",
  startTime: "08:30",
  endsOn: "2026-10-25",
  endTime: "17:00",
  title: "Weekend skills camp",
  eventType: "competition",
  coverThumbUrl: null,
};

const WEDNESDAYS: EventSeriesSummary = {
  weekdays: [3],
  endsOn: "2026-12-16",
  sessionsLeft: 10,
};

const TWELVE_NAMES = [
  "Lucía Fernández",
  "Tom Bell",
  "Mia Ruiz",
  "Pia Nolan",
  "Hugo Soto",
  "Dan White",
  "Ana Cole",
  "Ivy Park",
  "Leo Gray",
  "Max Hunt",
  "Zoe Lane",
  "Kai Ross",
];

type DetailChanges = Partial<OrganizerEventDetail>;

type Call = {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
};

const calls: Call[] = [];
/** Lo que guardó cada evento, por su ruta: el detalle de después lo trae. */
const savedResponses = new Map<string, RsvpResponse>();

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function detailOf(
  event: AgendaEvent,
  changes: DetailChanges,
): MemberEventDetail {
  return {
    ...event,
    coverUrl: null,
    series: null,
    notes: null,
    going: [],
    maybe: [],
    ...changes,
  };
}

function eventPath(event: AgendaEvent): string {
  return `${AGENDA_PATH}/${event.id}`;
}

/** La agenda con esos eventos, el detalle de cada uno con sus cambios, y
 * responder guardado con los conteos de vuelta. */
function stubApi(
  events: readonly AgendaEvent[],
  details: Readonly<Record<string, DetailChanges>> = {},
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const { pathname } = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ method, pathname, body });
      if (pathname.endsWith("/team")) {
        return jsonResponse(200, { data: { status: "not_published" } });
      }
      if (pathname.endsWith("/rsvp")) {
        const { response } = body as { response: RsvpResponse };
        savedResponses.set(pathname.replace(/\/rsvp$/, ""), response);
        return jsonResponse(200, { data: { response } });
      }
      if (pathname === AGENDA_PATH) {
        return jsonResponse(200, { data: { events, nextCursor: null } });
      }
      const event = events.find(
        (candidate) => pathname === eventPath(candidate),
      );
      if (event === undefined) {
        throw new Error(`Petición inesperada: ${pathname}`);
      }
      const myResponse = savedResponses.get(pathname) ?? event.myResponse;
      return jsonResponse(200, {
        data: detailOf({ ...event, myResponse }, details[event.id] ?? {}),
      });
    }),
  );
}

function renderAgenda(
  options: {
    readonly locale?: "en" | "es";
    readonly canManageEvents?: boolean;
    readonly canTakeAttendance?: boolean;
    readonly canRespond?: boolean;
  } = {},
): void {
  render(
    <AgendaScreen
      locale={options.locale ?? "en"}
      canManageEvents={options.canManageEvents ?? false}
      canTakeAttendance={options.canTakeAttendance ?? false}
      canRespond={options.canRespond ?? true}
    />,
  );
}

async function findPanel(title: string): Promise<HTMLElement> {
  return screen.findByRole("complementary", { name: title });
}

/** El panel con el detalle ya llegado. */
async function findLoadedPanel(title: string): Promise<HTMLElement> {
  const panel = await findPanel(title);
  await waitFor(() =>
    expect(within(panel).queryByText(/Loading the details/)).toBeNull(),
  );
  return panel;
}

function rowButton(title: string): HTMLElement {
  const list = screen.getByRole("list", { name: "Upcoming events" });
  return within(list).getByRole("button", { name: title });
}

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
}

afterEach(() => {
  calls.length = 0;
  savedResponses.clear();
  vi.unstubAllGlobals();
  saveFile.mockReset();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("elegir un evento", () => {
  it("elige el primer evento al cargar y llena el panel con él", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);

    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);
    expect(
      within(panel).getByRole("heading", {
        level: 2,
        name: TRIVIA_NIGHT.title,
      }),
    ).toBeInTheDocument();
    expect(rowButton(TRIVIA_NIGHT.title)).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("sin eventos no pinta el panel", async () => {
    stubApi([]);

    renderAgenda();

    await screen.findByText("There are no upcoming events.");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("al pulsar otra fila la elige y el panel pasa a ese evento", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
    renderAgenda();
    await findPanel(TRIVIA_NIGHT.title);

    await userEvent.click(rowButton(OPEN_TRAINING.title));

    await findPanel(OPEN_TRAINING.title);
    expect(rowButton(OPEN_TRAINING.title)).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(rowButton(TRIVIA_NIGHT.title)).not.toHaveAttribute("aria-current");
    expect(screen.getAllByRole("complementary")).toHaveLength(1);
  });

  it.each(["{Enter}", " "])(
    "elige la fila con el teclado (%s)",
    async (key) => {
      stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
      renderAgenda();
      await findPanel(TRIVIA_NIGHT.title);

      rowButton(OPEN_TRAINING.title).focus();
      await userEvent.keyboard(key);

      await findPanel(OPEN_TRAINING.title);
    },
  );

  it("el botón de la fila apunta al panel", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
    renderAgenda();
    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(rowButton(OPEN_TRAINING.title)).toHaveAttribute(
      "aria-controls",
      panel.id,
    );
  });

  it("al cambiar de fila la lista sigue siendo la misma, sin volver a montarse", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
    renderAgenda();
    await findPanel(TRIVIA_NIGHT.title);
    const list = screen.getByRole("list", { name: "Upcoming events" });

    await userEvent.click(rowButton(OPEN_TRAINING.title));

    await findPanel(OPEN_TRAINING.title);
    expect(screen.getByRole("list", { name: "Upcoming events" })).toBe(list);
  });

  it("pide el detalle de cada evento una sola vez aunque se elija dos veces", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
    renderAgenda();
    await findLoadedPanel(TRIVIA_NIGHT.title);
    await userEvent.click(rowButton(OPEN_TRAINING.title));
    await findLoadedPanel(OPEN_TRAINING.title);

    await userEvent.click(rowButton(TRIVIA_NIGHT.title));

    await findLoadedPanel(TRIVIA_NIGHT.title);
    expect(
      calls.filter((call) => call.pathname === eventPath(TRIVIA_NIGHT)),
    ).toHaveLength(1);
  });

  it("pulsar el lugar de una fila no la elige", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
    renderAgenda();
    await findPanel(TRIVIA_NIGHT.title);
    const list = screen.getByRole("list", { name: "Upcoming events" });
    const placeLink = within(list).getByRole("link", {
      name: /Princes Park, Oval 2/,
    });

    await userEvent.click(placeLink);

    expect(rowButton(OPEN_TRAINING.title)).not.toHaveAttribute("aria-current");
  });
});

describe("lo que enseña el panel, en orden", () => {
  it("de la imagen a las acciones", async () => {
    stubApi([OPEN_TRAINING], {
      [OPEN_TRAINING.id]: {
        series: WEDNESDAYS,
        notes: "Bring light and dark tops.",
        going: ["Lucía Fernández"],
        audience: { kind: "club" },
      },
    });
    renderAgenda({ canManageEvents: true });
    const panel = await findLoadedPanel(OPEN_TRAINING.title);
    await within(panel).findByRole("button", { name: "Edit" });

    const text = panel.textContent ?? "";
    const order = [
      "Training",
      "The whole club",
      OPEN_TRAINING.title,
      "Wednesday, October 21",
      "Every Wednesday",
      "Princes Park, Oval 2",
      "Directions",
      "Going · 12",
      "Bring light and dark tops.",
      "Edit",
    ].map((piece) => text.indexOf(piece));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((first, second) => first - second));
  });

  it("enseña la imagen grande del detalle", async () => {
    stubApi([TRIVIA_NIGHT], {
      [TRIVIA_NIGHT.id]: { coverUrl: "https://storage.example/large.webp" },
    });
    renderAgenda();

    const panel = await findLoadedPanel(TRIVIA_NIGHT.title);

    await waitFor(() =>
      expect(panel.querySelector("img")).toHaveAttribute(
        "src",
        "https://storage.example/large.webp",
      ),
    );
  });

  it("sin imagen pinta el fondo de su tipo", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda();

    const panel = await findLoadedPanel(OPEN_TRAINING.title);

    expect(panel.querySelector("img")).toBeNull();
    expect(
      panel.querySelector(".event-cover-fallback-training"),
    ).not.toBeNull();
  });

  it("a quien organiza le dice los grupos de la audiencia", async () => {
    stubApi([TRIVIA_NIGHT], {
      [TRIVIA_NIGHT.id]: {
        audience: {
          kind: "groups",
          groups: [
            { id: "9a9a9a9a-0000-4000-8000-000000000009", name: "Juniors" },
            { id: "8b8b8b8b-0000-4000-8000-000000000008", name: "Parents" },
          ],
        },
      },
    });
    renderAgenda({ canManageEvents: true });

    const panel = await findLoadedPanel(TRIVIA_NIGHT.title);

    expect(within(panel).getByText("Juniors · Parents")).toBeInTheDocument();
  });

  it("dice que el evento está cancelado", async () => {
    stubApi([{ ...TRIVIA_NIGHT, status: "cancelled" }]);
    renderAgenda();

    const panel = await findLoadedPanel(TRIVIA_NIGHT.title);

    expect(within(panel).getByText("Cancelled")).toBeInTheDocument();
    expect(within(panel).queryByRole("group", { name: /^RSVP/ })).toBeNull();
  });

  it("enseña las notas y no pinta el apartado sin ellas", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING], {
      [OPEN_TRAINING.id]: { notes: "Parents are welcome." },
    });
    renderAgenda();
    const quiet = await findLoadedPanel(TRIVIA_NIGHT.title);
    expect(within(quiet).queryByRole("heading", { name: "Notes" })).toBeNull();

    await userEvent.click(rowButton(OPEN_TRAINING.title));

    const panel = await findLoadedPanel(OPEN_TRAINING.title);
    expect(
      within(panel).getByRole("heading", { name: "Notes" }),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Parents are welcome.")).toBeInTheDocument();
  });

  it("si el detalle no carga lo dice en el panel y deja reintentar", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const { pathname } = new URL(input, "http://localhost");
        if (pathname === AGENDA_PATH) {
          return jsonResponse(200, {
            data: { events: [TRIVIA_NIGHT], nextCursor: null },
          });
        }
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return jsonResponse(200, {
          data: detailOf(TRIVIA_NIGHT, { notes: "Back again." }),
        });
      }),
    );
    renderAgenda();
    const panel = await findPanel(TRIVIA_NIGHT.title);

    await within(panel).findByRole("alert");
    await userEvent.click(
      within(panel).getByRole("button", { name: "Try again" }),
    );

    expect(await within(panel).findByText("Back again.")).toBeInTheDocument();
  });
});

describe("bloque de hora", () => {
  it("de un día dice el día, las horas y lo que dura", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(
      within(panel).getByText("Wednesday, October 14"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("6:00 pm – 7:30 pm · 1 h 30 min"),
    ).toBeInTheDocument();
  });

  it("de varios días dice los dos días", async () => {
    stubApi([CAMP]);
    renderAgenda();

    const panel = await findPanel(CAMP.title);

    expect(
      within(panel).getByText("Sat, Oct 24 – Sun, Oct 25"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("8:30 am Sat – 5:00 pm Sun · 2 days"),
    ).toBeInTheDocument();
  });

  it("sin hora de fin dice sólo el inicio", async () => {
    stubApi([{ ...TRIVIA_NIGHT, endTime: null }]);
    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(within(panel).getByText("6:00 pm")).toBeInTheDocument();
  });

  it("escribe la hora en español", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ locale: "es" });

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(
      within(panel).getByText("miércoles, 14 de octubre"),
    ).toBeInTheDocument();
  });
});

describe("agregar a mi calendario", () => {
  /** El archivo que se guardó, con su nombre y su texto. */
  async function savedCalendar(): Promise<{ name: string; text: string }> {
    expect(saveFile).toHaveBeenCalledOnce();
    const call = saveFile.mock.lastCall;
    if (call === undefined) {
      throw new Error("No se guardó ningún archivo");
    }
    const [file, name] = call;
    return { name, text: await file.text() };
  }

  it("descarga el .ics de la sesión con el título por nombre", async () => {
    stubApi([TRIVIA_NIGHT], {
      [TRIVIA_NIGHT.id]: { notes: "Bring a gold coin" },
    });
    renderAgenda();
    const panel = await findLoadedPanel(TRIVIA_NIGHT.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "Add to my calendar" }),
    );

    const { name, text } = await savedCalendar();
    expect(name).toBe("Fundraiser trivia night.ics");
    expect(text).toContain(`UID:${TRIVIA_NIGHT.id}@`);
    expect(text).toContain("SUMMARY:Fundraiser trivia night");
    expect(text).toContain(
      "LOCATION:Seadragons Clubhouse\\, 12 Beach Rd\\, St Kilda VIC 3182",
    );
    expect(text).toContain("DESCRIPTION:Bring a gold coin");
    expect(text).toContain("DTSTART;TZID=Australia/Melbourne:20261014T180000");
  });

  it("de una sesión de una serie baja sólo esa sesión", async () => {
    stubApi([OPEN_TRAINING], { [OPEN_TRAINING.id]: { series: WEDNESDAYS } });
    renderAgenda();
    const panel = await findLoadedPanel(OPEN_TRAINING.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "Add to my calendar" }),
    );

    const { text } = await savedCalendar();
    const vevent = text.slice(text.indexOf("BEGIN:VEVENT"));
    expect(vevent).toContain(`UID:${OPEN_TRAINING.id}@`);
    expect(vevent).not.toContain("RRULE");
  });

  it("se anuncia en español", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ locale: "es" });

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(
      within(panel).getByRole("button", { name: "Agregar a mi calendario" }),
    ).toBeInTheDocument();
  });
});

describe("bloque de repetición", () => {
  it("dice los días de la serie y las sesiones que quedan", async () => {
    stubApi([OPEN_TRAINING], { [OPEN_TRAINING.id]: { series: WEDNESDAYS } });
    renderAgenda();

    const panel = await findLoadedPanel(OPEN_TRAINING.title);

    expect(within(panel).getByText("Every Wednesday")).toBeInTheDocument();
    expect(
      within(panel).getByText("Until Dec 16 · 10 sessions left"),
    ).toBeInTheDocument();
  });

  it("lo escribe en español", async () => {
    stubApi([OPEN_TRAINING], { [OPEN_TRAINING.id]: { series: WEDNESDAYS } });
    renderAgenda({ locale: "es" });

    const panel = await findPanel(OPEN_TRAINING.title);

    expect(
      await within(panel).findByText("Todos los miércoles"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("Hasta el 16 dic · quedan 10 sesiones"),
    ).toBeInTheDocument();
  });

  it("no lo pinta en un evento suelto", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();

    const panel = await findLoadedPanel(TRIVIA_NIGHT.title);

    expect(within(panel).queryByText(/^Every /)).toBeNull();
  });
});

describe("tarjeta del lugar", () => {
  it("enseña el nombre y la dirección y enlaza Directions al mapa en otra pestaña", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(
      within(panel).getByText("12 Beach Rd, St Kilda VIC 3182"),
    ).toBeInTheDocument();
    const directions = within(panel).getByRole("link", { name: /Directions/ });
    expect(directions).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=-37.8676,144.9741",
    );
    expect(directions).toHaveAttribute("target", "_blank");
    expect(directions).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("con texto libre enseña el texto y Directions lo busca", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda();

    const panel = await findPanel(OPEN_TRAINING.title);

    expect(within(panel).getByText("Princes Park, Oval 2")).toBeInTheDocument();
    expect(
      within(panel).getByRole("link", { name: /Directions/ }),
    ).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Princes%20Park%2C%20Oval%202",
    );
  });

  it("escribe Cómo llegar en español", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ locale: "es" });

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(
      within(panel).getByRole("link", { name: /Cómo llegar/ }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Copiar dirección" }),
    ).toBeInTheDocument();
  });
});

/** La capa encima del mapa: el único enlace del panel sin nombre, porque
 * está escondida de los lectores de pantalla. */
function mapCover(panel: HTMLElement): HTMLElement {
  return within(panel).getByRole("link", { name: "", hidden: true });
}

describe("mapa del lugar", () => {
  const TRIVIA_MAP_URL =
    "https://www.openstreetmap.org/export/embed.html" +
    "?bbox=144.9676%2C-37.8694%2C144.9806%2C-37.8658" +
    "&layer=mapnik&marker=-37.8676%2C144.9741";

  it("con coordenadas pinta el mapa de OpenStreetMap con su título, perezoso", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);

    const map = within(panel).getByTitle("Map of Seadragons Clubhouse");
    expect(map.tagName).toBe("IFRAME");
    expect(map).toHaveAttribute("src", TRIVIA_MAP_URL);
    expect(map).toHaveAttribute("loading", "lazy");
  });

  it("el iframe no recibe el foco", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);

    const map = within(panel).getByTitle("Map of Seadragons Clubhouse");
    expect(map).toHaveAttribute("inert");
  });

  it("enseña la atribución de OpenStreetMap con su enlace", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(
      within(panel).getByRole("link", { name: /© OpenStreetMap/ }),
    ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  });

  it("una capa encima del mapa lo abre en Google Maps en otra pestaña", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);

    const cover = mapCover(panel);
    expect(cover).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=-37.8676,144.9741",
    );
    expect(cover).toHaveAttribute("target", "_blank");
    expect(cover).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("la capa no es otra parada del tabulador: Directions ya lleva allí", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);

    const cover = mapCover(panel);
    expect(cover).toHaveAttribute("tabindex", "-1");
    expect(cover).toHaveAttribute("aria-hidden", "true");
  });

  it("escribe el título del mapa en español", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ locale: "es" });

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(
      within(panel).getByTitle("Mapa de Seadragons Clubhouse"),
    ).toBeInTheDocument();
  });

  it("sin lugar elegido no pinta mapa", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda();

    const panel = await findPanel(OPEN_TRAINING.title);

    expect(panel.querySelector("iframe")).toBeNull();
    expect(
      within(panel).queryByRole("link", { name: /OpenStreetMap/ }),
    ).toBeNull();
  });

  it("con un lugar sin coordenadas no pinta mapa", async () => {
    const withoutCoordinates: AgendaEvent = {
      ...TRIVIA_NIGHT,
      place: {
        name: "Seadragons Clubhouse",
        address: "12 Beach Rd, St Kilda VIC 3182",
        lat: null,
        lng: null,
      },
    };
    stubApi([withoutCoordinates]);
    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(panel.querySelector("iframe")).toBeNull();
    expect(
      within(panel).queryByRole("link", { name: /OpenStreetMap/ }),
    ).toBeNull();
  });
});

describe("copiar la dirección", () => {
  it("copia el nombre y la dirección y lo anuncia", async () => {
    const copied: string[] = [];
    stubClipboard(async (text) => {
      copied.push(text);
    });
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();
    const panel = await findPanel(TRIVIA_NIGHT.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "Copy address" }),
    );

    expect(copied).toEqual([
      "Seadragons Clubhouse, 12 Beach Rd, St Kilda VIC 3182",
    ]);
    expect(await within(panel).findByText("Address copied")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("copia el texto libre cuando no hay lugar elegido", async () => {
    const copied: string[] = [];
    stubClipboard(async (text) => {
      copied.push(text);
    });
    stubApi([OPEN_TRAINING]);
    renderAgenda();
    const panel = await findPanel(OPEN_TRAINING.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "Copy address" }),
    );

    expect(copied).toEqual(["Princes Park, Oval 2"]);
  });

  it("si el portapapeles falla lo dice", async () => {
    stubClipboard(async () => {
      throw new Error("Permiso denegado");
    });
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();
    const panel = await findPanel(TRIVIA_NIGHT.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "Copy address" }),
    );

    expect(await within(panel).findByText("Couldn't copy")).toBeInTheDocument();
  });

  it("anuncia la copia en español", async () => {
    stubClipboard(async () => undefined);
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ locale: "es" });
    const panel = await findPanel(TRIVIA_NIGHT.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "Copiar dirección" }),
    );

    expect(
      await within(panel).findByText("Dirección copiada"),
    ).toBeInTheDocument();
  });
});

describe("¿Vas? en el panel", () => {
  it("ofrece Going, Maybe y Can't go", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();

    const panel = await findPanel(TRIVIA_NIGHT.title);

    const group = within(panel).getByRole("group", {
      name: `RSVP: ${TRIVIA_NIGHT.title}`,
    });
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Going", "Maybe", "Can't go"]);
  });

  it.each([
    ["Going", "yes"],
    ["Maybe", "maybe"],
    ["Can't go", "no"],
  ])("al pulsar %s guarda %s y lo marca", async (label, response) => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();
    const panel = await findPanel(TRIVIA_NIGHT.title);

    await userEvent.click(within(panel).getByRole("button", { name: label }));

    await waitFor(() =>
      expect(
        within(panel).getByRole("button", { name: label }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(
      calls.filter((call) => call.method === "PUT").map((call) => call.body),
    ).toEqual([{ response }]);
  });

  it("la píldora de la fila cambia al responder en el panel", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();
    const panel = await findPanel(TRIVIA_NIGHT.title);

    await userEvent.click(within(panel).getByRole("button", { name: "Maybe" }));

    const row = rowButton(TRIVIA_NIGHT.title).closest("li");
    await waitFor(() =>
      expect(row?.querySelector(".agenda-answer-maybe")).not.toBeNull(),
    );
  });

  it("con la membresía no al día los botones están desactivados", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ canRespond: false });

    const panel = await findPanel(TRIVIA_NIGHT.title);

    for (const label of ["Going", "Maybe", "Can't go"]) {
      expect(within(panel).getByRole("button", { name: label })).toBeDisabled();
    }
  });

  it("escribe los botones en español", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ locale: "es" });

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(within(panel).getByText("¿Vas?")).toBeInTheDocument();
    for (const label of ["Voy", "Quizás", "No puedo"]) {
      expect(
        within(panel).getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
  });
});

describe("los que van", () => {
  it("con tres pinta sus tres avatares con iniciales y sin +n more", async () => {
    stubApi([TRIVIA_NIGHT], {
      [TRIVIA_NIGHT.id]: {
        going: ["Lucía Fernández", "Tom Bell", "Mia Ruiz"],
        maybe: ["Pia Nolan"],
      },
    });
    renderAgenda();
    const panel = await findLoadedPanel(TRIVIA_NIGHT.title);

    const avatars = within(panel).getByRole("list", { name: "Going · 3" });

    expect(
      within(avatars)
        .getAllByRole("listitem")
        .map((avatar) => avatar.textContent),
    ).toEqual(["LFLucía Fernández", "TBTom Bell", "MRMia Ruiz"]);
    expect(within(panel).getByText("1 maybe")).toBeInTheDocument();
    expect(within(panel).queryByText(/more$/)).toBeNull();
  });

  it("con doce pinta siete avatares, +5 more y See all abre la lista entera", async () => {
    stubApi([OPEN_TRAINING], { [OPEN_TRAINING.id]: { going: TWELVE_NAMES } });
    renderAgenda();
    const panel = await findLoadedPanel(OPEN_TRAINING.title);
    const avatars = within(panel).getByRole("list", { name: "Going · 12" });
    expect(within(avatars).getAllByRole("listitem")).toHaveLength(7);
    expect(within(panel).getByText("+5 more")).toBeInTheDocument();

    const seeAll = within(panel).getByRole("button", { name: "See all" });
    expect(seeAll).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(seeAll);

    expect(seeAll).toHaveAttribute("aria-expanded", "true");
    const names = within(panel).getByRole("list", { name: "Going" });
    expect(within(names).getAllByRole("listitem")).toHaveLength(12);
  });

  it("dice con una frase que nadie ha respondido", async () => {
    stubApi([{ ...TRIVIA_NIGHT, goingCount: 0, maybeCount: 0 }]);
    renderAgenda();

    const panel = await findLoadedPanel(TRIVIA_NIGHT.title);

    expect(
      within(panel).getByText("Nobody has answered yet."),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "See all" })).toBeNull();
  });

  it("escribe los que van en español", async () => {
    stubApi([OPEN_TRAINING], { [OPEN_TRAINING.id]: { going: TWELVE_NAMES } });
    renderAgenda({ locale: "es" });

    const panel = await findPanel(OPEN_TRAINING.title);

    expect(await within(panel).findByText("+5 más")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Ver todos" }),
    ).toBeInTheDocument();
  });
});

describe("acciones del panel", () => {
  const STARTED_TRAINING: AgendaEvent = {
    ...OPEN_TRAINING,
    startsOn: "2020-01-01",
  };

  it("a quien organiza le ofrece Editar y Cancelar", async () => {
    stubApi([TRIVIA_NIGHT], {
      [TRIVIA_NIGHT.id]: { audience: { kind: "club" } },
    });
    renderAgenda({ canManageEvents: true });

    const panel = await findPanel(TRIVIA_NIGHT.title);

    expect(
      await within(panel).findByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
  });

  it("a quien no organiza no le ofrece Editar ni Cancelar", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda();

    const panel = await findLoadedPanel(TRIVIA_NIGHT.title);

    expect(within(panel).queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("a quien pasa lista le ofrece Take attendance en un entrenamiento empezado", async () => {
    stubApi([STARTED_TRAINING]);
    renderAgenda({ canTakeAttendance: true });

    const panel = await findPanel(STARTED_TRAINING.title);

    expect(
      within(panel).getByRole("link", { name: "Take attendance" }),
    ).toHaveAttribute("href", `/asistencia?sesion=${STARTED_TRAINING.id}`);
  });

  it("a quien no pasa lista no le ofrece Take attendance", async () => {
    stubApi([STARTED_TRAINING]);
    renderAgenda();

    const panel = await findPanel(STARTED_TRAINING.title);

    expect(
      within(panel).queryByRole("link", { name: "Take attendance" }),
    ).toBeNull();
  });
});

describe("sin acordeón", () => {
  it("las filas ya no se despliegan", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
    renderAgenda();
    await findPanel(TRIVIA_NIGHT.title);

    const list = screen.getByRole("list", { name: "Upcoming events" });

    expect(
      within(list)
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("aria-expanded")),
    ).toEqual([]);
  });
});

describe("foco entre la lista y el panel", () => {
  it("al cargar no mueve el foco al panel", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
    renderAgenda();

    const panel = await findLoadedPanel(TRIVIA_NIGHT.title);

    expect(within(panel).getByRole("heading", { level: 2 })).not.toHaveFocus();
  });

  it("al elegir una fila con el teclado lleva el foco al título del panel", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
    renderAgenda();
    await findPanel(TRIVIA_NIGHT.title);

    rowButton(OPEN_TRAINING.title).focus();
    await userEvent.keyboard("{Enter}");

    const panel = await findPanel(OPEN_TRAINING.title);
    await waitFor(() =>
      expect(
        within(panel).getByRole("heading", {
          level: 2,
          name: OPEN_TRAINING.title,
        }),
      ).toHaveFocus(),
    );
  });

  it("Escape en el panel devuelve el foco a la fila elegida", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
    renderAgenda();
    await findPanel(TRIVIA_NIGHT.title);
    await userEvent.click(rowButton(OPEN_TRAINING.title));
    const panel = await findPanel(OPEN_TRAINING.title);
    await waitFor(() =>
      expect(within(panel).getByRole("heading", { level: 2 })).toHaveFocus(),
    );

    await userEvent.keyboard("{Escape}");

    expect(rowButton(OPEN_TRAINING.title)).toHaveFocus();
  });

  it("Volver a la lista devuelve el foco a la fila elegida", async () => {
    stubApi([TRIVIA_NIGHT, OPEN_TRAINING]);
    renderAgenda({ locale: "es" });
    const panel = await findPanel(TRIVIA_NIGHT.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "Volver a la lista" }),
    );

    expect(
      within(screen.getByRole("list", { name: "Próximos eventos" })).getByRole(
        "button",
        { name: TRIVIA_NIGHT.title },
      ),
    ).toHaveFocus();
  });
});
