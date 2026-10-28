import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  ClubMarkRecord,
  ClubMarksGateway,
  ClubMarksGateways,
  MarkDeleteResult,
  MarkInsertResult,
  MarkRenameResult,
} from "./club-marks";

/**
 * Las marcas del club contra Supabase (#903), con la llave de servicio como
 * todo lo que escribe Entrenamiento (D4). Cada consulta filtra por el club de
 * quien llama. Las cuentas salen de `training_mark_usage`, que sólo devuelve
 * números: los valores de los socios no se leen aquí nunca (D11).
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MARKS_TABLE = "training_marks";
const MARK_USAGE_FUNCTION = "training_mark_usage";
const UNIQUE_VIOLATION_CODE = "23505";
const FOREIGN_KEY_VIOLATION_CODE = "23503";

const markRowsSchema = z.array(
  z.object({ id: z.string(), name: z.string(), sort_order: z.number() }),
);

const usageRowsSchema = z.array(
  z.object({
    mark_id: z.string(),
    routine_rows: z.number(),
    members: z.number(),
  }),
);

type MarkUsage = { readonly routineRows: number; readonly members: number };

async function readUsage(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<ReadonlyMap<string, MarkUsage>> {
  const { data, error } = await serviceClient.rpc(MARK_USAGE_FUNCTION, {
    p_club_id: clubId,
  });
  if (error) {
    throw new Error(
      `No se pudieron contar las marcas del club ${clubId}: ${error.message}`,
    );
  }
  return new Map(
    usageRowsSchema
      .parse(data)
      .map((row) => [
        row.mark_id,
        { routineRows: row.routine_rows, members: row.members },
      ]),
  );
}

async function listMarks(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<readonly ClubMarkRecord[]> {
  const { data, error } = await serviceClient
    .from(MARKS_TABLE)
    .select("id, name, sort_order")
    .eq("club_id", clubId)
    .order("sort_order")
    .order("name");
  if (error) {
    throw new Error(
      `No se pudieron leer las marcas del club ${clubId}: ${error.message}`,
    );
  }
  const usage = await readUsage(serviceClient, clubId);
  return markRowsSchema.parse(data).map((row) => {
    const counts = usage.get(row.id);
    return {
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
      routineRows: counts === undefined ? 0 : counts.routineRows,
      membersRecorded: counts === undefined ? 0 : counts.members,
    };
  });
}

async function insertMark(
  serviceClient: SupabaseClient,
  mark: Parameters<ClubMarksGateway["insertMark"]>[0],
): Promise<MarkInsertResult> {
  const { data, error } = await serviceClient
    .from(MARKS_TABLE)
    .insert({
      club_id: mark.clubId,
      name: mark.name,
      sort_order: mark.sortOrder,
    })
    .select("id")
    .single();
  if (error?.code === UNIQUE_VIOLATION_CODE) {
    return { kind: "name_taken" };
  }
  if (error) {
    throw new Error(
      `No se pudo crear la marca en el club ${mark.clubId}: ${error.message}`,
    );
  }
  return {
    kind: "created",
    markId: z.object({ id: z.string() }).parse(data).id,
  };
}

async function renameMark(
  serviceClient: SupabaseClient,
  target: Parameters<ClubMarksGateway["renameMark"]>[0],
  name: string,
): Promise<MarkRenameResult> {
  const { data, error } = await serviceClient
    .from(MARKS_TABLE)
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", target.markId)
    .eq("club_id", target.clubId)
    .select("id");
  if (error?.code === UNIQUE_VIOLATION_CODE) {
    return { kind: "name_taken" };
  }
  if (error) {
    throw new Error(
      `No se pudo renombrar la marca ${target.markId}: ${error.message}`,
    );
  }
  return data.length === 0 ? { kind: "not_found" } : { kind: "renamed" };
}

async function deleteMark(
  serviceClient: SupabaseClient,
  target: Parameters<ClubMarksGateway["deleteMark"]>[0],
): Promise<MarkDeleteResult> {
  const { error } = await serviceClient
    .from(MARKS_TABLE)
    .delete()
    .eq("id", target.markId)
    .eq("club_id", target.clubId);
  // Una fila de rutina que la empezó a usar entretanto: su clave no tiene
  // `on delete`.
  if (error?.code === FOREIGN_KEY_VIOLATION_CODE) {
    return { kind: "in_use" };
  }
  if (error) {
    throw new Error(
      `No se pudo borrar la marca ${target.markId}: ${error.message}`,
    );
  }
  return { kind: "deleted" };
}

export function createClubMarksGateways(
  serviceClient: SupabaseClient,
): ClubMarksGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    marks: {
      listMarks: (clubId) => listMarks(serviceClient, clubId),
      insertMark: (mark) => insertMark(serviceClient, mark),
      renameMark: (target, name) => renameMark(serviceClient, target, name),
      deleteMark: (target) => deleteMark(serviceClient, target),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type ClubMarksGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: ClubMarksGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

export function createSupabaseClubMarksGateways(
  env: Environment,
): ClubMarksGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createClubMarksGateways(createServiceRoleClient(env)),
  };
}
