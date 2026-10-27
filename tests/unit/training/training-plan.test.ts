import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import type { MembershipStatus } from "@/lib/membership/membership";
import {
  type ActiveTrainingPlan,
  type ExerciseItemRecord,
  type RoutineItemRecord,
  type TrainingCycleRecord,
  TrainingPlanBlockedError,
  type TrainingPlanGateways,
  type TrainingWeekRecord,
  TrainingWeekOutOfRangeError,
  readTrainingPlan,
} from "@/lib/training/training-plan";

/**
 * La semana del ciclo activo que ve el socio (#898, RF-3, RF-4 y RF-6 del PRD
 * de E35), con la puerta de estar al día (D2) que no cierra a quien planifica
 * (D3).
 */

const CALLER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const PHOTO_BASE = "https://example.supabase.co/storage/v1/object/public/";

/** Martes 6 de octubre de 2026 a las 10:00 de Melbourne: semana 2. */
const NOW = new Date("2026-10-05T23:00:00Z");

const CYCLE: TrainingCycleRecord = {
  id: "cycle-1",
  name: "Nationals build",
  eventName: "Nationals",
  eventDate: "2026-10-31",
  startDate: "2026-09-28",
  weeks: 4,
};

const SQUAT = { id: "mark-squat", name: "Back squat" };

const SECTION: RoutineItemRecord = {
  kind: "section",
  id: "item-section",
  position: 0,
  title: "Main 1",
};

const SQUAT_ROW: ExerciseItemRecord = {
  kind: "exercise",
  id: "item-squat",
  position: 1,
  exercise: {
    id: "ex-squat",
    name: "Barbell Squat",
    tips: ["Brace", "Knees out"],
    youtube: null,
    imageStartPath: "library/squat/0.jpg",
    imageEndPath: "library/squat/1.jpg",
  },
  sets: 3,
  reps: "5",
  rest: "2'",
  note: "Slow down",
  load: { kind: "week", mark: SQUAT },
};

const CRAWL_ROW: ExerciseItemRecord = {
  kind: "exercise",
  id: "item-crawl",
  position: 0,
  exercise: {
    id: "ex-crawl",
    name: "Front crawl",
    tips: [],
    youtube: "https://youtu.be/abc",
    imageStartPath: null,
    imageEndPath: null,
  },
  sets: null,
  reps: "400 m",
  rest: null,
  note: null,
  load: { kind: "text", text: "Easy" },
};

const WEEK: TrainingWeekRecord = {
  note: "Training Camp",
  dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 80 } },
  days: [
    {
      weekday: 1,
      slot: 2,
      routine: {
        id: "routine-gym",
        name: "Gym A",
        colorIndex: 1,
        // Desordenadas a propósito: la API las sirve por posición.
        items: [SQUAT_ROW, SECTION],
      },
    },
    {
      weekday: 1,
      slot: 1,
      routine: {
        id: "routine-pool",
        name: "Pool",
        colorIndex: 0,
        items: [CRAWL_ROW],
      },
    },
  ],
};

let role: Role;
let membershipStatus: MembershipStatus | null;
let activeCycle: TrainingCycleRecord | null;
let requestedWeeks: number[];

function gateways(): TrainingPlanGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Alba Ferrer",
        role,
      }),
    },
    membership: {
      findByUserId: async () =>
        membershipStatus === null
          ? null
          : {
              userId: CALLER_ID,
              clubId: CLUB_ID,
              plan: "Full",
              status: membershipStatus,
              stripeCustomerId: null,
              stripeSubscriptionId: null,
              currentPeriodEnd: null,
              trialEnd: null,
              card: null,
              waiver: null,
              scheduledChange: null,
            },
    },
    plan: {
      findActiveCycle: async () => activeCycle,
      findWeek: async ({ week }) => {
        requestedWeeks.push(week);
        return WEEK;
      },
      exercisePhotoUrl: (path) => `${PHOTO_BASE}${path}`,
    },
  };
}

function readPlan(week: number | null = null) {
  return readTrainingPlan(gateways(), { callerId: CALLER_ID, now: NOW, week });
}

