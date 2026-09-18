# PRD: E4 · Grupos

**Estado:** aprobado · **Fecha:** 18 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4), epic E4 de `docs/plan-maestro.md` y la matriz de permisos de su sección 4. Cubre FR-023 a FR-027 y los criterios AC-012 y AC-049. `docs/preguntas-abiertas.md` no deja nada sin resolver para esta épica.

## 1. Problema

El club tiene grupos de hecho (Senior Squad, Junior Squad, Masters Squad), pero la plataforma no sabe nada de ellos. Hoy cada anuncio o convocatoria llega a todos, o se manda por WhatsApp a mano a quien corresponde, y nadie sabe con certeza quién está en qué grupo.

Eso bloquea el plan. Los eventos (E7) y las noticias (E11) tienen que poder dirigirse a un grupo (FR-027), y el alta de socios por el Admin (E5) asigna grupos desde el primer día (FR-020). Sin grupos, las dos cosas nacen sin audiencia.

## 2. Usuarios y contexto

- **Committee:** la historia del SRD lo dice en sus palabras: quiere organizar a los socios en grupos como "Senior Squad" o "Junior Squad" para dirigir eventos y noticias con precisión. Lo hace desde el escritorio o el móvil.
- **Coach:** arma sus grupos de entrenamiento; la matriz le da gestionar grupos.
- **Admin:** puede todo lo anterior.
- **Player:** no gestiona grupos, pero quiere saber a cuáles pertenece.
- **Hoy lo resuelven así:** listas en WhatsApp y en la memoria de la junta.

## 3. Objetivo y métricas de éxito

- Objetivo: que quien gestiona grupos pueda crearlos y llenarlos dentro de la aplicación, y que esos grupos queden listos para ser audiencia de eventos y noticias.
- Métricas:
  - Crear un grupo y asignarle cinco socios lleva menos de dos minutos.
  - El conteo de cada grupo coincide siempre con sus socios asignados que no están dados de baja.
  - El 100% de las peticiones de gestión de grupos de un Player se rechaza en el servidor.

## 4. Alcance

**Incluido (v1):**

- La tabla de grupos y la de pertenencias, con sus reglas en la base.
- Crear, renombrar, borrar y listar grupos con su conteo.
- Asignar y quitar socios de un grupo.
- Una sección **Grupos** en la navegación, solo para Admin, Coach y Committee.
- En Mi cuenta, la lista de grupos a los que pertenece el socio.
- Los grupos vigentes como la lista que ofrecerán E7 y E11 al elegir audiencia.

**Explícitamente fuera (por ahora):**

- Dirigir eventos y noticias a un grupo, y esconderlos de quien no pertenece (AC-050, AC-052): E7 y E11.
- Asignar grupos en el alta de un socio por el Admin (FR-020): E5.
- Búsqueda, filtros y orden de socios al asignar: E5.
- Grupos anidados, descripción, color o foto del grupo.
- Avisar al socio de que lo asignaron o lo quitaron: E6.
- Auditoría de los cambios de grupos: NFR-010 no la pide.

## 5. Requerimientos funcionales

### RF-1 · Los grupos y sus socios se guardan con reglas en la base · Must

Aunque alguien se saltara la aplicación, la base no deja nombres repetidos ni pertenencias duplicadas o huérfanas.

- **Dado** un club con un grupo "Senior Squad", **cuando** se guarda otro llamado "senior squad" o " Senior Squad ", **entonces** la base lo rechaza: el nombre es único por club sin distinguir mayúsculas ni espacios alrededor.
- **Dado** un nombre vacío o de más de 60 caracteres, **cuando** se guarda, **entonces** la base lo rechaza.
- **Dado** un socio ya asignado a un grupo, **cuando** se lo asigna otra vez, **entonces** sigue habiendo una sola pertenencia.
- **Dado** un grupo con socios, **cuando** se borra, **entonces** sus pertenencias desaparecen con él y los socios no se tocan.
- **Dado** un socio con grupos, **cuando** se borra su identidad, **entonces** sus pertenencias desaparecen.
- **Dado** un usuario autenticado, **cuando** consulta las tablas directamente, **entonces** solo ve sus propias pertenencias y los grupos a los que pertenece, y no puede escribir nada. Un cliente anónimo no ve nada.

