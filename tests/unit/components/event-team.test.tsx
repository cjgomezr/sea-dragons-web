import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import type { AgendaEvent, MemberEventDetail } from "@/lib/events/event-agenda";
import type { Locale } from "@/lib/i18n/locale";
import type { MyTeam } from "@/lib/teams/my-team";

/**
 * El equipo de quien mira dentro del evento desplegado (#403, RF-8 del PRD de
 * E10, FR-048, AC-020): la tarjeta "Juegas en {equipo}" y la alineación de
 * los dos equipos, sin un OVR (D3). Quién juega dónde lo decide el servidor
 * (#401); aquí se prueba que la pantalla pinta lo que responde.
 */

const AGENDA_PATH = "/api/v1/events";

const SCRIMMAGE: AgendaEvent = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  startsOn: "2026-06-27",
  startTime: "10:00",
  title: "Scrimmage vs Geelong",
  eventType: "competition",
  location: "Geelong Aquatic Centre",
  status: "scheduled",
  seriesId: null,
  goingCount: 6,
  maybeCount: 0,
  myResponse: "yes",
  inAudience: true,
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
  return { ...event, notes: null, going: [], maybe: [] };
}

/** La agenda con un evento, su detalle y lo que responda su equipo. */
function stubEvent(event: AgendaEvent, team: TeamReply): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const { pathname } = new URL(input, "http://localhost");
      requestedPaths.push(pathname);
      if (pathname === AGENDA_PATH) {
        return jsonResponse(200, {
          data: { events: [event], nextCursor: null },
        });
      }
      if (pathname === `${AGENDA_PATH}/${event.id}`) {
        return jsonResponse(200, { data: detailOf(event) });
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

async function expandEvent(
  event: AgendaEvent,
  locale: Locale = "en",
): Promise<HTMLElement> {
  render(
    <AgendaScreen
      locale={locale}
      canManageEvents={false}
      canTakeAttendance={false}
    />,
  );
  const heading = await screen.findByRole("heading", { name: event.title });
  await userEvent.click(within(heading).getByRole("button"));
  const row = heading.closest("li");
  if (row === null) {
    throw new Error(`La fila de ${event.title} no es un elemento de la lista.`);
  }
  return row;
}

afterEach(() => {
  requestedPaths.length = 0;
  vi.unstubAllGlobals();
});

describe("el equipo en el evento desplegado", () => {
  it("dice en qué equipo juega quien mira, con su color y su posición, como una frase", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    const row = await expandEvent(SCRIMMAGE);

    expect(
      await within(row).findByText(
        "You're playing in Team Kelp, colour blue, as Forward.",
      ),
    ).toBeInTheDocument();
  });

  it("pinta la tarjeta con el color del equipo", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    const row = await expandEvent(SCRIMMAGE);

    const sentence = await within(row).findByText(
      "You're playing in Team Kelp, colour blue, as Forward.",
    );
    const card = sentence.closest(".event-my-team");
    expect(card).toHaveStyle({ "--team-color": "#1C6EA4" });
  });

  it("pone la alineación de los dos equipos con el nombre y la posición de cada uno", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    const row = await expandEvent(SCRIMMAGE);

    const kelp = await within(row).findByRole("list", { name: "Team Kelp" });
    const tide = within(row).getByRole("list", { name: "Team Tide" });
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

    const row = await expandEvent(SCRIMMAGE);

    await within(row).findByRole("list", { name: "Team Kelp" });
    expect(row).not.toHaveTextContent(/OVR|unrated|not rated|\d\.\d/i);
  });

  it("a quien no está en ningún equipo le enseña la alineación y se lo dice", async () => {
    stubEvent(SCRIMMAGE, NOT_ASSIGNED);

    const row = await expandEvent(SCRIMMAGE);

    expect(
      await within(row).findByText("You're not in either team for this event."),
    ).toBeInTheDocument();
    expect(within(row).queryByText(/^You're playing in/)).toBeNull();
    expect(
      within(row).getByRole("list", { name: "Team Kelp" }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("list", { name: "Team Tide" }),
    ).toBeInTheDocument();
  });

  it("no enseña nada de equipos si el reparto no está publicado", async () => {
    stubEvent(SCRIMMAGE, NOT_PUBLISHED);

    const row = await expandEvent(SCRIMMAGE);

    await within(row).findByText("This event has no notes.");
    await vi.waitFor(() =>
      expect(requestedPaths).toContain(`${AGENDA_PATH}/${SCRIMMAGE.id}/team`),
    );
    expect(within(row).queryByRole("heading", { name: "Teams" })).toBeNull();
    expect(within(row).queryByText(/playing in|either team/)).toBeNull();
  });

  it("marca la alineación de un evento cancelado", async () => {
    stubEvent(CANCELLED_SCRIMMAGE, PLAYING_IN_KELP);

    const row = await expandEvent(CANCELLED_SCRIMMAGE);

    const teams = await within(row).findByRole("region", { name: "Teams" });
    expect(within(teams).getByText("Cancelled")).toBeInTheDocument();
  });

  it("no pide equipos de un evento que no se arma, como un social", async () => {
    stubEvent(SOCIAL, PLAYING_IN_KELP);

    const row = await expandEvent(SOCIAL);

    await within(row).findByText("This event has no notes.");
    expect(requestedPaths).not.toContain(`${AGENDA_PATH}/${SOCIAL.id}/team`);
  });

  it("pide los equipos una sola vez aunque se pliegue y se vuelva a desplegar", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);
    const row = await expandEvent(SCRIMMAGE);
    await within(row).findByRole("list", { name: "Team Kelp" });
    const toggle = within(row).getByRole("button", { name: SCRIMMAGE.title });

    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(
      requestedPaths.filter(
        (path) => path === `${AGENDA_PATH}/${SCRIMMAGE.id}/team`,
      ),
    ).toHaveLength(1);
  });

  it("si los equipos no llegan lo dice y deja reintentar", async () => {
    stubEvent(SCRIMMAGE, "fails");
    const row = await expandEvent(SCRIMMAGE);
    expect(
      await within(row).findByText("The teams could not be loaded."),
    ).toBeInTheDocument();
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    await userEvent.click(
      within(row).getByRole("button", { name: "Load the teams again" }),
    );

    expect(
      await within(row).findByRole("list", { name: "Team Kelp" }),
    ).toBeInTheDocument();
  });

  it("lo cuenta en español", async () => {
    stubEvent(SCRIMMAGE, PLAYING_IN_KELP);

    const row = await expandEvent(SCRIMMAGE, "es");

    expect(
      await within(row).findByText(
        "Juegas en Team Kelp, de color azul, como Delantero.",
      ),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("region", { name: "Equipos" }),
    ).toBeInTheDocument();
    expect(
      within(within(row).getByRole("list", { name: "Team Tide" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ethan BrownSin posición", "Valentina GómezPortero"]);
  });

  it("dice en español que no está en ningún equipo", async () => {
    stubEvent(SCRIMMAGE, NOT_ASSIGNED);

    const row = await expandEvent(SCRIMMAGE, "es");

    expect(
      await within(row).findByText(
        "No estás en ninguno de los equipos de este evento.",
      ),
    ).toBeInTheDocument();
  });

  it("a quien juega sin posición se lo dice en la frase", async () => {
    stubEvent(SCRIMMAGE, {
      ...PLAYING_IN_KELP,
      me: { team: "b", position: null },
    });

    const row = await expandEvent(SCRIMMAGE);

    expect(
      await within(row).findByText(
        "You're playing in Team Tide, colour yellow, with no position.",
      ),
    ).toBeInTheDocument();
  });
});
