import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import type { AgendaEvent, MemberEventDetail } from "@/lib/events/event-agenda";
import type { Locale } from "@/lib/i18n/locale";
import type { MyTeam } from "@/lib/teams/my-team";

/**
 * El equipo de quien mira dentro del panel del evento (#403, RF-8 del PRD de
 * E10, FR-048, AC-020): la tarjeta "Juegas en {equipo}" y la alineación de
 * los dos equipos, sin un OVR (D3). Quién juega dónde lo decide el servidor
 * (#401); aquí se prueba que la pantalla pinta lo que responde.
 */

const AGENDA_PATH = "/api/v1/events";

const SCRIMMAGE: AgendaEvent = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  startsOn: "2026-06-27",
  startTime: "10:00",
  endTime: null,
  endsOn: null,
  title: "Scrimmage vs Geelong",
  eventType: "competition",
  location: "Geelong Aquatic Centre",
  place: null,
  placeDetail: null,
  status: "scheduled",
  seriesId: null,
  goingCount: 6,
  maybeCount: 0,
  myResponse: "yes",
  inAudience: true,
  coverThumbUrl: null,
};

const CANCELLED_SCRIMMAGE: AgendaEvent = {
  ...SCRIMMAGE,
  status: "cancelled",
};

const SOCIAL: AgendaEvent = {
  ...SCRIMMAGE,
  id: "cccccccc-0000-4000-8000-00000000000c",
  title: "Quiz Night",
  eventType: "social",
};

const FORWARD = {
  id: "f0f0f0f0-0000-4000-8000-00000000000f",
  names: { en: "Forward", es: "Delantero" },
};

const GOALKEEPER = {
  id: "f0f0f0f0-0000-4000-8000-00000000000a",
  names: { en: "Goalkeeper", es: "Portero" },
};

function player(
  index: number,
  fullName: string,
  position: typeof FORWARD | null,
): { userId: string; fullName: string; position: typeof FORWARD | null } {
  return {
    userId: `4e4e4e4e-0000-4000-8000-${String(index).padStart(12, "0")}`,
    fullName,
    position,
  };
}

const KELP = {
  name: "Team Kelp",
  color: "#1C6EA4",
  players: [
    player(1, "Daniela Vargas", FORWARD),
    player(2, "Mateo Restrepo", FORWARD),
  ],
};

const TIDE = {
  name: "Team Tide",
  color: "#C99A3E",
  players: [
    player(3, "Ethan Brown", null),
    player(4, "Valentina Gómez", GOALKEEPER),
  ],
};

const PLAYING_IN_KELP: MyTeam = {
  status: "published",
  publishedAt: "2026-06-20T08:00:00.000Z",
  me: { team: "a", position: FORWARD },
  teams: { a: KELP, b: TIDE },
};

const NOT_ASSIGNED: MyTeam = { ...PLAYING_IN_KELP, me: null };

const NOT_PUBLISHED: MyTeam = { status: "not_published" };

type TeamReply = MyTeam | "fails";

const requestedPaths: string[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function detailOf(event: AgendaEvent): MemberEventDetail {
  return {
    ...event,
    coverUrl: null,
    series: null,
    notes: null,
    going: [],
    maybe: [],
  };
}

/** La agenda con un evento, su detalle y lo que responda su equipo. Los
 * eventos de `others` van detrás en la agenda y sólo sirven su detalle. */
function stubEvent(
  event: AgendaEvent,
  team: TeamReply,
  others: readonly AgendaEvent[] = [],
): void {
  const events = [event, ...others];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const { pathname } = new URL(input, "http://localhost");
      requestedPaths.push(pathname);
      if (pathname === AGENDA_PATH) {
        return jsonResponse(200, { data: { events, nextCursor: null } });
      }
      const opened = events.find(
        (candidate) => pathname === `${AGENDA_PATH}/${candidate.id}`,
      );
      if (opened !== undefined) {
        return jsonResponse(200, { data: detailOf(opened) });
      }
      if (pathname === `${AGENDA_PATH}/${event.id}/team`) {
        return team === "fails"
          ? jsonResponse(500, {
              error: { code: "internal", message: "Algo falló." },
            })
          : jsonResponse(200, { data: team });
      }
      throw new Error(`Petición inesperada: ${pathname}`);
    }),
  );
}

