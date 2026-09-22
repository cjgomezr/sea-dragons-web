# PRD: E6 · Notificaciones

**Estado:** aprobado · **Fecha:** 22 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4), epic E6 de `docs/plan-maestro.md`. Cubre FR-073 a FR-075 y el criterio AC-030. Aplica la **política de avisos** del plan maestro (decidida el 21 de septiembre de 2026): dentro de la aplicación se avisa lo que la persona puede ver estando dentro, y el correo queda para lo que no puede ver o lo que exige actuar fuera. `docs/preguntas-abiertas.md` no deja nada sin resolver para esta épica.

## 1. Problema

Hoy la aplicación cambia cosas que afectan a una persona y no se lo dice. Un Admin le cambia el rol a alguien y esa persona lo descubre porque su menú cambió. Quien pide ser Coach y recibe un rechazo se queda esperando una respuesta que nunca llega. Y el Admin solo se entera de que hay una solicitud nueva si entra al directorio a mirar.

Además, eventos (E7), noticias (E11) y cobros (E12) tienen que avisar a su audiencia (AC-013, AC-020, AC-024, AC-028), y los tres necesitan dónde dejar ese aviso. Sin un centro de notificaciones, cada épica inventaría el suyo.

## 2. Usuarios y contexto

- **Cualquier miembro:** quiere saber, sin buscarlo, lo que cambió para él: su rol, la respuesta a su solicitud y, más adelante, los eventos y noticias que le tocan.
- **Admin:** quiere enterarse de que alguien pidió un rol sin tener que revisar el directorio cada tanto.
- **Hoy lo resuelven así:** por WhatsApp, o no se enteran.

## 3. Objetivo y métricas de éxito

- Objetivo: que cada miembro vea en un solo sitio lo que la aplicación tiene que contarle, y que las épicas siguientes tengan una única forma de avisar.
- Métricas:
  - Con avisos sin leer, la campana muestra el número exacto (AC-030).
  - "Marcar todo como leído" deja la campana sin número y ningún aviso marcado como nuevo, en una sola acción (AC-030).
  - Ningún aviso llega a quien no le corresponde.

## 4. Alcance

**Incluido (v1):**

- Guardar los avisos de cada miembro como un **tipo y sus datos**, no como texto.
- La campana en la cabecera, con el número de avisos sin leer.
- La lista de avisos, en un panel desplegable en escritorio y en una pantalla completa en el móvil, como en el prototipo.
- Marcar todo como leído, y marcar como leído un aviso al abrirlo.
- Una única forma de crear avisos, que usan esta épica y las siguientes.
- Tres avisos: tu rol cambió, tu solicitud de rol fue rechazada, y a los Admin del club, llegó una solicitud nueva.

**Explícitamente fuera (por ahora):**

- Avisos por correo. La política de avisos los reserva para lo que la persona no puede ver dentro.
- Preferencias de aviso por miembro. El SRD las deja como mejora futura.
- Borrar avisos viejos: necesita el programador de tareas de E16b.
- Avisos en tiempo real: el número se actualiza al navegar y cada minuto.
- Los avisos de eventos (E7), noticias (E11), equipos (E10) y cobros (E12, E13): cada épica agrega los suyos con la forma que deja esta.
- Notificaciones push en el móvil (Release 2).

## 5. Requerimientos funcionales

### RF-1 · Los avisos se guardan como tipo y datos · Must

Un aviso no guarda su texto: guarda qué pasó y los datos para contarlo. El título y el cuerpo se arman al mostrarlo, en el idioma que tenga la persona en ese momento. Si se guardara el texto, un aviso escrito en español seguiría en español aunque la persona cambie la aplicación a inglés.

- **Dado** un aviso, **cuando** se mira en la base, **entonces** tiene su club, su destinatario, su tipo, sus datos, el momento en que se creó y, si ya se leyó, el momento en que se leyó.
- **Dado** un tipo que no está en el catálogo cerrado, **cuando** se guarda, **entonces** la base lo rechaza.
- **Dado** un destinatario de otro club que el del aviso, **cuando** se guarda, **entonces** la base lo rechaza.
- **Dado** un usuario autenticado, **cuando** consulta los avisos directamente, **entonces** ve solo los suyos.
- **Dado** que se borra la identidad de un miembro, **cuando** termina la cascada, **entonces** sus avisos desaparecen.

### RF-2 · Una única forma de crear avisos · Must

- **Dado** cualquier parte de la aplicación que tenga que avisar, **cuando** crea un aviso, **entonces** lo hace por una sola función, con el destinatario, el tipo y sus datos.
- **Dado** un destinatario dado de baja, **cuando** se le intenta avisar, **entonces** no se crea nada.
- **Dado** que crear el aviso falla, **cuando** pasa dentro de otra acción (por ejemplo un cambio de rol), **entonces** esa acción no falla: el aviso se pierde, el error queda registrado en el servidor, y el cambio se aplica igual.

### RF-3 · La lista de avisos · Must

- **Dado** un miembro con avisos, **cuando** abre la lista, **entonces** los ve de más reciente a más antiguo, cada uno con título, cuerpo y hace cuánto llegó (FR-073).
- **Dado** esa lista, **cuando** se mira, **entonces** los avisos sin leer se distinguen de los leídos (FR-075).
- **Dado** la aplicación en inglés o en español, **cuando** se abre la lista, **entonces** títulos, cuerpos y tiempos salen en ese idioma, aunque el aviso se haya creado con la aplicación en el otro.
- **Dado** un miembro sin avisos, **cuando** abre la lista, **entonces** una frase lo dice.
- **Dado** un miembro con muchos avisos, **cuando** abre la lista, **entonces** ve los 50 más recientes.

