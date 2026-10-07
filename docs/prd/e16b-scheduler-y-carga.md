# PRD: E16b · Scheduler y prueba de carga

**Estado:** aprobado · **Fecha:** 7 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: la fila de E16b en `docs/plan-maestro.md`, el PRD de E16a (`docs/prd/e16a-entornos-y-despliegue.md`, que le pasó los trabajos de `pg_cron` y la prueba de carga) y la conversación con el dueño del 7 de octubre de 2026. Cubre NFR-001 y NFR-008 del SRD, y la parte de NFR-010 que dice cuánto se guarda la bitácora.

Al revisar el código antes de escribir esto, dos de los tres trabajos que el plan le daba a E16b resultaron estar ya resueltos de otra forma. Las decisiones del dueño van marcadas como D1 a D7:

- **D1. FR-031 sale de E16b.** Al crear una serie semanal, `create_events` (`0036`) genera en la misma transacción todas sus ocurrencias, y una serie dura como mucho un año (`event_series_date_range`, `0034`). No hay hueco que un trabajo programado tenga que llenar. Quien quiera seguir después del año crea otra serie.
- **D2. FR-072 se queda con Stripe.** El aviso antes de la renovación lo dispara el evento `invoice.upcoming` siete días antes (E13, D3 de su PRD). No se mueve a `pg_cron`.
- **D3.** El trabajo programado de verdad es la limpieza de datos viejos que varias migraciones dejaron prometida "para E16". Entran las tres partes: registros técnicos, bitácora y notificaciones.
- **D4.** Los registros técnicos (solicitudes de correo, de recuperación, de confirmación, de registro y envíos del directorio) se borran a los 90 días. Solo sirven para contar cupos de 1 a 24 horas.
- **D5.** La bitácora de auditoría se borra a los 12 meses, el mínimo de NFR-010.
- **D6.** La poda de notificaciones que hoy se hace al llegar una nueva (`0023`) pasa también a una vuelta nocturna para todos los socios.
- **D7.** La prueba de carga corre contra un Supabase desechable dentro del runner de GitHub Actions, nunca contra `seadragons-dev`. Corre a mano y una vez por semana, no en cada PR. Por eso depende de la épica de CI con su propio Supabase.

## 1. Problema

Hay dos huecos, y los dos son de los que no se ven hasta que duelen.

El primero es que varias tablas solo crecen. `audit_log`, las cinco tablas que cuentan cupos de correo (`0005`, `0006`, `0009`, `0010` y `0059`) y las notificaciones de quien no recibe nada nuevo no se limpian nunca, aunque sus migraciones prometen hacerlo. Cada fila de más ocupa base (el plan gratuito de Supabase da 500 MB) y es un dato personal guardado más tiempo del que hace falta. Eso va contra la idea de E15 de guardar solo lo necesario.

El segundo es que nadie sabe si la aplicación aguanta. El SRD pide que el 95% de las peticiones contesten en menos de un segundo con 50 usuarios a la vez (NFR-001), y con 500 socios, 5.000 ocurrencias y 50.000 asistencias (NFR-008). Hoy la base de dev tiene unas decenas de socios de prueba. Una consulta que va bien con 30 filas puede tardar segundos con 50.000, y lo descubriría el club un martes a las siete de la tarde.

## 2. Usuarios y contexto

- **El dueño de la plataforma:** quiere saber, antes de vender la licencia a otros clubes, que la aplicación aguanta un club grande, y que la base no crece sin control.
- **Los socios:** no ven nada de esta épica. Que la aplicación siga rápida con un club lleno es lo que notan.
- **El Admin:** lee la bitácora. Desde esta épica, solo ve los últimos 12 meses.
- **Hoy lo resuelven así:** no se resuelve. Nadie borra nada y nadie ha medido la aplicación con datos de tamaño real.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que la base se limpie sola cada noche y que haya una prueba repetible que diga si la aplicación cumple NFR-001 y NFR-008.
- **Métricas:**
  - Ninguna fila de las tablas de cupos con más de 91 días, y ninguna de `audit_log` con más de 12 meses y un día, comprobado en producción una semana después de activar la limpieza.
  - La prueba de carga termina con p95 por debajo de 1 segundo y menos del 1% de errores, con 50 usuarios virtuales y el dataset completo sembrado.
  - La prueba de carga se puede repetir con un clic y termina en menos de 30 minutos.
  - Cero filas sembradas y cero logs generados en `seadragons-dev` por la prueba de carga.

