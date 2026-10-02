# PRD: E13 · Stripe avanzado

**Estado:** borrador · **Fecha:** 2 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4) y el epic E13 de `docs/plan-maestro.md`. Cubre FR-064, FR-069 a FR-072, FR-080 y FR-087, la parte Casual de FR-065, INT-007 y los criterios AC-041. Se apoya en lo que dejó E12 (`docs/prd/e12-stripe-base.md`): la membresía con sus seis estados, la barrera, el webhook firmado e idempotente, Checkout y el panel de Pagos.

Las decisiones que el SRD no tomaba las tomó el dueño el 2 de octubre de 2026 y van marcadas como D1 a D4. D5 a D8 son decisiones técnicas de esta sesión de planificación, escritas para que el worker no las reinvente.

## 1. Problema

E12 dejó a un socio Casual sin forma de ponerse al día: nace `pending`, la barrera le cierra el club y no hay nada que pueda comprar, porque Casual no tiene cuota mensual sino packs prepagados (FR-063, FR-064). Hoy solo entra si un Admin lo exime a mano. Además, el comité cobra los levies de competición por fuera de la aplicación, un socio con el cobro fallido no tiene un botón para reintentarlo, y nadie avisa antes de que Stripe cobre la renovación.

## 2. Usuarios y contexto

- **Un socio Casual, desde el móvil:** viene cuando puede, no quiere cuota mensual y espera pagar un pack, ver cuántas sesiones le quedan y que se descuenten solas cuando el coach pasa lista.
- **Un socio que alterna planes:** pasa de Casual a Full en temporada y vuelve a Casual después. Espera no perder las sesiones que ya pagó (FR-087).
- **El Admin y el Committee:** deciden qué packs se ofrecen y crean los levies directamente en Stripe (FR-069, FR-080).
- **Un socio con la tarjeta caducada:** su cobro falla y quiere ver por qué y reintentar sin llamar a nadie (FR-070, FR-071).
- **Cualquier socio con plan mensual:** quiere saber antes del cobro cuánto se le va a cargar y en qué tarjeta (FR-072).
- **Hoy lo resuelven así:** Casual paga en efectivo cada sesión y un Admin lo exime en la app; los levies se cobran por transferencia y se apuntan aparte.

## 3. Objetivo y métricas de éxito

- Objetivo: que un Casual se ponga al día solo comprando un pack, que el saldo cuadre siempre con la asistencia, y que el resto de cobros del club (levies, reintentos, renovaciones) se gestionen sin ayuda.
- Métricas:
  - Un Casual nuevo compra un pack de 5 con tarjeta de prueba y en la siguiente petición está al día, con saldo 5 visible en Pagos.
  - Con 5 sesiones y dos asistencias guardadas como Present o Late, el saldo es 3; si el coach corrige una a Absent, vuelve a 4 (AC del SRD sobre FR-064).
  - Un Casual que pasa a Full con saldo 3 conserva los 3 sin que se descuenten, y los recupera al volver a Casual (FR-087, AC-041).
  - Un levy creado en Stripe con la marca del club aparece en Pagos de cada socio sin tocar la aplicación, y al pagarlo queda en su historial (FR-069, INT-007).
  - Un socio en `past_due` ve la alerta con la fecha del fallo y vuelve a `active` tras reintentar con éxito (FR-070, FR-071).
  - Siete días antes de cada renovación el socio recibe un correo y un aviso en la campana con el importe y la tarjeta (FR-072).

## 4. Alcance

**Incluido (v1):**

- El saldo de sesiones de un Casual como un libro de movimientos: compras, descuentos por asistencia y sus correcciones (FR-064, D6).
- Cuándo está al día un Casual (D1) y el saldo congelado al cambiar de plan (FR-087, D7).
- Las opciones de pack configurables por el Admin y el Committee, con 5 y 10 sesiones de inicio (FR-080, D2).
- Comprar un pack por Stripe Checkout en modo pago y ver el saldo en Pagos (FR-064, FR-065).
- Los levies: listar los productos activos marcados en Stripe, pagarlos y guardarlos en el historial (FR-069, INT-007, D4, D8).
- La alerta de pago fallido y el reintento (FR-070, FR-071, D5).
- El aviso previo a la renovación por correo y en la campana, disparado por Stripe (FR-072, D3).

**Explícitamente fuera (por ahora):**

