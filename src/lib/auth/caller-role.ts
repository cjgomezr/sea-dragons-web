import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "./roles";
import { COMPLETE_REGISTRATION_PATH, SIGN_IN_PATH } from "./routes";
import { readSessionState } from "./session-reader";
import { describeMissingAuthKeys } from "./supabase-auth-gateways";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";

/**
 * El rol de quien pide la pantalla, leído en el servidor con la misma lectura
 * que usa la frontera y no pedido al navegador: una cookie o un prop que el
 * cliente pudiera tocar decidiría qué se le ofrece.
 *
 * La frontera ya dejó pasar sólo a una cuenta activa, así que los otros dos
 * casos son una carrera con ella (la sesión se cerró o cambió entre medias) y
 * se resuelven igual que ella los resolvería.
 *
 * Lo leen la cáscara (#213) y las pantallas que enseñan algo según el rol,
 * como el botón de publicar (#330). `cache` hace que sea una sola lectura por
 * petición aunque la pidan los dos.
 */
export const readCallerRole = cache(async (): Promise<Role> => {
  const session = createSessionClient(process.env, await readServerCookies());
  if (session.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(session.missingKeys));
  }
  const state = await readSessionState(session.client);
  switch (state.kind) {
    case "active":
      return state.role;
    case "incomplete":
      redirect(COMPLETE_REGISTRATION_PATH);
    case "anonymous":
      redirect(SIGN_IN_PATH);
  }
});