## 4. Alcance

**Incluido (v1):**

- `pg_cron` activado en dev y en producción, con un trabajo nocturno de limpieza.
- Las funciones de limpieza: tablas de cupos a los 90 días, bitácora a los 12 meses, notificaciones de todos los socios con la regla de `0023`, y el propio historial de `pg_cron`.
- Un sembrado determinista del dataset de NFR-008 sobre un Supabase local.
- La prueba de carga de NFR-001 con su informe, en un workflow manual y semanal.
- Corregir la fila de E16b en `docs/plan-maestro.md` y las notas P2 y P3 de `docs/preguntas-abiertas.md`, que todavía dicen que E16b hace FR-031 y FR-072.

**Explícitamente fuera (por ahora):**

- Series sin fecha de fin y generación de ocurrencias por adelantado (D1).
- Mover el aviso de renovación a `pg_cron` (D2).
- Recordatorios antes de un evento (el PRD de E7 los menciona como futuro).
- El borrado o la anonimización de un socio que se da de baja (E15, NFR-011). Lo de esta épica son registros técnicos y la bitácora, no las fichas de los socios.
- Correr la prueba de carga contra dev o contra producción.
- Arreglar lo que la prueba de carga encuentre lento. Si algo no cumple, se abre un ticket por cada endpoint lento.
- Monitorización continua del rendimiento en producción (APM, alertas).

## 5. Requerimientos funcionales

### RF-1 · Limpieza de los registros de cupos · Must

Una función de base borra las filas con más de 90 días de las tablas que solo cuentan cupos.

- **Dado** filas de `password_recovery_requests`, `confirmation_email_requests`, `email_send_requests` y `registration_requests` con `requested_at` de hace 91 días y de hace 89, **cuando** corre la limpieza, **entonces** se borran las de 91 y se quedan las de 89.
- **Dado** filas de `directory_email_sends` con `created_at` de hace 91 días y de hace 89, **cuando** corre la limpieza, **entonces** se borran las de 91 y se quedan las de 89.
- **Dado** la limpieza, **cuando** termina, **entonces** devuelve cuántas filas borró de cada tabla.

### RF-2 · Limpieza de la bitácora · Must

- **Dado** filas de `audit_log` de hace 12 meses y un día y de hace 11 meses y 29 días, **cuando** corre la limpieza, **entonces** se borra la primera y se queda la segunda.
- **Dado** la pantalla de bitácora del Admin, **cuando** la abre después de la limpieza, **entonces** no hay ningún aviso nuevo: simplemente no aparece lo de hace más de 12 meses.

### RF-3 · Poda de notificaciones para todos · Must

- **Dado** un socio que no recibe ninguna notificación nueva desde hace meses y tiene notificaciones leídas de hace 100 días, **cuando** corre la vuelta nocturna, **entonces** se le podan con la misma regla de `prune_member_notifications` (`0023`): leídas de más de 90 días y, como mucho, 200 en total.
- **Dado** la poda que ya se hace al llegar una notificación, **cuando** se activa la nocturna, **entonces** la inmediata sigue igual. La regla vive en un solo sitio y las dos la llaman.

### RF-4 · El trabajo nocturno · Must

