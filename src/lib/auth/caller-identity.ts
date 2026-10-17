import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { redirect } from "next/navigation";
import { readCallerId } from "./caller-role";
import { SIGN_IN_PATH } from "./routes";
import {
  describeMissingAuthKeys,
  readRequiredText,
} from "./supabase-auth-gateways";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";

/** Quién tiene la sesión, como lo pone arriba el menú de la cuenta (#716). */
export type MemberIdentity = {
  readonly fullName: string;
  readonly email: string;
};

const MEMBERS_TABLE = "members";

/**
 * Se lee con la sesión de quien pide: la policy `members_select_own` de
 * `0003_members.sql` ya le deja ver su propia fila, y nada más.
 */
export async function findMemberIdentity(
  client: SupabaseClient,
  userId: string,
): Promise<MemberIdentity | null> {
  const { data, error } = await client
    .from(MEMBERS_TABLE)
    .select("full_name, email")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`No se pudo leer el nombre de la cuenta: ${error.message}`);
  }
  if (data === null) {
    return null;
  }
  return {
    fullName: readRequiredText(data, "full_name", MEMBERS_TABLE),
    email: readRequiredText(data, "email", MEMBERS_TABLE),
  };
}

/**
 * El nombre y el correo de quien pide la pantalla, para la cáscara. Va detrás
 * del id, que ya dejó pasar sólo a una cuenta activa; una fila que falta es la
 * misma carrera con la frontera que resuelve `readCallerId`.
 */
export const readCallerIdentity = cache(async (): Promise<MemberIdentity> => {
  const userId = await readCallerId();
  const session = createSessionClient(process.env, await readServerCookies());
  if (session.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(session.missingKeys));
  }
  const identity = await findMemberIdentity(session.client, userId);
  if (identity === null) {
    redirect(SIGN_IN_PATH);
  }
  return identity;
});
