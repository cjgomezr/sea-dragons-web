import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ManagementColumn,
  type OpenableSections,
} from "@/components/dashboard/ManagementColumn";
import type {
  ClubNumbers,
  DashboardMe,
  DashboardTodos,
} from "@/lib/dashboard/dashboard";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La columna de gestión del inicio (#750, RF-6, D3, D9, D11 y D13 del PRD de
 * E27): "Pendientes" con lo que le toca resolver a Admin, Coach o Committee,
 * y "Números del club" en una cuadrícula de 2 × 2.
 */

const ROLE_REQUESTS = { kind: "role_requests", count: 3 } as const;

const ATTENDANCE_MISSING = {
  kind: "attendance_missing",
  eventId: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Wednesday training",
  startsOn: "2026-10-14",
} as const;

const TEAMS_UNPUBLISHED = {
  kind: "teams_unpublished",
  eventId: "bbbbbbbb-0000-4000-8000-000000000002",
  title: "Saturday scrimmage",
} as const;

const TEAMS_DROPPED = {
  kind: "teams_dropped",
  eventId: "bbbbbbbb-0000-4000-8000-000000000002",
  title: "Saturday scrimmage",
  count: 2,
} as const;

const NO_REPLY = {
  kind: "no_reply",
  eventId: "bbbbbbbb-0000-4000-8000-000000000002",
  title: "Saturday scrimmage",
  count: 6,
} as const;

const ALL_TODOS: DashboardTodos = [
  ROLE_REQUESTS,
  ATTENDANCE_MISSING,
  TEAMS_UNPUBLISHED,
  NO_REPLY,
];

const CLUB: ClubNumbers = {
  attendance: { percent: 78, previousPercent: 74 },
  members: { active: 86, joinedThisMonth: 4 },
  unreadNews: { count: 2, announcements: 1 },
};

const MY_ATTENDANCE: DashboardMe["attendance"] = {
  percent: 85,
  attended: 11,
  sessions: 13,
  last10: [],
};

const ALL_SECTIONS: OpenableSections = {
  attendance: true,
  directory: true,
  news: true,
};

const NO_SECTIONS: OpenableSections = {
  attendance: false,
  directory: false,
  news: false,
};

function renderColumn(
  options: {
    readonly todos?: DashboardTodos;
    readonly club?: ClubNumbers;
    readonly myAttendance?: DashboardMe["attendance"];
    readonly openableSections?: OpenableSections;
    readonly locale?: "en" | "es";
    readonly onRetry?: () => void;
  } = {},
): void {
  render(
    <ManagementColumn
      translate={createTranslator(options.locale ?? "en")}
      todos={options.todos ?? ALL_TODOS}
      club={options.club ?? CLUB}
      myAttendance={
        options.myAttendance === undefined
          ? MY_ATTENDANCE
          : options.myAttendance
      }
      openableSections={options.openableSections ?? ALL_SECTIONS}
      onRetry={options.onRetry ?? vi.fn()}
    />,
  );
}

function todoCard(name = "To do"): HTMLElement {
  return screen.getByRole("region", { name });
}

function clubCard(name = "Club numbers"): HTMLElement {
  return screen.getByRole("region", { name });
}

function todoRows(): readonly HTMLElement[] {
  return within(todoCard()).getAllByRole("listitem");
}

/** La fila del pendiente cuyo título es `title`. */
function todoRow(title: string): HTMLElement {
  const row = todoRows().find((candidate) =>
    within(candidate).queryByText(title),
  );
  if (row === undefined) {
    throw new Error(`No hay pendiente "${title}".`);
  }
  return row;
}

function clubCells(): readonly HTMLElement[] {
  return within(clubCard()).getAllByRole("listitem");
}

/** La celda de los números del club cuya etiqueta es `label`. */
function clubCell(label: string): HTMLElement {
  const cell = clubCells().find((candidate) =>
    within(candidate).queryByText(label),
  );
  if (cell === undefined) {
    throw new Error(`No hay celda "${label}".`);
  }
  return cell;
}

