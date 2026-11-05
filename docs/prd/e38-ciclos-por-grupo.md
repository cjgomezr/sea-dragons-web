# PRD: E38 · Ciclos de entrenamiento por grupo

**Estado:** aprobado · **Fecha:** 5 de noviembre de 2026 · **Autor:** Camilo Gómez, con Claude

Épica #977 (tickets #978 a #981), fila E38 de `docs/plan-maestro.md`, añadida después del plan. Amplía E35 (`docs/prd/e35-entrenamiento.md`): cambia su decisión D5 ("solo uno activo por club") y deja todo lo demás como está. Usa los grupos de E4 y E32.

## Principio

**El socio abre Entrenamiento y ve su plan, sin elegir nada.** El selector de ciclos solo aparece cuando de verdad le toca más de uno. Ante la duda, gana la opción con menos pasos para el socio.

## Decisiones

- **D1. Cada ciclo tiene una audiencia: todo el club o grupos.** Un ciclo de grupos lleva uno o más grupos del club. La audiencia se guarda explícita en el ciclo (`audience`: `club` o `groups`) y los grupos en una tabla aparte. Un ciclo de grupos nunca pasa a ser de todo el club por accidente, ni siquiera si se borran sus grupos.
- **D2. Varios ciclos activos a la vez, sin solaparse.** Puede haber a la vez como mucho un ciclo activo de todo el club y, por cada grupo, como mucho un ciclo activo que lo incluya. Un ciclo de todo el club y uno de grupo sí pueden estar activos a la vez.
- **D3. Activar archiva lo que choca, después de confirmar.** Hoy activar un ciclo archiva el anterior sin preguntar. Ahora, si activar (o cambiar los grupos de un ciclo activo) choca con otros ciclos activos, la pantalla muestra cuáles se van a archivar y pide confirmación. Sin choque, activa directo.
- **D4. El socio ve solo lo suyo.** Los ciclos activos de todo el club y los de los grupos en los que está. Nunca los de otros grupos, ni por la API.
- **D5. Coach y Admin ven todos.** Por su rol de planificar (D3 de E35), en la vista del socio y en Planificar.
- **D6. El ciclo que se abre al entrar.** Si el socio eligió uno antes y sigue viéndolo, ese. Si no, primero los de sus grupos y después el de todo el club; entre varios de grupo, el de nombre primero en orden alfabético. Siempre en la semana en curso, como hoy (D5 de E35).
- **D7. El último elegido se recuerda en el dispositivo** (almacenamiento local del navegador), no en la base. La URL lleva el ciclo (`?cycle=`) para poder compartir un enlace. Perder el recuerdo solo cuesta volver a elegir.
- **D8. Duplicar copia la audiencia.** El ciclo copiado nace en borrador con la misma audiencia y los mismos grupos.
- **D9. Un ciclo de grupos sin grupos no lo ve ningún socio.** Pasa si se borran todos sus grupos. Planificar lo marca con "Sin grupos: ningún socio lo ve". No se archiva ni cambia solo.

## 1. Problema

Un club con varios equipos (juveniles, masters, femenino) no entrena igual en todos: cada equipo va en su propio ciclo, hacia su propio torneo. Hoy la app solo permite un ciclo activo por club (`training_cycles_one_active_per_club`, de `0083`), así que el Coach tiene que elegir qué equipo usa la app y los demás quedan fuera, o mezclar todo en un solo ciclo.

## 2. Usuarios y contexto

- **Socio**, casi siempre desde el móvil: quiere abrir Entrenamiento y ver el plan de su equipo en la semana en que va.
- **Coach y Admin**, desde el escritorio: planifican un ciclo por equipo y lo asignan a su grupo.
- **Hoy lo resuelven así:** un solo ciclo activo para todos, o el plan de los demás equipos fuera de la app.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que cada grupo tenga su ciclo activo y que cada socio vea el suyo sin buscarlo.
- **Métricas:**
  - Un socio con un solo ciclo llega a la rutina de hoy con los mismos toques que hoy (sin selector).
  - Un club con 5 grupos puede tener 5 ciclos activos más uno de todo el club.
  - La página del socio sigue respondiendo en menos de 1 s en el p95.

