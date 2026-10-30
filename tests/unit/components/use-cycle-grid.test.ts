import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CycleGrid,
  type CycleGridState,
  useCycleGrid,
} from "@/components/training/use-cycle-grid";
import type {
  CycleDayRecord,
  CycleWeekRecord,
  ManagedCycle,
} from "@/lib/training/club-cycles";

/**
 * Vaciar una semana desde el estado de la cuadrícula (#943): con la
 * respuesta de la API cambian los días y las semanas; con un fallo no cambia
 * nada y Planificar lo dice.
 */

const CYCLE: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Winter",
  status: "draft",
  weeks: 4,
  startDate: "2026-11-16",
  event: null,
  ownRoutines: 1,
};
const ROUTINE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const CLEAR_PATH = `/api/v1/training/manage/cycles/${CYCLE.id}/weeks/2/clear`;

const DAYS: readonly CycleDayRecord[] = [
  { weekNo: 2, weekday: 0, slot: 1, routineId: ROUTINE_ID },
  { weekNo: 3, weekday: 0, slot: 1, routineId: ROUTINE_ID },
];
const WEEKS: readonly CycleWeekRecord[] = [
  { weekNo: 1, note: null, dose: null },
  { weekNo: 2, note: "Load", dose: null },
  { weekNo: 3, note: "Peak", dose: null },
  { weekNo: 4, note: null, dose: null },
];
const CLEARED_WEEKS = WEEKS.map((week) =>
  week.weekNo === 2 ? { ...week, note: null } : week,
);
const CLEARED_DAYS = DAYS.filter((day) => day.weekNo !== 2);

type Reply = { readonly status: number; readonly body: unknown };

function stubApi(clearReply: Reply): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = new URL(input, "http://localhost").pathname;
      const { status, body } =
        path === CLEAR_PATH
          ? clearReply
          : path.endsWith("/routines")
            ? { status: 200, body: { data: { routines: [] } } }
            : {
                status: 200,
                body: { data: { cycle: CYCLE, weeks: WEEKS, days: DAYS } },
              };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

const showError = vi.fn();

async function readyGrid(): Promise<{ readonly current: CycleGrid }> {
  const { result } = renderHook(() => useCycleGrid(CYCLE, { showError }));
  await waitFor(() => expect(result.current.state.kind).toBe("ready"));
  return result;
}

function planOf(state: CycleGridState) {
  if (state.kind !== "ready") {
    throw new Error("la cuadrícula no está lista");
  }
  return state.plan;
}

beforeEach(() => {
  showError.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCycleGrid", () => {
  it("clearWeek pone los días y las semanas que responde la API", async () => {
    stubApi({
      status: 200,
      body: {
        data: { cycle: CYCLE, weeks: CLEARED_WEEKS, days: CLEARED_DAYS },
      },
    });
    const grid = await readyGrid();

    let isCleared = false;
    await act(async () => {
      isCleared = await grid.current.clearWeek(2);
    });

    expect(isCleared).toBe(true);
    expect(planOf(grid.current.state)).toEqual({
      weeks: CLEARED_WEEKS,
      days: CLEARED_DAYS,
    });
  });

  it("clearWeek con un fallo no cambia nada y lo dice", async () => {
    stubApi({
      status: 500,
      body: { error: { code: "internal_error", message: "x" } },
    });
    const grid = await readyGrid();

    let isCleared = true;
    await act(async () => {
      isCleared = await grid.current.clearWeek(2);
    });

    expect(isCleared).toBe(false);
    expect(planOf(grid.current.state)).toEqual({ weeks: WEEKS, days: DAYS });
    expect(showError).toHaveBeenLastCalledWith({ reason: null });
  });
});