### RF-2 · Crear un grupo · Must

- **Dado** un Admin, un Coach o un Committee, **cuando** crea un grupo llamado "Masters Squad", **entonces** aparece en la lista con 0 miembros (FR-023, AC-012).
- **Dado** un nombre que ya existe en el club, **cuando** se intenta crear, **entonces** se rechaza con 409 y un mensaje que lo dice.

### RF-3 · Listar los grupos con su conteo · Must

- **Dado** quien gestiona grupos, **cuando** abre la sección Grupos, **entonces** ve todos los grupos del club con su conteo de miembros, en orden alfabético (FR-024).
- **Dado** un socio dado de baja (`inactive`) que sigue asignado, **cuando** se cuenta su grupo, **entonces** no cuenta.
- **Dado** un club sin grupos, **cuando** se abre la sección, **entonces** una frase lo dice e invita a crear el primero.

### RF-4 · Renombrar un grupo · Should

- **Dado** el grupo "Senoir Squad", **cuando** se renombra a "Senior Squad", **entonces** conserva sus socios.
- **Dado** un nombre nuevo que ya usa otro grupo del club, **cuando** se intenta renombrar, **entonces** se rechaza con 409.

### RF-5 · Borrar un grupo · Must

- **Dado** un grupo, **cuando** se pide borrarlo, **entonces** la pantalla pide confirmación diciendo cuántos socios tiene.
- **Dado** esa confirmación, **cuando** se acepta, **entonces** el grupo desaparece de la lista y deja de ofrecerse como audiencia (FR-025, AC-012). Los socios siguen en el club.

### RF-6 · Asignar y quitar socios · Must

- **Dado** un socio sin grupos, **cuando** se lo asigna a "Senior Squad" y a "Masters Squad", **entonces** aparece en la lista de socios de los dos y los dos conteos suben en uno (FR-026, AC-049).
- **Dado** ese socio, **cuando** se lo quita de uno, **entonces** ese conteo baja en uno y el otro no cambia.
- **Dado** un socio dado de baja (`inactive`), **cuando** se intenta asignarlo, **entonces** se rechaza con 422.
- **Dado** un socio con la cuenta todavía incompleta, **cuando** se lo asigna, **entonces** se permite: el alta por el Admin de E5 crea socios incompletos que ya pertenecen a sus grupos.
- **Dado** quien asigna, **cuando** busca a quién agregar, **entonces** ve una lista mínima de los socios del club, solo con nombre, sin correo ni otros datos.

### RF-7 · Solo quien gestiona grupos los gestiona · Must

- **Dado** un Player, **cuando** pide `/grupos` o cualquier endpoint de gestión de grupos, **entonces** la frontera lo devuelve al panel o responde 403, y el servidor no hace el trabajo.
- **Dado** un Player, **cuando** mira la navegación, **entonces** no ve Grupos.
- **Dado** un Admin, un Coach o un Committee, **cuando** mira la navegación, **entonces** ve Grupos en la barra lateral y, en el móvil, dentro de "Más".
- **Dado** un grupo de otro club, **cuando** se intenta leer, renombrar, borrar o asignar, **entonces** responde 404.

### RF-8 · Mis grupos en Mi cuenta · Should

- **Dado** un socio que pertenece a "Senior Squad", **cuando** abre Mi cuenta, **entonces** ve ese grupo en la lista de los suyos.
- **Dado** un socio sin grupos, **cuando** abre Mi cuenta, **entonces** una frase dice que no pertenece a ninguno.
- **Dado** cualquier socio, **cuando** abre Mi cuenta, **entonces** no ve los grupos a los que no pertenece ni a los demás miembros de los suyos.

### RF-9 · Los grupos quedan listos para ser audiencia · Must

FR-027 pide que los grupos sirvan de audiencia de eventos y noticias. Esas pantallas nacen en E7 y E11; esta épica deja la pieza que van a usar.

- **Dado** los grupos vigentes del club, **cuando** E7 o E11 pidan la lista para elegir audiencia, **entonces** es la misma lista de RF-3, y un grupo borrado ya no aparece.
- **Dado** un socio y un conjunto de grupos, **cuando** se pregunta si pertenece a alguno, **entonces** la respuesta sale de las pertenencias guardadas, sin contar a los dados de baja.

## 6. Casos borde y estados de error

