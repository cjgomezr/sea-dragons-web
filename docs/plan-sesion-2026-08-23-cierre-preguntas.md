<!--
  Copia congelada del plan aprobado el 23 de agosto de 2026, antes de ejecutarlo.
  Sirve de referencia histórica: NO se actualiza cuando el plan cambie. Lo que
  vive y se mantiene es docs/plan-maestro.md.
-->

# Plan: cerrar las preguntas abiertas, actualizar el SRD y crear los epics + los tickets de E1

## Contexto

El repo tiene el bootstrap hecho y **cero issues**. `docs/plan-maestro.md` define 14 epics y su
columna "Issue" apunta a `#1`–`#14`, que no existen. `docs/preguntas-abiertas.md` dice, textual,
"nada resuelto todavía": 4 bloqueadores, 3 contradicciones internas del SRD, 7 FRs sin criterio de
aceptación y 5 huecos del plan. `CLAUDE.md` prohíbe escribir el ticket de un epic que aparezca ahí
sin resolver, así que la cola no puede arrancar en el estado actual.

Además acabas de añadir `docs/Seadragons Platform.dc.html` y `docs/support.js`: el prototipo de
Claude Design que el SRD cita como fuente y que la auditoría daba por perdido (§5 de
preguntas-abiertas). Trae los tokens de marca reales y las 8 pantallas web + 5 móviles, lo que
sube al `ui-reviewer` de modo heurístico a modo comparación.

Decisiones que ya tomaste en la ronda de preguntas:

- **Alcance de la tanda:** los 16 epics, y tickets solo de E1.
- **B1 Family:** fuera de Release 1. Quedan Full, Student y Casual.
- **P2/P3/P4:** dos epics nuevos, E15 (privacidad y datos personales) y E16 (infraestructura).
- **B4:** el % de asistencia se calcula sobre las sesiones a las que el miembro estaba targeteado
  y ocurrieron tras su alta; el jugador sin evaluar entra al auto-balance como 5.0 virtual.

Resultado esperado: SRD v1.4 sin bloqueadores, plan maestro con 16 epics y stack declarado,
16 issues épicos en el board, y los tickets de E1 listos para que `process-backlog.sh` arranque.

---

## Fase 1 · Resolver las preguntas abiertas en el SRD (v1.3 → v1.4)

Cada decisión se escribe **en el SRD**, no en el chat. `docs/preguntas-abiertas.md` pasa a marcar
cada fila como resuelta con un puntero al FR/AC que la resolvió.

### Lo que ya decidiste

| Ref     | Decisión a escribir                                                                                                                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1**  | FR-062 pasa a tres tipos: Full $45, Student $32, Casual $15/sesión. FR-009 ofrece esos tres. §3.2 gana "Family membership" como fuera de alcance. §9 pierde el `[TBD]: linking model`. ASS-001 se ajusta.                                     |
| **B4a** | FR-042 reescrita: `% = (Present + Late) / sesiones de tipo Training a las que el miembro estaba targeteado y cuya fecha es posterior a su join date`. Denominador 0 → se muestra "sin datos", nunca 0%. AC-017 reescrita con ese denominador. |
| **B4b** | Nueva FR-086: un jugador sin evaluación participa del auto-balance con OVR 5.0 calculado al vuelo, sin persistir evaluación, y la UI lo marca "sin evaluar".                                                                                  |
| **P2**  | NFR-011 se convierte en el epic E15.                                                                                                                                                                                                          |
| **P3**  | Scheduler = `pg_cron` de Supabase, en E16, consumido por FR-031 y FR-072.                                                                                                                                                                     |
| **P4**  | Entornos, hosting y migraciones en CI = E16.                                                                                                                                                                                                  |

### Lo que propongo y ratificas al aprobar este plan

