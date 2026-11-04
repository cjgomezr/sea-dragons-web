import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaCardContent } from "@/components/calendar/AgendaCard";
import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import type { AgendaEvent, MemberEventDetail } from "@/lib/events/event-agenda";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * El vídeo de la sesión en la agenda (#965, RF-4 y RF-5 del PRD de E37): la
 * fila de una sesión con vídeo lleva su icono, y el panel del evento ofrece
 * ponerlo a Admin, Committee y Coach, también en una sesión pasada.
 */

const AGENDA_PATH = "/api/v1/events";
const VIDEO = "https://youtu.be/abc123";

const TRAINING: AgendaEvent = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  startsOn: "2026-10-14",
  startTime: "18:00",
  endTime: "19:30",
  endsOn: null,
  title: "Pool training",
  eventType: "training",
  location: "MSAC",
  place: null,
  placeDetail: null,
  status: "scheduled",
  seriesId: "5e5e5e5e-0000-4000-8000-000000000005",
  goingCount: 3,
  maybeCount: 0,
  myResponse: null,
  inAudience: true,
  coverThumbUrl: null,
  videoUrl: null,
};

const RECORDED: AgendaEvent = {
  ...TRAINING,
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  startsOn: "2026-10-15",
  title: "Recorded training",
  videoUrl: VIDEO,
};

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

function stubApi(events: readonly AgendaEvent[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const { pathname } = new URL(input, "http://localhost");
      if (pathname === AGENDA_PATH) {
        return jsonResponse(200, { data: { events, nextCursor: null } });
      }
      if (pathname.endsWith("/team")) {
        return jsonResponse(200, { data: { status: "not_published" } });
      }
      if (pathname.endsWith("/video") && init?.method === "PUT") {
        const { url } = JSON.parse(String(init.body)) as { url: string };
        const eventId = pathname.split("/")[4];
        return jsonResponse(200, { data: { eventId, url } });
      }
      const event = events.find(
        (candidate) => pathname === `${AGENDA_PATH}/${candidate.id}`,
      );
      if (event === undefined) {
        throw new Error(`Petición inesperada: ${pathname}`);
      }
      return jsonResponse(200, { data: detailOf(event) });
    }),
  );
}

function renderAgenda(
  options: {
    readonly canPostVideos?: boolean;
    readonly initialPeriod?: "upcoming" | "past";
  } = {},
): void {
  render(
    <AgendaScreen
      locale="en"
      canManageEvents={false}
      canTakeAttendance={false}
      canRespond
      canPostVideos={options.canPostVideos ?? false}
      initialPeriod={options.initialPeriod ?? "upcoming"}
    />,
  );
}

async function findRow(title: string): Promise<HTMLElement> {
  const toggle = await screen.findByRole("button", { name: title });
  const row = toggle.closest("li");
  if (row === null) {
    throw new Error(`La fila de ${title} no está en una lista`);
  }
  return row;
}

async function openPanel(title: string): Promise<HTMLElement> {
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: title }));
  return screen.findByRole("complementary", { name: title });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el vídeo de la sesión en la agenda", () => {
  it.each(["upcoming", "past"] as const)(
    "pone el icono Has a video en la fila de una sesión con vídeo (%s)",
    async (initialPeriod) => {
      stubApi([TRAINING, RECORDED]);
      renderAgenda({ initialPeriod });

      const recorded = await findRow(RECORDED.title);
      const plain = await findRow(TRAINING.title);

      expect(
        within(recorded).getByRole("img", { name: "Has a video" }),
      ).toBeInTheDocument();
      expect(
        within(plain).queryByRole("img", { name: "Has a video" }),
      ).not.toBeInTheDocument();
    },
  );

  it("pone el icono en la tarjeta del móvil", () => {
    const translate = createTranslator("en");

    const { rerender } = render(
      <AgendaCardContent
        translate={translate}
        event={RECORDED}
        title={<h3>{RECORDED.title}</h3>}
        answer={null}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Has a video" }),
    ).toBeInTheDocument();
    rerender(
      <AgendaCardContent
        translate={translate}
        event={TRAINING}
        title={<h3>{TRAINING.title}</h3>}
        answer={null}
      />,
    );
    expect(
      screen.queryByRole("img", { name: "Has a video" }),
    ).not.toBeInTheDocument();
  });

  it("ofrece Add video en el panel de una sesión pasada a quien puede ponerlo", async () => {
    stubApi([TRAINING]);
    renderAgenda({ canPostVideos: true, initialPeriod: "past" });

    const panel = await openPanel(TRAINING.title);

    expect(
      within(panel).getByRole("button", { name: "Add video" }),
    ).toBeInTheDocument();
  });

  it("no ofrece Add video a un Player", async () => {
    stubApi([TRAINING]);
    renderAgenda({ canPostVideos: false });

    const panel = await openPanel(TRAINING.title);

    expect(
      within(panel).queryByRole("button", { name: "Add video" }),
    ).not.toBeInTheDocument();
  });

  it("enseña Watch session video a un Player en una sesión con vídeo", async () => {
    stubApi([RECORDED]);
    renderAgenda({ canPostVideos: false });

    const panel = await openPanel(RECORDED.title);

    expect(
      within(panel).getByRole("link", { name: /Watch session video/ }),
    ).toHaveAttribute("href", VIDEO);
  });

  it("al guardar el vídeo, la fila gana su icono sin recargar", async () => {
    const user = userEvent.setup();
    stubApi([TRAINING]);
    renderAgenda({ canPostVideos: true });
    const panel = await openPanel(TRAINING.title);

    await user.click(within(panel).getByRole("button", { name: "Add video" }));
    await user.type(
      within(panel).getByRole("textbox", { name: "YouTube link" }),
      VIDEO,
    );
    await user.click(within(panel).getByRole("button", { name: "Save" }));

    expect(
      await within(panel).findByRole("link", { name: /Watch session video/ }),
    ).toBeInTheDocument();
    expect(
      within(await findRow(TRAINING.title)).getByRole("img", {
        name: "Has a video",
      }),
    ).toBeInTheDocument();
  });
});