function renderAgenda(locale: Locale = "en"): void {
  render(
    <AgendaScreen
      locale={locale}
      canManageEvents={false}
      canTakeAttendance={false}
      canRespond
    />,
  );
}

/** Elige la fila del evento si no lo está ya (la primera se elige sola al
 * cargar) y devuelve su panel con el detalle llegado: los que van sólo se
 * pintan con el detalle, en inglés y en español. */
async function selectEvent(event: AgendaEvent): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", {
    level: 3,
    name: event.title,
  });
  const button = within(heading).getByRole("button");
  if (button.getAttribute("aria-current") !== "true") {
    await userEvent.click(button);
  }
  const panel = await screen.findByRole("complementary", {
    name: event.title,
  });
  await within(panel).findByRole("heading", {
    level: 3,
    name: /^(Going|Van) · \d+$/,
  });
  return panel;
}

async function openPanel(
  event: AgendaEvent,
  locale: Locale = "en",
): Promise<HTMLElement> {
  renderAgenda(locale);
  return selectEvent(event);
}

afterEach(() => {
  requestedPaths.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el equipo en el panel del evento", () => {
  it("dice en qué equipo juega quien mira, con su color y su posición, como una frase", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    const panel = await openPanel(SCRIMMAGE);

    expect(
      await within(panel).findByText(
        "You're playing in Team Kelp, colour blue, as Forward.",
      ),
    ).toBeInTheDocument();
  });

  it("pinta la tarjeta con el color del equipo", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    const panel = await openPanel(SCRIMMAGE);

    const sentence = await within(panel).findByText(
      "You're playing in Team Kelp, colour blue, as Forward.",
    );
    const card = sentence.closest(".event-my-team");
    expect(card).toHaveStyle({ "--team-color": "#1C6EA4" });
  });

  it("pone la alineación de los dos equipos con el nombre y la posición de cada uno", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    const panel = await openPanel(SCRIMMAGE);

    const kelp = await within(panel).findByRole("list", { name: "Team Kelp" });
    const tide = within(panel).getByRole("list", { name: "Team Tide" });
    expect(
      within(kelp)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Daniela VargasForward", "Mateo RestrepoForward"]);
    expect(
      within(tide)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ethan BrownNo position", "Valentina GómezGoalkeeper"]);
  });

  it("no enseña ningún OVR ni marca de sin evaluar", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    const panel = await openPanel(SCRIMMAGE);

    await within(panel).findByRole("list", { name: "Team Kelp" });
    expect(panel).not.toHaveTextContent(/OVR|unrated|not rated|\d\.\d/i);
  });

  it("a quien no está en ningún equipo le enseña la alineación y se lo dice", async () => {
    stubEvent(SCRIMMAGE, NOT_ASSIGNED);

    const panel = await openPanel(SCRIMMAGE);

    expect(
      await within(panel).findByText(
        "You're not in either team for this event.",
      ),
    ).toBeInTheDocument();
    expect(within(panel).queryByText(/^You're playing in/)).toBeNull();
    expect(
      within(panel).getByRole("list", { name: "Team Kelp" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("list", { name: "Team Tide" }),
    ).toBeInTheDocument();
  });

  it("no enseña nada de equipos si el reparto no está publicado", async () => {
    stubEvent(SCRIMMAGE, NOT_PUBLISHED);

    const panel = await openPanel(SCRIMMAGE);

    await vi.waitFor(() =>
      expect(requestedPaths).toContain(`${AGENDA_PATH}/${SCRIMMAGE.id}/team`),
    );
    expect(within(panel).queryByRole("heading", { name: "Teams" })).toBeNull();
    expect(within(panel).queryByText(/playing in|either team/)).toBeNull();
  });

  it("marca la alineación de un evento cancelado", async () => {
    stubEvent(CANCELLED_SCRIMMAGE, PLAYING_IN_KELP);

    const panel = await openPanel(CANCELLED_SCRIMMAGE);

    const teams = await within(panel).findByRole("region", { name: "Teams" });
    expect(within(teams).getByText("Cancelled")).toBeInTheDocument();
  });

  it("no pide equipos de un evento que no se arma, como un social", async () => {
    stubEvent(SOCIAL, PLAYING_IN_KELP);

    await openPanel(SOCIAL);

    expect(requestedPaths).not.toContain(`${AGENDA_PATH}/${SOCIAL.id}/team`);
  });

  it("pide los equipos una sola vez aunque se elija otro evento y se vuelva a elegir", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP, [SOCIAL]);
    const panel = await openPanel(SCRIMMAGE);
    await within(panel).findByRole("list", { name: "Team Kelp" });

    await selectEvent(SOCIAL);
    const again = await selectEvent(SCRIMMAGE);

    await within(again).findByRole("list", { name: "Team Kelp" });
    expect(
      requestedPaths.filter(
        (path) => path === `${AGENDA_PATH}/${SCRIMMAGE.id}/team`,
      ),
    ).toHaveLength(1);
  });

  it("si los equipos no llegan lo dice y deja reintentar", async () => {
    stubEvent(SCRIMMAGE, "fails");
    const panel = await openPanel(SCRIMMAGE);
    expect(
      await within(panel).findByText("The teams could not be loaded."),
    ).toBeInTheDocument();
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    await userEvent.click(
      within(panel).getByRole("button", { name: "Load the teams again" }),
    );

    expect(
      await within(panel).findByRole("list", { name: "Team Kelp" }),
    ).toBeInTheDocument();
  });

  it("lo cuenta en español", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    const panel = await openPanel(SCRIMMAGE, "es");

    expect(
      await within(panel).findByText(
        "Juegas en Team Kelp, de color azul, como Delantero.",
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("region", { name: "Equipos" }),
    ).toBeInTheDocument();
    expect(
      within(within(panel).getByRole("list", { name: "Team Tide" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ethan BrownSin posición", "Valentina GómezPortero"]);
  });

  it("dice en español que no está en ningún equipo", async () => {
    stubEvent(SCRIMMAGE, NOT_ASSIGNED);

    const panel = await openPanel(SCRIMMAGE, "es");

    expect(
      await within(panel).findByText(
        "No estás en ninguno de los equipos de este evento.",
      ),
    ).toBeInTheDocument();
  });

  it("a quien juega sin posición se lo dice en la frase", async () => {
    stubEvent(SCRIMMAGE, {
      ...PLAYING_IN_KELP,
      me: { team: "b", position: null },
    });

    const panel = await openPanel(SCRIMMAGE);

    expect(
      await within(panel).findByText(
        "You're playing in Team Tide, colour gold, with no position.",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ["en", "You're playing in Team Tide, colour gold, as Goalkeeper."],
    ["es", "Juegas en Team Tide, de color dorado, como Portero."],
  ] as const)("dice el dorado por su nombre (%s)", async (locale, sentence) => {
    stubEvent(SCRIMMAGE, {
      ...PLAYING_IN_KELP,
      me: { team: "b", position: GOALKEEPER },
    });

    const panel = await openPanel(SCRIMMAGE, locale);

    expect(await within(panel).findByText(sentence)).toBeInTheDocument();
  });
});

/* "Ver equipos" del inicio (D6 del PRD de E27) abre el evento ya en sus
   equipos: el panel en escritorio, la pantalla entera en el móvil. */
describe("abrir el evento en sus equipos", () => {
  const PHONE_QUERY = "(width < 768px)";

  function stubPhone(): void {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    // jsdom no implementa el scroll de la ventana.
    vi.stubGlobal("scrollTo", vi.fn());
  }

  function renderOpenedInTeams(event: AgendaEvent): void {
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        focusEventId={event.id}
        shouldRevealTeams
      />,
    );
  }

  it("en escritorio elige el evento y lleva el foco a sus equipos", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP, [SOCIAL]);

    renderOpenedInTeams(SCRIMMAGE);

    const panel = await screen.findByRole("complementary", {
      name: SCRIMMAGE.title,
    });
    const teams = await within(panel).findByRole("heading", { name: "Teams" });
    await vi.waitFor(() => expect(teams).toHaveFocus());
  });

  it("sin pedir los equipos el foco se queda en el título, como desde la búsqueda", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        focusEventId={SCRIMMAGE.id}
      />,
    );

    const panel = await screen.findByRole("complementary", {
      name: SCRIMMAGE.title,
    });
    const teams = await within(panel).findByRole("heading", { name: "Teams" });
    const title = screen.getByRole("heading", {
      level: 3,
      name: SCRIMMAGE.title,
    });
    await vi.waitFor(() => expect(title).toHaveFocus());
    expect(teams).not.toHaveFocus();
  });

  it("en el móvil abre la pantalla del evento en sus equipos sin dejar otra entrada en el historial", async () => {
    stubPhone();
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    renderOpenedInTeams(SCRIMMAGE);

    const eventScreen = await screen.findByRole("article", {
      name: SCRIMMAGE.title,
    });
    const teams = await within(eventScreen).findByRole("heading", {
      name: "Teams",
    });
    await vi.waitFor(() => expect(teams).toHaveFocus());
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(
      expect.objectContaining({ calendarEventScreen: SCRIMMAGE.id }),
      "",
    );
  });

  it("en escritorio, si el evento no está en la agenda, elige el primero y no lleva el foco a sus equipos", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    renderOpenedInTeams(SOCIAL);

    const panel = await screen.findByRole("complementary", {
      name: SCRIMMAGE.title,
    });
    const teams = await within(panel).findByRole("heading", { name: "Teams" });
    expect(teams).not.toHaveFocus();
  });

  it("en el móvil, Volver con algo detrás vuelve atrás, a la página de la que se llegó", async () => {
    stubPhone();
    vi.stubGlobal("navigation", { canGoBack: true });
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);
    renderOpenedInTeams(SCRIMMAGE);
    const eventScreen = await screen.findByRole("article", {
      name: SCRIMMAGE.title,
    });

    await userEvent.click(
      within(eventScreen).getByRole("button", { name: "Back to calendar" }),
    );

    expect(back).toHaveBeenCalledTimes(1);
  });

  it("en el móvil, Volver sin nada detrás quita la marca y se queda en la agenda", async () => {
    stubPhone();
    vi.stubGlobal("navigation", { canGoBack: false });
    const back = vi.spyOn(window.history, "back");
    const replaceState = vi.spyOn(window.history, "replaceState");
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);
    renderOpenedInTeams(SCRIMMAGE);
    const eventScreen = await screen.findByRole("article", {
      name: SCRIMMAGE.title,
    });

    await userEvent.click(
      within(eventScreen).getByRole("button", { name: "Back to calendar" }),
    );

    expect(back).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ calendarEventScreen: SCRIMMAGE.id }),
      "",
    );
    expect(
      await screen.findByRole("heading", { level: 3, name: SCRIMMAGE.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("en el móvil, si el evento no está en la agenda, se queda en la agenda", async () => {
    stubPhone();
    stubEvent(SOCIAL, NOT_PUBLISHED);

    renderOpenedInTeams(SCRIMMAGE);

    await screen.findByRole("heading", { level: 3, name: SOCIAL.title });
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});
