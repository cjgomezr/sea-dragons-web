import { cache } from "react";
import { redirect } from "next/navigation";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import { readCallerId } from "@/lib/auth/caller-role";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { readProfilePhoto } from "@/lib/members/profile-photo";
import { createSupabaseProfilePhotoGateways } from "@/lib/members/supabase-profile-photo-gateways";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";

/**
 * La foto de quien pide la pantalla, para el botón de la cuenta de la barra
 * de arriba (#717): una dirección firmada de vida corta, o null para las
 * iniciales. Se firma con la llave de servicio porque el bucket es privado
 * (#245), como en Mi cuenta.
 */
export const readCallerPhotoUrl = cache(async (): Promise<string | null> => {
  const userId = await readCallerId();
  const session = createSessionClient(process.env, await readServerCookies());
  if (session.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(session.missingKeys));
  }
  const wiring = createSupabaseProfilePhotoGateways(
    process.env,
    session.client,
  );
  if (wiring.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(wiring.missingKeys));
  }
  try {
    const photo = await readProfilePhoto(wiring.gateways, userId);
    return photo.photoUrl;
  } catch (error) {
    // La misma carrera con la frontera que en `readCallerIdentity`: la fila
    // desapareció entre el id y la foto.
    if (error instanceof MemberNotFoundError) {
      redirect(SIGN_IN_PATH);
    }
    throw error;
  }
});