- Caducidad de los packs: el SRD no la pide y un pack no caduca.
- Descuentos por volumen: cada sesión vale 15 AUD en cualquier pack.
- Reembolsar sesiones no usadas o un levy: se hace en el panel de Stripe y la aplicación no lo refleja en el saldo.
- Crear o editar levies desde la aplicación: se crean en Stripe (FR-069).
- Que un Casual quede a deber sesiones (D1).
- Mover el aviso de renovación a `pg_cron` (E16b): lo dispara Stripe.

## 5. Decisiones

- **D1 · Casual al día con saldo.** Un Casual no exento está al día mientras su saldo sea mayor que cero: su membresía está `active`. Al llegar a cero vuelve a `pending` y la barrera de E12 lo cierra hasta que compre otro pack. Nunca queda a deber.
- **D2 · Packs de inicio.** Se ofrecen packs de 5 y 10 sesiones (75 y 150 AUD). El Admin y el Committee cambian la lista; el precio por sesión no se toca desde la aplicación, es un `Price` de Stripe.
- **D3 · Aviso de renovación.** Siete días antes, por correo y en la campana, con el importe y la marca y los últimos cuatro de la tarjeta. Lo dispara el evento `invoice.upcoming` de Stripe, con "Upcoming renewal events" configurado a 7 días en la cuenta del club: no hace falta scheduler.
- **D4 · Levies para todos.** Cualquier socio con la cuenta activa ve y paga los levies, esté o no al día con la membresía. Pagar un levy no cambia el estado de la membresía.
- **D5 · Reintento en Stripe.** El reintento abre la página de la factura que aloja Stripe (`hosted_invoice_url` de la factura abierta), donde el socio paga con la misma tarjeta o con otra. Ningún dato de tarjeta pasa por la aplicación (NFR-006). El estado vuelve a `active` por el webhook, nunca por la pantalla.
- **D6 · El saldo es un libro.** El saldo no es un contador que se edita: es la suma de movimientos de una tabla (`+N` por pack comprado, `-1` por asistencia Present o Late guardada siendo Casual). Corregir una asistencia anula su movimiento. Así una corrección del coach no descuadra nada y el historial explica cada número.
- **D7 · El saldo congelado.** Solo se descuenta asistencia mientras el plan es Casual. Al pasar a Full o Student el saldo se queda como está; al volver a Casual vuelve a gastarse. Quien llega a Casual sin haberlo sido antes empieza en cero: el tiempo pagado de un plan mensual no se convierte en sesiones. Así se leen juntas las dos frases de FR-087.
- **D8 · Qué es un levy en Stripe.** Un `Product` activo con `metadata.seadragons_kind = "levy"` y un `Price` de pago único en AUD. Lo demás de la cuenta (los planes, la sesión Casual) no aparece como levy. Un levy pagado por un socio se le enseña como "Pagado" y no se le vuelve a ofrecer.

## 6. Requerimientos funcionales

### RF-1 · El libro de sesiones y el saldo · Must

- **Dado** un pack comprado, **cuando** llega su pago por webhook, **entonces** el libro suma tantas sesiones como el pack y el saldo sube en ese número, una sola vez aunque el evento llegue repetido.
- **Dado** un Casual con saldo, **cuando** el coach guarda su asistencia como Present o Late en una hoja de entrenamiento, **entonces** el libro resta una sesión ligada a ese registro de asistencia.
- **Dado** esa asistencia, **cuando** el coach la corrige a Absent o la quita, **entonces** el movimiento se anula y el saldo vuelve a subir; guardarla otra vez como Present no resta dos veces.
- **Dado** un Casual con saldo cero, **cuando** se intenta restar, **entonces** no se resta y queda una línea en el log: el saldo nunca es negativo (D1).
- **Dado** un socio, **cuando** lee su saldo o sus movimientos, **entonces** solo ve los suyos; escribir lo hace solo el servidor.

### RF-2 · Cuándo está al día un Casual · Must

- **Dado** un Casual no exento, **cuando** su saldo pasa de 0 a más, **entonces** su membresía pasa a `active`; **cuando** vuelve a 0, pasa a `pending` (D1).
- **Dado** un Casual con exención vigente, **cuando** cambia su saldo, **entonces** el estado sigue `waived`.
- **Dado** un socio Full o Student, **cuando** cambia su saldo congelado, **entonces** su estado no cambia: lo sigue moviendo Stripe.

### RF-3 · El saldo congelado al cambiar de plan · Must

