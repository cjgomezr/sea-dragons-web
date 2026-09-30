# PRD: E12 · Stripe base

**Estado:** aprobado · **Fecha:** 30 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4), epic E12 de `docs/plan-maestro.md` y la matriz de permisos de su sección 4. Cubre FR-062, FR-063 y FR-065 a FR-068, los criterios AC-025, AC-026 y AC-029, las integraciones INT-001, INT-002 e INT-003 y NFR-006. Aplica B1 (Family fuera de Release 1) y resuelve B5, que bloqueaba esta épica desde el 16 de septiembre de 2026.

Las decisiones que el SRD no tomaba las tomó el dueño el 30 de septiembre de 2026 y van marcadas como D1 a D7.

## 1. Problema

El club cobra las cuotas a mano y por fuera de la aplicación, y la aplicación no sabe quién está al día. Hoy cualquiera puede registrarse desde la web, elegir un tipo de membresía y, en cuanto confirma el correo y completa sus datos, usar todo: ve el directorio con nombres y fotos de los socios, los documentos del club, responde al RSVP y entra en los equipos, sin haber pagado ni haber hablado con nadie (B5). El SRD pide que las cuotas se cobren solas por Stripe cada mes (FR-063, BR-005) y que cada socio vea su plan, su tarjeta y su historial (FR-065, FR-068), y separa el estado de la cuenta del estado de la membresía (§9) sin definir el segundo.

## 2. Usuarios y contexto

- **Un socio nuevo, desde el móvil:** se registra un domingo por la noche, quiere entrar al club sin esperar a nadie y entiende que hay que pagar. Espera el primer mes gratis que el club ofrece.
- **Un socio veterano:** quiere que se le cobre solo, ver cuándo es el próximo cobro y cambiar la tarjeta cuando caduca, sin llamar a nadie.
- **El Admin y el Committee:** quieren saber quién está al día sin abrir Stripe, y poder eximir de cuota a los entrenadores y a quienes hacen trabajo voluntario, que hoy no pagan.
- **Un desconocido que se registra:** no debe ver nada de dentro del club hasta ser socio.
- **Hoy lo resuelven así:** transferencias y efectivo apuntados aparte; la aplicación activa a todo el mundo.

## 3. Objetivo y métricas de éxito

- Objetivo: que estar al día con la cuota sea la puerta del club, que la cuota se cobre sola y que el socio gestione su plan sin ayuda.
- Métricas:
  - Un socio Full con tarjeta recibe un cargo de 45,00 AUD el día de facturación y su panel enseña "Activa" y la fecha del siguiente cobro (AC-025).
  - Una cuenta recién registrada sin tarjeta no ve el directorio, las noticias, los equipos ni puede responder al RSVP, ni por API (D2).
  - Ningún número de tarjeta pasa por la plataforma ni queda guardado: solo marca, últimos cuatro dígitos y caducidad (NFR-006, AC-029).
  - El Admin exime a un entrenador en menos de un minuto y queda en la bitácora (D4).
  - Cada evento de Stripe se aplica una sola vez aunque llegue repetido (INT-002).

## 4. Alcance

**Incluido (v1):**

- La entidad membresía con sus estados y quién los mueve (D1).
- La barrera: qué ve y qué no ve quien no está al día (D2), en pantalla y en la API.
- El alta en Stripe al primer inicio de sesión, con un mes de prueba y tarjeta obligatoria (D3).
- La exención manual del Admin para quien no paga (D4).
- El panel de membresía del mockup: plan, estado, precio, próximo cobro, tarjeta, cambio de tarjeta y cambio de plan al siguiente ciclo (FR-065 a FR-067, D5, D6).
- El historial de pagos (FR-068).
- Los webhooks de Stripe que mantienen todo lo anterior (INT-002, D7).
- El estado de membresía visible para el Admin en el directorio y en la ficha.

**Explícitamente fuera (por ahora):**

