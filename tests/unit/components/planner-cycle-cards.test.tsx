import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlannerCycleCards } from "@/components/training/PlannerCycleCards";
import { createTranslator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";

/**
 * Con cuatro ciclos o más la fila de tarjetas se desplaza de lado, y el botón
 * de crear ciclo no puede quedar cortado en el borde (#988): vive fuera de la
 * lista que se desplaza, pero sigue después de las tarjetas en el orden del
 * documento y del foco.
 */

const english = createTranslator("en");

function cycle(index: number): ManagedCycle {
  return {
    id: `aaaaaaaa-0000-4000-8000-00000000000${index}`,
    name: `Cycle ${index}`,
    status: index === 1 ? "active" : "draft",
    weeks: 8,
    startDate: "2027-01-04",
    event: null,
    ownRoutines: 0,
    audience: { kind: "club" },
  };
}

const FIRST_CYCLE = cycle(1);
const FOUR_CYCLES = [FIRST_CYCLE, cycle(2), cycle(3), cycle(4)];

function renderCards(): void {
  render(
    <PlannerCycleCards
      translate={english}
      cycles={FOUR_CYCLES}
      selectedId={FIRST_CYCLE.id}
      isBusy={false}
      onSelect={vi.fn()}
      onCreate={vi.fn()}
    />,
  );
}

describe("PlannerCycleCards", () => {
  it("deja el botón de crear ciclo fuera de la lista que se desplaza", () => {
    renderCards();

    const list = screen.getByRole("list", { name: "Cycles" });
    const newCycle = screen.getByRole("button", { name: "New cycle" });
    expect(list).not.toContainElement(newCycle);
  });

  it("pone el botón de crear ciclo después de la última tarjeta en el documento", () => {
    renderCards();

    const lastCard = screen.getByRole("button", { name: /Cycle 4/ });
    const newCycle = screen.getByRole("button", { name: "New cycle" });
    expect(
      lastCard.compareDocumentPosition(newCycle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("llega al botón de crear ciclo con el tabulador justo después de la última tarjeta", async () => {
    const user = userEvent.setup();
    renderCards();

    screen.getByRole("button", { name: /Cycle 4/ }).focus();
    await user.tab();

    expect(screen.getByRole("button", { name: "New cycle" })).toHaveFocus();
  });
});
