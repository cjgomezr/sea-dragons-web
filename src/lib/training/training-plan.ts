import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import {
  type MembershipBlock,
  type MembershipGateway,
  membershipBlockOf,
  readMembership,
} from "@/lib/membership/membership";
import type { ExerciseSource } from "./club-exercises";
import {
  type CycleWeekPosition,
  cycleDayDate,
  cycleEndDate,
  cycleWeekAt,
} from "./cycle-week";
import type { RoutineLoad, WeekDose } from "./training-load";

/**
 * La semana del ciclo activo que ve el socio (#898, RF-3, RF-4 y RF-6 del PRD
 * de E35). La lee el servidor con la llave de servicio porque la puerta
 * cerrada también enseña la cabecera del ciclo, que RLS le esconde a quien no
 * está al día. La regla de la puerta es la de E12 (D2), salvo para quien
 * planifica (D3).
 */

/** Los que planifican ven el plan aunque su membresía no esté al día (D3). */
const PLANNER_ROLES: ReadonlySet<Role> = new Set(["Admin", "Coach"]);

/** Si el rol planifica el entrenamiento (D3): Admin y Coach. */
export function canPlanTraining(role: Role): boolean {
  return PLANNER_ROLES.has(role);
}

const FIRST_WEEK = 1;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

const YOUTUBE_LINK_PREFIX = "https://";
const YOUTUBE_SEARCH_URL = "https://www.youtube.com/results?search_query=";

export type TrainingCycleRecord = {
  readonly id: string;
  readonly name: string;
  readonly eventName: string | null;
  /** YYYY-MM-DD. */
  readonly eventDate: string | null;
  /** YYYY-MM-DD, el lunes de la semana 1. */
  readonly startDate: string;
  readonly weeks: number;
};

export type ExerciseRecord = {
  readonly id: string;
  readonly name: string;
  readonly source: ExerciseSource;
  readonly tips: readonly string[];
  /** Un enlace `https://`, un texto que buscar, o nulo: la biblioteca busca
   * entonces el nombre y el club no tiene botón (D13). */
  readonly youtube: string | null;
  readonly imageStartPath: string | null;
  readonly imageEndPath: string | null;
};

type RowDose = {
  readonly sets: number | null;
  readonly reps: string | null;
  readonly rest: string | null;
  readonly note: string | null;
  readonly load: RoutineLoad;
};

export type SectionItemRecord = {
  readonly kind: "section";
  readonly id: string;
  readonly position: number;
  readonly title: string;
};

export type ExerciseItemRecord = RowDose & {
  readonly kind: "exercise";
  readonly id: string;
  readonly position: number;
  readonly exercise: ExerciseRecord;
};

export type RoutineItemRecord = SectionItemRecord | ExerciseItemRecord;

export type RoutineRecord = {
  readonly id: string;
  readonly name: string;
  readonly colorIndex: number;
  readonly items: readonly RoutineItemRecord[];
};

/** Una rutina puesta en un día de la cuadrícula, en su ranura (D7). */
export type ScheduledRoutineRecord = {
  /** 0 es el lunes. */
  readonly weekday: number;
  readonly slot: number;
  readonly routine: RoutineRecord;
};

export type TrainingWeekRecord = {
  readonly note: string | null;
  readonly dose: WeekDose | null;
  readonly days: readonly ScheduledRoutineRecord[];
};

export type TrainingPlanGateway = {
  findActiveCycle(clubId: string): Promise<TrainingCycleRecord | null>;
  findWeek(query: {
    readonly clubId: string;
    readonly cycleId: string;
    readonly week: number;
  }): Promise<TrainingWeekRecord>;
  /** La URL pública de una foto del bucket de ejercicios (#896). */
  exercisePhotoUrl(path: string): string;
};

export type TrainingPlanGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly membership: MembershipGateway;
  readonly plan: TrainingPlanGateway;
};