describe("ManagementColumn: Pendientes", () => {
  it("counts the rows in a warning badge", () => {
    renderColumn();

    const badge = within(todoCard()).getByText("4");

    expect(badge).toHaveClass("dashboard-todos-badge");
    expect(todoRows()).toHaveLength(4);
  });

  it("sends role requests to the directory with Review", () => {
    renderColumn({ todos: [ROLE_REQUESTS] });

    const row = todoRow("3 role requests");

    expect(within(row).getByText("Waiting for your approval")).toBeVisible();
    expect(within(row).getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/directorio",
    );
  });

  it("writes a single role request in the singular", () => {
    renderColumn({ todos: [{ kind: "role_requests", count: 1 }] });

    expect(within(todoCard()).getByText("1 role request")).toBeVisible();
  });

  it("sends a missing attendance to that session's sheet with Take", () => {
    renderColumn({ todos: [ATTENDANCE_MISSING] });

    const row = todoRow("Take attendance");

    expect(
      within(row).getByText("Wednesday training · Wed 14 Oct"),
    ).toBeVisible();
    expect(within(row).getByRole("link", { name: "Take" })).toHaveAttribute(
      "href",
      `/asistencia?sesion=${ATTENDANCE_MISSING.eventId}`,
    );
  });

  it("sends unpublished teams to that event's team builder with Open", () => {
    renderColumn({ todos: [TEAMS_UNPUBLISHED] });

    const row = todoRow("Publish teams");

    expect(
      within(row).getByText("Saturday scrimmage · saved, not published"),
    ).toBeVisible();
    expect(within(row).getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      `/equipos?evento=${TEAMS_UNPUBLISHED.eventId}`,
    );
  });

  it("sends the players who dropped out to that event's team builder with Open (#838)", () => {
    renderColumn({ todos: [TEAMS_DROPPED] });

    const row = todoRow("2 players dropped out of published teams");

    expect(within(row).getByText("Saturday scrimmage")).toBeVisible();
    expect(within(row).getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      `/equipos?evento=${TEAMS_DROPPED.eventId}`,
    );
  });

  it("writes the players who dropped out in Spanish, in the singular", () => {
    renderColumn({
      todos: [{ ...TEAMS_DROPPED, count: 1 }],
      locale: "es",
    });

    expect(
      within(todoCard("Pendientes")).getByText(
        "1 ya no viene en un reparto publicado",
      ),
    ).toBeVisible();
  });

  it("writes them in Spanish, in the plural", () => {
    renderColumn({ todos: [TEAMS_DROPPED], locale: "es" });

    expect(
      within(todoCard("Pendientes")).getByText(
        "2 ya no vienen en un reparto publicado",
      ),
    ).toBeVisible();
  });

  it("sends the missing replies to the event with See who", () => {
    renderColumn({ todos: [NO_REPLY] });

    const row = todoRow("6 haven't replied");

    expect(within(row).getByText("Saturday scrimmage")).toBeVisible();
    expect(within(row).getByRole("link", { name: "See who" })).toHaveAttribute(
      "href",
      `/calendario?evento=${NO_REPLY.eventId}`,
    );
  });

  it("describes each action with its row's title", () => {
    renderColumn({ todos: [ATTENDANCE_MISSING] });

    expect(
      within(todoRow("Take attendance")).getByRole("link", { name: "Take" }),
    ).toHaveAccessibleDescription("Take attendance");
  });

  it("says everything is up to date without a badge when there is nothing", () => {
    renderColumn({ todos: [] });

    const card = todoCard();

    expect(within(card).getByText("✓ All caught up.")).toHaveClass(
      "dashboard-todos-empty",
    );
    expect(within(card).queryByRole("list")).not.toBeInTheDocument();
    expect(
      card.querySelector(".dashboard-todos-badge"),
    ).not.toBeInTheDocument();
  });

  it("offers to retry when the to-dos could not be loaded", async () => {
    const onRetry = vi.fn();
    renderColumn({ todos: { kind: "unavailable" }, onRetry });

    const card = todoCard();
    expect(
      within(card).getByText("We couldn't load your to-dos."),
    ).toBeVisible();
    await userEvent.click(
      within(card).getByRole("button", { name: "Try again" }),
    );

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("speaks Spanish", () => {
    renderColumn({ locale: "es" });

    const card = todoCard("Pendientes");

    expect(within(card).getByText("3 solicitudes de rol")).toBeVisible();
    expect(
      within(card).getByText("Saturday scrimmage · guardado, sin publicar"),
    ).toBeVisible();
    expect(within(card).getByRole("link", { name: "Ver quién" })).toBeVisible();
  });
});

describe("ManagementColumn: Números del club", () => {
  it("lays out the four numbers with their captions", () => {
    renderColumn();

    expect(clubCells()).toHaveLength(4);
    expect(within(clubCell("Club attendance")).getByText("78%")).toBeVisible();
    expect(within(clubCell("My attendance")).getByText("85%")).toBeVisible();
    expect(
      within(clubCell("My attendance")).getByText("11 of 13 sessions"),
    ).toBeVisible();
    expect(within(clubCell("Members")).getByText("86")).toBeVisible();
    expect(
      within(clubCell("Members")).getByText("+4 this month"),
    ).toBeVisible();
    expect(within(clubCell("Unread news")).getByText("2")).toBeVisible();
    expect(
      within(clubCell("Unread news")).getByText("1 announcement"),
    ).toBeVisible();
  });

  it("marks a rise in club attendance as a success", () => {
    renderColumn();

    expect(
      within(clubCell("Club attendance")).getByText("↑ 4 pts vs last month"),
    ).toHaveClass("dashboard-club-trend-up");
  });

  it("marks a drop in club attendance as a danger", () => {
    renderColumn({
      club: { ...CLUB, attendance: { percent: 70, previousPercent: 76 } },
    });

    expect(
      within(clubCell("Club attendance")).getByText("↓ 6 pts vs last month"),
    ).toHaveClass("dashboard-club-trend-down");
  });

  it("shows no comparison when club attendance stayed the same", () => {
    renderColumn({
      club: { ...CLUB, attendance: { percent: 78, previousPercent: 78 } },
    });

    expect(
      within(clubCell("Club attendance")).queryByText(/pts vs last month/),
    ).not.toBeInTheDocument();
  });

  it("shows no comparison when last month has no data", () => {
    renderColumn({
      club: { ...CLUB, attendance: { percent: 78, previousPercent: null } },
    });

    const cell = clubCell("Club attendance");

    expect(within(cell).getByText("78%")).toBeVisible();
    expect(
      within(cell).queryByText(/pts vs last month/),
    ).not.toBeInTheDocument();
  });

  it("says there is no data when this month has none", () => {
    renderColumn({
      club: { ...CLUB, attendance: { percent: null, previousPercent: 74 } },
    });

    const cell = clubCell("Club attendance");

    expect(within(cell).getByText("No data")).toBeVisible();
    expect(
      within(cell).queryByText(/pts vs last month/),
    ).not.toBeInTheDocument();
  });

  it("hides my attendance when I have no eligible sessions", () => {
    renderColumn({ myAttendance: null });

    expect(clubCells()).toHaveLength(3);
    expect(
      within(clubCard()).queryByText("My attendance"),
    ).not.toBeInTheDocument();
  });

  it("links each number to its section when the role can open it", () => {
    renderColumn({ openableSections: ALL_SECTIONS });

    const card = clubCard();

    expect(
      within(card).getByRole("link", { name: /Club attendance/ }),
    ).toHaveAttribute("href", "/asistencia");
    expect(within(card).getByRole("link", { name: /Members/ })).toHaveAttribute(
      "href",
      "/directorio",
    );
    expect(
      within(card).getByRole("link", { name: /Unread news/ }),
    ).toHaveAttribute("href", "/noticias");
  });

  it("leaves a number as text when the role cannot open its section", () => {
    renderColumn({
      openableSections: { attendance: false, directory: true, news: true },
    });

    expect(
      within(clubCard()).queryByRole("link", { name: /Club attendance/ }),
    ).not.toBeInTheDocument();
    expect(within(clubCell("Club attendance")).getByText("78%")).toBeVisible();
  });

  it("links nothing when the role can open none of the sections", () => {
    renderColumn({ openableSections: NO_SECTIONS });

    expect(within(clubCard()).queryAllByRole("link")).toHaveLength(0);
  });

  it("never links my own attendance", () => {
    renderColumn({ openableSections: ALL_SECTIONS });

    expect(
      within(clubCell("My attendance")).queryByRole("link"),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["club attendance", { ...CLUB, attendance: { kind: "unavailable" } }],
    ["members", { ...CLUB, members: { kind: "unavailable" } }],
    ["unread news", { ...CLUB, unreadNews: { kind: "unavailable" } }],
  ] as const)(
    "offers to retry when the %s could not be loaded",
    async (_part, club) => {
      const onRetry = vi.fn();
      renderColumn({ club, onRetry });

      const card = clubCard();
      expect(
        within(card).getByText("We couldn't load the club numbers."),
      ).toBeVisible();
      expect(within(card).queryByRole("list")).not.toBeInTheDocument();
      await userEvent.click(
        within(card).getByRole("button", { name: "Try again" }),
      );

      expect(onRetry).toHaveBeenCalledOnce();
    },
  );

  it("offers to retry when my attendance could not be loaded", () => {
    renderColumn({ myAttendance: { kind: "unavailable" } });

    expect(
      within(clubCard()).getByText("We couldn't load the club numbers."),
    ).toBeVisible();
  });

  it("speaks Spanish", () => {
    renderColumn({ locale: "es" });

    const card = clubCard("Números del club");

    expect(within(card).getByText("Asistencia del club")).toBeVisible();
    expect(within(card).getByText("↑ 4 pts vs el mes pasado")).toBeVisible();
    expect(within(card).getByText("+4 este mes")).toBeVisible();
    expect(within(card).getByText("1 aviso")).toBeVisible();
  });
});
