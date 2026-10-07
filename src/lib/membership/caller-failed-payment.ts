import { cache } from "react";
import { readCallerAccess, readCallerId } from "@/lib/auth/caller-role";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";
import {
  type FailedPaymentAlert,
  readFailedPaymentAlert,
} from "./failed-payment-alert";
import { createFailedPaymentAlertGateway } from "./supabase-failed-payment-gateway";

/**
 * La alerta de pago fallido de quien pide la pantalla (#474), leída en el
 * servidor para que la cáscara la pinte sin otra petición del navegador.
 *
 * Quien está al día no puede estar en `past_due`, y la frontera ya lo sabe:
 * a él no se le pregunta nada a la base. Sólo quien tiene la puerta cerrada
 * paga las dos lecturas, con el cliente de su sesión.
 */
export const readCallerFailedPayment = cache(
  async (): Promise<FailedPaymentAlert | null> => {
    const access = await readCallerAccess();
    if (access.membershipCurrent) {
      return null;
    }
    const userId = await readCallerId();
    const session = createSessionClient(process.env, await readServerCookies());
    if (session.kind === "unconfigured") {
      throw new Error(describeMissingAuthKeys(session.missingKeys));
    }
    return readFailedPaymentAlert(
      createFailedPaymentAlertGateway(session.client),
      { userId, now: new Date() },
    );
  },
);
