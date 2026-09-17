# PRD: E3 · Roles y RBAC

**Estado:** aprobado · **Fecha:** 17 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4), epic E3 de `docs/plan-maestro.md` y la matriz de permisos de su sección 4. Cubre FR-010 a FR-014 y NFR-004, y se apoya en NFR-010 para la auditoría. `docs/preguntas-abiertas.md` no deja nada sin resolver para esta épica.

## 1. Problema

Toda cuenta nace Player y nadie puede cambiar eso, así que hoy el club no tiene administradores ni entrenadores dentro de la plataforma. La frontera de sesión sabe si alguien entró y si su cuenta está completa, pero no sabe quién es: un Player y un futuro Coach ven exactamente lo mismo.

Eso bloquea el resto del plan. Las evaluaciones no pueden existir sin que alguien las pueda ver y otros no (FR-055), los eventos necesitan quién los crea (FR-028), el directorio necesita quién administra (FR-020) y los grupos necesitan quién los gestiona (FR-023). Tres épicas dependen de esta de forma directa.

También es un riesgo declarado del SRD: BR-007 pide que el acceso a datos sensibles se controle por rol, y NFR-004 exige que eso se aplique en el servidor para el 100% de las peticiones, no en la interfaz.

## 2. Usuarios y contexto

- **Administrador del club:** una o dos personas de la junta. Necesitan dar permisos a los entrenadores y a la gente de la junta sin depender de nadie de fuera. Trabajan desde el móvil tanto como desde el escritorio.
- **Socio que quiere ser Coach o Committee:** hoy lo pide por WhatsApp y alguien se acuerda o no. Quiere pedirlo dentro de la aplicación y que quede registrado.
- **Jugador:** no debería ver evaluaciones, ni administración, ni publicar nada. Hoy no las ve porque esas pantallas están vacías, no porque algo se lo impida.
- **Hoy lo resuelven así:** no hay roles. Quién puede qué vive en la cabeza de la junta y se coordina por WhatsApp.

## 3. Objetivo y métricas de éxito

- Objetivo: que cada persona vea y pueda hacer exactamente lo que su rol permite, decidido en el servidor.
- Métricas:
  - El 100% de las peticiones a capacidades restringidas se resuelve por rol en el servidor, con un test por cada celda de la matriz.
  - Un Admin cambia el rol de un socio en menos de un minuto, sin salir de la aplicación.
  - Toda decisión sobre una solicitud y todo cambio de rol queda en la bitácora con actor, momento y resultado (NFR-010).

## 4. Alcance

**Incluido (v1):**

- El catálogo de cuatro roles como única fuente de verdad, con la matriz de capacidades de la sección 4 del SRD escrita en código.
- La frontera del servidor aplicando esa matriz a páginas y a endpoints.
- La tabla de solicitudes de rol, con una sola solicitud pendiente por persona garantizada en la base.
- Una página mínima **Mi cuenta** con el rol actual y el formulario para pedir Coach o Committee.
- Aprobación y rechazo por un Admin, con el cambio de rol al aprobar.
- Cambio de rol directo por un Admin.
- Protección del último Admin del club.
- Auditoría de los cambios de rol y de las decisiones sobre solicitudes.
- Una pantalla mínima de administración, solo para Admin: lista de socios con su rol y bandeja de solicitudes pendientes.
- La navegación, también la barra móvil, deja de ofrecer lo que el rol no permite.
- El primer Admin se crea a mano con una sentencia SQL documentada.

**Explícitamente fuera (por ahora):**

- El perfil completo y editable (E5). Mi cuenta es su primera piedra, y E5 la amplía.
- El directorio completo con búsqueda, filtros y orden (E5), que reemplazará o absorberá la pantalla mínima de administración.
- Grupos y permisos por grupo (E4).
- Avisar al Admin de una solicitud nueva por notificación (E6) o por correo.
- Más de un rol por persona, permisos a medida o delegación temporal.
- Una vista de auditoría para el Admin. El SRD la deja como recomendación para una release posterior.
- Construir las funciones que la matriz protege. Las capacidades cuyas pantallas todavía no existen se protegen igual, pero no se implementan aquí.

**Ya hecho antes de esta épica:** la base no deja que un socio cambie su propio rol. `0003_members.sql` quita todo privilegio a `authenticated` salvo la lectura, y `tests/unit/supabase/members-migration.test.ts` lo prueba ("no deja al dueño de la fila cambiar su propio rol"). La restricción de cuatro roles de esa misma tabla es la segunda barrera de RF-1.

