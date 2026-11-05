import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  ClubCycleRecord,
  ClubCyclesGateway,
  ClubCyclesGateways,
  CycleAudience,
  CycleAudienceInput,
  CycleConflictOutcome,
  CycleDayChange,
  CycleDayRecord,
  CycleDeletion,
  CycleFields,
  CycleTarget,
  CycleWeekRecord,
  RoutineScope,
} from "./club-cycles";
import {
  WEEK_COLUMNS,
  toWeekDose,
  weekRowSchema,
} from "./supabase-training-plan-gateways";
import type { DoseIntensity } from "./training-load";

/**
 * Los ciclos de Planificar contra Supabase (#904), con la llave de servicio
 * como todo lo que escribe Entrenamiento (D4). Cada consulta filtra por el
 * club de quien llama. Cambiar, activar, duplicar, poner un día y copiar la
 * semana 1 son funciones de `0085_training_cycles_manage.sql`, y borrar es
 * la de `0088_training_cycle_delete.sql`, para que cada una sea una
 * transacción. Crear, activar, cambiar la audiencia y duplicar son las de
 * `0095_training_cycle_audience.sql` (#978).
 */

type Environment = Readonly<Record<string, string | undefined>>;

const CYCLES_TABLE = "training_cycles";
const WEEKS_TABLE = "training_cycle_weeks";
const DAYS_TABLE = "training_cycle_days";
const ROUTINES_TABLE = "training_routines";
const GROUPS_TABLE = "groups";

// Las claves se nombran: entre ciclos y rutinas hay más de un camino
// posible, y entre ciclos y grupos la tabla del medio también lo es.
const CYCLE_COLUMNS = `
  id, name, status, weeks, start_date, event_name, event_date, audience,
  routines:training_routines!training_routines_cycle_same_club_fkey ( count ),
  cycle_groups:training_cycle_groups!training_cycle_groups_cycle_same_club_fkey (
    group:groups!training_cycle_groups_group_same_club_fkey ( id, name )
  )`;

const cycleRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["draft", "active", "archived"]),
  weeks: z.number().int(),
  start_date: z.string(),
  event_name: z.string().nullable(),
  event_date: z.string().nullable(),
  audience: z.enum(["club", "groups"]),
  routines: z.array(z.object({ count: z.number().int() })),
  cycle_groups: z.array(
    z.object({ group: z.object({ id: z.string(), name: z.string() }) }),
  ),
});

/** Lo que devuelven activar y cambiar la audiencia (`0095`). */
const conflictRowsSchema = z.array(
  z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("missing") }),
    z.object({
      outcome: z.enum(["conflict", "archived", "activated", "saved"]),
      affected_cycle_id: z.string(),
      affected_cycle_name: z.string(),
    }),
  ]),
);

const plannedWeekRowSchema = weekRowSchema.extend({
  week_no: z.number().int(),
});

const dayRowSchema = z.object({
  week_no: z.number().int(),
  weekday: z.number().int(),
  slot: z.union([z.literal(1), z.literal(2)]),
  routine_id: z.string(),
});

const updateRowsSchema = z.array(z.object({ days_removed: z.number().int() }));

const deletionRowsSchema = z.array(
  z.discriminatedUnion("deleted", [
    z.object({
      deleted: z.literal(true),
      previous_status: z.enum(["draft", "archived"]),
      routines_deleted: z.number().int(),
    }),
    z.object({ deleted: z.literal(false) }),
  ]),
);

const duplicateRowsSchema = z.array(
  z.object({ new_cycle_id: z.string(), routines_copied: z.number().int() }),
);

function failure(action: string, message: string): Error {
  return new Error(`No se pudo ${action}: ${message}`);
}

/** Los grupos, por nombre. Uno de grupos sin ninguno sigue siéndolo (D9). */
function toAudience(row: z.infer<typeof cycleRowSchema>): CycleAudience {
  if (row.audience === "club") {
    return { kind: "club" };
  }
  const groups = row.cycle_groups
    .map(({ group }) => group)
    .sort((left, right) => left.name.localeCompare(right.name));
  return { kind: "groups", groups };
}

