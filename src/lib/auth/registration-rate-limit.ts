/**
 * El límite de peticiones del registro (#173).
 *
 * Hasta el #154 una ráfaga contra `POST /api/v1/auth/register` costaba envíos
 * reales. Desde que existe el cupo propio de correos sale gratis: registrar
 * una dirección que ya tiene cuenta no manda ningún correo, pero sí gasta
 * cupo, así que 80 peticiones con direcciones inventadas dejaban al club 24
 * horas sin confirmaciones y a las cuentas nuevas sin poder entrar.
 *
 * Se aplica antes de mirar ninguna cuenta y antes de tocar el cupo, y se
 * aplica igual exista o no la dirección: un límite que distinguiera esos dos
 * casos sería un oráculo de qué direcciones tienen cuenta, que es justo lo que
 * el #147 y el #158 cerraron.
 *
 * Lo que este límite NO cubre: una ráfaga repartida entre muchas procedencias.
 * Un límite por IP no puede, y fuera de Vercel las cabeceras de IP las pone
 * quien quiera. Contra eso hace falta otra cosa, y no es este ticket.
 */

/** Contra qué se cuenta una petición. La procedencia y la dirección se cuentan
 * por separado para que una ráfaga contra un solo correo no consuma el cupo de
 * todos, ni al revés. */
export type RegistrationSubject =
  | { readonly kind: "ip"; readonly value: string }
  | { readonly kind: "email"; readonly value: string };

/** Anota la petición y devuelve cuántas van de ese sujeto desde `windowStart`,
 * contando esta. Anotar antes de contar es lo que impide que una ráfaga en
 * paralelo lea todas el mismo contador por debajo del tope. Es el mismo
 * contrato que `EmailRequestLog`, con un sujeto que ya no es sólo un correo. */
export type RegistrationRequestLog = {
  recordAndCountRecent(input: {
    readonly subject: RegistrationSubject;
    readonly now: Date;
    readonly windowStart: Date;
  }): Promise<number>;
};

/** La misma ventana que el reenvío de la confirmación, y por lo mismo: un
 * cuarto de hora le sobra a quien se equivoca y reintenta. Los dos topes están
 * muy por debajo de las 80 peticiones diarias del cupo propio de correos. */
export const REGISTRATION_WINDOW_MINUTES = 15;

/** Por procedencia. Deja sitio a varias personas tras el mismo NAT (una
 * piscina, una oficina) sin dejar sitio a un bucle. */
export const MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW = 5;

/** Por dirección. Registrarse es una vez; tres intentos cubren al que se
 * equivoca de contraseña y vuelve a empezar. */
export const MAX_REGISTRATIONS_PER_EMAIL_PER_WINDOW = 3;

const MILLISECONDS_PER_MINUTE = 60_000;

/** El mensaje no nombra la dirección a propósito: acaba en el registro del
 * servidor, y el correo es un dato personal. */
export class RegistrationRateLimitedError extends Error {
  readonly retryAfterMinutes: number;

  constructor(retryAfterMinutes: number) {
    super(
      `Se superó el límite de peticiones de registro; hay que esperar ${retryAfterMinutes} minutos.`,
    );
    this.name = "RegistrationRateLimitedError";
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

export type RegistrationRateLimitInput = {
  /** De dónde viene la petición, ya reducido a un cubo: ver `client-ip.ts`. */
  readonly clientBucket: string;
  readonly email: string;
  readonly now: Date;
};

/** Lanza `RegistrationRateLimitedError` si la petición se pasa de cualquiera
 * de los dos topes. Un fallo de la tabla se propaga tal cual: sin poder
 * contar, dejar pasar la petición sería apagar el límite en silencio, que es
 * el escenario que este código existe para impedir. */
export async function enforceRegistrationRateLimit(
  log: RegistrationRequestLog,
  { clientBucket, email, now }: RegistrationRateLimitInput,
): Promise<void> {
  const windowStart = new Date(
    now.getTime() - REGISTRATION_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE,
  );

  const byBucket = await log.recordAndCountRecent({
    subject: { kind: "ip", value: clientBucket },
    now,
    windowStart,
  });
  if (byBucket > MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW) {
    throw new RegistrationRateLimitedError(REGISTRATION_WINDOW_MINUTES);
  }

  // Sólo si la procedencia pasó: una ráfaga ya rechazada no debe gastarle a
  // nadie su cupo de intentos por dirección.
  const byEmail = await log.recordAndCountRecent({
    subject: { kind: "email", value: email },
    now,
    windowStart,
  });
  if (byEmail > MAX_REGISTRATIONS_PER_EMAIL_PER_WINDOW) {
    throw new RegistrationRateLimitedError(REGISTRATION_WINDOW_MINUTES);
  }
}
