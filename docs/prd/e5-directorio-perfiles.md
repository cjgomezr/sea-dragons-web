# PRD: E5 · Directorio y perfiles

**Estado:** aprobado · **Fecha:** 20 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4), epic E5 de `docs/plan-maestro.md`. Cubre FR-015 a FR-022, FR-084 y FR-085, con BR-008, y los criterios AC-009 a AC-011, AC-039, AC-040 y AC-047. La decisión B3 de `docs/preguntas-abiertas.md` (quién edita qué del perfil) ya está resuelta y este PRD la aplica.

## 1. Problema

El club no tiene una lista de sus miembros dentro de la plataforma. Quién juega, en qué posición, con qué nivel y con qué registro federativo vive en una hoja de cálculo y en la memoria de la junta. Cuando llega alguien nuevo, la junta lo anota a mano y le escribe por WhatsApp para que se registre.

Además, la persona no puede corregir sus propios datos: hoy solo existen el nombre y el correo del registro, y ni siquiera hay dónde cambiarlos. Y el club no tiene forma de dar de baja a un miembro que se va, así que su cuenta sigue viva.

BR-008 lo hace urgente por un lado concreto: el número de la federación (AUF) y su vencimiento tienen que estar al día y visibles para el Admin, y hoy no se guardan en ninguna parte.

## 2. Usuarios y contexto

- **Admin:** mantiene el registro del club. Da de alta a quien llega, anota su número de AUF, lo pone en sus grupos, y da de baja a quien se va. Necesita ver de un golpe quién tiene el registro federativo vencido.
- **Coach:** busca a una persona para saber su posición y su nivel antes de armar un entrenamiento.
- **Miembro:** quiere corregir su país, su posición, su nivel o su foto sin pedírselo a nadie.
- **Hoy lo resuelven así:** una hoja de cálculo que solo tiene una persona, y WhatsApp para todo lo demás.

## 3. Objetivo y métricas de éxito

- Objetivo: que el club tenga en la plataforma la lista completa y al día de sus miembros, y que cada persona mantenga sus propios datos.
- Métricas:
  - Encontrar a un miembro por nombre en el directorio toma menos de cinco segundos.
  - Dar de alta a un miembro con sus datos federativos y su invitación toma menos de dos minutos.
  - El 100% de los intentos de un miembro de cambiarse el rol, el AUF, sus grupos o su estado se rechaza en el servidor.

## 4. Alcance

**Incluido (v1):**

- Los campos que faltan en la ficha del miembro: posición, nivel de experiencia, género, número y vencimiento de AUF, y fecha de ingreso.
- El directorio con nombre, país, nivel, rol, posición y estado, con búsqueda por nombre, filtro por rol y orden ascendente o descendente.
- El filtro "incluir inactivos", solo para el Admin.
- El perfil propio editable: nombre, país, posición, nivel, género y foto. Mi cuenta se convierte en esa pantalla.
- La ficha reservada al Admin: rol, AUF y su vencimiento, grupos y estado.
- El alta de un miembro por el Admin, con su invitación por correo.
- La baja y la reactivación de un miembro.
- La foto de perfil, guardada en el almacenamiento de Supabase.
- La mudanza de la bandeja de solicitudes y del cambio de rol al directorio, y el retiro de la pantalla de administración.

**Explícitamente fuera (por ahora):**

- La columna de asistencia y su orden (E8), y la de la nota general OVR (E9). El SRD las pide en el directorio (FR-015, FR-016, FR-019); las agrega cada épica cuando ese dato exista, porque hoy no hay nada que mostrar. FR-022 (asistencia en el perfil propio) queda igual, en E8.
- Ver el perfil completo de otra persona. Cualquiera ve su ficha en el directorio; la pantalla de perfil es la propia, y el Admin abre la de cualquiera para editar lo suyo.
- Borrar a un miembro. La baja es un estado, y el borrado de datos personales es E15.
- Exportar el directorio.
- Editar a varios miembros a la vez.

## 5. Requerimientos funcionales

### RF-1 · La ficha del miembro guarda los datos del club · Must