- **Nombre repetido con otras mayúsculas o espacios:** 409, con el mensaje de que ya existe.
- **Dos personas crean o renombran al mismo nombre a la vez:** decide la base; la segunda recibe 409.
- **Asignar a un grupo que otro acaba de borrar:** 404, y la pantalla lo quita de la vista.
- **Asignar dos veces al mismo socio, o doble clic:** una sola pertenencia; la segunda petición responde como si ya estuviera hecho.
- **Quitar a un socio que ya no estaba:** responde como hecho, sin error.
- **Grupo con muchos socios:** la lista de socios del grupo se lee completa; hoy el club tiene decenas, no miles.
- **Nombre de 60 caracteres en la pantalla a 375:** se parte o se recorta sin romper el diseño.
- **Player que escribe `/grupos` a mano:** la frontera lo devuelve al panel.
- **Socio que pasa a `inactive` después de asignado:** sigue asignado, pero deja de contar y de ser audiencia.
- **Borrar un grupo que un evento o noticia ya usa:** hoy no puede pasar porque no existen; E7 y E11 deciden qué hacen con su audiencia cuando llegue ese caso.

## 7. UX / UI

- Mockups: no hay pantalla de grupos en `docs/mockups/`. Revisión heurística contra `design-system.md`; la fila de socio sigue la de `docs/mockups/directory-light.png` (iniciales y nombre).
- Pantallas:
  - **Grupos (Admin, Coach, Committee):** lista de grupos con su conteo, un campo para crear uno, y por grupo las acciones de renombrar y borrar. Al abrir un grupo, sus socios con la acción de quitar y un selector para agregar socios.
  - **Mi cuenta (todos):** una sección "Mis grupos" con los nombres de los grupos del socio.
- Flujo principal: crear el grupo, abrirlo, agregar socios uno a uno desde el selector, volver a la lista y ver el conteo actualizado.
- Viewports: 375 / 768 / 1440, en tema claro y oscuro, en inglés y en español.

## 8. Requerimientos no funcionales

- Seguridad: la capacidad `manageGroups` se aplica en el servidor para el 100% de las peticiones (NFR-004), declarando las rutas en `RESTRICTED_ROUTES`. La interfaz solo esconde.
- Privacidad: la lista para asignar socios devuelve solo id y nombre. Un Player no ve a los demás miembros de sus grupos.
- Idiomas: todo texto nuevo sale del catálogo (`src/lib/i18n/messages/en.ts` y `es.ts`). Los errores se traducen en pantalla a partir del código de error de la API.
- API: las lecturas y escrituras van por la API v1, porque la app nativa de Release 2 usará los mismos endpoints (CON-002).
- Accesibilidad: sin violaciones de axe en las pantallas nuevas, en los dos idiomas.

## 9. Preguntas abiertas

Ninguna. El dueño tomó estas decisiones el 18 de septiembre de 2026:

- Asignan socios a grupos Admin, Coach y Committee, los mismos que los crean. Resuelve la contradicción del SRD entre la matriz ("Manage groups" para los tres) y FR-084 ("group assignments editable only by an Admin"): FR-084 y la decisión B3 se leen como "un socio no puede cambiar sus propios grupos".
- Los grupos tienen su propia sección en la navegación, solo para quien los gestiona.
- Un Player ve sus propios grupos en Mi cuenta, y nada más.
- Se puede renombrar un grupo, además de crearlo y borrarlo.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                     | Tamaño | Depende de | Auto-merge sugerido                       |
| --- | -------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------- |
| 1   | Guarda los grupos y sus socios en la base, con nombre único por club | S      | ninguna    | No: tabla nueva con datos de socios       |
| 2   | Deja crear, renombrar, borrar y listar grupos con su conteo, por API | M      | 1          | No: lógica nueva con permisos             |
| 3   | Deja meter y sacar socios de un grupo, por API                       | M      | 2          | No: lógica nueva con permisos             |
| 4   | Da a Admin, Coach y Committee una pantalla Grupos                    | M      | 2, 3       | No: pantalla nueva                        |
| 5   | Muestra en Mi cuenta los grupos a los que pertenece el socio         | S      | 1          | No: cambia una pantalla con datos propios |

El 3 depende del 2 y no solo del 1 para que los dos no choquen en los mismos archivos de rutas.