| Ref                       | Propuesta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B2** · OAuth incompleto | Nueva FR-083: tras autenticar con Google o Apple la cuenta nace en estado `incomplete` y solo puede ver la pantalla "completar registro" (membresía, fecha de nacimiento, país, posición, experiencia; consentimiento de tutor si es menor). Es el **mismo** estado que usa NFR-012, no uno paralelo: `incomplete` cubre "falta datos" y "falta consentimiento", y la cuenta se activa cuando ninguna de las dos falta. Nueva AC-038.                                                                                                    |
| **B3** · Perfil propio    | Nueva FR-084: el miembro edita nombre, país, posición, nivel de experiencia, género y foto. Quedan reservados al Admin: rol, número y vencimiento AUF, grupos y estado. El país se captura en el sign-up (FR-001) y en el alta por Admin (FR-020). Nueva AC-039.                                                                                                                                                                                                                                                                         |
| **B3b** · Baja de miembro | Nueva FR-085: un Admin cambia el `status` de un miembro entre `active` e `inactive`. El inactivo no puede iniciar sesión, sale del directorio por defecto (filtro "incluir inactivos" para Admin), no es targeteable y conserva su historial. Nueva AC-040. Entra en Release 1: es barato y NFR-011 lo va a necesitar.                                                                                                                                                                                                                   |
| **C1** · FR-053 vs AC-035 | Gana AC-035: el set de categorías de una evaluación guardada es **inmutable**; editar ratings no migra nada. Se añade una acción explícita "actualizar al set actual" que reconstruye la evaluación (categorías nuevas a 5, las desactivadas se descartan). FR-053 se reescribe para decirlo.                                                                                                                                                                                                                                            |
| **C2** · Auto-balance     | FR-046 reescrita con orden de prioridad explícito: (1) cobertura de posición como restricción dura donde la escuadra lo permita, (2) minimizar la diferencia de puntaje, (3) tamaños que no difieran en más de un jugador. Algoritmo especificado: reparto serpiente por OVR descendente, luego búsqueda local de intercambios de a un par hasta que ninguno mejore, con corte por tiempo. Escuadra impar: el sobrante va al equipo de menor puntaje combinado. AC-019 reescrita para verificar eso, más una AC nueva de escuadra impar. |
| **C3** · Casual           | FR-063 excluye explícitamente a Casual. FR-065: el panel de un Casual muestra saldo de sesiones y "sin cargo recurrente" en vez de próxima fecha. Nueva FR-087: al pasar de Casual a plan mensual el saldo prepago **se congela** (no se reembolsa ni se pierde) y vuelve a consumirse si regresa a Casual; al pasar de mensual a Casual el saldo arranca en 0. Nueva AC-041.                                                                                                                                                            |
| **FRs sin AC**            | AC nuevas para FR-047, FR-066, FR-043, FR-054, FR-033, FR-022 y FR-012, más AC propia para FR-026, FR-027, FR-029 y FR-032, que hoy solo tienen cobertura de refilón.                                                                                                                                                                                                                                                                                                                                                                    |
| **P5**                    | AC-036 y AC-037 quedan en orden. §3.2 cita FR-033 (agenda), no FR-034.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **NFR-001/003/008**       | Se declara dónde se verifican: NFR-001 y NFR-008 con un test de carga en E16, NFR-003 por monitoreo del hosting, ninguno bloquea tickets funcionales.                                                                                                                                                                                                                                                                                                                                                                                    |

### Archivos que toca la fase 1

- `docs/SRD_Victoria_Seadragons_Club_Platform.md`: versión a **1.4**, con la lista de resoluciones
  en la cabecera de estado y en el "Orphan check" de §15.
- `docs/preguntas-abiertas.md`: cada fila marcada resuelta con su FR/AC; §5 (prototipo ausente)
  pasa a resuelta porque el `.dc.html` ya está en el repo.
- `docs/plan-maestro.md`: filas E15 y E16, dependencias actualizadas, el stack bajado a
  "Decisiones técnicas transversales" (P1), y la columna Issue rellenada al final de la fase 2.

---

## Fase 2 · Crear los 16 epics

Un issue por epic con label `epic`, cuerpo con alcance, FRs cubiertas, dependencias y puntero al
PRD que le tocará (`docs/prd/<epic>.md`). **Sin label `pending`**: los epics no son elegibles para
la cola, solo sus tickets. Cada uno se añade al board con `bash scripts/task-status.sh N "Todo"`
(el proyecto ya está configurado en `.plan/project.json`, número 5).

Los 14 del plan actual se crean tal cual, con estos ajustes:

- **E12** encoge: tres membresías en vez de cuatro, sin modelo de vínculo familiar.
- **E13** gana la FR-087 (saldo congelado al cambiar de plan).
- **E15 · Privacidad y datos personales** (M, depende de E2 y E5): aviso de privacidad en el
  sign-up, exportación de datos del miembro, borrado/anonimización dentro de 30 días, política de
  retención tras la baja. Cubre NFR-011 y CON-006.
- **E16 · Infraestructura y trabajos programados** (M, sin dependencias, va en paralelo a E1):
  entorno de despliegue, aplicación de migraciones en CI, secretos por entorno, `pg_cron` como
  scheduler y el job de ocurrencias recurrentes (FR-031) y aviso de renovación (FR-072). E2 y E7
  quedan `blocked-by` este epic.

Las dos filas nuevas se anexan a `docs/plan-maestro.md` marcadas como añadidas post-plan, en el
mismo paso que crea sus issues.

---

## Fase 3 · PRD de E1 y sus tickets

`docs/prd/e1-fundacion-tecnica.md` con la plantilla `template.es.md` de la skill. Alcance: FR-079,
NFR-009, NFR-010, CON-002 y CON-004.