## 5. Requerimientos funcionales

### RF-1 · Catálogo de roles y matriz de capacidades · Must

Los cuatro roles y lo que cada uno puede hacer viven en un solo sitio del código, y de ahí lo leen la frontera, la interfaz y los tests.

- **Dado** el catálogo, **cuando** se consulta, **entonces** existen exactamente cuatro roles: Admin, Coach, Committee y Player (FR-012, AC-048).
- **Dado** una petición que intenta asignar un rol fuera de ese conjunto, **cuando** llega al servidor, **entonces** se rechaza sin tocar la base.
- **Dado** la matriz de la sección 4 del SRD, **cuando** se compara con el código, **entonces** coinciden celda por celda, y hay un test que lo fija.

### RF-2 · La frontera aplica la matriz en el servidor · Must

Cada página y cada endpoint restringido declara qué capacidad exige, y la frontera resuelve por el rol de quien pide. Hoy no existe ningún endpoint restringido: esta épica entrega el mecanismo, y lo prueban las páginas que ya existen (equipos y evaluaciones) y los endpoints nuevos de RF-4 a RF-6.

- **Dado** un Player, **cuando** pide la página de equipos, de evaluaciones o de administración, **entonces** no llega: la aplicación lo devuelve a donde sí puede estar (FR-013, AC-007).
- **Dado** un endpoint que exige una capacidad, **cuando** lo pide un rol que no la tiene, **entonces** recibe 403 y el servidor no hace el trabajo.
- **Dado** un Coach, **cuando** pide administración, **entonces** se le niega, porque su fila de la matriz no lo permite.
- **Dado** un Committee, **cuando** pide evaluaciones, equipos o administración, **entonces** se le niega.
- **Dado** cualquier rol, **cuando** pide el panel, el calendario, el directorio, las noticias, los pagos o Mi cuenta, **entonces** pasa.
- **Dado** una misma petición que comprueba varias capacidades, **cuando** se resuelve, **entonces** el rol se lee una sola vez.

### RF-3 · Las solicitudes de rol se guardan con sus reglas en la base · Must

Aunque alguien se saltara la aplicación, la base no deja duplicar solicitudes ni leer las ajenas.

- **Dado** un socio con una solicitud pendiente, **cuando** se intenta guardar otra suya, aunque sea al mismo tiempo, **entonces** la base la rechaza.
- **Dado** un socio con una solicitud ya aprobada o rechazada, **cuando** se guarda una nueva, **entonces** la base la acepta.
- **Dado** la tabla de solicitudes, **cuando** un socio la consulta, **entonces** ve las suyas y ninguna más.
- **Dado** esa misma tabla, **cuando** la consulta alguien sin sesión, **entonces** no ve nada.
- **Dado** una solicitud, **cuando** se guarda, **entonces** su rol solo puede ser Coach o Committee y su estado solo pendiente, aprobada o rechazada.

### RF-4 · Solicitar un rol desde Mi cuenta · Must

Un socio pide Coach o Committee, con una justificación opcional, desde una página Mi cuenta enlazada en la cabecera junto a cerrar sesión. No puede inundar la aplicación con la misma solicitud.

- **Dado** un socio con la cuenta activa, **cuando** abre Mi cuenta, **entonces** ve su rol actual y el formulario de solicitud.
- **Dado** ese socio, **cuando** envía una solicitud de Coach con su justificación, **entonces** queda registrada como pendiente (FR-010).
- **Dado** un socio con una solicitud pendiente, **cuando** abre Mi cuenta, **entonces** no ve el formulario: ve qué rol pidió, cuándo, y que está pendiente de respuesta.
- **Dado** un socio con una solicitud pendiente, **cuando** envía otra por petición directa, **entonces** recibe 409 y el mensaje de que ya tiene una en curso.
- **Dado** el formulario, **cuando** se está enviando, **entonces** el botón queda desactivado, para que un doble clic no mande dos.
- **Dado** un socio al que le rechazaron una solicitud, **cuando** vuelve a Mi cuenta, **entonces** el formulario está de nuevo disponible y la nueva solicitud se acepta.
- **Dado** una solicitud de un rol que esa persona ya tiene, o de Admin, **cuando** se envía, **entonces** se rechaza.
- **Dado** una cuenta que todavía está incompleta, **cuando** intenta solicitar, **entonces** se le niega, porque esa cuenta aún no opera.

### RF-5 · Aprobar o rechazar una solicitud · Must

Solo un Admin decide, y aprobar cambia el rol.

