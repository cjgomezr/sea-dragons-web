import { z } from "zod";
import { normalizeForSearch } from "@/lib/text/name-search";
import { clubDaysBetween } from "@/lib/time/club-calendar";
import { WEEK_NOTE_MAX_LENGTH } from "./club-cycle-input";
import type { CycleDaySlot } from "./club-cycles";
import {
  ITEM_NOTE_MAX_LENGTH,
  ITEM_REPS_MAX_LENGTH,
  ITEM_REST_MAX_LENGTH,
  LOAD_TEXT_MAX_LENGTH,
  SECTION_TITLE_MAX_LENGTH,
  countCharacters,
} from "./routine-items";
import type { DoseIntensity, WeekDose } from "./training-load";

/**
 * El plan de muestra pasado a un ciclo (#912, RF-13 y D16 del PRD de E35).
 * Pura: lee `plan-uwr-sep-2026.json` y dice qué ciclo, rutinas, semanas y
 * días hay que crear, con los ejercicios y las marcas por su nombre. Es una
 * muestra y se aproxima: lo que no cabe en su columna va a la nota, y la
 * sesión opcional de la semana no se carga.
 */

export const SAMPLE_CYCLE_NAME = "UWR macrocycle Sep 2026";
/** Los ejercicios del club con que se escriben la piscina y el ESC (D9). */
export const SWIM_SET_EXERCISE = "Swim set";
export const ESC_INTERVAL_EXERCISE = "ESC interval";

const MACRO_VOLUME = "Macro Vol";
const MACRO_INTENSITY = "Macro %";
const NOTE_SEPARATOR = " · ";
const ELLIPSIS = "…";
const DAYS_PER_WEEK = 7;
const SLOTS: readonly CycleDaySlot[] = [1, 2];
/** La intensidad de la muestra es una fracción: 0,65 es el 65 %, con un
 * decimal como mucho. */
const FRACTION_TO_PCT_TENTHS = 1000;
const PCT_TENTHS = 10;

/** La marca de cada ejercicio con filas "Macro Vol", en el orden en que se
 * crean las marcas. */
const MACRO_MARKS: ReadonlyMap<string, string> = new Map([
  ["Back Squat", "Back squat"],
  ["Half Back Squat (fast concentric)", "Back squat"],
  ["Deadlift", "Deadlift"],
  ["Bench Press", "Bench press"],
  ["Bench Press (fast concentric)", "Bench press"],
  ["Supinated Pull Up", "Pull-up"],
  ["Pronated Pull Up", "Pull-up"],
]);

const sessionIndex = z.number().int().nonnegative();

const sessionRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("swim"),
    sub: z.enum(["endurance", "anaerobic", "alactic"]),
    idx: sessionIndex,
  }),
  z.object({
    kind: z.literal("esc"),
    sub: z.enum(["aerobic", "anaerobic", "alactic"]),
    idx: sessionIndex,
  }),
  z.object({
    kind: z.literal("gym"),
    phase: z.enum(["transmutation", "realization", "maintenance"]),
    day: sessionIndex,
  }),
]);

const swimSessionSchema = z.object({
  title: z.string(),
  rows: z.array(
    z.object({
      sec: z.string(),
      vol: z.string(),
      desc: z.string(),
      cycle: z.string(),
      int: z.string(),
      note: z.string(),
    }),
  ),
});

const escSessionSchema = z.object({
  title: z.string(),
  rows: z.array(z.object({ rounds: z.string(), work: z.string() })),
});

const gymRowSchema = z.object({
  group: z.string(),
  ex: z.string(),
  sets: z.string(),
  load: z.string(),
  note: z.string(),
});

const gymDays = z.array(z.array(gymRowSchema));

const sampleSchema = z.object({
  weeks: z
    .array(
      z.object({
        start: z.iso.date(),
        phase: z.string(),
        event: z.string(),
        vol: z.string(),
        intensity: z.union([z.number(), z.string()]),
        days: z.array(
          z.object({ date: z.iso.date(), items: z.array(sessionRefSchema) }),
        ),
      }),
    )
    .min(1),
  lib: z.object({
    endurance: z.array(swimSessionSchema),
    anaerobic: z.array(swimSessionSchema),
    alactic: z.array(swimSessionSchema),
    esc: z.object({
      aerobic: z.array(escSessionSchema),
      anaerobic: z.array(escSessionSchema),
      alactic: z.array(escSessionSchema),
    }),
    gym: z.object({
      transmutation: gymDays,
      realization: gymDays,
      maintenance: gymDays,
    }),
  }),
  guide: z.record(
    z.string(),
    z.object({ yt: z.string(), cues: z.array(z.string()) }),
  ),
  gmap: z.record(z.string(), z.string()),
});

