# PRD: E11 · Noticias y documentos

**Estado:** borrador · **Fecha:** 24 de septiembre de 2026 · **Épica:** #11

## 1. Problema

El club comunica por WhatsApp y por correo: el aviso de que cambia la piscina,
la política de seguridad que hay que leer antes de bucear, el resumen del
partido del sábado. Eso se pierde en el desplazamiento del chat, no se puede
dirigir a un grupo concreto, y quien entra al club en junio no tiene forma de
leer lo que se dijo en marzo.

Hace falta un sitio dentro de la plataforma donde lo publicado quede, se dirija
a quien corresponde y traiga sus documentos adjuntos.

## 2. Usuarios y contexto

- **Quien publica:** un Admin o alguien del Committee (FR-057), desde un
  portátil. Escribe pocas veces al mes, así que la pantalla tiene que
  explicarse sola.
- **Quien lee:** cualquier miembro, casi siempre desde el móvil, mirando por
  encima el feed para ver si hay algo nuevo.
- **Hoy lo resuelve así:** un grupo de WhatsApp y algún correo suelto.

## 3. Objetivo y métricas de éxito

Objetivo: que lo que el club comunica quede publicado, dirigido y accesible,
con sus documentos.

Métricas:

- Publicar algo con un PDF adjunto lleva **menos de dos minutos**.
- **Ningún miembro ve, ni por API, una publicación cuya audiencia no lo
  incluye.**
- Quien entra al club hoy puede leer **todo lo que se publicó para su grupo**
  desde que existe la plataforma.

## 4. Alcance

**Incluido (v1)**

- Publicar con categoría (Announcement, News, Document), título y cuerpo
  (FR-057).
- Adjuntos: hasta 5 archivos por publicación, 10 MB cada uno, en PDF, imagen o
  Word (FR-058, decisión D3).
- Audiencia: todo el club o grupos concretos (FR-059), con el mismo modelo que
  E7 usa para los eventos.
- Feed en orden cronológico inverso, con categoría, título, extracto, autor,
  fecha y marca de adjuntos (FR-060).
- Pantalla de detalle con el cuerpo entero y sus adjuntos.
- Aviso a la audiencia al publicar (FR-061).
- Editar y retirar una publicación, con marca de editada (decisión D1).

**Explícitamente fuera (por ahora)**

- Comentarios, reacciones y cualquier respuesta del lector.
- Borradores y publicación programada.
- Texto enriquecido: el cuerpo es texto plano con saltos de línea.
- Fijar una publicación arriba del feed.
- Buscar dentro del feed: la búsqueda global es E14.
- Las tres últimas publicaciones en el panel de inicio: también E14.

## 5. Decisiones tomadas antes de escribir

- **D1 · Se puede editar y retirar, con marca.** Una errata se corrige, y lo
  que ya no aplica se retira. Retirar **oculta, no borra**: la publicación deja
  de salir en el feed pero se conserva, igual que E7 hace con un evento
  cancelado. Una publicación editada dice que se editó y cuándo.
- **D2 · Se avisa al publicar, nunca al editar.** FR-061 pide avisar a la
  audiencia cuando se publica. Corregir una errata no vuelve a molestar a
  nadie: es lo que mantiene la campana creíble.
- **D3 · Adjuntos: hasta 5 por publicación, 10 MB cada uno.** Cubre lo que el
  club reparte de verdad y protege el tráfico de salida de Supabase, que es el
  mismo motivo por el que el #271 achicó las fotos de perfil.

## 6. Requerimientos funcionales

### RF-1 · Las publicaciones y su audiencia se guardan con reglas en la base · Must

- **Dado** una publicación, **cuando** se mira en la base, **entonces** tiene club, categoría, título, cuerpo, autor, fecha de publicación, audiencia, estado y, si se editó, cuándo.
- **Dado** una categoría que no es Announcement, News ni Document, **cuando** se intenta guardar, **entonces** la base la rechaza.
- **Dado** una audiencia de grupos, **cuando** incluye un grupo de otro club, **entonces** la base lo rechaza.
- **Dado** un título vacío o de más de 120 caracteres, o un cuerpo vacío, **cuando** se guarda, **entonces** la base lo rechaza.
- **Dado** un miembro `authenticated`, **cuando** consulta publicaciones por la base, **entonces** solo recibe las de su club dirigidas a él y no retiradas.
- **Dado** la migración, **cuando** se aplica dos veces, **entonces** la segunda no falla ni duplica nada.