- **Dado** la ficha de un miembro, **cuando** se mira en la base, **entonces** tiene posición (Goalkeeper, Defender, Forward), nivel de experiencia (Beginner, Intermediate, Advanced), género, número de AUF, vencimiento de AUF y fecha de ingreso, además de lo que ya tenía (FR-020).
- **Dado** un valor fuera de esos conjuntos para la posición o el nivel, **cuando** se guarda, **entonces** la base lo rechaza.
- **Dado** un miembro que ya existía, **cuando** se aplica el cambio, **entonces** conserva sus datos y los campos nuevos quedan vacíos, salvo la fecha de ingreso, que toma la de creación de su cuenta.
- **Dado** un miembro, **cuando** un usuario autenticado consulta la base directamente, **entonces** sigue viendo solo su propia fila, como hasta ahora.

### RF-2 · El directorio · Must

- **Dado** cualquier miembro con la cuenta activa, **cuando** abre el directorio, **entonces** ve a los miembros del club con nombre, país, nivel, rol y posición (FR-015).
- **Dado** el directorio, **cuando** se escribe parte de un nombre, **entonces** la lista muestra solo a quienes lo llevan, sin distinguir mayúsculas ni acentos (FR-017).
- **Dado** el directorio, **cuando** se filtra por rol (todos, Player, Coach, Committee, Admin), **entonces** solo aparecen los de ese rol (FR-018).
- **Dado** el directorio, **cuando** se ordena por nombre, rol o posición, **entonces** la lista se ordena en el sentido pedido, ascendente o descendente (FR-019).
- **Dado** un miembro dado de baja, **cuando** se mira el directorio, **entonces** no aparece (FR-085).
- **Dado** un Admin, **cuando** activa "incluir inactivos", **entonces** los ve con una marca de baja (AC-040).
- **Dado** quien no es Admin, **cuando** pide ese filtro por API, **entonces** se le niega.
- **Dado** una búsqueda sin resultados, **cuando** termina, **entonces** una frase lo dice y ofrece limpiar los filtros.
- **Dado** un Admin, **cuando** mira a un miembro con el registro de AUF vencido, **entonces** la ficha lo señala (BR-008). Nadie más ve el dato de AUF.

### RF-3 · El perfil propio · Must

- **Dado** un miembro, **cuando** abre su perfil, **entonces** ve sus datos y puede cambiar nombre, país, posición, nivel de experiencia y género (FR-084).
- **Dado** ese cambio, **cuando** se guarda, **entonces** el directorio lo muestra (AC-039).
- **Dado** ese mismo miembro, **cuando** intenta cambiar su rol, su AUF, su vencimiento, sus grupos o su estado, por pantalla o por API directa, **entonces** se le niega (AC-039).
- **Dado** un nombre vacío o de largo desmedido, **cuando** se guarda, **entonces** se rechaza con un mensaje que lo explica.
- **Dado** el perfil propio, **cuando** se abre, **entonces** sigue mostrando lo que Mi cuenta ya mostraba: el rol actual, la solicitud de rol y los grupos propios.

### RF-4 · La ficha reservada al Admin · Must

- **Dado** un Admin en el directorio, **cuando** abre a un miembro, **entonces** puede cambiar su número de AUF, su vencimiento y sus grupos (FR-020, FR-084).
- **Dado** un Coach, un Committee o un Player, **cuando** intenta lo mismo, **entonces** recibe 403.
- **Dado** un vencimiento con formato inválido o anterior a la fecha de ingreso, **cuando** se guarda, **entonces** se rechaza.
- **Dado** un cambio de grupos desde ahí, **cuando** se guarda, **entonces** vale lo mismo que hacerlo desde la sección Grupos, y los conteos cuadran.

### RF-5 · Alta de un miembro por el Admin · Must

- **Dado** un Admin, **cuando** crea un miembro con nombre, correo, país, posición, nivel, género, número y vencimiento de AUF y grupos, **entonces** queda creado con el rol Player, sus grupos asignados y la cuenta pendiente de activar (FR-020, AC-011).
- **Dado** ese alta, **cuando** termina, **entonces** sale una invitación por correo al miembro, en su idioma, con un enlace para activar su cuenta (FR-021, AC-011).
- **Dado** un correo que ya tiene cuenta en el club, **cuando** se intenta dar de alta, **entonces** se rechaza diciendo que ya existe, sin crear nada ni mandar correo.
- **Dado** el miembro invitado, **cuando** abre el enlace, **entonces** termina su registro con la pantalla que ya existe y su cuenta pasa a activa.
- **Dado** que el envío del correo falla, **cuando** ocurre, **entonces** el miembro queda creado, la pantalla lo dice y ofrece reenviar la invitación.

### RF-6 · Baja y reactivación · Must