### RF-4 · La campana y su número · Must

- **Dado** un miembro con 3 avisos sin leer, **cuando** mira la cabecera, **entonces** la campana muestra 3 (FR-074, AC-030).
- **Dado** más de 9 avisos sin leer, **cuando** se mira la campana, **entonces** muestra "9+".
- **Dado** ningún aviso sin leer, **cuando** se mira la campana, **entonces** no muestra número.
- **Dado** un aviso nuevo, **cuando** el miembro cambia de pantalla o pasa un minuto con la aplicación abierta, **entonces** el número se actualiza.
- **Dado** un lector de pantalla, **cuando** llega a la campana, **entonces** anuncia cuántos avisos hay sin leer.

### RF-5 · Marcar como leídos · Must

- **Dado** avisos sin leer, **cuando** el miembro pulsa "Marcar todo como leído", **entonces** la campana se queda sin número y ningún aviso aparece como nuevo (FR-075, AC-030).
- **Dado** un aviso sin leer, **cuando** el miembro lo abre, **entonces** ese aviso queda leído y el número baja en uno.
- **Dado** un miembro, **cuando** intenta marcar como leído el aviso de otro, **entonces** no puede.

### RF-6 · Los avisos de roles · Must

- **Dado** un miembro al que un Admin le cambia el rol, **cuando** el cambio se aplica, **entonces** recibe un aviso con su rol nuevo.
- **Dado** un miembro cuya solicitud de rol se aprueba, **cuando** se aprueba, **entonces** recibe el mismo aviso de rol nuevo.
- **Dado** un miembro cuya solicitud se rechaza, **cuando** se rechaza, **entonces** recibe un aviso de que su solicitud fue rechazada, con el rol que había pedido.
- **Dado** una solicitud de rol nueva, **cuando** se registra, **entonces** cada Admin activo del club recibe un aviso con quién la pidió y qué rol.
- **Dado** un cambio que no cambia nada (poner el mismo rol que ya tenía), **cuando** ocurre, **entonces** no se avisa.

## 6. Casos borde y estados de error

- **Sin avisos:** la lista lo dice con una frase y la campana no muestra número.
- **Muchos avisos:** la lista trae los 50 más recientes; los anteriores siguen guardados.
- **Dos pestañas abiertas:** marcar todo en una deja la otra desactualizada hasta el siguiente minuto o el siguiente cambio de pantalla. No es un error.
- **El aviso habla de alguien que ya no está** (un Admin que se fue, un miembro borrado): el aviso se muestra con los datos que guardó, sin romper la lista.
- **El destinatario está dado de baja:** no se le crea el aviso.
- **Falla la base al crear un aviso:** la acción que lo originó sigue adelante, y el error queda registrado.
- **Falla la red al abrir la lista o marcar como leído:** la pantalla lo dice y deja reintentar, sin dar el cambio por hecho.
- **Datos de un tipo viejo que ya no encajan con su texto:** el aviso muestra un texto genérico en vez de romper la lista.

## 7. UX / UI

- Mockup: el prototipo (`docs/Seadragons Platform.dc.html`) dibuja la campana en la cabecera con su número, un desplegable con "Mark all read" en escritorio y una pantalla "Notifications" en el móvil. No hay captura en `docs/mockups/`, así que la revisión es heurística contra `design-system.md` siguiendo ese dibujo.
- Pantallas:
  - **Campana:** en la fila de acciones de la cabecera, junto a Mi cuenta.
  - **Escritorio:** panel desplegable bajo la campana, con la lista y "Marcar todo como leído".
  - **Móvil:** la campana abre la lista a pantalla completa.
- Viewports: 375 / 768 / 1440, tema claro y oscuro, inglés y español.

## 8. Requerimientos no funcionales

- Privacidad: los datos de un aviso son los mínimos para contarlo. Nada de correos, fechas de nacimiento ni justificaciones de solicitudes.
- Seguridad: cada miembro lee y marca solo sus avisos, garantizado en la base (RLS) y en la API.
- Idiomas: los textos de los avisos salen del catálogo, uno por tipo, en inglés y en español.
- Rendimiento: contar los avisos sin leer es una consulta ligera, porque se repite cada minuto por cada miembro conectado.
- API: todo pasa por la API v1 (CON-002).
- Accesibilidad: sin violaciones de axe; la campana anuncia su número.

## 9. Preguntas abiertas

Ninguna. El dueño tomó estas decisiones el 22 de septiembre de 2026:

- E6 trae los tres avisos que ya tienen motivo hoy: rol cambiado, solicitud rechazada y solicitud nueva para los Admin.
- El número de la campana se actualiza al navegar y cada minuto, sin tiempo real.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                                 | Tamaño | Depende de | Auto-merge sugerido                   |
| --- | ------------------------------------------------------------------------------------------------ | ------ | ---------- | ------------------------------------- |
| 1   | Guarda los avisos de cada miembro, con su tipo y sus datos                                       | S      | ninguna    | No: tabla nueva con datos de miembros |
| 2   | Sirve los avisos por API: listar, contar no leídos y marcar leídos, con una puerta para crearlos | M      | 1          | No: lógica nueva con permisos         |
| 3   | Pon la campana en la cabecera, con su panel y su pantalla en el móvil                            | M      | 2          | No: pantalla nueva                    |
| 4   | Avisa a un miembro cuando su rol cambia o su solicitud se rechaza                                | S      | 2          | No: toca el flujo de roles            |
| 5   | Avisa a los Admin cuando llega una solicitud de rol nueva                                        | S      | 2          | No: toca el flujo de roles            |
