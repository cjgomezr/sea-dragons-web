# PRD: E20 · CI con su propio Supabase

**Estado:** aprobado · **Fecha:** 8 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: la conversación con el dueño del 6 al 8 de octubre de 2026, el aviso de Supabase sobre la cuota de logs y el PRD de E16b (`docs/prd/e16b-scheduler-y-carga.md`, D7), cuya prueba de carga depende de esta épica. Es una épica de infraestructura añadida después del plan; no cambia ningún requisito del SRD.

Las decisiones del dueño van marcadas como D1 a D5:

- **D1.** Cada corrida de CI levanta su propio Supabase dentro del runner con el Supabase CLI, le aplica las migraciones del repo y lo tira al terminar. No es un tercer proyecto de Supabase ni tiene coste.
- **D2.** Se pasa primero el workflow `checks` y, cuando esté estable, la visual (`compare`, `regenerate` y la aceptación de capturas).
- **D3.** Solo CI. Los workers de la fábrica y las personas siguen usando `seadragons-dev` en sus máquinas. Pasarlas a un Supabase local pide Docker en Windows y en macOS, y queda para otra épica.
- **D4.** La cola de turnos de dev (#507, #517) se quita cuando ningún workflow la necesite.
- **D5.** La reserva de socios de prueba (#415) se queda: las corridas en las máquinas contra dev la siguen necesitando para no gastar usuarios mensuales.

## 1. Problema

CI comparte con todos la base `seadragons-dev`, y eso cuesta de tres formas.

- **La cuota de logs.** Dev genera unas 316.000 líneas de log al día, casi todas de CI (`/rest/v1/members` 82.000, `/auth/v1/user` 20.000, `/rest/v1/groups` 17.000). En octubre de 2026 la organización ya pasó la cuota gratuita de ingesta de logs (1,40 de 1 GB). Supabase avisó de que desde el 30 de octubre de 2026 aplica su política de uso justo y puede restringir la organización, que es la misma de producción.
- **Los fallos que no son del código.** Con dos o tres PR a la vez, dev deja peticiones sin contestar. Los arreglos del #506 (tiempo máximo y reintento) y del #507 (cola de turnos) lo contienen, pero no lo quitan: el 7 de octubre `news.integration` falló en main porque dev no contestó a un borrado en 10 segundos, sin nada más corriendo.
- **La espera.** La cola de turnos pone en fila todo lo que usa dev. Un PR espera a que acaben los `checks` y las visuales de los demás, y con cuatro PR abiertos un `checks` llegó a esperar 60 minutos antes de empezar.

## 2. Usuarios y contexto

- **El dueño y Andrea, operando la fábrica:** abren tres a cinco PR al día y esperan a que CI salga verde para hacer el merge.
- **Los workers de la fábrica:** no cambian. Siguen corriendo Playwright en la máquina de cada uno contra dev (D3).
- **Los socios de producción:** no ven nada, salvo que la organización de Supabase deje de estar en riesgo de restricción.
- **Hoy lo resuelven así:** esperando la cola, relanzando a mano los jobs que fallan por dev y revisando cada fallo para decidir si es del código o de dev.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que CI no toque `seadragons-dev` y que un PR no espere a otro.
- **Métricas:**
  - Las líneas de log diarias de dev bajan de unas 316.000 a menos de 30.000, medido con el MCP de Supabase una semana después del último ticket.
  - Cero fallos de CI por "dev no contestó" en las dos semanas siguientes.
  - Un PR con la visual queda en verde en menos de 30 minutos desde el push, sin esperar a otros PR.
  - Ningún secreto de dev llega ya a `checks.yml` ni a `visual-baselines.yml`.

## 4. Alcance

**Incluido (v1):**

- Una acción compuesta reutilizable que levanta el Supabase local en un runner, le aplica las migraciones y deja la URL y las llaves en el entorno del job.
- `checks` y la visual (sus cuatro tandas de `compare` y de `regenerate`, y la aceptación) usando cada uno su propio Supabase local.
- Quitar la cola de turnos y su script cuando ya no la use nadie.
- Poner al día `docs/entornos.md`, `entornos.json`, `CLAUDE.md` y los tests que fijan que CI usa dev.

**Explícitamente fuera (por ahora):**

- Las máquinas de las personas y de los workers (D3).
- Quitar la reserva de socios de prueba (D5) o los arreglos de tiempo máximo y reintento (#163, #506): siguen sirviendo contra dev.
- Las previews de Vercel, que siguen apuntando a dev.
- La prueba de carga de E16b: usará la acción de esta épica, pero es su ticket (#524, #525).
- Pasar a Supabase Pro.

## 5. Requerimientos funcionales

### RF-1 · Un Supabase local en el runner · Must

Una acción compuesta (por ejemplo `.github/actions/supabase-local`) que cualquier job puede usar.

- **Dado** un job de GitHub Actions en `ubuntu-latest`, **cuando** usa la acción, **entonces** arranca Supabase con el CLI del repo (`supabase` en `devDependencies`), con las migraciones de `supabase/migrations` aplicadas, y en menos de 4 minutos.
- **Dado** la acción terminada, **cuando** siguen los pasos del job, **entonces** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` apuntan a ese Supabase. Las llaves salen de `supabase status`, no de los secretos del repo.
- **Dado** el Supabase local, **cuando** arranca, **entonces** solo levanta lo que usan la app y los tests: base, Auth, la API REST y Storage. Studio, Realtime, Edge Functions y la analítica no.
- **Dado** que el arranque falla (una imagen que no baja, Docker caído), **cuando** pasa, **entonces** reintenta una vez y, si vuelve a fallar, el job falla con un mensaje claro. Nunca cae a dev en silencio.
- **Dado** el Supabase local recién levantado, **cuando** se mira, **entonces** tiene el club `victoria-seadragons` y sus posiciones, como dev, porque los crean las migraciones (`0001`, `0025`).

### RF-2 · El checks usa su Supabase · Must

- **Dado** un PR que no es de solo texto, **cuando** corre `checks`, **entonces** los tests de integración y de RLS corren contra su Supabase local y no reciben ningún secreto de dev.
- **Dado** el job `checks`, **cuando** arranca, **entonces** no pasa por `turno-dev`: no espera a ninguna otra corrida.
- **Dado** los tests de Stripe en modo de prueba, **cuando** corren, **entonces** siguen recibiendo los secretos de Stripe como hoy. Stripe no es parte de esta épica.
- **Dado** un PR de solo texto o de solo líneas base (#494), **cuando** corre `checks`, **entonces** se lo sigue saltando como hoy, sin levantar Supabase.

### RF-3 · La visual usa su Supabase · Must

- **Dado** la visual (`compare` y `regenerate`), **cuando** corre cada una de sus cuatro tandas, **entonces** cada tanda levanta su propio Supabase local, compila la app contra él (el prerender lee la marca del club, #292) y corre Playwright contra él.
- **Dado** la aceptación de capturas (`workflow_dispatch`), **cuando** corre, **entonces** también usa su Supabase local.
- **Dado** la visual, **cuando** arranca, **entonces** no pasa por `turno-dev` ni espera al `checks` de su propio PR.
- **Dado** las líneas base actuales, **cuando** se pasa a Supabase local, **entonces** las capturas no cambian. Si alguna cambia (por ejemplo, porque dev tenía datos que la base nueva no tiene), el ticket lo dice y se acepta con el OK del dueño, como siempre.

### RF-4 · Sin cola de turnos · Must

- **Dado** que ni `checks` ni la visual usan dev, **cuando** se quita la cola, **entonces** desaparecen los jobs `turno-dev`, `scripts/wait-for-dev-turn.sh` y sus tests, y dos PR corren a la vez.
- **Dado** la concurrencia por PR (`cancel-in-progress`), **cuando** llega un push nuevo, **entonces** se sigue cancelando la corrida anterior del mismo PR, como hoy.

### RF-5 · La documentación dice dónde corre cada cosa · Must

- **Dado** `docs/entornos.md`, `entornos.json` y `CLAUDE.md`, **cuando** se leen, **entonces** dicen que CI usa un Supabase local por corrida y que las máquinas siguen usando dev.
- **Dado** los tests que hoy fijan que CI usa dev (`entornos-doc.test.ts`, `entornos-manifest.test.ts`, `config/integration-tests-doc.test.ts`, `dev-queue.test.ts`), **cuando** se actualizan, **entonces** fijan lo nuevo y no se borran a secas.

### RF-6 · Los tests de integración en paralelo · Could

- **Dado** el proyecto `integration` de Vitest, que hoy corre un archivo a la vez por la carga de dev (#431), **cuando** corre contra el Supabase local en CI, **entonces** puede correr varios archivos a la vez, si eso baja el tiempo del `checks` sin volverlo inestable. En las máquinas, contra dev, sigue en serie.

## 6. Casos borde y estados de error

- **Límites de Auth del Supabase local:** `supabase/config.toml` pone `sign_in_sign_ups = 30` cada 5 minutos por IP, y en CI todo sale de la misma IP. La suite inicia sesión mucho más. Hay que subir esos límites en `config.toml`, que solo afecta a los Supabase locales: los de dev y producción se configuran en su panel.
- **Bajar las imágenes de Docker:** la primera vez de cada runner tarda. Si las imágenes vienen de un registro con límite de descargas anónimas, el arranque puede fallar a ratos. El reintento de RF-1 lo cubre; si no basta, se cachean.
- **Las migraciones fallan en el Supabase local** (por ejemplo, una que solo funciona en dev): el job falla en el arranque con el error de la migración. Es un aviso útil, no un problema de CI.
- **`pg_cron` existe en el Supabase local:** la `0062` programa la limpieza nocturna, que en una base de minutos de vida no llega a correr. No hace falta tratarlo.
- **La reserva de socios de prueba** crea su bucket en cada Supabase nuevo. Funciona igual, solo que sin competencia por las plazas.
- **Memoria del runner:** Supabase local más la app compilada más Playwright tienen que caber en un runner estándar (16 GB en repos públicos). Si no caben, el ticket de la visual lo dice.
- **Una corrida cancelada a mitad:** el runner se tira entero y no queda nada que limpiar en ningún sitio.

## 7. UX / UI

- No hay pantallas.

## 8. Requerimientos no funcionales

- **Rendimiento:** el arranque del Supabase local no suma más de 4 minutos a ningún job.
- **Seguridad:**
  - Las llaves del Supabase local son las de ejemplo del CLI y no son secretas.
  - Los secretos de dev (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) dejan de pasarse a `checks.yml` y `visual-baselines.yml`. Siguen en el repo para quien los use.
  - La guarda de `src/lib/supabase/environment-guard.ts` ya permite `127.0.0.1:54321` y `localhost:54321`, y sigue impidiendo producción.
- **Coste:** cero. El repo es público y sus minutos de Actions no se cobran; el Supabase local no es un proyecto.
- **Accesibilidad:** no aplica.

## 9. Preguntas abiertas

- Ninguna que bloquee. El tiempo real de arranque y si hace falta cachear imágenes se ve en el primer ticket.

## 10. Descomposición en tickets (para write-ticket)

| #        | Título propuesto                                                                                       | Tamaño | Depende de | Auto-merge sugerido                         |
| -------- | ------------------------------------------------------------------------------------------------------ | ------ | ---------- | ------------------------------------------- |
| 1 (#535) | Levanta un Supabase local en el runner con las migraciones del repo, en una acción reutilizable (RF-1) | M      | ninguna    | No: infraestructura nueva de CI             |
| 2 (#536) | Corre los tests de integración del checks contra su propio Supabase y sin cola (RF-2)                  | M      | 1          | No: cambia qué verifica el gate de los PR   |
| 3 (#537) | Corre la visual y la aceptación de capturas contra su propio Supabase por tanda y sin cola (RF-3)      | M      | 2          | No: cambia el gate visual y las líneas base |
| 4 (#538) | Quita la cola de turnos de dev y pone al día la documentación de entornos (RF-4, RF-5)                 | S      | 3          | No: borra un control y toca `CLAUDE.md`     |
| 5 (#539) | Corre en paralelo los tests de integración en CI (RF-6)                                                | S      | 2          | No: puede volver inestable el checks        |

Los tickets de E16b que esperan esta épica: el #524 (sembrar el club de NFR-008) pasa a depender del #535, y el #525 sigue dependiendo del #524.

Los tickets 2 y 3 se prueban a sí mismos en su PR: es mejor correrlos con pocos PR abiertos. Ninguno lleva migraciones, así que los puede hacer cualquiera de los dos.