export type TrainingPlanRequest = {
  readonly callerId: string;
  readonly now: Date;
  /** La semana pedida; nula para la actual. */
  readonly week: number | null;
};

export type TrainingCycle = {
  readonly id: string;
  readonly name: string;
  readonly event: {
    readonly name: string;
    readonly date: string | null;
  } | null;
  readonly startDate: string;
  /** El domingo de la última semana. */
  readonly endDate: string;
  readonly weeks: number;
};

export type TrainingExercise = {
  readonly id: string;
  readonly name: string;
  readonly tips: readonly string[];
  /** Las de inicio y fin que tenga: 0, 1 o 2. */
  readonly photoUrls: readonly string[];
  /** El enlace del ejercicio, la búsqueda que toca, o nulo si no tiene
   * botón (D13). */
  readonly youtubeUrl: string | null;
};

export type TrainingRoutineItem =
  | {
      readonly kind: "section";
      readonly id: string;
      readonly title: string;
    }
  | (RowDose & {
      readonly kind: "exercise";
      readonly id: string;
      readonly exercise: TrainingExercise;
    });

export type TrainingRoutine = {
  readonly id: string;
  readonly name: string;
  readonly colorIndex: number;
  readonly items: readonly TrainingRoutineItem[];
};

export type TrainingDay = {
  readonly weekday: number;
  /** YYYY-MM-DD. */
  readonly date: string;
  /** 0, 1 o 2, en el orden de su ranura. Sin ninguna, descanso. */
  readonly routines: readonly TrainingRoutine[];
};

export type TrainingWeek = {
  readonly number: number;
  readonly note: string | null;
  readonly dose: WeekDose | null;
  readonly days: readonly TrainingDay[];
};

export type ActiveTrainingPlan = {
  readonly cycle: TrainingCycle;
  /** Dónde cae hoy, para volver a esta semana desde otra. */
  readonly current: CycleWeekPosition;
  readonly week: TrainingWeek;
};

export type TrainingPlan = { readonly cycle: null } | ActiveTrainingPlan;

/** La puerta cerrada (RF-6): el motivo y la cabecera del ciclo, sin días ni
 * rutinas. */
export class TrainingPlanBlockedError extends Error {
  readonly block: MembershipBlock;
  readonly cycle: TrainingCycle | null;

  constructor(block: MembershipBlock, cycle: TrainingCycle | null) {
    super(`El plan está cerrado para una membresía ${block}.`);
    this.name = "TrainingPlanBlockedError";
    this.block = block;
    this.cycle = cycle;
  }
}

export class TrainingWeekOutOfRangeError extends Error {
  constructor(week: number, weeks: number) {
    super(`La semana ${week} no está entre 1 y ${weeks}.`);
    this.name = "TrainingWeekOutOfRangeError";
  }
}

function toTrainingCycle(record: TrainingCycleRecord): TrainingCycle {
  return {
    id: record.id,
    name: record.name,
    event:
      record.eventName === null
        ? null
        : { name: record.eventName, date: record.eventDate },
    startDate: record.startDate,
    endDate: cycleEndDate(record),
    weeks: record.weeks,
  };
}

function youtubeSearchUrl(query: string): string {
  return `${YOUTUBE_SEARCH_URL}${encodeURIComponent(query)}`;
}

/** A dónde lleva "Watch on YouTube" (D13). Un ejercicio del club con el campo
 * vacío no tiene botón: su nombre ("Swim set") no encuentra nada útil. */
export function youtubeUrlOf(exercise: ExerciseRecord): string | null {
  const youtube = exercise.youtube?.trim() ?? "";
  if (youtube.startsWith(YOUTUBE_LINK_PREFIX)) {
    return youtube;
  }
  if (youtube !== "") {
    return youtubeSearchUrl(youtube);
  }
  return exercise.source === "club" ? null : youtubeSearchUrl(exercise.name);
}