- Packs prepagados de Casual y el descuento por asistencia (FR-064, E13). En E12 un Casual queda `pending` hasta que E13 le deje comprar su primer pack, salvo que el Admin lo exima.
- Cobros puntuales creados en Stripe (FR-069, E13).
- La alerta de pago fallido con reintento (FR-070, FR-071) y el aviso previo a la renovación (FR-072): E13 y E16b. En E12 un pago fallido cambia el estado y la puerta se cierra; el socio ve por qué y puede actualizar la tarjeta.
- PayPal, que el mockup dibuja como "integration-ready": no hay FR.
- Family (B1).
- Reembolsos, prorrateos a mitad de ciclo (FR-066 los excluye), descuentos y cupones.
- Que el Admin cobre en efectivo o registre pagos a mano: el club no lo hace.

## 5. Requerimientos funcionales

### RF-1 · La membresía y sus estados · Must

Cada socio tiene una membresía con un tipo (Full, Student, Casual; FR-062) y un estado (D1). El estado lo mueven los webhooks de Stripe y la exención del Admin, nunca una pantalla.

| Estado      | Significa                                                                                 | Quién lo pone |
| ----------- | ----------------------------------------------------------------------------------------- | ------------- |
| `pending`   | No ha puesto tarjeta (o es Casual sin pack). Es el estado con el que nace toda membresía. | El alta       |
| `trialing`  | Tarjeta puesta, dentro del mes de prueba.                                                 | Stripe        |
| `active`    | Stripe cobró la última cuota.                                                             | Stripe        |
| `past_due`  | El último cobro falló; Stripe reintenta.                                                  | Stripe        |
| `cancelled` | El socio dejó el plan o Stripe agotó los reintentos.                                      | Stripe        |
| `waived`    | Exento por el Admin: entrenadores, voluntarios.                                           | El Admin      |

"Al día" es `trialing`, `active` o `waived`.

- **Dado** una cuenta que pasa a `active` (FR-083), **cuando** se activa, **entonces** existe su membresía con el tipo elegido en el registro y estado `pending`.
- **Dado** una membresía, **cuando** se lee, **entonces** guarda el tipo, el estado, el cliente y la suscripción de Stripe (si los hay), el fin del periodo en curso, el fin de la prueba, la marca y los últimos cuatro dígitos de la tarjeta, y nada más de la tarjeta (NFR-006).
- **Dado** una cuenta autenticada, **cuando** consulta la tabla directamente, **entonces** lee como mucho su propia membresía y no escribe ninguna: escribe el servidor con la llave de servicio, como en asistencia.
- **Dado** que se borra la identidad de un socio, **cuando** termina la cascada, **entonces** su membresía y sus pagos desaparecen; el cliente de Stripe se borra aparte (E15 decide cuándo).

### RF-2 · La barrera: quién no está al día · Must