**Comprobación de idempotencia antes de escribir nada** (paso 2 del ciclo de la fábrica): el
bootstrap ya entregó `supabase/migrations/0001_clubs.sql` con el patrón `club_id` + RLS,
`src/lib/theme.ts` + `ThemeToggle` con persistencia (FR-079 ya cumplida y con tests),
`src/app/api/v1/health/route.ts` y un `AppShell` mínimo. El PRD lo declara y ningún ticket lo
rehace.

### Descomposición propuesta de E1

| #   | Ticket                                                                         | Tamaño | Depende | auto-merge                                                      | ui-review |
| --- | ------------------------------------------------------------------------------ | ------ | ------- | --------------------------------------------------------------- | --------- |
| 1   | Aplicar los tokens de marca del prototipo a `design-system.md` y `globals.css` | S      | —       | Sí: cambio de estilos fijado por las líneas base visuales       | Sí        |
| 2   | Exportar las pantallas del prototipo a `docs/mockups/`                         | S      | —       | Sí: genera assets de documentación, sin código de runtime       | No        |
| 3   | Convención de la API v1: sobre de respuesta, códigos y manejo de errores       | M      | —       | No: es el contrato base de toda la API                          | No        |
| 4   | Tabla `audit_log` con `club_id` + RLS y helper `recordAuditEvent`              | M      | —       | No: dato sensible y frontera de seguridad                       | No        |
| 5   | Arnés de pruebas de RLS contra Supabase local                                  | M      | 4       | No: define cómo se verifica la seguridad del resto del proyecto | No        |
| 6   | App shell con navegación por secciones y rutas placeholder                     | M      | 1, 2    | No: UI nueva, no fijada por líneas base previas                 | Sí        |

Detalle de los dos que dependen del prototipo, que es lo nuevo respecto del plan original:

- **Ticket 1** saca los valores reales del `.dc.html`: acento `#1C6EA4` claro / `#33A1E0` oscuro,
  fondo `#EFF3F7` / `#0C1A26`, panel `#FFFFFF` / `#13283A`, tinta `#1C3245` / `#E8F0F7`, ok
  `#2E9E86`, warn `#C99A3E`, y la familia tipográfica Archivo + Space Grotesk + Space Mono. Hoy
  `design-system.md` lleva el azul por defecto `#2563EB` marcado como provisional. El ticket
  actualiza el documento y `globals.css` a la vez y regenera las líneas base de
  `tests/ui.spec.ts-snapshots`, para que doc y código no queden en desacuerdo.
- **Ticket 2** renderiza el prototipo con Playwright y captura una imagen por pantalla en
  `docs/mockups/` (dashboard, directory, calendar, attendance, team, evaluations, news, payments,
  auth, y las vistas móviles), en claro y oscuro. Riesgo conocido: `support.js` carga React 18
  desde unpkg, así que la captura necesita red; si el runner no la tiene, el ticket vendoriza
  `react` y `react-dom` en `docs/vendor/` antes de capturar. Va temprano porque **todo ticket de
  UI posterior cita estas imágenes**, y una que falte degrada al `ui-reviewer` a modo heurístico.

Cada ticket sale del `template.es.md` de `write-ticket`: criterios en Dado/Cuando/Entonces, lista
explícita de tests a escribir primero, y valla de alcance. Se crean como sub-issues de E1 con el
`sub_issues` de la API (id numérico de base de datos, no el número de issue) y se añaden al board
en "Todo".

---

## Puertas de aprobación

1. **Ratificación de las decisiones de la fase 1** al aprobar este plan.
2. **Gate de `write-ticket` antes de crear issues**: se imprime la tabla completa (16 epics + 6
   tickets, con tamaños, dependencias, `auto-merge` y `ui-review` sugeridos) y se espera un sí
   explícito. Crear issues no se deshace limpio, así que esa pausa no es un trámite.

## Verificación

- `docs/preguntas-abiertas.md` no deja ninguna fila sin resolver, y cada resolución apunta a un FR
  o AC que existe en el SRD v1.4.
- Cada FR nueva (FR-083 a FR-087) tiene al menos una AC, y las 7 FRs huérfanas de la auditoría ya
  no lo están: `grep -c 'FR-0' sobre §8` y revisión de la matriz de §15.
- `gh issue list --label epic` devuelve 16 issues, y la columna Issue de `docs/plan-maestro.md`
  coincide con sus números reales.
- `gh issue list --label pending` devuelve los 6 tickets de E1 y nada más.
- `gh api repos/cjgomezr/sea-dragons-web/issues/<E1>/sub_issues` lista los 6.
- Las 6 tarjetas nuevas aparecen en el board 5 en "Todo".
- `npm test`, `npm run lint` y `npm run typecheck` siguen verdes: esta tanda solo toca documentos
  y GitHub, no hay código que romper.

## Dónde paro

Cuando los issues existan. No arranco a trabajarlos: eso lo dispara
`bash scripts/process-backlog.sh`, o la etiqueta `ready-for-dev` para que lo haga la nube.
