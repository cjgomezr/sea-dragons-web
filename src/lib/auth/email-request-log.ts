/** Lo que necesita un límite de peticiones por correo: anotar la petición y
 * saber cuántas hubo desde `windowStart`, contando esta. Anotar antes de
 * contar es lo que impide que una ráfaga en paralelo lea todas el mismo
 * contador por debajo del tope.
 *
 * Lo usan la recuperación de contraseña y el reenvío de la confirmación, cada
 * uno sobre su propia tabla. */
export type EmailRequestLog = {
  recordAndCountRecent(input: {
    readonly email: string;
    readonly now: Date;
    readonly windowStart: Date;
  }): Promise<number>;
};