- **Dado** un Casual con saldo 3, **cuando** su plan pasa a Full o Student, **entonces** el saldo sigue en 3 y ninguna asistencia lo descuenta mientras siga en ese plan (FR-087, AC-041).
- **Dado** ese socio, **cuando** vuelve a Casual, **entonces** recupera el saldo de 3 y, si es mayor que cero, está al día sin comprar nada.
- **Dado** un socio que nunca fue Casual, **cuando** su plan pasa a Casual, **entonces** empieza con saldo 0 y `pending` (D7).

### RF-4 · Las opciones de pack · Should

- **Dado** un club nuevo o el actual, **cuando** se aplica la migración, **entonces** ofrece packs de 5 y 10 sesiones (D2).
- **Dado** un Admin o un Committee, **cuando** abre la configuración del club, **entonces** ve la lista de packs y puede añadir uno (de 1 a 50 sesiones), quitarlo o cambiar el orden; un Coach o un Player no ven la sección y la API les responde 403.
- **Dado** la lista, **cuando** queda vacía, **entonces** no se puede guardar: siempre hay al menos un pack.

### RF-5 · Comprar un pack · Must

- **Dado** un Casual, **cuando** abre Pagos, **entonces** ve "Sin cobro recurrente", su saldo y un botón por cada pack con su precio (sesiones por 15 AUD) (FR-065).
- **Dado** un pack elegido, **cuando** pulsa comprar, **entonces** `POST /api/v1/membership/session-packs/checkout` crea una sesión de Checkout en modo pago con el `Price` de la sesión Casual y la cantidad del pack, `client_reference_id` y `metadata.user_id` del socio y `metadata.pack_sessions`, y lo lleva a Stripe; un tamaño que no está en la lista responde 400.
- **Dado** que Checkout termina bien, **cuando** llega `checkout.session.completed` con el pago hecho, **entonces** el libro suma el pack, el historial guarda el pago y, por RF-2, la puerta se abre en la siguiente petición.
- **Dado** un socio Full o Student, **cuando** abre Pagos, **entonces** no ve botones de pack; si tiene saldo congelado, lo ve con una frase que dice que vuelve a valer si pasa a Casual.
- **Dado** Pagos de un Casual, **cuando** se mira, **entonces** lista los movimientos del saldo (compras y sesiones descontadas con la fecha del entrenamiento).

### RF-6 · Los levies · Should

- **Dado** productos activos en Stripe con `metadata.seadragons_kind = "levy"`, **cuando** un socio abre Pagos, **entonces** ve cada uno con su nombre, descripción e importe; los que no llevan esa marca no aparecen (D8, INT-007).
- **Dado** un levy, **cuando** el socio lo paga, **entonces** va a Checkout en modo pago y, al volver el webhook, el pago entra en su historial con el nombre del levy y el levy le sale como "Pagado".
- **Dado** un socio que no está al día, **cuando** abre Pagos, **entonces** ve y puede pagar los levies igual (D4); pagarlos no cambia su membresía.
- **Dado** que Stripe no responde, **cuando** se listan los levies, **entonces** la sección dice que no se pudieron cargar y el resto de Pagos se pinta.

### RF-7 · La alerta de pago fallido y el reintento · Must

- **Dado** una membresía `past_due`, **cuando** el socio entra en cualquier pantalla, **entonces** ve un aviso destacado con la fecha del fallo y el botón "Reintentar el pago" (FR-070).
- **Dado** ese botón, **cuando** se pulsa, **entonces** `POST /api/v1/membership/retry-payment` devuelve la `hosted_invoice_url` de la factura abierta y la pantalla lo lleva allí (D5); sin factura abierta responde 409 con `reason`.
- **Dado** que el pago se completa, **cuando** llega `invoice.paid`, **entonces** la membresía vuelve a `active` y el aviso desaparece en la siguiente petición (FR-071).
- **Dado** un socio al día, **cuando** entra, **entonces** no hay aviso.

### RF-8 · El aviso previo a la renovación · Must

- **Dado** `invoice.upcoming` de una suscripción, **cuando** llega, **entonces** el socio recibe un correo y un aviso en la campana con el importe, la fecha del cobro y la marca y los últimos cuatro de su tarjeta (FR-072, D3), en su idioma.
- **Dado** el mismo evento repetido, **cuando** llega, **entonces** no se manda otro correo ni otro aviso.
- **Dado** una membresía exenta o cancelada al final del periodo, **cuando** llega el evento, **entonces** no se avisa.

## 7. Casos borde y estados de error