function toTrainingExercise(
  exercise: ExerciseRecord,
  gateway: TrainingPlanGateway,
): TrainingExercise {
  const paths = [exercise.imageStartPath, exercise.imageEndPath].filter(
    (path): path is string => path !== null,
  );
  return {
    id: exercise.id,
    name: exercise.name,
    tips: exercise.tips,
    photoUrls: paths.map((path) => gateway.exercisePhotoUrl(path)),
    youtubeUrl: youtubeUrlOf(exercise),
  };
}

function toRoutineItem(
  item: RoutineItemRecord,
  gateway: TrainingPlanGateway,
): TrainingRoutineItem {
  if (item.kind === "section") {
    return { kind: "section", id: item.id, title: item.title };
  }
  return {
    kind: "exercise",
    id: item.id,
    exercise: toTrainingExercise(item.exercise, gateway),
    sets: item.sets,
    reps: item.reps,
    rest: item.rest,
    note: item.note,
    load: item.load,
  };
}

function toTrainingRoutine(
  routine: RoutineRecord,
  gateway: TrainingPlanGateway,
): TrainingRoutine {
  return {
    id: routine.id,
    name: routine.name,
    colorIndex: routine.colorIndex,
    items: [...routine.items]
      .sort((a, b) => a.position - b.position)
      .map((item) => toRoutineItem(item, gateway)),
  };
}

function toTrainingWeek(
  input: {
    readonly cycle: TrainingCycleRecord;
    readonly week: number;
    readonly record: TrainingWeekRecord;
  },
  gateway: TrainingPlanGateway,
): TrainingWeek {
  const { cycle, week, record } = input;
  const days = WEEKDAYS.map((weekday) => ({
    weekday,
    date: cycleDayDate(cycle, { week, weekday }),
    routines: record.days
      .filter((day) => day.weekday === weekday)
      .sort((a, b) => a.slot - b.slot)
      .map((day) => toTrainingRoutine(day.routine, gateway)),
  }));
  return { number: week, note: record.note, dose: record.dose, days };
}

/** Si quien llama puede ver el plan, o el motivo por el que no. */
async function readBlock(
  gateways: TrainingPlanGateways,
  request: TrainingPlanRequest & { readonly role: Role },
): Promise<MembershipBlock | null> {
  if (canPlanTraining(request.role)) {
    return null;
  }
  return membershipBlockOf(
    await readMembership(gateways.membership, {
      userId: request.callerId,
      now: request.now,
    }),
  );
}

function weekToServe(
  cycle: TrainingCycleRecord,
  request: { readonly week: number | null; readonly current: number },
): number {
  if (request.week === null) {
    return request.current;
  }
  if (request.week < FIRST_WEEK || request.week > cycle.weeks) {
    throw new TrainingWeekOutOfRangeError(request.week, cycle.weeks);
  }
  return request.week;
}

export async function readTrainingPlan(
  gateways: TrainingPlanGateways,
  request: TrainingPlanRequest,
): Promise<TrainingPlan> {
  const caller = await gateways.members.findRoleRequestMember(request.callerId);
  if (caller === null) {
    throw new MemberNotFoundError(request.callerId);
  }
  const [record, block] = await Promise.all([
    gateways.plan.findActiveCycle(caller.clubId),
    readBlock(gateways, { ...request, role: caller.role }),
  ]);
  if (block !== null) {
    throw new TrainingPlanBlockedError(
      block,
      record === null ? null : toTrainingCycle(record),
    );
  }
  if (record === null) {
    return { cycle: null };
  }
  const current = cycleWeekAt(record, request.now);
  const week = weekToServe(record, {
    week: request.week,
    current: current.week,
  });
  const weekRecord = await gateways.plan.findWeek({
    clubId: caller.clubId,
    cycleId: record.id,
    week,
  });
  return {
    cycle: toTrainingCycle(record),
    current,
    week: toTrainingWeek(
      { cycle: record, week, record: weekRecord },
      gateways.plan,
    ),
  };
}