type Sample = z.infer<typeof sampleSchema>;
type SessionRef = z.infer<typeof sessionRefSchema>;
type GymRow = z.infer<typeof gymRowSchema>;
type SwimRow = z.infer<typeof swimSessionSchema>["rows"][number];
type EscRow = z.infer<typeof escSessionSchema>["rows"][number];

/** La carga de una fila, con la marca por su nombre. */
export type SampleLoad =
  | { readonly kind: "none" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "week"; readonly markName: string };

export type SampleItem =
  | { readonly kind: "section"; readonly title: string }
  | {
      readonly kind: "exercise";
      readonly exerciseName: string;
      readonly sets: number | null;
      readonly reps: string | null;
      readonly rest: string | null;
      readonly note: string | null;
      readonly load: SampleLoad;
    };

export type SampleRoutine = {
  readonly name: string;
  readonly items: readonly SampleItem[];
};

/** Un ejercicio que las filas nombran: se busca en la biblioteca y el club,
 * y si no está se crea con lo que dice la guía de la muestra. */
export type SampleExercise = {
  readonly name: string;
  readonly tips: readonly string[];
  readonly youtube: string;
};

export type SampleWeek = {
  readonly weekNo: number;
  readonly note: string | null;
  readonly dose: WeekDose | null;
};

/** `routineIndex` es su posición en `routines`. 0 es el lunes. */
export type SampleDay = {
  readonly weekNo: number;
  readonly weekday: number;
  readonly slot: CycleDaySlot;
  readonly routineIndex: number;
};

export type SampleCyclePlan = {
  readonly cycle: {
    readonly name: string;
    /** YYYY-MM-DD, el lunes de la semana 1. */
    readonly startDate: string;
    readonly weeks: number;
  };
  readonly marks: readonly string[];
  readonly exercises: readonly SampleExercise[];
  readonly routines: readonly SampleRoutine[];
  /** Sólo las semanas con nota o dosis. */
  readonly weeks: readonly SampleWeek[];
  readonly days: readonly SampleDay[];
};

export class SampleCycleError extends Error {
  constructor(message: string) {
    super(`La muestra no vale: ${message}`);
    this.name = "SampleCycleError";
  }
}

const NO_LOAD: SampleLoad = { kind: "none" };

/** Lo que una fila de ejercicio trae antes de repartirlo en columnas: un
 * texto vacío es que no lo lleva. */
type ExerciseDraft = {
  readonly exerciseName: string;
  readonly sets: number | null;
  readonly reps: string;
  readonly rest: string;
  readonly notes: readonly string[];
  readonly load: SampleLoad;
};

function fits(text: string, maxLength: number): boolean {
  return countCharacters(text) <= maxLength;
}