- **Dado** un socio cuya membresía no está al día, **cuando** entra, **entonces** alcanza solo su perfil, el panel de membresía y el calendario en lectura; el resto del menú no aparece y cada sección oculta responde 403 por API con `reason: "membership_not_current"`.
- **Dado** un socio que no está al día, **cuando** abre el calendario, **entonces** ve los eventos de su audiencia con los botones de RSVP deshabilitados y una frase que dice que hasta ponerse al día no puede apuntarse, con el enlace al panel de membresía; el endpoint de RSVP responde 403.
- **Dado** un socio que no está al día, **cuando** el coach abre la hoja de asistencia o arma la escuadra, **entonces** ese socio no aparece: la audiencia viva de asistencia y equipos excluye a quien no está al día.
- **Dado** un socio que no está al día, **cuando** otro socio abre el directorio, **entonces** sigue apareciendo (es socio del club); el Admin ve además su estado de membresía en la fila y en la ficha.
- **Dado** el Admin, el Coach y el Committee, **cuando** su propia membresía no está al día, **entonces** la barrera les aplica igual en lo de socio (RSVP, directorio, noticias), pero conservan sus pantallas de gestión: un Admin sin tarjeta tiene que poder eximirse o pagar.
- **Dado** la barrera, **cuando** se comprueba, **entonces** se decide en el servidor con la misma frontera de sesión de hoy (`src/lib/auth/session-boundary.ts`) y el estado de membresía viaja en el `SessionState` guardado 30 segundos (#434): un cambio de estado tarda como mucho 30 segundos en aplicarse.

### RF-3 · El alta en Stripe con un mes de prueba · Must

- **Dado** un socio Full o Student con membresía `pending`, **cuando** entra por primera vez, **entonces** la aplicación lo lleva al panel de membresía, que explica el precio, el mes de prueba y que el primer cobro es en 30 días, y le ofrece "Añadir tarjeta"; ese botón abre Stripe Checkout en modo suscripción con periodo de prueba de 30 días y tarjeta obligatoria (D3, INT-003).
- **Dado** que Checkout termina bien, **cuando** llega el webhook, **entonces** la membresía pasa a `trialing` con el fin de la prueba, la tarjeta y el cliente de Stripe guardados, y la puerta se abre en la siguiente petición.
- **Dado** que el socio abandona Checkout, **cuando** vuelve, **entonces** sigue `pending` y puede intentarlo otra vez.
- **Dado** el día 31, **cuando** Stripe cobra la primera cuota, **entonces** la membresía pasa a `active` y el pago entra en el historial.
- **Dado** un socio Casual, **cuando** entra por primera vez, **entonces** el panel le dice que los packs de sesiones llegan con E13 y que mientras tanto un Admin puede activarlo; no hay Checkout para Casual en E12.
- **Dado** los precios, **cuando** se crea la suscripción, **entonces** usa los `Price` de Stripe configurados por variable de entorno para Full y Student, en AUD, mensuales (FR-062, FR-063); no se crean precios desde la aplicación.

### RF-4 · La exención manual · Must

- **Dado** un Admin en la ficha de un socio, **cuando** pulsa "Eximir de cuota", escribe el motivo y, si quiere, una fecha de fin, y confirma, **entonces** la membresía pasa a `waived`, queda en la bitácora con quién, a quién, el motivo y la fecha, y el socio está al día desde su siguiente petición (D4).
- **Dado** una exención con fecha de fin, **cuando** llega esa fecha, **entonces** la membresía vuelve a `pending` (o al estado que tenga su suscripción de Stripe si existe) en la siguiente lectura, sin scheduler: la fecha se compara al leer.
- **Dado** un Admin, **cuando** retira una exención, **entonces** pasa lo mismo y queda en la bitácora.
- **Dado** un socio exento con suscripción activa en Stripe, **cuando** se le exime, **entonces** la suscripción se cancela al final del periodo, para no cobrarle.
- **Dado** un Coach, un Committee o un Player, **cuando** intenta eximir, **entonces** 403.

### RF-5 · El panel de membresía · Must

Es la pantalla `/pagos` del mockup `docs/mockups/payments-light.png`, sin la tarjeta de proveedores (PayPal fuera) y sin la alerta de pago fallido (E13).

- **Dado** un socio, **cuando** abre Pagos, **entonces** ve su plan (nombre y precio mensual), el estado con su chip (Activa, En prueba hasta el día X, Pendiente, Pago fallido, Cancelada, Exenta), la fecha del siguiente cobro, y la tarjeta (marca y últimos cuatro) si la hay (FR-065).
- **Dado** un Casual, **cuando** abre Pagos, **entonces** en vez de la fecha del siguiente cobro ve "Sin cobro recurrente" (FR-065).
- **Dado** un socio con tarjeta, **cuando** pulsa "Actualizar tarjeta", **entonces** va a Stripe (Checkout en modo `setup` o el portal de cliente de Stripe) y al volver el panel enseña la tarjeta nueva; ningún dato de tarjeta pasa por la aplicación (FR-067, AC-029, D6).
- **Dado** un socio `pending`, **cuando** abre Pagos, **entonces** ve lo de RF-3 y el botón de añadir tarjeta.
- **Dado** un socio `past_due` o `cancelled`, **cuando** abre Pagos, **entonces** ve el estado y por qué la puerta está cerrada, y "Actualizar tarjeta" o "Volver a suscribirse" según el caso; el reintento con un clic es E13.

### RF-6 · Cambio de plan al siguiente ciclo · Should

- **Dado** un socio Full o Student al día, **cuando** elige el otro plan y confirma, **entonces** el cambio se programa para el inicio del siguiente ciclo en Stripe, sin prorrateo, y el panel dice "Pasa a Student el día X" (FR-066, D5).
- **Dado** un cambio programado, **cuando** el socio se arrepiente antes de la fecha, **entonces** puede anularlo desde el panel.
- **Dado** un socio Full o Student, **cuando** elige Casual, **entonces** su suscripción se cancela al final del periodo y ese día su membresía pasa a `pending` como Casual (el pack es E13).
- **Dado** un Casual, **cuando** elige Full o Student, **entonces** va a Checkout como en RF-3, sin mes de prueba si ya tuvo uno.

### RF-7 · El historial de pagos · Must

- **Dado** un socio, **cuando** abre Pagos, **entonces** ve sus pagos del más reciente al más antiguo con fecha, descripción, importe y estado (Pagado, Fallido, Pendiente), tal como Stripe los informó (FR-068, AC-026).
- **Dado** un pago, **cuando** Stripe lo informa por webhook, **entonces** queda guardado con su id de factura o cargo, y un webhook repetido no lo duplica.
- **Dado** un socio sin pagos, **cuando** abre el historial, **entonces** una frase lo dice.

### RF-8 · Los webhooks de Stripe · Must

- **Dado** un evento de Stripe, **cuando** llega a `POST /api/v1/stripe/webhook`, **entonces** se verifica la firma con el secreto del webhook y sin firma válida responde 400 y no toca nada (INT-002, D7).
- **Dado** un evento válido, **cuando** se procesa, **entonces** se guarda su id antes de aplicarlo y un evento ya visto responde 200 sin volver a aplicarse.
- **Dado** `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`, **cuando** llegan, **entonces** mueven la membresía y el historial según la tabla de D1; cualquier otro evento responde 200 y se ignora.
- **Dado** un evento de un cliente de Stripe que la base no conoce, **cuando** llega, **entonces** responde 200, no crea nada y lo deja en el log.
- **Dado** eventos que llegan fuera de orden (Stripe no garantiza el orden), **cuando** se aplican, **entonces** el estado final es el del evento más reciente según su `created`, y uno más viejo que el último aplicado no retrocede el estado.
- **Dado** el webhook, **cuando** se declara, **entonces** es ruta pública sin sesión, fuera del proxy de sesión, con su propia verificación.

### RF-9 · Configuración y entorno · Must

- **Dado** las variables `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FULL` y `STRIPE_PRICE_STUDENT`, **cuando** faltan, **entonces** el panel de membresía dice que los pagos no están configurados y ningún endpoint de Stripe se ofrece; nunca un 500.
- **Dado** `seadragons-dev` y el Supabase local, **cuando** se prueba, **entonces** se usa la cuenta de Stripe del club en modo de prueba; producción usa las llaves reales. Las llaves viven donde dice `docs/entornos.md` (`.env.local`, secretos de GitHub, variables de Vercel), nunca en el repositorio.

## 6. Casos borde y estados de error

- **Stripe no contesta** al crear Checkout: el panel lo dice y ofrece reintentar; la membresía no cambia.
- **Webhook que llega antes que la vuelta de Checkout:** la membresía ya está `trialing` cuando el socio vuelve; el panel lo enseña sin recargar dos veces.
- **Webhook repetido o fuera de orden:** RF-8.
- **Tarjeta caducada durante la prueba:** Stripe falla el primer cobro; `past_due`; la puerta se cierra con su motivo.
- **Socio que cambia de tipo en su perfil:** el tipo de membresía deja de editarse desde el perfil (E5); se cambia solo desde Pagos (RF-6).
- **Exención con fecha de fin ya pasada:** no se puede guardar.
- **Admin que se exime a sí mismo:** permitido, y queda en la bitácora.
- **Dos Admins eximiendo a la vez:** gana el último, como en el resto de escrituras del Admin.
- **Cuenta `inactive` (baja) con suscripción activa:** al dar de baja, la suscripción se cancela al final del periodo; la exención, si la hay, se retira.
- **Cuenta `incomplete`:** no llega a nada de esto; sigue con su pantalla de completar registro.
- **Menor con consentimiento del tutor:** el mismo flujo; la tarjeta la pone quien sea.
- **Cambio de idioma:** el panel, los estados y los correos de Stripe (idioma del cliente en Stripe) siguen al socio.

## 7. UX / UI

- Mockups: `docs/mockups/payments-light.png` y `payments-dark.png` (escritorio). El panel del móvil, el estado `pending` con la explicación del mes de prueba, la barrera en el calendario y la exención en la ficha no están dibujados: revisión heurística contra `design-system.md`.
- Flujos: registrarse, entrar, poner la tarjeta en Checkout, volver y ver el club abierto. Actualizar la tarjeta. Cambiar de plan. El Admin exime a un entrenador desde su ficha.
- Viewports a soportar: 375 / 768 / 1440.

## 8. Requerimientos no funcionales

- Rendimiento: el estado de membresía entra en el `SessionState` (una lectura más en la misma consulta de `members` o un join), sin viajes extra por petición.
- Seguridad: firma de webhooks verificada; ningún dato de tarjeta en la plataforma (NFR-006); las llaves de Stripe solo en el servidor; RLS en `memberships` y `payments` como en asistencia.
- Accesibilidad: `design-system.md`, axe sin violaciones; los chips de estado con texto, no solo color.
- Bilingüe (E17): todo texto nuevo en los dos catálogos.
- Tests: la lógica de estados y de la barrera con gateways falsos; los webhooks con eventos de ejemplo firmados con un secreto de prueba; contra Stripe real solo en modo de prueba y solo donde haya llaves (se saltan sin ellas, con aviso, como los de red).

## 9. Preguntas abiertas

Ninguna que bloquee. Decisiones tomadas el 30 de septiembre de 2026:

- **D1 · Estados:** `pending`, `trialing`, `active`, `past_due`, `cancelled`, `waived`; al día son los tres del medio más `waived`.
- **D2 · La barrera es el pago:** quien no está al día ve su perfil, Pagos y el calendario en lectura, y nada más; no responde al RSVP, no entra en escuadras ni en hojas de asistencia. Sin aprobación manual del Admin para las altas.
- **D3 · Primer pago al primer inicio de sesión, con un mes de prueba en Stripe y tarjeta obligatoria.** El registro sigue durando un minuto.
- **D4 · Exención manual del Admin** para entrenadores y voluntarios, con motivo, fecha de fin opcional y bitácora. El club no cobra en efectivo.
- **D5 · El cambio de plan se aplica al siguiente ciclo** en Stripe, sin prorrateo, y se puede anular antes.
- **D6 · La tarjeta se cambia en Stripe**, nunca en la aplicación.
- **D7 · Los webhooks son la única fuente de verdad** del estado, idempotentes por id de evento y a prueba de desorden.

## 10. Descomposición en tickets (para write-ticket)

| #   | Issue | Título propuesto                                                                             | Tamaño | Depende de | Auto-merge sugerido             |
| --- | ----- | -------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------- |
| 1   | #451  | Guarda la membresía y los pagos de cada socio, con sus estados y RLS                         | M      | ninguna    | No: modelo de datos nuevo       |
| 2   | #452  | Recibe y aplica los webhooks de Stripe, firmados, idempotentes y a prueba de desorden        | M      | 1          | No: integración de pagos        |
| 3   | #453  | Cierra la puerta a quien no está al día: frontera, menú, RSVP, escuadra y hoja de asistencia | M      | 1          | No: permisos                    |
| 4   | #454  | Lleva al socio nuevo a Stripe Checkout con un mes de prueba y abre la puerta al volver       | M      | 2, 3       | No: pagos                       |
| 5   | #455  | Panel de membresía del mockup: plan, estado, tarjeta, cambio de tarjeta e historial          | M      | 2          | No: pantalla nueva, `ui-review` |
| 6   | #456  | Cambio de plan al siguiente ciclo, con anulación                                             | S      | 5          | No: pagos                       |
| 7   | #457  | Exención manual del Admin desde la ficha, con bitácora y estado visible en el directorio     | S      | 3          | No: permisos, `ui-review`       |

Los tickets 2 y 3 van en paralelo tras el 1; el 4 y el 5 detrás; el 6 y el 7 al final. Antes del ticket 2 hace falta la cuenta de Stripe del club en modo de prueba con los dos precios creados y las llaves puestas en `.env.local` de quien lo trabaje y en los secretos de GitHub: es un paso del dueño.