- **Dado** `pg_cron` activado en un proyecto, **cuando** se aplica la migración, **entonces** existe un único trabajo con nombre fijo (por ejemplo `limpieza-nocturna`) que llama a las limpiezas de RF-1, RF-2, RF-3 y RF-5.
- **Dado** el horario del trabajo, **cuando** se programa, **entonces** cae de madrugada en Melbourne y fuera de las franjas de NFR-003 (martes y jueves de 18:00 a 22:00, sábado de 08:00 a 13:00). `pg_cron` usa UTC: por ejemplo `30 16 * * *`, que son las 02:30 en horario de verano australiano y las 03:30 en el de invierno.
- **Dado** la migración aplicada dos veces, o sobre un proyecto donde el trabajo ya existe, **cuando** corre, **entonces** no duplica el trabajo.
- **Dado** que una de las limpiezas falla, **cuando** corre el trabajo, **entonces** las otras se intentan igual y el fallo queda en el historial de `pg_cron` con el mensaje de error.
- **Dado** la base de Postgres desechable de CI (`migrations.yml`), que no trae `pg_cron`, **cuando** se aplican las migraciones, **entonces** pasan igual y las funciones de limpieza se pueden probar allí. Solo la programación depende de que exista `pg_cron`.

### RF-5 · El historial de pg_cron también se limpia · Should

- **Dado** filas de `cron.job_run_details` de hace más de 30 días, **cuando** corre el trabajo, **entonces** se borran. Si no, el historial del propio scheduler crece sin límite.

### RF-6 · El dataset de NFR-008 · Must

Un script siembra, sobre un Supabase local, un club con el tamaño que pide el SRD.

- **Dado** un Supabase local recién levantado y con las migraciones aplicadas, **cuando** corre el sembrado, **entonces** hay un club con al menos 500 socios, 5.000 ocurrencias de evento y 50.000 asistencias, más grupos, noticias, notificaciones, RSVP, evaluaciones y membresías en proporciones creíbles (el ticket fija cuáles).
- **Dado** el mismo sembrado dos veces, **cuando** se compara, **entonces** produce los mismos datos: usa una semilla fija, no aleatoriedad libre.
- **Dado** el sembrado, **cuando** termina, **entonces** tarda menos de 5 minutos. Inserta por lotes, no fila a fila por la API.
- **Dado** los usuarios de la prueba, **cuando** se siembran, **entonces** hay 50 identidades con contraseña conocida y sesión iniciable, repartidas entre roles: la mayoría Player, y algunos Coach, Committee y Admin.
- **Dado** cualquier configuración, **cuando** alguien intenta correr el sembrado contra un proyecto que no es local, **entonces** se niega y dice por qué. La misma guardia que ya usa la suite para no crear usuarios donde no toca.

### RF-7 · La prueba de carga · Must

- **Dado** el dataset de RF-6 y la aplicación compilada en modo producción contra ese Supabase local, **cuando** corre la prueba, **entonces** 50 usuarios virtuales con sesión iniciada recorren durante al menos 5 minutos las pantallas y endpoints de uso normal: inicio, calendario y detalle de evento con RSVP, directorio con filtros, asistencia de un evento, estadísticas de asistencia, noticias, notificaciones y Pagos.
- **Dado** el resultado, **cuando** el p95 de las peticiones supera 1 segundo o los errores pasan del 1%, **entonces** la prueba falla y dice qué peticiones fueron las más lentas.
- **Dado** el resultado, **cuando** termina, **entonces** el resumen del job enseña el p50, el p95 y el p99 por endpoint, y el informe completo queda como artefacto.
- **Dado** la prueba, **cuando** se mira el workflow, **entonces** se lanza a mano (`workflow_dispatch`) y una vez por semana, fuera de los PR. No usa `seadragons-dev` ni su cola, y no recibe sus credenciales.

### RF-8 · El reparto de equipos dentro de su límite · Could

- **Dado** el dataset, **cuando** un Coach pide el reparto automático de 30 jugadores durante la prueba, **entonces** el p95 de esa petición queda por debajo de 2 segundos (NFR-002, AC-019c).

## 6. Casos borde y estados de error