## 4. Alcance

**Incluido:**

- La audiencia del ciclo en la base, la seguridad y la API.
- La regla de activos de D2, con la confirmación de D3.
- El campo "Para" en Planificar, los grupos en las tarjetas de los ciclos y el aviso de D9.
- El selector de ciclo en la vista del socio, con la elección por defecto de D6 y el recuerdo de D7.

**Explícitamente fuera (por ahora):**

- Que un socio vea los ciclos de otros grupos (D4). Si algún club lo pide, irá como opción de la configuración del club.
- Avisos en la campana cuando se activa un ciclo de tu grupo.
- Rutinas o marcas por grupo: las rutinas compartidas y las marcas de cada socio sirven en todos los ciclos, como hoy.
- Topes del plan gratis (cuántos ciclos activos) del modelo multiclub.
- La plantilla Excel (E36).

## 5. Requerimientos funcionales

### RF-1 · La audiencia del ciclo · Must

Cada ciclo guarda si es de todo el club o de grupos, y cuáles.

- **Dado** un ciclo que existe antes de esta épica, **cuando** se aplica la migración, **entonces** queda con audiencia `club` y sin grupos, y el ciclo activo sigue activo.
- **Dado** un Coach, **cuando** crea un ciclo sin elegir audiencia, **entonces** nace de todo el club.
- **Dado** un Coach, **cuando** crea un ciclo de grupos con los grupos A y B, **entonces** el ciclo queda con audiencia `groups` y esos dos grupos.
- **Dado** un ciclo de grupos, **cuando** se pide guardarlo sin ningún grupo, **entonces** la API responde 422 (un ciclo de grupos se crea o edita con al menos uno).
- **Dado** un grupo de otro club, **cuando** se pide asignarlo a un ciclo, **entonces** la API responde 422 y no guarda nada.
- **Dado** un ciclo de grupos, **cuando** se duplica, **entonces** la copia nace en borrador con la misma audiencia y los mismos grupos (D8).
- **Dado** un ciclo de grupos cuyo único grupo se borra, **cuando** se lee, **entonces** sigue siendo de grupos, sin grupos, y conserva su estado (D9).

### RF-2 · Varios ciclos activos sin solaparse · Must

La base y la API permiten varios activos y nunca dos que choquen (D2).

- **Dado** un ciclo activo del grupo A, **cuando** se activa un ciclo del grupo B, **entonces** los dos quedan activos.
- **Dado** un ciclo activo de todo el club, **cuando** se activa un ciclo del grupo A, **entonces** los dos quedan activos.
- **Dado** un ciclo activo de todo el club, **cuando** se pide activar otro de todo el club sin confirmar, **entonces** la API responde 409 con la lista de ciclos que chocan (id y nombre) y no cambia nada.
- **Dado** un ciclo activo de los grupos A y B, **cuando** se pide activar uno del grupo B sin confirmar, **entonces** la API responde 409 con ese ciclo en la lista.
- **Dado** ese mismo choque, **cuando** se pide activar con confirmación, **entonces** el ciclo que chocaba queda archivado y el nuevo activo, en una sola transacción.
- **Dado** un ciclo activo del grupo A, **cuando** se le añade el grupo B y B ya tiene otro ciclo activo, **entonces** aplica la misma regla: 409 sin confirmar, archivar con confirmación.
- **Dado** dos peticiones que activan a la vez ciclos que chocan, **cuando** terminan, **entonces** como mucho uno queda activo para cada grupo y para todo el club (la base lo garantiza, no solo la API).

### RF-3 · Quién ve qué ciclo · Must

La seguridad de la base y la API aplican D4 y D5.