### RF-2 · Publicar · Must

- **Dado** un Admin o un Committee, **cuando** publica con categoría, título, cuerpo y audiencia, **entonces** la publicación queda guardada con su autor y su fecha.
- **Dado** una audiencia de "todo el club", **cuando** se publica, **entonces** alcanza a todos los miembros activos.
- **Dado** una audiencia de grupos, **cuando** se publica, **entonces** alcanza solo a quien pertenece a alguno de esos grupos.
- **Dado** un Coach o un Player, **cuando** intentan publicar por pantalla o por API, **entonces** reciben 403.
- **Dado** una audiencia de grupos vacía, **cuando** se intenta publicar, **entonces** se rechaza: o es todo el club, o es al menos un grupo.

### RF-3 · Los adjuntos · Must

- **Dado** quien publica, **cuando** adjunta hasta 5 archivos PDF, de imagen o de Word de hasta 10 MB, **entonces** se guardan con la publicación.
- **Dado** un sexto archivo, o uno de más de 10 MB, o de un tipo que no está admitido, **cuando** se intenta subir, **entonces** se rechaza con el motivo y no se guarda nada.
- **Dado** un archivo que dice ser PDF pero no lo es, **cuando** se sube, **entonces** se rechaza: el tipo se comprueba por el contenido, no por el nombre.
- **Dado** un miembro de la audiencia, **cuando** abre un adjunto, **entonces** lo descarga; **dado** alguien fuera de la audiencia, **entonces** no puede, ni con la dirección directa.
- **Dado** una publicación que se retira, **cuando** ocurre, **entonces** sus adjuntos dejan de servirse.
- **Dado** un adjunto que ya no está en el almacenamiento, **cuando** se abre la publicación, **entonces** se avisa de que no está disponible, sin romper la pantalla.

### RF-4 · El feed · Must

- **Dado** un miembro, **cuando** abre Noticias, **entonces** ve las publicaciones dirigidas a él, de la más reciente a la más antigua.
- **Dado** cada fila, **cuando** se muestra, **entonces** trae categoría, título, extracto, autor, cuánto hace que se publicó y, si los hay, cuántos adjuntos tiene.
- **Dado** un cuerpo largo, **cuando** se muestra en el feed, **entonces** el extracto se corta sin partir una palabra.
- **Dado** un miembro sin ninguna publicación dirigida a él, **cuando** abre Noticias, **entonces** una frase lo dice, en vez de una pantalla vacía.
- **Dado** un club con muchas publicaciones, **cuando** se abre el feed, **entonces** trae las 20 más recientes y ofrece cargar más.
- **Dado** una publicación retirada, **cuando** se mira el feed, **entonces** no aparece.

### RF-5 · La publicación abierta · Must

- **Dado** una fila del feed, **cuando** se abre, **entonces** se ve el cuerpo entero, su autor, su fecha y sus adjuntos con nombre y tamaño.
- **Dado** una publicación editada, **cuando** se abre, **entonces** dice que fue editada y cuándo.
- **Dado** una publicación que no está dirigida a quien pide, **cuando** se abre por su dirección directa, **entonces** responde 404, no 403: quien no es audiencia no descubre ni que existe.
- **Dado** una publicación retirada, **cuando** un miembro la abre, **entonces** responde 404; **cuando** la abre quien publica, **entonces** la ve marcada como retirada.

### RF-6 · Editar y retirar · Should

- **Dado** un Admin o el Committee que publicó, **cuando** corrige título, cuerpo, categoría o audiencia, **entonces** se guarda y la publicación queda marcada como editada.
- **Dado** una edición, **cuando** ocurre, **entonces** no se manda ningún aviso (decisión D2).
- **Dado** una edición que amplía la audiencia, **cuando** se guarda, **entonces** los nuevos la ven en su feed, sin aviso.
- **Dado** quien publicó, **cuando** retira una publicación, **entonces** desaparece del feed de todos y sus adjuntos dejan de servirse, pero no se borra.
- **Dado** una publicación retirada, **cuando** quien publicó la vuelve a publicar, **entonces** reaparece en el feed sin volver a avisar.
- **Dado** un Committee, **cuando** intenta editar la publicación de otra persona, **entonces** se le niega; un Admin sí puede.
- **Dado** cualquier edición o retirada, **cuando** ocurre, **entonces** la bitácora guarda quién y sobre qué publicación.