- **Tablas vacías:** la limpieza termina sin error y devuelve ceros.
- **Muchas filas de golpe:** la primera vez en producción puede haber meses acumulados. La limpieza borra por lotes acotados para no bloquear las tablas que se usan para contar cupos mientras un socio pide recuperar su contraseña.
- **El límite exacto:** una fila con exactamente 90 días se queda. Se borra lo estrictamente más viejo.
- **Zona horaria:** las edades se calculan con `now()` en UTC. No dependen del huso de Melbourne.
- **pg_cron no disponible:** en CI no está. La migración no falla; solo se salta la programación.
- **El trabajo se solapa consigo mismo:** si una vuelta tarda más de 24 horas (no debería), `pg_cron` no lanza la siguiente encima.
- **Bitácora y NFR-010:** se borra lo de más de 12 meses, nunca menos. Un error en el cálculo que borre de más es un incumplimiento, así que el test usa los dos bordes.
- **La prueba de carga se queda sin memoria o sin tiempo en el runner:** falla con un mensaje claro y el informe parcial. Nunca sale en verde por haber medido menos de lo pedido.
- **El sembrado a medias:** si falla a la mitad, el Supabase local se tira entero; no hay nada que deshacer.

## 7. UX / UI

- No hay pantallas nuevas.
- La bitácora del Admin simplemente deja de mostrar lo de más de 12 meses.

## 8. Requerimientos no funcionales

- **Rendimiento:** la limpieza nocturna termina en menos de 1 minuto con el dataset de RF-6. La prueba de carga mide NFR-001 y NFR-008.
- **Seguridad:**
  - Las funciones de limpieza solo las ejecuta `postgres` (el dueño de `pg_cron`). `anon`, `authenticated` y `service_role` no pueden llamarlas por la API.
  - La prueba de carga no usa ningún secreto de dev ni de producción.
- **Coste:** cero filas y cero logs en los proyectos de Supabase compartidos. `pg_cron` viene incluido en el plan gratuito.
- **Accesibilidad:** no aplica, no hay UI.

## 9. Preguntas abiertas

- [ ] **La épica de CI con su propio Supabase no existe todavía.** RF-6 y RF-7 dependen de ella (D7). Si se decide no hacerla, la prueba de carga tendría que levantar su propio Supabase local, que es más o menos el mismo trabajo. Hay que escribir esa épica antes de los tickets 3 y 4.
- [ ] **k6 o autocannon** para la prueba de carga. k6 es un binario aparte, no una dependencia de npm, y da percentiles y umbrales de serie. autocannon es de npm y más simple, pero peor para recorrer varias pantallas con sesión. Recomiendo k6; lo decide el ticket con una línea de justificación.

## 10. Descomposición en tickets (para write-ticket)

| #        | Título propuesto                                                                                           | Tamaño | Depende de                  | Auto-merge sugerido                                    |
| -------- | ---------------------------------------------------------------------------------------------------------- | ------ | --------------------------- | ------------------------------------------------------ |
| 1 (#522) | Borra los registros de cupos de más de 90 días y la bitácora de más de 12 meses (RF-1, RF-2, RF-3)         | M      | ninguna                     | No: borra datos en producción                          |
| 2 (#523) | Activa pg_cron y programa la limpieza nocturna, con su propio historial acotado (RF-4, RF-5)               | S      | 1                           | No: extensión nueva y trabajo programado en producción |
| 3 (#524) | Siembra en un Supabase local el club de NFR-008: 500 socios, 5.000 ocurrencias y 50.000 asistencias (RF-6) | M      | épica de CI con su Supabase | No: herramienta nueva, aunque no toca producción       |
| 4 (#525) | Prueba con 50 usuarios que el p95 queda por debajo de 1 segundo, a mano y cada semana (RF-7, RF-8)         | M      | 3                           | No: workflow nuevo y dependencia nueva                 |

Además, el PR de este PRD corrige la fila de E16b en `docs/plan-maestro.md` (sin FR-031 ni FR-072, con la limpieza y la dependencia de la épica de CI) y las notas P2 y P3 de `docs/preguntas-abiertas.md`.

Los tickets 1 y 2 no dependen de nada y se pueden hacer ya. Los dos necesitan aplicar migraciones en dev, así que son para quien tiene el MCP de Supabase.