- **Dado** un socio al día del grupo A, **cuando** pide los ciclos activos, **entonces** recibe el de todo el club (si hay) y los que incluyen A, y ninguno de otro grupo.
- **Dado** un socio al día sin grupos, **cuando** pide los ciclos activos, **entonces** recibe solo el de todo el club, o ninguno.
- **Dado** un socio del grupo A, **cuando** pide por la API un ciclo activo solo del grupo B (`?cycle=`), **entonces** la respuesta es 404, igual que un ciclo que no existe.
- **Dado** un socio del grupo A, **cuando** consulta `training_cycles`, sus semanas o sus días directamente con su sesión (RLS), **entonces** no ve las filas de un ciclo solo del grupo B.
- **Dado** un Coach o un Admin, **cuando** pide los ciclos activos, **entonces** recibe todos los del club.
- **Dado** un socio que no está al día, **cuando** pide cualquier ciclo, **entonces** sigue la puerta de E35: 403 con el motivo.

### RF-4 · El plan del socio con varios ciclos · Must

`GET /api/v1/training/plan` acepta `?cycle=<id>` y devuelve, además de la semana, la lista de ciclos que ve.

- **Dado** un socio que ve un solo ciclo, **cuando** pide el plan sin `?cycle`, **entonces** recibe ese ciclo en la semana de hoy (Melbourne) y una lista de un elemento.
- **Dado** un socio del grupo A con un ciclo de A y uno de todo el club, **cuando** pide el plan sin `?cycle`, **entonces** recibe el de A (D6).
- **Dado** un socio de los grupos A y B, cada uno con su ciclo ("Masters" y "Juveniles"), **cuando** pide el plan sin `?cycle`, **entonces** recibe "Juveniles", el primero por nombre.
- **Dado** `?cycle=<id>` de un ciclo que ve, **cuando** pide el plan, **entonces** recibe ese ciclo, y `?week=k` sigue funcionando sobre él.
- **Dado** que no ve ningún ciclo activo, **cuando** pide el plan, **entonces** recibe "sin plan", como hoy ("No plan yet").
- **Dado** la lista de ciclos de la respuesta, **cuando** se lee, **entonces** cada uno trae id, nombre, la semana en curso y los nombres de sus grupos (o "todo el club").

### RF-5 · Planificar: para quién es el ciclo · Must

En la pestaña Ciclo, el Coach elige la audiencia y ve la de cada ciclo.

- **Dado** el formulario del ciclo, **cuando** se abre, **entonces** hay un campo "Para" con "Todo el club" o "Grupos", y con "Grupos" una lista de los grupos del club para marcar uno o más.
- **Dado** un club sin grupos, **cuando** se abre el campo "Para", **entonces** solo está "Todo el club", con una pista que lleva a Grupos.
- **Dado** la lista de ciclos, **cuando** se ve, **entonces** cada ciclo muestra su audiencia ("Todo el club" o los nombres de sus grupos) y su estado.
- **Dado** un ciclo de grupos sin grupos, **cuando** se ve en la lista, **entonces** muestra "Sin grupos: ningún socio lo ve" (D9).
- **Dado** que activar choca con otros ciclos, **cuando** el Coach pulsa Activar, **entonces** aparece una confirmación con los nombres de los ciclos que se archivarán; Cancelar no cambia nada y Confirmar activa y archiva (D3).
- **Dado** el selector de ciclo de Planificar, **cuando** hay varios activos, **entonces** los muestra todos, cada uno con su audiencia.

### RF-6 · Vista del socio: elegir ciclo · Must

En `/entrenamiento`, el socio cambia de ciclo cuando le toca más de uno.

- **Dado** un socio que ve un solo ciclo, **cuando** abre Entrenamiento, **entonces** no hay selector y la pantalla queda como hoy.
- **Dado** un socio que ve dos o más, **cuando** abre Entrenamiento, **entonces** arriba hay un selector con sus nombres y entra en el ciclo de D6, en la semana en curso.
- **Dado** el selector, **cuando** elige otro ciclo, **entonces** la pantalla muestra ese ciclo en su semana en curso, la URL lleva `?cycle=` y la elección queda guardada en el dispositivo.
- **Dado** una elección guardada que ya no ve (archivado, o salió del grupo), **cuando** abre Entrenamiento, **entonces** entra en el ciclo de D6 sin mostrar error.
- **Dado** un Coach o un Admin, **cuando** abre Entrenamiento, **entonces** el selector muestra todos los ciclos activos del club.