- **Dado** un Admin, **cuando** da de baja a un miembro, **entonces** su estado pasa a `inactive` (FR-085).
- **Dado** un miembro dado de baja, **cuando** intenta entrar, **entonces** no puede (AC-040).
- **Dado** un miembro dado de baja, **cuando** se mira el directorio, los grupos o cualquier audiencia, **entonces** no aparece ni se puede elegir.
- **Dado** un miembro dado de baja, **cuando** se mira su historial, **entonces** sigue completo.
- **Dado** un Admin, **cuando** lo reactiva, **entonces** vuelve a entrar y a aparecer.
- **Dado** el último Admin del club, **cuando** se intenta dar de baja, **entonces** se rechaza, igual que al degradarlo.
- **Dado** un Admin, **cuando** intenta darse de baja a sí mismo, **entonces** se rechaza, porque quien se va lo hace desde otra cuenta de Admin.

### RF-7 · La foto de perfil · Should

- **Dado** un miembro, **cuando** sube una foto, **entonces** aparece en su perfil y en su ficha del directorio (FR-084).
- **Dado** un archivo que no es imagen, o que pesa más de lo permitido, **cuando** se sube, **entonces** se rechaza con un mensaje que dice el límite.
- **Dado** un miembro, **cuando** borra su foto, **entonces** vuelven sus iniciales.
- **Dado** la foto de otra persona, **cuando** alguien intenta reemplazarla o borrarla, **entonces** el almacenamiento lo niega.
- **Dado** una foto subida, **cuando** se mira su dirección, **entonces** no expone datos del miembro más allá de lo que el directorio ya muestra.

### RF-8 · El directorio absorbe la pantalla de administración · Must

- **Dado** un Admin, **cuando** abre el directorio, **entonces** encuentra ahí la bandeja de solicitudes de rol y el cambio de rol de cada miembro.
- **Dado** esa mudanza, **cuando** termina, **entonces** `/administracion` ya no existe y su entrada sale de la navegación.
- **Dado** lo que E3 dejó probado (decidir solicitudes, cambiar rol, último Admin protegido), **cuando** se usa desde el directorio, **entonces** se comporta igual.

### Mejoras añadidas el 22 de septiembre de 2026

Al probar E5 terminada, el dueño encontró cuatro cosas que ajustar. Van como requerimientos nuevos de la misma épica.

### RF-9 · La foto se achica al subirla · Must

Hoy la foto se guarda tal como la sube el miembro, hasta 2 MB. Un directorio de 30 miembros con fotos grandes descarga decenas de megas cada vez que alguien lo abre, y el plan gratuito de Supabase tiene un tope mensual de tráfico de salida que eso agota pronto.

- **Dado** un miembro que sube una foto, **cuando** el servidor la recibe, **entonces** la guarda reducida a un tamaño de ficha (unos 400 px por lado, en un formato comprimido) y no el original.
- **Dado** una foto reducida, **cuando** se mira su peso, **entonces** queda muy por debajo del límite de subida, del orden de decenas de KB.
- **Dado** una foto vertical, apaisada o con giro guardado en sus metadatos, **cuando** se reduce, **entonces** conserva su orientación y su proporción, sin deformarse.
- **Dado** los metadatos de la foto original (ubicación GPS, cámara), **cuando** se guarda la reducida, **entonces** no los conserva.
- **Dado** una foto ya pequeña, **cuando** se sube, **entonces** no se agranda.

### RF-10 · El Admin corrige la fecha de nacimiento · Must

El miembro no edita su fecha de nacimiento a propósito: de ella depende si es menor y necesita el consentimiento de su tutor (NFR-012), y editarla le dejaría saltárselo. Pero hoy nadie puede corregir un error del registro.

- **Dado** un Admin en la ficha de un miembro, **cuando** corrige su fecha de nacimiento, **entonces** queda guardada.
- **Dado** esa corrección, **cuando** ocurre, **entonces** la bitácora guarda quién la hizo, sobre quién y cuándo, sin guardar la fecha en sí.
- **Dado** una corrección que deja al miembro como menor y sin consentimiento de tutor, **cuando** se guarda, **entonces** su cuenta pasa a `incomplete` y, al entrar, se le pide el consentimiento, como en el registro (FR-081, FR-082).
- **Dado** una fecha futura o imposible, **cuando** se guarda, **entonces** se rechaza.
- **Dado** el miembro, **cuando** mira su perfil, **entonces** sigue sin poder editar su fecha.

