import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlayerColumn } from "@/components/dashboard/PlayerColumn";
import type { AttendedSession } from "@/lib/attendance/season-attendance";
import type {
  ActiveMembershipSummary,
  DashboardMe,
  RestrictedMembershipSummary,
} from "@/lib/dashboard/dashboard";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La columna del Player en el inicio (#749, RF-5, D8 y D13 del PRD de E27):
 * "Mi asistencia" de la temporada con las últimas 10 sesiones, y la tarjeta
 * de la membresía con la flecha a Pagos.
 */

const STATUSES = ["present", "late", "absent"] as const;

function session(index: number): AttendedSession {
  const day = String(index + 1).padStart(2, "0");
  return {
    eventId: `event-${index}`,
    startsOn: `2026-09-${day}`,
    status: STATUSES[index % STATUSES.length] ?? "present",
  };
}

function sessions(count: number): readonly AttendedSession[] {
  return Array.from({ length: count }, (_, index) => session(index));
}

const ATTENDANCE: DashboardMe["attendance"] = {
  percent: 82,
  attended: 18,
  sessions: 22,
  last10: sessions(10),
};

const ACTIVE: ActiveMembershipSummary = {
  status: "active",
  plan: "Full",
  renewsOn: "2027-06-30",
};

function restricted(
  block: RestrictedMembershipSummary["block"],
  endedOn: string | null = null,
): RestrictedMembershipSummary {
  return { status: "restricted", block, endedOn };
}

function renderColumn(
  options: {
    readonly attendance?: DashboardMe["attendance"];
    readonly membership?: ActiveMembershipSummary | RestrictedMembershipSummary;
    readonly locale?: "en" | "es";
    readonly onRetry?: () => void;
  } = {},
): void {
  render(
    <PlayerColumn
      translate={createTranslator(options.locale ?? "en")}
      attendance={
        options.attendance === undefined ? ATTENDANCE : options.attendance
      }
      membership={options.membership ?? ACTIVE}
      onRetry={options.onRetry ?? vi.fn()}
    />,
  );
}

function attendanceCard(name = "My attendance"): HTMLElement {
  return screen.getByRole("region", { name });
}

function membershipCard(name = "Membership"): HTMLElement {
  return screen.getByRole("region", { name });
}

function lastTen(name = "Last 10 sessions"): HTMLElement {
  return within(attendanceCard()).getByRole("list", { name });
}

describe("Mi asistencia (#749)", () => {
  it("dice la temporada, el porcentaje y cuántas sesiones de cuántas", () => {
    renderColumn();

    const card = attendanceCard();
    expect(
      within(card).getByRole("heading", { level: 2, name: "My attendance" }),
    ).toBeInTheDocument();
    expect(within(card).getByText("This season")).toBeInTheDocument();
    expect(within(card).getByText("82%")).toBeInTheDocument();
    expect(within(card).getByText("18 of 22 sessions")).toBeInTheDocument();
  });

  it("con una sola sesión la dice en singular", () => {
    renderColumn({
      attendance: {
        percent: 100,
        attended: 1,
        sessions: 1,
        last10: sessions(1),
      },
    });

    expect(
      within(attendanceCard()).getByText("1 of 1 session"),
    ).toBeInTheDocument();
  });

  it("pinta las últimas 10 en orden, cada una con su fecha y su estado", () => {
    renderColumn();

    expect(within(attendanceCard()).getByText("Last 10")).toBeInTheDocument();
    const blocks = within(lastTen()).getAllByRole("listitem");
    expect(blocks.map((block) => block.textContent)).toEqual([
      "1 September 2026: Present",
      "2 September 2026: Late",
      "3 September 2026: Absent",
      "4 September 2026: Present",
      "5 September 2026: Late",
      "6 September 2026: Absent",
      "7 September 2026: Present",
      "8 September 2026: Late",
      "9 September 2026: Absent",
      "10 September 2026: Present",
    ]);
  });

  it("pinta cada bloque con el color de su estado", () => {
    renderColumn();

    const [present, late, absent] = within(lastTen()).getAllByRole("listitem");
    expect(present).toHaveClass("dashboard-attendance-block-present");
    expect(late).toHaveClass("dashboard-attendance-block-late");
    expect(absent).toHaveClass("dashboard-attendance-block-absent");
  });

  it("lleva la leyenda de los tres estados", () => {
    renderColumn();

    const legend = within(attendanceCard()).getByRole("list", {
      name: "Legend",
    });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Present", "Late", "Absent"]);
  });

  it("con menos de 10 sesiones pinta sólo las que hay", () => {
    renderColumn({
      attendance: {
        percent: 67,
        attended: 2,
        sessions: 3,
        last10: sessions(3),
      },
    });

    expect(within(lastTen()).getAllByRole("listitem")).toHaveLength(3);
  });

  it("sin sesiones lo dice y no pinta porcentaje ni bloques", () => {
    renderColumn({ attendance: null });

    const card = attendanceCard();
    expect(
      within(card).getByText("No sessions yet this season."),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/%$/)).not.toBeInTheDocument();
    expect(within(card).queryByRole("list")).not.toBeInTheDocument();
  });

  it("si no se pudo leer lo dice con Reintentar", async () => {
    const onRetry = vi.fn();
    renderColumn({ attendance: { kind: "unavailable" }, onRetry });

    const card = attendanceCard();
    expect(
      within(card).getByText("We couldn't load your attendance."),
    ).toBeInTheDocument();
    await userEvent.click(
      within(card).getByRole("button", { name: "Try again" }),
    );

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("lo dice todo en español", () => {
    renderColumn({ locale: "es" });

    const card = attendanceCard("Mi asistencia");
    expect(within(card).getByText("Esta temporada")).toBeInTheDocument();
    expect(within(card).getByText("18 de 22 sesiones")).toBeInTheDocument();
    expect(within(card).getByText("Últimas 10")).toBeInTheDocument();
    const blocks = within(card).getByRole("list", {
      name: "Últimas 10 sesiones",
    });
    expect(within(blocks).getAllByRole("listitem")[1]).toHaveTextContent(
      "2 de septiembre de 2026: Tarde",
    );
  });

  it("sin sesiones lo dice en español", () => {
    renderColumn({ attendance: null, locale: "es" });

    expect(
      within(attendanceCard("Mi asistencia")).getByText(
        "Todavía no hay sesiones esta temporada.",
      ),
    ).toBeInTheDocument();
  });
});

describe("la membresía (#749)", () => {
  it("al día dice que está activa, el plan y cuándo se renueva, en éxito", () => {
    renderColumn();

    const card = membershipCard();
    expect(card).toHaveClass("dashboard-membership-card-active");
    expect(within(card).getByText("Membership active")).toBeInTheDocument();
    expect(
      within(card).getByText("Full member · renews 30 June 2027"),
    ).toBeInTheDocument();
  });

  it("sin renovación dice sólo el plan", () => {
    renderColumn({ membership: { ...ACTIVE, renewsOn: null } });

    expect(
      within(membershipCard()).getByText("Full member"),
    ).toBeInTheDocument();
  });

  it("sin plan dice sólo cuándo se renueva", () => {
    renderColumn({ membership: { ...ACTIVE, plan: null } });

    expect(
      within(membershipCard()).getByText("Renews 30 June 2027"),
    ).toBeInTheDocument();
  });

  it("lleva la flecha a Pagos", () => {
    renderColumn();

    expect(
      within(membershipCard()).getByRole("link", { name: "Open Payments" }),
    ).toHaveAttribute("href", "/pagos");
  });

  it("vencida con fecha dice cuándo venció y que se renueva en Pagos, en peligro", () => {
    renderColumn({ membership: restricted("cancelled", "2026-09-30") });

    const card = membershipCard();
    expect(card).toHaveClass("dashboard-membership-card-restricted");
    expect(within(card).getByText("Membership expired")).toBeInTheDocument();
    expect(
      within(card).getByText("Expired 30 September 2026 · renew in Payments"),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "Open Payments" }),
    ).toHaveAttribute("href", "/pagos");
  });

  it("vencida sin fecha no la dice", () => {
    renderColumn({ membership: restricted("cancelled") });

    const card = membershipCard();
    expect(within(card).getByText("Membership expired")).toBeInTheDocument();
    expect(within(card).getByText("Renew in Payments")).toBeInTheDocument();
  });

  it.each([
    ["pending", "Membership pending", "Add a card in Payments"],
    ["past_due", "Payment failed", "Update your card in Payments"],
  ] as const)(
    "con el bloqueo %s dice su estado en peligro",
    (block, title, detail) => {
      renderColumn({ membership: restricted(block) });

      const card = membershipCard();
      expect(card).toHaveClass("dashboard-membership-card-restricted");
      expect(within(card).getByText(title)).toBeInTheDocument();
      expect(within(card).getByText(detail)).toBeInTheDocument();
    },
  );

  it("lo dice en español", () => {
    renderColumn({ locale: "es" });

    const card = membershipCard("Membresía");
    expect(within(card).getByText("Membresía activa")).toBeInTheDocument();
    expect(
      within(card).getByText("Plan Full · se renueva el 30 de junio de 2027"),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "Abrir Pagos" }),
    ).toBeInTheDocument();
  });

  it("vencida lo dice en español", () => {
    renderColumn({
      membership: restricted("cancelled", "2026-09-30"),
      locale: "es",
    });

    const card = membershipCard("Membresía");
    expect(within(card).getByText("Membresía vencida")).toBeInTheDocument();
    expect(
      within(card).getByText(
        "Venció el 30 de septiembre de 2026 · renueva en Pagos",
      ),
    ).toBeInTheDocument();
  });
});