## 6. Casos borde y estados de error

- **Sin ciclos activos:** "No plan yet", como hoy, con el enlace a Planificar para Coach y Admin.
- **Socio sin grupos:** solo el ciclo de todo el club, si hay.
- **Grupo borrado:** el ciclo pierde ese grupo. Si era el último, aplica D9. Nunca pasa a todo el club.
- **Socio que sale de un grupo:** deja de ver el ciclo de ese grupo en su siguiente carga; su elección guardada cae a D6.
- **Muchos grupos:** el selector de grupos del formulario sirve para 30 grupos sin romper el móvil (lista con scroll).
- **Nombres largos:** el selector del socio recorta con "…" y muestra el nombre completo en su lista.
- **Concurrencia:** dos activaciones a la vez que chocan: la base deja una sola (RF-2). La segunda recibe 409.
- **Ciclo del grupo cambiado mientras el socio lo mira:** la siguiente carga aplica la audiencia nueva; si ya no lo ve, responde 404 y la pantalla vuelve a D6.

## 7. UX / UI

- **Mockups:** sin mockup; se aplica `design-system.md` y el estilo de Entrenamiento de E35 (`docs/design/design_handoff_training/`).
- **Flujo del Coach:** Planificar → Ciclo → Nuevo ciclo → Para: Grupos → marca "Juveniles" → Guardar → Activar (confirmación si choca).
- **Flujo del socio:** Entrenamiento → entra en su ciclo, en la semana en curso → (si tiene varios) cambia en el selector de arriba.
- **Viewports:** 375 / 768 / 1440, en claro y oscuro.
- **Capturas nuevas:** el selector del socio con dos ciclos; el campo "Para" con grupos marcados; la confirmación al activar con choque; el aviso "Sin grupos".

## 8. Requerimientos no funcionales

- **Rendimiento:** la página del socio en menos de 1 s en el p95 con 6 ciclos activos de 52 semanas.
- **Accesibilidad:** cumple `design-system.md`; el selector es un control nativo o con rol y nombre accesibles; axe sin violaciones.
- **Seguridad:** RLS de `training_cycles`, `training_cycle_weeks`, `training_cycle_days` y la tabla nueva aplica D4 y D5. La tabla nueva sigue el patrón de E35: el servidor escribe, `authenticated` solo lee lo que la policy deja. La bitácora registra crear, editar audiencia, activar y archivar por choque.

## 9. Preguntas abiertas

- [ ] Ninguna bloquea. D4 (solo lo suyo) lo decidió Camilo el 5 de noviembre de 2026.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                                         | Tamaño | Depende de | Auto-merge sugerido                                       |
| --- | -------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------- |
| 1   | Guarda para quién es cada ciclo (todo el club o grupos) y permite varios activos sin que se solapen      | M      | ninguna    | No: migración, regla de negocio y concurrencia en la base |
| 2   | Enseña a cada socio solo los ciclos de sus grupos y los de todo el club, en la base y en la API del plan | M      | 1          | No: seguridad (RLS) y permisos                            |
| 3   | Deja elegir en Planificar para quién es el ciclo y confirma qué ciclos se archivan al activar            | M      | 1          | No: UI con lógica de negocio; lleva `ui-review`           |
| 4   | Pone un selector de ciclo en Entrenamiento cuando al socio le toca más de uno, y recuerda el último      | S      | 2          | No: pantalla nueva del socio; lleva `ui-review`           |

Los tickets 2 y 3 pueden correr en paralelo después del 1; los dos tocan la API de entrenamiento, así que mejor uno tras otro si la fábrica corre de a uno. El 1 trae la migración (la siguiente libre, hoy `0095`).
