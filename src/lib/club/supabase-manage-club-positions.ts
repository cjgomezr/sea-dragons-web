import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { PositionNames } from "./club-positions";
import type {
  ManagedPositionsGateways,
  PositionArchiveResult,
  PositionInsertResult,
  PositionRenameResult,
  PositionReorderResult,
} from "./manage-club-positions";
import { fetchClubPositions } from "./supabase-club-positions";

/**
 * Adaptador entre la administración de posiciones (#300) y Supabase: cada
 * cambio es una función de `0027_manage_club_positions.sql`, que lo hace
 * entero o no lo hace.
 *
 * Va por la llave de servicio, la única que puede ejecutarlas. El servidor ya
 * comprobó que quien pide es Admin y pasa su club; la función no encuentra una
 * posición de otro.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const localeSchema = z.enum(["en", "es"]);

const insertResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("created"), position_id: z.uuid() }),
  z.object({ outcome: z.literal("name_taken"), locale: localeSchema }),
]);

const renameResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("renamed") }),
  z.object({ outcome: z.literal("name_taken"), locale: localeSchema }),
  z.object({ outcome: z.literal("not_found") }),
]);

const reorderResultSchema = z.object({
  outcome: z.enum(["reordered", "positions_changed"]),
});

const archiveResultSchema = z.object({
  outcome: z.enum(["changed", "unchanged", "not_found"]),
});

/** Llama a la función y estrecha su respuesta. Un error o una forma que no
 * cuadra no son un resultado del dominio: suben con el nombre de la función. */
async function callPositionFunction<Result>(
  serviceClient: SupabaseClient,
  call: {
    readonly name: string;
    readonly args: Record<string, unknown>;
    readonly schema: z.ZodType<Result>;
  },
): Promise<Result> {
  const { data, error } = await serviceClient.rpc(call.name, call.args);
  if (error) {
    throw new Error(`Falló ${call.name}: ${error.message}`);
  }
  const parsed = call.schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `${call.name} volvió con una forma que el dominio no reconoce: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

async function insertPosition(
  serviceClient: SupabaseClient,
  clubId: string,
  names: PositionNames,
): Promise<PositionInsertResult> {
  const result = await callPositionFunction(serviceClient, {
    name: "create_club_position",
    args: { acting_club_id: clubId, name_en: names.en, name_es: names.es },
    schema: insertResultSchema,
  });
  return result.outcome === "created"
    ? { kind: "created", positionId: result.position_id }
    : { kind: "name_taken", locale: result.locale };
}

async function renamePosition(
  serviceClient: SupabaseClient,
  target: { readonly clubId: string; readonly positionId: string },
  names: PositionNames,
): Promise<PositionRenameResult> {
  const result = await callPositionFunction(serviceClient, {
    name: "rename_club_position",
    args: {
      acting_club_id: target.clubId,
      target_position_id: target.positionId,
      name_en: names.en,
      name_es: names.es,
    },
    schema: renameResultSchema,
  });
  return result.outcome === "name_taken"
    ? { kind: "name_taken", locale: result.locale }
    : { kind: result.outcome };
}

async function reorderPositions(
  serviceClient: SupabaseClient,
  clubId: string,
  positionIds: readonly string[],
): Promise<PositionReorderResult> {
  const result = await callPositionFunction(serviceClient, {
    name: "reorder_club_positions",
    args: { acting_club_id: clubId, ordered_ids: positionIds },
    schema: reorderResultSchema,
  });
  return { kind: result.outcome };
}

async function setPositionArchived(
  serviceClient: SupabaseClient,
  target: { readonly clubId: string; readonly positionId: string },
  isArchived: boolean,
): Promise<PositionArchiveResult> {
  const result = await callPositionFunction(serviceClient, {
    name: "set_club_position_archived",
    args: {
      acting_club_id: target.clubId,
      target_position_id: target.positionId,
      archived: isArchived,
    },
    schema: archiveResultSchema,
  });
  return { kind: result.outcome };
}

/** Sin caché: el Admin tiene que ver lo que acaba de guardar. */
export function createManagedPositionsGateways(
  serviceClient: SupabaseClient,
): ManagedPositionsGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    positions: {
      findClubPositions: (clubId) => fetchClubPositions(serviceClient, clubId),
      insertPosition: (clubId, names) =>
        insertPosition(serviceClient, clubId, names),
      renamePosition: (target, names) =>
        renamePosition(serviceClient, target, names),
      reorderPositions: (clubId, positionIds) =>
        reorderPositions(serviceClient, clubId, positionIds),
      setPositionArchived: (target, isArchived) =>
        setPositionArchived(serviceClient, target, isArchived),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type ManagedPositionsGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: ManagedPositionsGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición de los endpoints. Devuelve las variables que faltan en
 * vez de lanzar, como las demás. */
export function createSupabaseManagedPositionsGateways(
  env: Environment,
): ManagedPositionsGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createManagedPositionsGateways(createServiceRoleClient(env)),
  };
}