/** Un ciclo sin la fecha o sin el nombre del evento no tiene evento: la API
 * siempre guarda los dos. */
function toCycleRecord(row: z.infer<typeof cycleRowSchema>): ClubCycleRecord {
  const [routines] = row.routines;
  return {
    audience: toAudience(row),
    id: row.id,
    name: row.name,
    status: row.status,
    weeks: row.weeks,
    startDate: row.start_date,
    event:
      row.event_name === null || row.event_date === null
        ? null
        : { name: row.event_name, date: row.event_date },
    ownRoutines: routines === undefined ? 0 : routines.count,
  };
}

type CycleColumns = {
  readonly name: string;
  readonly weeks: number;
  readonly start_date: string;
  readonly event_name: string | null;
  readonly event_date: string | null;
};

function cycleColumns(fields: CycleFields): CycleColumns {
  return {
    name: fields.name,
    weeks: fields.weeks,
    start_date: fields.startDate,
    event_name: fields.event === null ? null : fields.event.name,
    event_date: fields.event === null ? null : fields.event.date,
  };
}

async function listCycles(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<readonly ClubCycleRecord[]> {
  const { data, error } = await serviceClient
    .from(CYCLES_TABLE)
    .select(CYCLE_COLUMNS)
    .eq("club_id", clubId)
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    throw failure(`leer los ciclos del club ${clubId}`, error.message);
  }
  return z.array(cycleRowSchema).parse(data).map(toCycleRecord);
}

async function findCycle(
  serviceClient: SupabaseClient,
  target: CycleTarget,
): Promise<ClubCycleRecord | null> {
  const { data, error } = await serviceClient
    .from(CYCLES_TABLE)
    .select(CYCLE_COLUMNS)
    .eq("id", target.cycleId)
    .eq("club_id", target.clubId)
    .maybeSingle();
  if (error) {
    throw failure(`leer el ciclo ${target.cycleId}`, error.message);
  }
  return data === null ? null : toCycleRecord(cycleRowSchema.parse(data));
}

async function readWeeks(
  serviceClient: SupabaseClient,
  target: CycleTarget,
): Promise<readonly CycleWeekRecord[]> {
  const { data, error } = await serviceClient
    .from(WEEKS_TABLE)
    .select(`week_no, ${WEEK_COLUMNS}`)
    .eq("cycle_id", target.cycleId)
    .eq("club_id", target.clubId)
    .order("week_no");
  if (error) {
    throw failure(
      `leer las semanas del ciclo ${target.cycleId}`,
      error.message,
    );
  }
  return z
    .array(plannedWeekRowSchema)
    .parse(data)
    .map((row) => ({
      weekNo: row.week_no,
      note: row.note,
      dose: toWeekDose(row),
    }));
}

async function readDays(
  serviceClient: SupabaseClient,
  target: CycleTarget,
): Promise<readonly CycleDayRecord[]> {
  const { data, error } = await serviceClient
    .from(DAYS_TABLE)
    .select("week_no, weekday, slot, routine_id")
    .eq("cycle_id", target.cycleId)
    .eq("club_id", target.clubId)
    .order("week_no")
    .order("weekday")
    .order("slot");
  if (error) {
    throw failure(`leer los días del ciclo ${target.cycleId}`, error.message);
  }
  return z
    .array(dayRowSchema)
    .parse(data)
    .map((row) => ({
      weekNo: row.week_no,
      weekday: row.weekday,
      slot: row.slot,
      routineId: row.routine_id,
    }));
}

function groupIdsOf(audience: CycleAudienceInput): readonly string[] {
  return audience.kind === "groups" ? audience.groupIds : [];
}

