import type { EmailSenderConnection } from "./resend-email-sender";

/**
 * Si ahora se pueden mandar correos, decidido antes de mirar ninguna cuenta
 * (#154).
 *
 * El registro y el reenvío no pueden decir "no pudimos mandar el correo" a
 * partir de un envío concreto: sólo se intenta enviar a cuentas sin confirmar,
 * así que ese aviso delataría cuáles lo son (#147). Lo que sí se puede decir,
 * igual a cualquiera, es que el envío en general no está disponible. Por eso
 * esta señal no recibe la dirección, y nada de lo que consulta sabe de
 * cuentas: la configuración del proveedor, un cupo propio que cuenta
 * peticiones y no envíos, y una sonda al proveedor que no manda nada.
 */

export type EmailDeliveryAvailability =
  | { readonly kind: "available" }
  | { readonly kind: "unavailable"; readonly reason: string };

export type EmailProviderStatus =
  | { readonly kind: "reachable" }
  | { readonly kind: "unreachable"; readonly reason: string };

/** Pregunta al proveedor si está en pie, sin mandar nada a nadie. */
export type EmailProviderProbe = {
  probeProvider(): Promise<EmailProviderStatus>;
};

/**
 * El cupo propio de correos. Cuenta peticiones que podían acabar en un envío,
 * no envíos: un envío sólo ocurre para cuentas sin confirmar, y un contador
 * de envíos que llegara al tope justo tras sondear una dirección diría que
 * esa dirección tenía una.
 */
export type EmailSendBudget = {
  countSince(windowStart: Date): Promise<number>;
  recordRequest(now: Date): Promise<void>;
};

export type EmailDeliveryAvailabilityCheck = {
  checkAvailability(now: Date): Promise<EmailDeliveryAvailability>;
};

export const EMAIL_BUDGET_WINDOW_HOURS = 24;

/** Por debajo del cupo diario del plan gratuito de Resend, que es de 100
 * correos. El margen es para la recuperación de contraseña, que sale del mismo
 * cupo del proveedor y no se cuenta aquí. */
export const MAX_EMAIL_REQUESTS_PER_WINDOW = 80;

const MILLISECONDS_PER_HOUR = 3_600_000;

function describeExhaustedBudget(requestsInWindow: number): string {
  return `Se agotó el cupo propio de correos: ${requestsInWindow} peticiones en ${EMAIL_BUDGET_WINDOW_HOURS} horas, con un tope de ${MAX_EMAIL_REQUESTS_PER_WINDOW}.`;
}

/** Las comprobaciones van de la más barata a la más cara, y la petición sólo
 * se anota en el cupo si iba a poder salir: una caída del proveedor no debe
 * dejar el cupo gastado para cuando vuelva.
 *
 * Contar y anotar no son atómicos, así que una ráfaga en el borde puede pasar
 * unas pocas peticiones del tope. Se acepta: el margen bajo el cupo de Resend
 * lo absorbe, y un bloqueo en la base costaría más que ese exceso. */
export function createEmailDeliveryAvailabilityCheck(dependencies: {
  readonly connection: EmailSenderConnection;
  readonly provider: EmailProviderProbe;
  readonly budget: EmailSendBudget;
}): EmailDeliveryAvailabilityCheck {
  const { connection, provider, budget } = dependencies;
  return {
    async checkAvailability(now) {
      if (connection.kind === "not_connected") {
        return { kind: "unavailable", reason: connection.reason };
      }

      const requestsInWindow = await budget.countSince(
        new Date(
          now.getTime() - EMAIL_BUDGET_WINDOW_HOURS * MILLISECONDS_PER_HOUR,
        ),
      );
      if (requestsInWindow >= MAX_EMAIL_REQUESTS_PER_WINDOW) {
        return {
          kind: "unavailable",
          reason: describeExhaustedBudget(requestsInWindow),
        };
      }

      const status = await provider.probeProvider();
      if (status.kind === "unreachable") {
        return { kind: "unavailable", reason: status.reason };
      }

      await budget.recordRequest(now);
      return { kind: "available" };
    },
  };
}