- **Dado** un Admin con una solicitud de Coach pendiente, **cuando** la aprueba, **entonces** esa persona pasa a Coach y la solicitud queda aprobada (FR-011, AC-006).
- **Dado** esa misma solicitud, **cuando** la rechaza, **entonces** el rol no cambia y la solicitud queda rechazada.
- **Dado** quien no es Admin, **cuando** intenta decidir una solicitud, **entonces** recibe 403.
- **Dado** dos Admin que deciden la misma solicitud a la vez, **cuando** llega la segunda decisión, **entonces** no pisa a la primera y se le dice que ya estaba resuelta.
- **Dado** una decisión, **cuando** se toma, **entonces** queda en la bitácora con quién decidió, sobre qué solicitud, cuándo y el resultado (NFR-010).

### RF-6 · Cambiar el rol de un socio · Must

Un Admin puede poner cualquiera de los cuatro roles a cualquier socio. FR-014 lo sitúa en el perfil del socio; hasta que E5 construya ese perfil, vive en la pantalla de administración.

- **Dado** un Admin, **cuando** cambia el rol de un socio a Committee, **entonces** sus permisos pasan a ser los de Committee en su siguiente petición (FR-014, AC-008).
- **Dado** quien no es Admin, **cuando** intenta cambiar un rol, **entonces** recibe 403.
- **Dado** un rol que no existe, **cuando** se envía, **entonces** se rechaza.
- **Dado** un cambio de rol, **cuando** ocurre, **entonces** la bitácora guarda quién lo hizo, sobre quién, cuándo, el rol anterior, el nuevo y el resultado (NFR-010).

### RF-7 · El club nunca se queda sin Admin · Must

- **Dado** un club con un solo Admin, **cuando** se intenta cambiarle el rol, **entonces** se rechaza explicando que es el último Admin.
- **Dado** un club con dos o más Admin, **cuando** se degrada a uno, **entonces** se permite.
- **Dado** un club con dos Admin, **cuando** se intenta degradar a los dos a la vez, **entonces** solo pasa uno: la comprobación es atómica en la base, no una lectura previa en la aplicación.

### RF-8 · Pantalla mínima de administración · Must

- **Dado** un Admin, **cuando** abre administración, **entonces** ve la lista de socios con nombre, correo y rol, y la bandeja de solicitudes pendientes con el rol pedido, la fecha y la justificación.
- **Dado** esa pantalla, **cuando** aprueba, rechaza o cambia un rol, **entonces** la lista y la bandeja reflejan el resultado sin recargar a mano.
- **Dado** una bandeja sin solicitudes, **cuando** se abre, **entonces** lo dice con una frase, no con una tabla vacía.
- **Dado** el último Admin, **cuando** alguien intenta degradarlo, **entonces** la pantalla muestra el motivo del rechazo.

### RF-9 · La navegación refleja el rol · Should

- **Dado** un Player, **cuando** mira la navegación, **entonces** no se le ofrecen evaluaciones, equipos ni administración.
- **Dado** un Coach, **cuando** mira la navegación, **entonces** ve evaluaciones y equipos, y no ve administración.
- **Dado** un Admin, **cuando** mira la navegación, **entonces** ve administración en la barra lateral y, en el móvil, detrás de "Más".
- **Dado** la barra móvil, **cuando** se arma, **entonces** sus cuatro pestañas fijas son las cuatro primeras secciones de uso diario que el rol puede abrir. Un Player ve Inicio, Eventos, Directorio y Noticias; un Coach o un Admin ven Inicio, Eventos, Equipos y Noticias.
- **Dado** cualquier rol, **cuando** escribe a mano la dirección de algo que no le toca, **entonces** la frontera lo detiene igual. Esconder es comodidad, no seguridad.

### RF-10 · El primer Admin · Must

- **Dado** un club recién desplegado sin ningún Admin, **cuando** una persona del club ejecuta la sentencia documentada en Supabase, **entonces** esa cuenta pasa a Admin.
- **Dado** esa sentencia, **cuando** se busca, **entonces** está en la documentación del repositorio, con el aviso de que es un acto manual y único.

## 6. Casos borde y estados de error