### RF-11 · Los textos dicen invitar y desactivar · Should

"Dar de alta" y "dar de baja" suenan a trámite. El dueño prefiere palabras de club.

- **Dado** la aplicación en español, **cuando** se mira el directorio y la ficha, **entonces** dice "Invitar miembro" donde decía dar de alta, y "Desactivar cuenta" y "Reactivar cuenta" donde decía dar de baja y reactivar.
- **Dado** la aplicación en inglés, **cuando** se mira lo mismo, **entonces** dice "Invite member", "Deactivate account" y "Reactivate account".
- **Dado** la marca y el filtro de los miembros desactivados, **cuando** se miran, **entonces** usan la misma palabra ("desactivada", "inactive"), sin que quede "de baja" en ningún texto que vea una persona.

### RF-12 · El miembro propone su número de AUF · Could

Hasta ahora el AUF lo escribía solo el Admin (decisión B3). El dueño decidió que el miembro pueda escribirlo para ahorrarle trabajo al Admin, sin perder la confianza en el dato: queda **sin verificar** hasta que un Admin lo confirme.

- **Dado** un miembro en su perfil, **cuando** escribe su número de AUF y su vencimiento, **entonces** se guardan marcados como sin verificar.
- **Dado** un AUF sin verificar, **cuando** un Admin mira el directorio o la ficha, **entonces** lo ve marcado como tal, distinto de uno verificado y de uno vencido.
- **Dado** un AUF sin verificar, **cuando** el Admin lo confirma, **entonces** queda verificado, y la bitácora guarda quién lo verificó y cuándo.
- **Dado** un AUF verificado, **cuando** el miembro intenta cambiarlo, **entonces** se le niega: una vez verificado, solo el Admin lo corrige.
- **Dado** un AUF que el Admin escribe o corrige él mismo, **cuando** se guarda, **entonces** queda verificado directamente.
- **Dado** el miembro, **cuando** intenta cambiar su rol, grupos o estado, **entonces** se le sigue negando como hasta ahora.

## 6. Casos borde y estados de error

- **Club con un solo miembro, o directorio recién estrenado:** la lista se ve bien con una fila.
- **Búsqueda con acentos o mayúsculas distintas:** encuentra igual.
- **Nombre muy largo o de una sola letra:** la fila no se rompe a 375.
- **Miembro sin posición, sin nivel o sin país:** la ficha muestra un guion, no un hueco.
- **Dos Admin editando al mismo miembro:** gana la última escritura, y cada campo se guarda completo.
- **Invitación a un correo con cuenta en otro club:** se rechaza.
- **Reenvío de invitación repetido:** limitado como el reenvío del correo de confirmación que ya existe.
- **Baja de alguien con solicitud de rol pendiente:** la solicitud queda sin efecto y no aparece en la bandeja.
- **Foto enorme o con formato raro:** se rechaza antes de subirla.
- **Subir foto con la conexión caída:** la pantalla lo dice y deja reintentar, sin dejar una foto a medias.
- **Un miembro que pide el perfil de otro por API:** se le niega.
- **Una foto que el servidor no puede decodificar** aunque diga ser JPEG, PNG o WebP: se rechaza con el mismo mensaje de formato no admitido.
- **Las fotos que ya se subieron antes de achicarlas:** se quedan como están; se reemplazan la próxima vez que el miembro suba otra.
- **Dos Admin corrigiendo la fecha de nacimiento a la vez:** gana la última, y la bitácora guarda las dos.
- **Un miembro que cambia su AUF sin verificar varias veces:** cada cambio lo deja sin verificar, sin límite.
- **Un AUF verificado que se vence:** sigue verificado, y además se marca vencido, como ya pasa hoy.

## 7. UX / UI

- Mockups: `docs/mockups/directory-light.png` y `directory-dark.png` para el directorio (búsqueda, filtros por rol, filas con iniciales, nombre, país, nivel y rol; las columnas de OVR y asistencia quedan fuera hasta E8 y E9). `docs/mockups/mobile-profile-light.png` y `mobile-profile-dark.png` para el perfil, sin las métricas ni las notas.
- Pantallas:
  - **Directorio:** búsqueda, filtro por rol, orden, filas de miembro, y para el Admin la bandeja de solicitudes, el cambio de rol, el alta y la baja.
  - **Perfil propio:** datos editables, foto, rol actual, solicitud de rol y grupos propios.
  - **Ficha de miembro para el Admin:** AUF, vencimiento, grupos, rol y estado.
