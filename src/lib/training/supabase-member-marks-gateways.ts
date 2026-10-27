import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createMembershipGateway } from "@/lib/membership/supabase-membership-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  ClubMarkRecord,
  MemberMarkValueRecord,
  MemberMarksGateway,
  MemberMarksGateways,
} from "./member-marks";

/**
 * Adaptador entre las marcas del socio (#899) y Supabase. Con la llave de
 * servicio, como todo lo que escribe Entrenamiento (D4). Cada lectura y cada
 * escritura filtra por el socio de la sesión y su club, nunca por un id que
 * venga en la petición.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MARKS_TABLE = "training_marks";
const MEMBER_MARKS_TABLE = "training_member_marks";

const clubMarkRowsSchema = z.array(
  z.object({ id: z.string(), name: z.string() }),
);

const memberValueRowsSchema = z.array(
  z.object({ mark_id: z.string(), value: z.number() }),
);

async function listClubMarks(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<readonly ClubMarkRecord[]> {
  const { data, error } = await serviceClient
    .from(MARKS_TABLE)
    .select("id, name")
    .eq("club_id", clubId)
    .order("sort_order")
    .order("name");
  if (error) {
    throw new Error(
      `No se pudieron leer las marcas del club ${clubId}: ${error.message}`,
    );
  }
  return clubMarkRowsSchema.parse(data);
}

async function listMemberValues(
  serviceClient: SupabaseClient,
  member: Parameters<MemberMarksGateway["listMemberValues"]>[0],
): Promise<readonly MemberMarkValueRecord[]> {
  const { data, error } = await serviceClient
    .from(MEMBER_MARKS_TABLE)
    .select("mark_id, value")
    .eq("user_id", member.userId)
    .eq("club_id", member.clubId);
  if (error) {
    throw new Error(
      `No se pudieron leer las marcas del socio ${member.userId}: ${error.message}`,
    );
  }
  return memberValueRowsSchema
    .parse(data)
    .map((row) => ({ markId: row.mark_id, value: row.value }));
}

async function saveValue(
  serviceClient: SupabaseClient,
  entry: Parameters<MemberMarksGateway["saveValue"]>[0],
): Promise<void> {
  const { error } = await serviceClient.from(MEMBER_MARKS_TABLE).upsert(
    {
      user_id: entry.userId,
      club_id: entry.clubId,
      mark_id: entry.markId,
      value: entry.value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,mark_id" },
  );
  // Sin el valor en el mensaje: el registro del servidor tampoco lo ve (D11).
  if (error) {
    throw new Error(
      `No se pudo guardar la marca ${entry.markId} del socio ${entry.userId}: ${error.message}`,
    );
  }
}

async function clearValue(
  serviceClient: SupabaseClient,
  entry: Parameters<MemberMarksGateway["clearValue"]>[0],
): Promise<void> {
  const { error } = await serviceClient
    .from(MEMBER_MARKS_TABLE)
    .delete()
    .eq("user_id", entry.userId)
    .eq("club_id", entry.clubId)
    .eq("mark_id", entry.markId);
  if (error) {
    throw new Error(
      `No se pudo borrar la marca ${entry.markId} del socio ${entry.userId}: ${error.message}`,
    );
  }
}

export function createMemberMarksGateway(
  serviceClient: SupabaseClient,
): MemberMarksGateway {
  return {
    listClubMarks: (clubId) => listClubMarks(serviceClient, clubId),
    listMemberValues: (member) => listMemberValues(serviceClient, member),
    saveValue: (entry) => saveValue(serviceClient, entry),
    clearValue: (entry) => clearValue(serviceClient, entry),
  };
}

export function createMemberMarksGateways(
  serviceClient: SupabaseClient,
): MemberMarksGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    membership: createMembershipGateway(serviceClient),
    marks: createMemberMarksGateway(serviceClient),
  };
}

export type MemberMarksGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: MemberMarksGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

export function createSupabaseMemberMarksGateways(
  env: Environment,
): MemberMarksGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createMemberMarksGateways(createServiceRoleClient(env)),
  };
}