- **Club sin ningún Admin:** nadie puede aprobar solicitudes. Las solicitudes quedan pendientes, y la documentación explica cómo crear el primero.
- **Rol cambiado mientras la persona navega:** el rol se lee del servidor en cada petición, así que el cambio se nota en la siguiente. No hace falta cerrar sesión.
- **Cuenta incompleta:** no puede solicitar ni administrar. La frontera de cuentas incompletas manda y se aplica antes que la de roles.
- **Solicitud de quien ya fue ascendido por otra vía:** al decidirla, la aplicación avisa de que esa persona ya tiene ese rol.
- **Dos Admin decidiendo a la vez:** la segunda decisión no pisa a la primera.
- **Doble clic, dos pestañas o llamadas repetidas al solicitar:** una sola solicitud pendiente, porque lo garantiza la base.
- **Admin que se degrada a sí mismo:** permitido si hay otro Admin, bloqueado si es el último.
- **Justificación enorme:** se limita su largo y se avisa antes de enviar.
- **Rol inválido por petición directa:** rechazado por la aplicación y, como segunda barrera, por la restricción que ya tiene la base.

## 7. UX / UI

- Mockups: sin mockup. Revisión heurística contra `design-system.md`.
- Pantallas:
  - **Mi cuenta (todos):** rol actual; si no hay solicitud pendiente, el formulario con el rol pedido y la justificación; si la hay, su estado en lugar del formulario.
  - **Administración (solo Admin):** lista de socios con nombre, correo, rol y el control para cambiarlo, y bandeja de solicitudes pendientes con los botones de aprobar y rechazar.
- Flujo principal: el socio solicita desde Mi cuenta, el Admin ve la solicitud en su bandeja y decide, y el socio ve su rol nuevo en su siguiente petición.
- Viewports: 375 / 768 / 1440 (y 360 para la barra móvil), en tema claro y oscuro, en inglés y en español.

## 8. Requerimientos no funcionales

- Seguridad: la matriz se aplica en el servidor para el 100% de las peticiones (NFR-004). La interfaz solo esconde; no protege.
- Auditoría: todo cambio de rol y toda decisión quedan registrados (NFR-010), sin datos personales que no hagan falta: identificadores, no nombres ni correos ni la justificación.
- Rendimiento: leer el rol no puede costar una consulta extra por cada comprobación dentro de la misma petición.
- Idiomas: todo texto nuevo sale del catálogo (`src/lib/i18n/messages/en.ts` y `es.ts`), incluidos los mensajes de error de los endpoints que ve una persona. El test de textos sin traducir lo vigila.
- Accesibilidad: sin violaciones de axe en las pantallas nuevas, en los dos idiomas.
- Privacidad: la bandeja no expone datos del socio más allá de lo que el Admin ya puede ver.

## 9. Preguntas abiertas

Ninguna. El dueño tomó estas decisiones:

- 16 de septiembre de 2026: el primer Admin se crea a mano por SQL; se admite una solicitud pendiente por persona, con derecho a volver a pedir tras un rechazo; el último Admin no se puede degradar; y esta épica incluye una pantalla mínima de administración que E5 después absorberá.
- 17 de septiembre de 2026: la solicitud se hace desde una página mínima Mi cuenta, enlazada en la cabecera, que E5 convertirá en el perfil; con una solicitud pendiente, la pantalla muestra su estado en vez del formulario; y la barra móvil fija las cuatro primeras secciones que el rol puede abrir, así que un Player ve Directorio donde un Coach ve Equipos.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                | Tamaño | Depende de | Auto-merge sugerido                 |
| --- | ------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------- |
| 1   | Escribe en código el catálogo de roles y la matriz de capacidades del SRD       | S      | ninguna    | No: fuente de verdad de permisos    |
| 2   | Haz que la frontera niegue por rol, en pantallas y en endpoints                 | M      | 1          | No: frontera de seguridad           |
| 3   | Guarda las solicitudes de rol, con una sola pendiente por persona en la base    | S      | 1          | No: tabla nueva con datos de socios |
| 4   | Deja que un socio pida Coach o Committee desde una página Mi cuenta             | M      | 2, 3       | No: lógica nueva y pantalla         |
| 5   | Deja que un Admin apruebe o rechace una solicitud, con su rastro en la bitácora | M      | 4          | No: cambia permisos                 |
| 6   | Deja que un Admin cambie el rol de un socio, sin degradar al último Admin       | M      | 2          | No: cambia permisos                 |
| 7   | Da al Admin una pantalla con los socios y las solicitudes pendientes            | M      | 5, 6       | No: pantalla nueva                  |
| 8   | Muestra en la navegación solo lo que el rol permite, también en la barra móvil  | S      | 2, 7       | No: cambia todas las pantallas      |
| 9   | Documenta cómo se crea el primer Admin del club                                 | S      | 1          | Sí: solo documentación              |