/** El ciclo y sus grupos, en una transacción (`create_training_cycle`). */
async function insertCycle(
  serviceClient: SupabaseClient,
  cycle: Parameters<ClubCyclesGateway["insertCycle"]>[0],
): Promise<string> {
  const columns = cycleColumns(cycle);
  const { data, error } = await serviceClient.rpc("create_training_cycle", {
    p_club_id: cycle.clubId,
    p_name: columns.name,
    p_weeks: columns.weeks,
    p_start_date: columns.start_date,
    p_event_name: columns.event_name,
    p_event_date: columns.event_date,
    p_created_by: cycle.createdBy,
    p_audience: cycle.audience.kind,
    p_group_ids: groupIdsOf(cycle.audience),
  });
  if (error) {
    throw failure(`crear el ciclo en el club ${cycle.clubId}`, error.message);
  }
  return z.string().parse(data);
}

async function findClubGroupIds(
  serviceClient: SupabaseClient,
  clubId: string,
  groupIds: readonly string[],
): Promise<readonly string[]> {
  const { data, error } = await serviceClient
    .from(GROUPS_TABLE)
    .select("id")
    .eq("club_id", clubId)
    .in("id", [...groupIds]);
  if (error) {
    throw failure(`leer los grupos del club ${clubId}`, error.message);
  }
  return z
    .array(z.object({ id: z.string() }))
    .parse(data)
    .map(({ id }) => id);
}

/** Las filas de `activate_training_cycle` y `save_training_cycle_audience`:
 * `missing`, los `conflict` sin cambiar nada, o los `archived` y el guardado. */
function toConflictOutcome(data: unknown): CycleConflictOutcome {
  const rows = conflictRowsSchema.parse(data);
  const affected = rows.flatMap((row) =>
    row.outcome === "missing"
      ? []
      : [
          {
            outcome: row.outcome,
            cycle: { id: row.affected_cycle_id, name: row.affected_cycle_name },
          },
        ],
  );
  if (affected.length === 0) {
    return { kind: "missing" };
  }
  const conflicts = affected.filter((row) => row.outcome === "conflict");
  if (conflicts.length > 0) {
    return {
      kind: "conflicts",
      conflicts: conflicts.map(({ cycle }) => cycle),
    };
  }
  return {
    kind: "saved",
    archived: affected
      .filter((row) => row.outcome === "archived")
      .map(({ cycle }) => cycle),
  };
}

/** El cambio y el borrado de lo que sobra, en una transacción. */
async function updateCycle(
  serviceClient: SupabaseClient,
  target: CycleTarget,
  fields: CycleFields,
): Promise<void> {
  const { data, error } = await serviceClient.rpc("update_training_cycle", {
    p_club_id: target.clubId,
    p_cycle_id: target.cycleId,
    p_name: fields.name,
    p_weeks: fields.weeks,
    p_start_date: fields.startDate,
    p_event_name: fields.event === null ? null : fields.event.name,
    p_event_date: fields.event === null ? null : fields.event.date,
  });
  if (error) {
    throw failure(`cambiar el ciclo ${target.cycleId}`, error.message);
  }
  if (updateRowsSchema.parse(data).length === 0) {
    throw failure(`cambiar el ciclo ${target.cycleId}`, "no es del club");
  }
}

async function activateCycle(
  serviceClient: SupabaseClient,
  target: CycleTarget,
  options: { readonly confirm: boolean },
): Promise<CycleConflictOutcome> {
  const { data, error } = await serviceClient.rpc("activate_training_cycle", {
    p_club_id: target.clubId,
    p_cycle_id: target.cycleId,
    p_confirm: options.confirm,
  });
  if (error) {
    throw failure(`activar el ciclo ${target.cycleId}`, error.message);
  }
  return toConflictOutcome(data);
}