- **Asistencia guardada antes de E13:** no se descuenta hacia atrás; el libro empieza vacío para todos.
- **Dos hojas a la vez:** el descuento va dentro de la misma transacción que guarda la asistencia y se ata al registro (evento y socio), así que no puede restar dos veces.
- **Pack pagado con el socio ya sin cuenta:** el webhook responde 200, no escribe nada y deja una línea en el log, como en E12.
- **Cambio de plan con el saldo a mitad:** el plan cambia al final del ciclo (E12, RF-6); hasta ese día la asistencia de un Full no descuenta aunque tenga saldo.
- **Precio de la sesión sin configurar:** `STRIPE_PRICE_CASUAL_SESSION` ausente hace que el botón de compra responda 503 con `reason`; el resto de Pagos se ve.
- **Levy archivado en Stripe:** desaparece de la lista; quien ya lo pagó lo sigue viendo en su historial.
- **Pago fallido de un levy o de un pack:** no suma nada ni cambia el estado; Checkout ya le dice al socio que no se cobró.
- **Factura abierta que se paga desde otro sitio:** el webhook pone la membresía en `active` igual; el botón de reintento responde 409 si ya no hay factura abierta.

## 8. UX / UI

- Mockups: el panel de membresía de `docs/mockups/` que usa el #455. El saldo de un Casual, los packs, los levies y la alerta no están dibujados: revisión heurística contra `design-system.md`, con la forma de las tarjetas del panel.
- Flujos: Casual nuevo, Pagos, elegir pack, Checkout, vuelta a Pagos con saldo y la puerta abierta. Socio con cobro fallido, aviso, Reintentar, factura de Stripe, vuelta a la app al día.
- Viewports: 375 / 768 / 1440, claro y oscuro, inglés y español.

## 9. Requerimientos no funcionales

- Seguridad: el libro, las opciones de pack y los pagos tienen RLS, se escriben solo con la llave de servicio y se revocan los privilegios por defecto (patrón de `0003_members.sql`). Ninguna tarjeta pasa por la aplicación (NFR-006).
- Dinero en centavos enteros (CON-005).
- Accesibilidad: axe sin violaciones en Pagos con saldo, con levies y con la alerta.
- Idempotencia: cada evento de Stripe se aplica una vez (INT-002), también los nuevos.

## 10. Pasos del dueño antes de lanzar tickets

- Crear en Stripe, modo de prueba, un producto "Sesión Casual" con un `Price` de pago único de 15 AUD, y poner su id como `STRIPE_PRICE_CASUAL_SESSION` en `.env.local`, en los secretos de GitHub y en Vercel (Production). Antes del ticket 3.
- En Stripe, Billing, activar "Upcoming renewal events" a 7 días y añadir `invoice.upcoming` a los eventos del destino del webhook. Antes del ticket 7.
- Crear al menos un levy de prueba con `metadata.seadragons_kind = levy`. Antes del ticket 5.

## 11. Preguntas abiertas

- Ninguna bloquea. Las cuatro del SRD quedaron resueltas como D1 a D4.

## 12. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                                       | Tamaño | Depende de | Auto-merge sugerido                  |
| --- | ------------------------------------------------------------------------------------------------------ | ------ | ---------- | ------------------------------------ |
| 1   | Lleva el saldo de sesiones de cada Casual como un libro: compras, asistencia, correcciones y congelado | M      | ninguna    | No: modelo de datos y estado de pago |
| 2   | Deja al Admin y al Committee elegir los packs de sesiones que se ofrecen                               | S      | ninguna    | No: permisos, `ui-review`            |
| 3   | Vende packs de sesiones por Stripe Checkout y abre la puerta al Casual que paga                        | M      | 1, 2, #454 | No: pagos                            |
| 4   | Enseña en Pagos el saldo del Casual, sus movimientos y el saldo congelado                              | S      | 1, #455    | No: pantalla nueva, `ui-review`      |
| 5   | Lista y cobra los levies que el comité crea en Stripe                                                  | M      | #454, #455 | No: pagos, `ui-review`               |
| 6   | Avisa del pago fallido en toda la aplicación y deja reintentarlo en Stripe                             | S      | #455       | No: pagos, `ui-review`               |
| 7   | Avisa por correo y en la campana siete días antes de cada renovación                                   | S      | ninguna    | No: pagos y correos a socios         |

El 1, el 2 y el 7 pueden ir en paralelo desde ya. El 3 espera al 1, al 2 y al #454 (Checkout de E12); el 4, el 5 y el 6 esperan al #455 (el panel de Pagos). Ninguno se recomienda para auto-merge: todos tocan dinero, permisos o lo que ve el socio.