/** Recortado a `maxLength` caracteres, con puntos suspensivos si no cabe. */
function shorten(text: string, maxLength: number): string {
  if (fits(text, maxLength)) {
    return text;
  }
  const kept = [...text].slice(0, maxLength - ELLIPSIS.length).join("");
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

function joinNote(parts: readonly string[], maxLength: number): string | null {
  const note = parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(NOTE_SEPARATOR);
  return note === "" ? null : shorten(note, maxLength);
}

/** El texto si cabe en su columna; vacío o demasiado largo, nulo. */
function columnText(text: string, maxLength: number): string | null {
  const trimmed = text.trim();
  return trimmed !== "" && fits(trimmed, maxLength) ? trimmed : null;
}

/** Lo que no cabe en las repeticiones o el descanso pasa a la nota. */
function exerciseItem(draft: ExerciseDraft): SampleItem {
  const reps = columnText(draft.reps, ITEM_REPS_MAX_LENGTH);
  const rest = columnText(draft.rest, ITEM_REST_MAX_LENGTH);
  const overflow = [
    reps === null ? draft.reps : "",
    rest === null ? draft.rest : "",
  ];
  return {
    kind: "exercise",
    exerciseName: draft.exerciseName.trim(),
    sets: draft.sets,
    reps,
    rest,
    note: joinNote([...overflow, ...draft.notes], ITEM_NOTE_MAX_LENGTH),
    load: draft.load,
  };
}

function section(title: string): SampleItem {
  return {
    kind: "section",
    title: shorten(title.trim(), SECTION_TITLE_MAX_LENGTH),
  };
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

const SETS_AND_REPS = /^(\d+)\s*x\s*(.*)$/i;
const REPS_ONLY = /^x\s*(.+)$/i;

/** "4x 5" son 4 series de 5; "x8", 8 repeticiones; lo demás ("5-4-3-3",
 * "30sec"), repeticiones tal cual. */
function parseVolume(text: string): { sets: number | null; reps: string } {
  const trimmed = text.trim();
  const setsAndReps = SETS_AND_REPS.exec(trimmed);
  if (setsAndReps !== null) {
    return {
      sets: Number(setsAndReps[1]),
      reps: (setsAndReps[2] ?? "").trim(),
    };
  }
  const repsOnly = REPS_ONLY.exec(trimmed);
  return { sets: null, reps: (repsOnly?.[1] ?? trimmed).trim() };
}

/** "Macro Vol" y "Macro %" son la dosis de la semana sobre su marca (D6);
 * otra intensidad ("RPE 9") va a la nota. */
function macroExercise(row: GymRow): SampleItem {
  const exerciseName = row.ex.trim();
  const markName = MACRO_MARKS.get(exerciseName);
  if (markName === undefined) {
    throw new SampleCycleError(
      `la fila ${MACRO_VOLUME} de "${exerciseName}" no tiene una marca conocida.`,
    );
  }
  const intensity = row.load.trim();
  return exerciseItem({
    exerciseName,
    sets: null,
    reps: "",
    rest: "",
    notes: [intensity === MACRO_INTENSITY ? "" : intensity, row.note],
    load: { kind: "week", markName },
  });
}

/** La carga de la muestra es un texto ("RPE 7", "@50%"); si no cabe, va a
 * la nota. */
function gymExercise(row: GymRow): SampleItem {
  if (row.sets.trim() === MACRO_VOLUME) {
    return macroExercise(row);
  }
  const loadText = columnText(row.load, LOAD_TEXT_MAX_LENGTH);
  return exerciseItem({
    exerciseName: row.ex,
    ...parseVolume(row.sets),
    rest: "",
    notes: [loadText === null ? row.load : "", row.note],
    load: loadText === null ? NO_LOAD : { kind: "text", text: loadText },
  });
}

/** El grupo es el título de su sección; el ejercicio, una fila. */
function gymItems(rows: readonly GymRow[]): readonly SampleItem[] {
  return rows.flatMap((row) => [
    ...(isBlank(row.group) ? [] : [section(row.group)]),
    ...(isBlank(row.ex) ? [] : [gymExercise(row)]),
  ]);
}

function swimItems(rows: readonly SwimRow[]): readonly SampleItem[] {
  return rows.flatMap((row) => {
    const hasSet = [row.vol, row.desc, row.cycle, row.int, row.note].some(
      (text) => !isBlank(text),
    );
    return [
      ...(isBlank(row.sec) ? [] : [section(row.sec)]),
      ...(hasSet
        ? [
            exerciseItem({
              exerciseName: SWIM_SET_EXERCISE,
              sets: null,
              reps: row.vol,
              rest: row.cycle,
              notes: [row.desc, row.int, row.note],
              load: NO_LOAD,
            }),
          ]
        : []),
    ];
  });
}

/** Unas rondas sin trabajo son un título ("Technique Basics and Tips"). */
function escItems(rows: readonly EscRow[]): readonly SampleItem[] {
  return rows.flatMap((row) => {
    if (isBlank(row.work)) {
      return isBlank(row.rounds) ? [] : [section(row.rounds)];
    }
    return [
      exerciseItem({
        exerciseName: ESC_INTERVAL_EXERCISE,
        sets: null,
        reps: row.rounds,
        rest: "",
        notes: [row.work],
        load: NO_LOAD,
      }),
    ];
  });
}

function pick<T>(list: readonly T[], index: number, label: string): T {
  const found = list[index];
  if (found === undefined) {
    throw new SampleCycleError(`no existe la sesión ${label}.`);
  }
  return found;
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function sessionKey(ref: SessionRef): string {
  return ref.kind === "gym"
    ? `gym:${ref.phase}:${ref.day}`
    : `${ref.kind}:${ref.sub}:${ref.idx}`;
}

function routineFor(ref: SessionRef, lib: Sample["lib"]): SampleRoutine {
  const label = sessionKey(ref);
  switch (ref.kind) {
    case "gym":
      return {
        name: `Gym · ${capitalize(ref.phase)} · ${ref.day + 1}`,
        items: gymItems(pick(lib.gym[ref.phase], ref.day, label)),
      };
    case "swim": {
      const session = pick(lib[ref.sub], ref.idx, label);
      return { name: session.title.trim(), items: swimItems(session.rows) };
    }
    case "esc": {
      const session = pick(lib.esc[ref.sub], ref.idx, label);
      return {
        name: `ESC · ${session.title.trim()}`,
        items: escItems(session.rows),
      };
    }
  }
}

/** Las sesiones que algún día usa, cada una una vez y en el orden en que
 * aparecen. La opcional de la semana (`extra`) no cuenta. */
function usedSessions(sample: Sample): ReadonlyMap<string, SessionRef> {
  const refs = sample.weeks.flatMap((week) =>
    week.days.flatMap((day) => day.items),
  );
  return new Map(refs.map((ref) => [sessionKey(ref), ref] as const));
}

function doseIntensity(raw: number | string): DoseIntensity {
  if (typeof raw === "number") {
    return {
      kind: "pct",
      pct: Math.round(raw * FRACTION_TO_PCT_TENTHS) / PCT_TENTHS,
    };
  }
  const text = raw.trim();
  return text === "" ? { kind: "none" } : { kind: "text", text };
}

function weekDose(vol: string, intensity: number | string): WeekDose | null {
  const { sets, reps } = parseVolume(vol);
  const dose = {
    sets,
    reps: reps === "" ? null : reps,
    intensity: doseIntensity(intensity),
  };
  const isEmpty =
    dose.sets === null && dose.reps === null && dose.intensity.kind === "none";
  return isEmpty ? null : dose;
}

/** La semana y el día de la semana de `date`, contados desde el lunes de la
 * semana 1: la muestra salta números, las fechas no. */
function positionOf(
  startDate: string,
  date: string,
): { weekNo: number; weekday: number } {
  const days = clubDaysBetween(startDate, date);
  return {
    weekNo: Math.floor(days / DAYS_PER_WEEK) + 1,
    weekday: days % DAYS_PER_WEEK,
  };
}

function sampleWeeks(sample: Sample, startDate: string): readonly SampleWeek[] {
  return sample.weeks.map((week) => ({
    weekNo: positionOf(startDate, week.start).weekNo,
    note: joinNote([week.phase, week.event], WEEK_NOTE_MAX_LENGTH),
    dose: weekDose(week.vol, week.intensity),
  }));
}

function sampleDays(
  sample: Sample,
  context: {
    readonly startDate: string;
    readonly routineKeys: readonly string[];
  },
): readonly SampleDay[] {
  return sample.weeks.flatMap((week) =>
    week.days.flatMap((day) =>
      day.items.map((ref, index) => ({
        ...positionOf(context.startDate, day.date),
        slot: pick(SLOTS, index, `${day.date} en la ranura ${index + 1}`),
        routineIndex: context.routineKeys.indexOf(sessionKey(ref)),
      })),
    ),
  );
}

/** Cada ejercicio una vez, sin contar mayúsculas ni tildes: el club no
 * admite dos que se lean igual (D13). */
function sampleExercises(
  sample: Sample,
  routines: readonly SampleRoutine[],
): readonly SampleExercise[] {
  const byKey = new Map<string, SampleExercise>();
  for (const item of routines.flatMap((routine) => routine.items)) {
    const key =
      item.kind === "exercise" ? normalizeForSearch(item.exerciseName) : "";
    if (item.kind === "section" || byKey.has(key)) {
      continue;
    }
    const guide = sample.guide[sample.gmap[item.exerciseName] ?? ""];
    byKey.set(key, {
      name: item.exerciseName,
      tips: guide?.cues ?? [],
      youtube: guide?.yt ?? "",
    });
  }
  return [...byKey.values()];
}

function parseSample(raw: unknown): Sample {
  const parsed = sampleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SampleCycleError(z.prettifyError(parsed.error));
  }
  return parsed.data;
}

export function buildSampleCyclePlan(raw: unknown): SampleCyclePlan {
  const sample = parseSample(raw);
  const [firstWeek] = sample.weeks;
  if (firstWeek === undefined) {
    throw new SampleCycleError("no tiene semanas.");
  }
  const startDate = firstWeek.start;
  const sessions = usedSessions(sample);
  const routines = [...sessions.values()].map((ref) =>
    routineFor(ref, sample.lib),
  );
  const weeks = sampleWeeks(sample, startDate);
  return {
    cycle: {
      name: SAMPLE_CYCLE_NAME,
      startDate,
      weeks: Math.max(...weeks.map((week) => week.weekNo)),
    },
    marks: [...new Set(MACRO_MARKS.values())],
    exercises: sampleExercises(sample, routines),
    routines,
    weeks,
    days: sampleDays(sample, { startDate, routineKeys: [...sessions.keys()] }),
  };
}