async function saveAudience(
  serviceClient: SupabaseClient,
  request: {
    readonly target: CycleTarget;
    readonly audience: CycleAudienceInput;
    readonly confirm: boolean;
  },
): Promise<CycleConflictOutcome> {
  const { target, audience } = request;
  const { data, error } = await serviceClient.rpc(
    "save_training_cycle_audience",
    {
      p_club_id: target.clubId,
      p_cycle_id: target.cycleId,
      p_audience: audience.kind,
      p_group_ids: groupIdsOf(audience),
      p_confirm: request.confirm,
    },
  );
  if (error) {
    throw failure(
      `cambiar la audiencia del ciclo ${target.cycleId}`,
      error.message,
    );
  }
  return toConflictOutcome(data);
}

async function archiveCycle(
  serviceClient: SupabaseClient,
  target: CycleTarget,
): Promise<void> {
  const { error } = await serviceClient
    .from(CYCLES_TABLE)
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", target.cycleId)
    .eq("club_id", target.clubId);
  if (error) {
    throw failure(`archivar el ciclo ${target.cycleId}`, error.message);
  }
}

/** Mirar que no esté activo y borrar, en una transacción (`0088`). */
async function deleteCycle(
  serviceClient: SupabaseClient,
  target: CycleTarget,
): Promise<CycleDeletion> {
  const { data, error } = await serviceClient.rpc("delete_training_cycle", {
    p_club_id: target.clubId,
    p_cycle_id: target.cycleId,
  });
  if (error) {
    throw failure(`borrar el ciclo ${target.cycleId}`, error.message);
  }
  const [row] = deletionRowsSchema.parse(data);
  if (row === undefined) {
    return { kind: "missing" };
  }
  if (!row.deleted) {
    return { kind: "active" };
  }
  return {
    kind: "deleted",
    status: row.previous_status,
    routinesDeleted: row.routines_deleted,
  };
}

async function duplicateCycle(
  serviceClient: SupabaseClient,
  target: CycleTarget,
  copy: Parameters<ClubCyclesGateway["duplicateCycle"]>[1],
): Promise<{ readonly cycleId: string; readonly routinesCopied: number }> {
  const { data, error } = await serviceClient.rpc("duplicate_training_cycle", {
    p_club_id: target.clubId,
    p_cycle_id: target.cycleId,
    p_name: copy.name,
    p_created_by: copy.createdBy,
  });
  if (error) {
    throw failure(`duplicar el ciclo ${target.cycleId}`, error.message);
  }
  const [row] = duplicateRowsSchema.parse(data);
  if (row === undefined) {
    throw failure(`duplicar el ciclo ${target.cycleId}`, "no es del club");
  }
  return { cycleId: row.new_cycle_id, routinesCopied: row.routines_copied };
}

async function findRoutineScope(
  serviceClient: SupabaseClient,
  clubId: string,
  routineId: string,
): Promise<RoutineScope> {
  const { data, error } = await serviceClient
    .from(ROUTINES_TABLE)
    .select("cycle_id")
    .eq("id", routineId)
    .eq("club_id", clubId)
    .maybeSingle();
  if (error) {
    throw failure(`leer la rutina ${routineId}`, error.message);
  }
  if (data === null) {
    return { kind: "missing" };
  }
  const { cycle_id: cycleId } = z
    .object({ cycle_id: z.string().nullable() })
    .parse(data);
  return cycleId === null ? { kind: "shared" } : { kind: "cycle", cycleId };
}

async function setDay(
  serviceClient: SupabaseClient,
  target: CycleTarget,
  day: CycleDayChange,
): Promise<void> {
  const { error } = await serviceClient.rpc("set_training_cycle_day", {
    p_club_id: target.clubId,
    p_cycle_id: target.cycleId,
    p_week_no: day.weekNo,
    p_weekday: day.weekday,
    p_slot: day.slot,
    p_routine_id: day.routineId,
  });
  if (error) {
    throw failure(`guardar un día del ciclo ${target.cycleId}`, error.message);
  }
}

type IntensityColumns = {
  readonly dose_intensity_kind: DoseIntensity["kind"];
  readonly dose_pct: number | null;
  readonly dose_text: string | null;
};