- Viewports: 375 / 768 / 1440, tema claro y oscuro, en inglés y en español.

## 8. Requerimientos no funcionales

- Seguridad: lo reservado al Admin se aplica en el servidor para el 100% de las peticiones (NFR-004), con la capacidad `manageUsersAndRoles` declarada en `RESTRICTED_ROUTES`. La interfaz solo esconde.
- Privacidad: el directorio muestra los datos del club, no los personales. La fecha de nacimiento, el correo del tutor y el consentimiento no se muestran nunca. El número de AUF solo lo ve el Admin.
- Auditoría: el cambio de estado de una cuenta queda registrado con actor, momento y resultado, como los cambios de rol (NFR-010).
- Idiomas: todo texto nuevo sale del catálogo, y los correos salen en el idioma del miembro.
- Accesibilidad: sin violaciones de axe en las pantallas nuevas, en los dos idiomas.
- API: todo pasa por la API v1 (CON-002).

## 9. Preguntas abiertas

Ninguna. El dueño tomó estas decisiones el 20 de septiembre de 2026:

- Las columnas de asistencia y de nota general no entran aquí: las agregan E8 y E9 cuando esos datos existan.
- La foto de perfil entra en E5, con su propio ticket, y monta el almacenamiento que E11 reutilizará para los adjuntos.
- El directorio absorbe la pantalla de administración, y Mi cuenta se convierte en el perfil.
- Un miembro ve la ficha de otro en el directorio, pero la pantalla de perfil es la propia. El Admin abre la de cualquiera para editar lo suyo.

Y estas, el 22 de septiembre de 2026, al probar la épica terminada:

- La foto se achica en el servidor al subirla (RF-9), con una librería de imágenes nueva justificada en su PR.
- El Admin corrige la fecha de nacimiento (RF-10); el miembro sigue sin poder hacerlo, por el consentimiento de tutor.
- Los textos dicen "Invitar miembro", "Desactivar cuenta" y "Reactivar cuenta" (RF-11).
- El miembro propone su número de AUF y un Admin lo verifica (RF-12). Esto cambia la decisión B3 de `docs/preguntas-abiertas.md`.
- Las posiciones configurables por club no entran aquí: van a E18, que es la épica pensada para clubes de otros deportes.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                  | Tamaño | Depende de | Auto-merge sugerido                       |
| --- | --------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------- |
| 1   | Agrega a la ficha del miembro posición, nivel, género, AUF y fecha de ingreso     | S      | ninguna    | No: datos personales en la base           |
| 2   | Sirve el directorio por API, con búsqueda, filtro por rol y orden                 | M      | 1          | No: expone datos de todos los miembros    |
| 3   | Da al club la pantalla del directorio                                             | M      | 2          | No: pantalla nueva                        |
| 4   | Muda al directorio la bandeja de solicitudes y el cambio de rol, y retira la otra | M      | 3          | No: mueve permisos de sitio               |
| 5   | Deja que un miembro edite su perfil, con Mi cuenta convertida en perfil           | M      | 1          | No: escribe datos personales              |
| 6   | Deja que un Admin edite lo reservado de un miembro: AUF y grupos                  | M      | 3          | No: campos reservados al Admin            |
| 7   | Deja que un Admin cree un miembro y lo invite por correo                          | M      | 6          | No: crea cuentas y manda correos          |
| 8   | Deja que un Admin dé de baja y reactive a un miembro                              | M      | 3          | No: cierra el acceso de una persona       |
| 9   | Guarda la foto de perfil en el almacenamiento de Supabase                         | M      | 5          | No: almacenamiento nuevo con sus reglas   |
| 10  | Reduce la foto de perfil al subirla, para que el directorio no gaste el tráfico   | M      | 9          | No: dependencia nueva de imágenes         |
| 11  | Deja que un Admin corrija la fecha de nacimiento de un miembro                    | M      | 6          | No: toca el consentimiento de tutor       |
| 12  | Llama "Invitar miembro" y "Desactivar cuenta" a lo que hoy dice alta y baja       | S      | 7, 8       | No: cambia textos y capturas              |
| 13  | Deja que un miembro escriba su AUF, pendiente de que un Admin lo verifique        | M      | 6          | No: cambia quién escribe un dato del club |