### RF-7 · Avisar a la audiencia · Must

- **Dado** una publicación nueva, **cuando** se publica, **entonces** cada miembro de su audiencia recibe un aviso en su campana (FR-061).
- **Dado** quien publica, **cuando** se manda el aviso, **entonces** no se avisa a sí mismo.
- **Dado** un miembro dado de baja dentro de la audiencia, **cuando** se publica, **entonces** no recibe aviso.
- **Dado** el aviso, **cuando** se muestra, **entonces** dice la categoría y el título, en el idioma de quien lo lee, y lleva a la publicación.
- **Dado** que el aviso falla, **cuando** ocurre, **entonces** la publicación se guarda igual y el fallo queda registrado.

## 7. Casos borde y estados de error

- **Miembro que entra a un grupo después de publicar:** ve la publicación en su
  feed (la audiencia se resuelve al leer), pero no recibe el aviso, que ya pasó.
- **Grupo que se borra con publicaciones dirigidas a él:** la publicación
  conserva su audiencia y deja de alcanzar a nadie por ese grupo. No se borra.
- **Quien publicó deja el club:** su publicación sigue, con su nombre como
  autor.
- **Dos personas editando la misma publicación:** la segunda recibe un conflicto
  y no pisa a la primera en silencio.
- **Subida a medias:** si un adjunto falla, no se publica nada a medias; se
  avisa y se puede reintentar.
- **Cuerpo con HTML o enlaces:** se muestra como texto plano. Los enlaces
  pueden hacerse pulsables, pero nunca se interpreta HTML.

## 8. UX / UI

- **Mockups:** `docs/mockups/news-light.png`, `news-dark.png`,
  `mobile-news-light.png` y `mobile-news-dark.png`. De ahí salen la etiqueta de
  categoría, el "hace 2 días · autor", el título, el extracto, la marca de
  adjuntos con su número y el botón de publicar.
- **Flujo principal:** Noticias → Publicar → categoría, título, cuerpo,
  audiencia, adjuntos → publicar. El feed lo muestra arriba del todo.
- **Viewports:** 375 / 768 / 1440, tema claro y oscuro, inglés y español.
- El botón de publicar solo lo ven Admin y Committee.

## 9. Requerimientos no funcionales

- **Seguridad:** la audiencia se aplica en el servidor y en la base, no
  escondiendo filas en la pantalla. Los adjuntos viven en un bucket privado y
  se sirven con direcciones firmadas de vida corta, como las fotos de perfil.
- **Accesibilidad:** cada fila del feed es un enlace con nombre propio; los
  adjuntos dicen su tipo y su tamaño. Axe sin violaciones.
- **Rendimiento:** el feed de 20 filas se resuelve en una consulta, sin una por
  publicación ni por adjunto.

## 10. Preguntas abiertas

- [ ] ¿La categoría Document debería listarse aparte, como un archivo de
      documentos del club? Propuesta: no en v1, el feed con su etiqueta basta.
      Si el club acumula políticas, se abre después.
- [ ] ¿Hace falta avisar por correo además de en la campana? Propuesta: no. La
      política de avisos del plan maestro reserva el correo para lo que no se
      puede ver dentro.

## 11. Descomposición en tickets

| #   | Ticket                                                                    | Tamaño | Depende de | auto-merge | ui-review |
| --- | ------------------------------------------------------------------------- | ------ | ---------- | ---------- | --------- |
| T1  | Guarda las publicaciones, su audiencia y sus adjuntos, con RLS            | M      | —          | No         | No        |
| T2  | Publica y sirve el feed por API, con la audiencia aplicada en el servidor | M      | T1         | No         | No        |
| T3  | Sube y sirve los adjuntos, con sus límites y sus direcciones firmadas     | M      | T1         | No         | No        |
| T4  | El feed y la publicación abierta, en móvil y escritorio                   | M      | T2, T3     | No         | Sí        |
| T5  | El formulario de publicar, con audiencia y adjuntos                       | M      | T2, T3     | No         | Sí        |
| T6  | Editar y retirar una publicación, con su marca y su bitácora              | M      | T5         | No         | Sí        |
| T7  | Avisa a la audiencia al publicar                                          | S      | T2         | No         | No        |

Total: **7 tickets**, L. El plan maestro decía M (4-5): el crecimiento viene de
los adjuntos y de editar y retirar, que el SRD no detallaba.
