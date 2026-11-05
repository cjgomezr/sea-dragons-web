import { describe, expect, it } from "vitest";
import type { TrainingCycleRecord } from "@/lib/training/training-plan";
import { cyclesVisibleTo, defaultCycleOf } from "@/lib/training/visible-cycles";

/**
 * Qué ciclos activos ve cada uno y cuál se abre al entrar (#979, D4, D5 y D6
 * del PRD de E38).
 */

const GROUP_A = { id: "group-a", name: "Juveniles" };
const GROUP_B = { id: "group-b", name: "Masters" };
const GROUP_C = { id: "group-c", name: "Open" };

function cycle(
  id: string,
  audience: TrainingCycleRecord["audience"],
  name = id,
): TrainingCycleRecord {
  return {
    id,
    name,
    eventName: null,
    eventDate: null,
    startDate: "2026-09-28",
    weeks: 4,
    audience,
  };
}

const CLUB = cycle("club", { kind: "club" }, "Todo el club");
const OF_A = cycle("of-a", { kind: "groups", groups: [GROUP_A] }, "Juveniles");
const OF_B = cycle("of-b", { kind: "groups", groups: [GROUP_B] }, "Masters");
const OF_B_AND_C = cycle(
  "of-b-c",
  { kind: "groups", groups: [GROUP_B, GROUP_C] },
  "Adultos",
);
const WITHOUT_GROUPS = cycle("empty", { kind: "groups", groups: [] }, "Vacío");

const ALL = [OF_B, CLUB, OF_A, WITHOUT_GROUPS];

describe("los ciclos que ve un socio", () => {
  it("un socio del grupo A ve el de todo el club y los que incluyen A", () => {
    const visible = cyclesVisibleTo(ALL, {
      kind: "member",
      groupIds: [GROUP_A.id],
    });

    expect(visible.map((each) => each.id)).toEqual(["of-a", "club"]);
  });

  it("un socio sin grupos ve sólo el de todo el club", () => {
    const visible = cyclesVisibleTo(ALL, { kind: "member", groupIds: [] });

    expect(visible.map((each) => each.id)).toEqual(["club"]);
  });

  it("un socio sin grupos y sin ciclo de todo el club no ve ninguno", () => {
    const visible = cyclesVisibleTo([OF_A, OF_B], {
      kind: "member",
      groupIds: [],
    });

    expect(visible).toEqual([]);
  });

  it("un socio ve un ciclo de varios grupos si está en uno de ellos", () => {
    const visible = cyclesVisibleTo([OF_B_AND_C], {
      kind: "member",
      groupIds: [GROUP_C.id],
    });

    expect(visible.map((each) => each.id)).toEqual(["of-b-c"]);
  });

  it("quien planifica los ve todos por nombre, también el de grupos sin grupos", () => {
    const visible = cyclesVisibleTo(ALL, { kind: "planner" });

    expect(visible.map((each) => each.name)).toEqual([
      "Juveniles",
      "Masters",
      "Todo el club",
      "Vacío",
    ]);
  });
});

describe("el ciclo por defecto", () => {
  it("con un solo ciclo, ese", () => {
    expect(defaultCycleOf([CLUB], [])).toBe(CLUB);
  });

  it("el de un grupo del socio va antes que el de todo el club", () => {
    expect(defaultCycleOf([CLUB, OF_A], [GROUP_A.id])).toBe(OF_A);
  });

  it("entre dos de sus grupos, el primero por nombre", () => {
    expect(defaultCycleOf([OF_B, OF_A], [GROUP_A.id, GROUP_B.id])).toBe(OF_A);
  });

  it("a quien no está en ningún grupo de los que ve, el de todo el club", () => {
    expect(defaultCycleOf([OF_B, CLUB, OF_A], [])).toBe(CLUB);
  });

  it("sin el de todo el club ni los de sus grupos, el primero por nombre", () => {
    expect(defaultCycleOf([OF_B, OF_A], [])).toBe(OF_A);
  });

  it("con la lista vacía, ninguno", () => {
    expect(defaultCycleOf([], [GROUP_A.id])).toBeNull();
  });
});