function intensityColumns(intensity: DoseIntensity): IntensityColumns {
  return {
    dose_intensity_kind: intensity.kind,
    dose_pct: intensity.kind === "pct" ? intensity.pct : null,
    dose_text: intensity.kind === "text" ? intensity.text : null,
  };
}

async function saveWeek(
  serviceClient: SupabaseClient,
  target: CycleTarget,
  week: CycleWeekRecord,
): Promise<void> {
  const { dose } = week;
  const { error } = await serviceClient.from(WEEKS_TABLE).upsert(
    {
      club_id: target.clubId,
      cycle_id: target.cycleId,
      week_no: week.weekNo,
      note: week.note,
      dose_sets: dose === null ? null : dose.sets,
      dose_reps: dose === null ? null : dose.reps,
      ...intensityColumns(dose === null ? { kind: "none" } : dose.intensity),
    },
    { onConflict: "cycle_id,week_no" },
  );
  if (error) {
    throw failure(
      `guardar la semana ${week.weekNo} del ciclo ${target.cycleId}`,
      error.message,
    );
  }
}

async function copyWeekOne(
  serviceClient: SupabaseClient,
  target: CycleTarget,
  targetWeeks: readonly number[],
): Promise<void> {
  const { error } = await serviceClient.rpc("copy_training_cycle_week_one", {
    p_club_id: target.clubId,
    p_cycle_id: target.cycleId,
    p_target_weeks: targetWeeks,
  });
  if (error) {
    throw failure(
      `copiar la semana 1 del ciclo ${target.cycleId}`,
      error.message,
    );
  }
}

async function clearWeek(
  serviceClient: SupabaseClient,
  target: CycleTarget,
  weekNo: number,
): Promise<void> {
  const { error } = await serviceClient.rpc("clear_training_cycle_week", {
    p_club_id: target.clubId,
    p_cycle_id: target.cycleId,
    p_week_no: weekNo,
  });
  if (error) {
    throw failure(
      `vaciar la semana ${weekNo} del ciclo ${target.cycleId}`,
      error.message,
    );
  }
}

export function createClubCyclesGateways(
  serviceClient: SupabaseClient,
): ClubCyclesGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    cycles: {
      listCycles: (clubId) => listCycles(serviceClient, clubId),
      findCycle: (target) => findCycle(serviceClient, target),
      readCyclePlan: async (target) => {
        const [weeks, days] = await Promise.all([
          readWeeks(serviceClient, target),
          readDays(serviceClient, target),
        ]);
        return { weeks, days };
      },
      insertCycle: (cycle) => insertCycle(serviceClient, cycle),
      findClubGroupIds: (clubId, groupIds) =>
        findClubGroupIds(serviceClient, clubId, groupIds),
      updateCycle: (target, fields) =>
        updateCycle(serviceClient, target, fields),
      activateCycle: (target, options) =>
        activateCycle(serviceClient, target, options),
      saveAudience: (target, audience, { confirm }) =>
        saveAudience(serviceClient, { target, audience, confirm }),
      archiveCycle: (target) => archiveCycle(serviceClient, target),
      deleteCycle: (target) => deleteCycle(serviceClient, target),
      duplicateCycle: (target, copy) =>
        duplicateCycle(serviceClient, target, copy),
      findRoutineScope: (clubId, routineId) =>
        findRoutineScope(serviceClient, clubId, routineId),
      setDay: (target, day) => setDay(serviceClient, target, day),
      saveWeek: (target, week) => saveWeek(serviceClient, target, week),
      copyWeekOne: (target, targetWeeks) =>
        copyWeekOne(serviceClient, target, targetWeeks),
      clearWeek: (target, weekNo) => clearWeek(serviceClient, target, weekNo),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type ClubCyclesGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: ClubCyclesGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

export function createSupabaseClubCyclesGateways(
  env: Environment,
): ClubCyclesGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createClubCyclesGateways(createServiceRoleClient(env)),
  };
}