async function readActivePlan(): Promise<ActiveTrainingPlan> {
  const plan = await readPlan();
  if (plan.cycle === null) {
    throw new Error("se esperaba un ciclo activo");
  }
  return plan;
}

beforeEach(() => {
  role = "Player";
  membershipStatus = "active";
  activeCycle = CYCLE;
  requestedWeeks = [];
});

describe("readTrainingPlan", () => {
  it("sirve el ciclo, la semana actual en Melbourne y esa semana", async () => {
    const plan = await readPlan();

    expect(plan.cycle).toEqual({
      id: "cycle-1",
      name: "Nationals build",
      event: { name: "Nationals", date: "2026-10-31" },
      startDate: "2026-09-28",
      endDate: "2026-10-25",
      weeks: 4,
    });
    expect(plan).toMatchObject({
      current: { week: 2, phase: "running", today: "2026-10-06" },
      week: {
        number: 2,
        note: "Training Camp",
        dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 80 } },
      },
    });
    expect(requestedWeeks).toEqual([2]);
  });

  it("trae los siete días con su fecha, de lunes a domingo", async () => {
    const plan = await readActivePlan();

    expect(plan.week.days.map((day) => [day.weekday, day.date])).toEqual([
      [0, "2026-10-05"],
      [1, "2026-10-06"],
      [2, "2026-10-07"],
      [3, "2026-10-08"],
      [4, "2026-10-09"],
      [5, "2026-10-10"],
      [6, "2026-10-11"],
    ]);
    expect(plan.week.days[0]?.routines).toEqual([]);
  });

  it("un día trae sus rutinas por ranura, cada una con sus filas en orden", async () => {
    const plan = await readActivePlan();

    const tuesday = plan.week.days[1];
    expect(tuesday?.routines.map((routine) => routine.name)).toEqual([
      "Pool",
      "Gym A",
    ]);
    expect(tuesday?.routines[1]).toMatchObject({
      id: "routine-gym",
      colorIndex: 1,
    });
    expect(tuesday?.routines[1]?.items.map((item) => item.id)).toEqual([
      "item-section",
      "item-squat",
    ]);
  });

  it("una fila de sección trae solo su título", async () => {
    const plan = await readActivePlan();

    expect(plan.week.days[1]?.routines[1]?.items[0]).toEqual({
      kind: "section",
      id: "item-section",
      title: "Main 1",
    });
  });

  it("una fila de ejercicio trae fotos, consejos, YouTube, dosis y carga", async () => {
    const plan = await readActivePlan();

    expect(plan.week.days[1]?.routines[1]?.items[1]).toEqual({
      kind: "exercise",
      id: "item-squat",
      exercise: {
        id: "ex-squat",
        name: "Barbell Squat",
        tips: ["Brace", "Knees out"],
        photoUrls: [
          `${PHOTO_BASE}library/squat/0.jpg`,
          `${PHOTO_BASE}library/squat/1.jpg`,
        ],
        youtubeUrl:
          "https://www.youtube.com/results?search_query=Barbell%20Squat",
      },
      sets: 3,
      reps: "5",
      rest: "2'",
      note: "Slow down",
      load: { kind: "week", mark: SQUAT },
    });
  });

  it("un ejercicio sin fotos y con enlace sirve el enlace y ninguna foto", async () => {
    const plan = await readActivePlan();

    expect(plan.week.days[1]?.routines[0]?.items[0]).toMatchObject({
      exercise: { photoUrls: [], youtubeUrl: "https://youtu.be/abc" },
      load: { kind: "text", text: "Easy" },
    });
  });

  it("un texto de YouTube que no es un enlace se busca tal cual (D13)", async () => {
    const week: TrainingWeekRecord = {
      ...WEEK,
      days: [
        {
          weekday: 0,
          slot: 1,
          routine: {
            id: "routine-pool",
            name: "Pool",
            colorIndex: 0,
            items: [
              {
                ...CRAWL_ROW,
                exercise: {
                  ...CRAWL_ROW.exercise,
                  youtube: "http://fin kick drill",
                  imageStartPath: "club/start.webp",
                },
              },
            ],
          },
        },
      ],
    };
    const base = gateways();
    const plan = await readTrainingPlan(
      { ...base, plan: { ...base.plan, findWeek: async () => week } },
      { callerId: CALLER_ID, now: NOW, week: null },
    );

    if (plan.cycle === null) {
      throw new Error("se esperaba un ciclo activo");
    }
    expect(plan.week.days[0]?.routines[0]?.items[0]).toMatchObject({
      exercise: {
        photoUrls: [`${PHOTO_BASE}club/start.webp`],
        youtubeUrl:
          "https://www.youtube.com/results?search_query=http%3A%2F%2Ffin%20kick%20drill",
      },
    });
  });

  it("con una semana pedida sirve esa y deja la actual", async () => {
    const plan = await readPlan(4);

    expect(plan).toMatchObject({
      current: { week: 2 },
      week: { number: 4 },
    });
    expect(requestedWeeks).toEqual([4]);
  });

  it.each([0, 5])("rechaza la semana %i, fuera de 1..N", async (week) => {
    await expect(readPlan(week)).rejects.toBeInstanceOf(
      TrainingWeekOutOfRangeError,
    );
    expect(requestedWeeks).toEqual([]);
  });

  it("sin ciclo activo sirve el ciclo nulo", async () => {
    activeCycle = null;

    await expect(readPlan()).resolves.toEqual({ cycle: null });
  });

  it("un ciclo sin evento no trae evento", async () => {
    activeCycle = { ...CYCLE, eventName: null, eventDate: null };

    const plan = await readPlan();

    expect(plan.cycle?.event).toBeNull();
  });

  it("antes del inicio sirve la semana 1 y dice que no empezó", async () => {
    activeCycle = { ...CYCLE, startDate: "2026-10-12" };

    const plan = await readPlan();

    expect(plan).toMatchObject({
      current: { week: 1, phase: "not_started" },
      week: { number: 1 },
    });
  });

  it("después del fin sirve la semana N y dice que terminó", async () => {
    activeCycle = { ...CYCLE, startDate: "2026-08-31" };

    const plan = await readPlan();

    expect(plan).toMatchObject({
      current: { week: 4, phase: "finished" },
      week: { number: 4 },
    });
  });

  it.each<[MembershipStatus | null, string]>([
    ["pending", "pending"],
    ["past_due", "past_due"],
    ["cancelled", "cancelled"],
    [null, "pending"],
  ])(
    "a un socio con la membresía %s lo para con su motivo y la cabecera",
    async (status, block) => {
      membershipStatus = status;

      const error = await readPlan().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(TrainingPlanBlockedError);
      expect(error).toMatchObject({
        block,
        cycle: { name: "Nationals build", endDate: "2026-10-25" },
      });
      expect(requestedWeeks).toEqual([]);
    },
  );

  it("a un socio sin estar al día y sin ciclo activo lo para sin cabecera", async () => {
    membershipStatus = "cancelled";
    activeCycle = null;

    await expect(readPlan()).rejects.toMatchObject({
      block: "cancelled",
      cycle: null,
    });
  });

  it("a un Committee sin estar al día también lo para", async () => {
    role = "Committee";
    membershipStatus = "past_due";

    await expect(readPlan()).rejects.toBeInstanceOf(TrainingPlanBlockedError);
  });

  it.each<Role>(["Admin", "Coach"])(
    "a un %s sin la membresía al día le sirve el plan entero (D3)",
    async (plannerRole) => {
      role = plannerRole;
      membershipStatus = "cancelled";

      const plan = await readPlan();

      expect(plan).toMatchObject({ week: { number: 2 } });
    },
  );

  it("sin fila de socio no sirve nada", async () => {
    const base = gateways();

    await expect(
      readTrainingPlan(
        { ...base, members: { findRoleRequestMember: async () => null } },
        { callerId: CALLER_ID, now: NOW, week: null },
      ),
    ).rejects.toThrow(CALLER_ID);
  });
});
