# PRD: E18a · Marca configurable por club

**Estado:** borrador · **Fecha:** 23 de septiembre de 2026 · **Épica:** #258

## 1. Problema

El dueño quiere vender la licencia de la plataforma a otros clubes, no
necesariamente de rugby subacuático. Hoy eso no se puede hacer sin tocar el
código: "Victoria Seadragons" está escrito a mano en cuatro archivos y en 17
claves de cada catálogo de idioma, los colores viven en `globals.css`, la marca
visual es un recuadro con las iniciales `VS`, y las tres posiciones de juego
(Goalkeeper, Defender, Forward) están fijas en una restricción de la base.

Un club nuevo obligaría hoy a un despliegue con el nombre cambiado a mano, y un
club de otro deporte no podría ni describir a sus miembros.

Hay además una razón de calendario: cada pantalla nueva nace con el nombre
escrito a mano. E7 y E11 suman entre 10 y 15 pantallas, así que hacer esto
después significa reabrirlas todas, con sus pruebas y sus capturas.

## 2. Usuarios y contexto

- **Usuario primario:** el Admin del club, desde un portátil, sin conocimientos
  técnicos. Entra una vez al instalar la plataforma y vuelve muy de tarde en
  tarde (un logo nuevo, un patrocinador, una posición que el club deja de usar).
- **Usuario secundario:** cualquier miembro, que ve el resultado en cada
  pantalla y en cada correo, sin saber que es configurable.
- **Hoy lo resuelve así:** no lo resuelve. Hay que editar el código y desplegar.

## 3. Objetivo y métricas de éxito

Objetivo: que un club pueda poner su nombre, su logo, su color y sus posiciones
de juego sin que nadie toque el código ni haga un despliegue.

Métricas:

- Un Admin cambia nombre, logo y color y lo ve aplicado en toda la aplicación
  **en menos de 5 minutos**, sin salir de la pantalla de configuración.
- **Cero apariciones** del literal "Victoria Seadragons" en `src/`, garantizado
  por una prueba que falla si vuelve a colarse.
- Un club puede renombrar sus posiciones de juego sin perder los datos de los
  miembros que ya tenían una.

## 4. Alcance

**Incluido (v1)**

- Nombre del club, iniciales y logo.
- Color de acento, con el color del texto encima calculado y validado.
- Los textos del inicio de sesión, en los dos idiomas.
- Las posiciones de juego: crear, renombrar, reordenar y archivar.
- Una pantalla de configuración reservada al Admin, con su API y su bitácora.
- La marca en los correos transaccionales.

**Explícitamente fuera (por ahora)**

- El alta de un club nuevo y la publicación de versiones: son E18b, que espera
  la decisión B6.
- Varios clubes en una misma instalación. Sigue siendo un club por instalación.
- La paleta completa: solo se configura el acento (ver decisión D1).
- Favicon y la imagen de vista previa al compartir un enlace.
- Tipografías configurables.
- Traducir automáticamente lo que escriba el club.

## 5. Decisiones tomadas antes de escribir

- **D1 · Solo el color de acento.** El club elige un color, el de botones,
  enlaces y estados activos. Fondos, paneles y texto no se tocan. El color del
  texto sobre el acento se calcula, y se rechaza un acento que no llegue a
  contraste AA. Motivo: es lo más difícil de romper, y una paleta completa mal
  elegida deja la aplicación ilegible.
- **D2 · Los textos que escribe el club son por idioma, con respaldo.** Si el
  club escribe solo uno, en el otro idioma sale el texto por defecto de la
  aplicación. Se usa el mismo mecanismo para los textos del inicio de sesión y
  para los nombres de las posiciones, así que es una sola pieza.
- **D3 · Las posiciones se archivan, no se borran.** Quien ya la tenía la
  conserva, y nadie nuevo puede elegirla. Así no se pierde información ni hay
  que tocar fichas de miembros.

## 6. Requerimientos funcionales

### RF-1 · La marca sale del código · Must

El nombre, las iniciales y el logo del club se leen de la base de datos, no de
constantes ni de los catálogos de idioma.

- **Dado** un club con su nombre guardado, **cuando** se abre cualquier pantalla
  o se recibe cualquier correo, **entonces** aparece ese nombre y no el escrito
  en el código.
- **Dado** el repositorio, **cuando** se busca el literal "Victoria Seadragons"
  en `src/`, **entonces** no aparece, y una prueba lo impide en adelante.
- **Dado** un título de pestaña ("Directorio · X"), **cuando** se muestra,
  **entonces** el nombre del club entra como dato del catálogo, no dentro del
  texto traducido.
- **Dado** un club sin iniciales guardadas, **cuando** se muestra su marca,
  **entonces** se derivan de su nombre (la inicial de las dos primeras
  palabras).

### RF-2 · La lectura de la marca no puede tumbar la aplicación · Must

- **Dado** que la marca se lee en cada visita, **cuando** se sirven varias
  páginas seguidas, **entonces** la lectura se sirve de una caché en memoria del
  servidor y no consulta la base cada vez.
- **Dado** que la base no responde, **cuando** se pide una pantalla,
  **entonces** se pinta con los valores por defecto sembrados en el código, se
  registra el fallo, y la pantalla no se cae.
- **Dado** un Admin que guarda un cambio, **cuando** recarga cualquier pantalla,
  **entonces** ve el valor nuevo sin esperar a que caduque la caché.

### RF-3 · El color de acento · Must

- **Dado** un Admin en la configuración, **cuando** elige un color de acento y
  guarda, **entonces** botones, enlaces y estados activos lo usan en toda la
  aplicación, en tema claro y oscuro.
- **Dado** un color elegido, **cuando** se guarda, **entonces** el color del
  texto que va encima se calcula solo, de modo que el par siempre llega a
  contraste AA.
- **Dado** un color con el que ningún texto llega a AA, **cuando** se intenta
  guardar, **entonces** se rechaza con un mensaje que dice por qué, y nada
  cambia.
- **Dado** un valor que no es un color hexadecimal válido, **cuando** se manda
  por la API, **entonces** responde 400 sin tocar la base.
- **Dado** el color aplicado, **cuando** se carga la página sin JavaScript,
  **entonces** ya sale bien, sin parpadeo del color anterior.

### RF-4 · El logo · Must

- **Dado** un Admin, **cuando** sube un logo PNG o WebP de hasta 512 KB,
  **entonces** se guarda y sustituye al recuadro de iniciales en la cabecera, en
  el inicio de sesión y en los correos.
- **Dado** un club sin logo, **cuando** se muestra su marca, **entonces** sale
  el recuadro con las iniciales, como hoy.
- **Dado** un logo subido, **cuando** se mira su dirección, **entonces** es
  pública y se ve sin iniciar sesión, porque un correo se abre fuera de la
  aplicación.
- **Dado** un archivo que no es una imagen admitida, o que pesa de más,
  **cuando** se sube, **entonces** se rechaza con el motivo, sin guardar nada.
- **Dado** un Admin que quita el logo, **cuando** guarda, **entonces** vuelven
  las iniciales y el archivo anterior se borra del almacenamiento.

### RF-5 · Los textos del inicio de sesión · Should

- **Dado** un Admin, **cuando** escribe el lema y el párrafo de bienvenida del
  inicio de sesión, **entonces** esa pantalla los muestra en lugar de los de la
  aplicación.
- **Dado** que los escribió solo en español, **cuando** alguien abre la
  aplicación en inglés, **entonces** ve el texto por defecto en inglés, no el
  español.
- **Dado** un texto más largo que el máximo (140 caracteres el lema, 320 el
  párrafo), **cuando** se guarda, **entonces** se rechaza con el límite escrito
  en el mensaje.
- **Dado** un texto con etiquetas HTML, **cuando** se muestra, **entonces** sale
  como texto plano, sin interpretarse.

### RF-6 · La pantalla de configuración del club · Must

- **Dado** un Admin, **cuando** entra en la configuración del club, **entonces**
  puede ver y cambiar nombre, iniciales, logo, color y textos del inicio de
  sesión.
- **Dado** un Coach, un Committee o un Player, **cuando** intentan entrar por
  pantalla o por API, **entonces** reciben 403.
- **Dado** un cambio guardado, **cuando** ocurre, **entonces** la bitácora anota
  quién lo hizo, cuándo y qué campos cambiaron, sin guardar los valores.
- **Dado** dos Admin guardando a la vez, **cuando** el segundo guarda sobre un
  estado que ya cambió, **entonces** se le avisa y no pisa el cambio del primero
  en silencio.

### RF-7 · Las posiciones de juego, configurables · Must

- **Dado** un Admin, **cuando** añade, renombra o reordena posiciones,
  **entonces** el perfil y el directorio ofrecen esas y en ese orden.
- **Dado** un club recién instalado, **cuando** nadie ha tocado nada,
  **entonces** tiene Goalkeeper, Defender y Forward, con sus nombres en los dos
  idiomas, como hoy.
- **Dado** un nombre de posición, **cuando** el club lo escribe, **entonces**
  puede darlo en los dos idiomas, con el mismo respaldo que los textos del
  inicio de sesión.
- **Dado** una posición archivada, **cuando** un miembro que la tenía mira su
  perfil, **entonces** la sigue viendo, marcada como retirada, y nadie más puede
  elegirla.
- **Dado** el directorio ordenado por posición, **cuando** se lista, **entonces**
  usa el orden que definió el club, no el alfabético.
- **Dado** un club que archiva todas sus posiciones, **cuando** un miembro edita
  su perfil, **entonces** el campo de posición desaparece en vez de quedar vacío
  y roto.

### RF-8 · La marca en los correos · Should

- **Dado** cualquier correo transaccional, **cuando** se envía, **entonces**
  lleva el nombre, el color y el logo del club.
- **Dado** que un cliente de correo no carga imágenes, **cuando** se lee el
  correo, **entonces** el nombre del club se lee igual, en texto.

## 7. Casos borde y estados de error

- **Nombre muy largo.** Máximo 60 caracteres. A 360 px la cabecera no puede
  partirse en dos filas ni tapar los controles: se recorta con puntos
  suspensivos y el nombre completo queda como título accesible. Es el mismo
  guardián de geometría del #209 y del #287.
- **Nombre vacío.** Se rechaza: el club siempre tiene nombre.
- **Logo desproporcionado.** Se muestra encajado en su caja, sin deformarse ni
  desbordar, sea cuadrado o apaisado.
- **Logo que ya no existe en el almacenamiento.** Se cae a las iniciales en vez
  de dejar una imagen rota.
- **Color igual al fondo.** Lo cubre la validación de contraste de RF-3.
- **Posición repetida.** Dos posiciones con el mismo nombre en el mismo idioma
  se rechazan.
- **Miembro con una posición archivada que edita su perfil.** Puede guardar sin
  cambiarla; si la cambia, ya no puede volver a la archivada.
- **Caché tras un cambio.** Cubierto por RF-2: guardar invalida la caché.

## 8. UX / UI

- **Mockups:** no hay ninguno para la configuración del club. Revisión
  heurística contra `design-system.md`. La referencia de formulario es la ficha
  del miembro (`MemberRecordForm`), que ya resuelve guardado, validación y
  errores del servidor.
- **Flujo principal:** Admin entra en la configuración → cambia nombre, color o
  logo → guarda → ve el cambio aplicado en la propia cabecera al instante.
- **Dónde vive:** una sección nueva reservada al Admin, dentro de
  `RESTRICTED_ROUTES`. Se alcanza desde el menú de la cuenta (#287), que es
  donde ya viven las preferencias.
- **Viewports:** 375 / 768 / 1440, tema claro y oscuro, inglés y español.
- **Capturas que cambian:** todas, porque la cabecera sale en todas. Hay que
  aceptar líneas base en el primer ticket que aplique la marca.

## 9. Requerimientos no funcionales

- **Rendimiento:** la marca añade como mucho una consulta por arranque de
  servidor, no por visita (RF-2).
- **Accesibilidad:** axe sin violaciones; el par acento y texto siempre en AA.
- **Seguridad:** solo el Admin escribe, comprobado en el servidor y en RLS. El
  logo vive en un bucket público de solo lectura; escribir exige la llave de
  servicio. Lo que escribe el club se muestra como texto plano.
- **Un club por instalación:** no se toca `club_id` ni se relaja NFR-009. Las
  tablas siguen colgando del club.

## 10. Preguntas abiertas

- [ ] ¿El club puede cambiar su `slug`? Propuesta: no en v1, porque hoy es la
      llave con la que el servidor encuentra al club.
- [ ] ¿El favicon entra en una segunda vuelta? Propuesta: sí, fuera de v1.

## 11. Descomposición en tickets

**Tanda 1 · La marca (antes de abrir E7 y E11)**

| #   | Ticket                                                                        | Tamaño | Depende de | auto-merge                                       |
| --- | ----------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------ |
| T1  | Guarda la marca del club en la base, con sus valores actuales sembrados       | M      | —          | No: migración y esquema                          |
| T2  | Lee la marca en el servidor, con caché y respaldo, y pinta nombre e iniciales | M      | T1         | No: toca el arranque de toda pantalla            |
| T3  | Saca el nombre del club de los catálogos de idioma                            | S      | T2         | Sí: mecánico y cercado por el test de traducción |
| T4  | Aplica el color de acento del club, con su validación de contraste            | M      | T2         | No: puede dejar la aplicación ilegible           |
| T5  | Deja subir, cambiar y quitar el logo del club                                 | M      | T2         | No: almacenamiento y archivos                    |
| T6  | Pantalla de configuración del club para el Admin, con su API y su bitácora    | M      | T2         | No: permisos                                     |
| T7  | Lleva la marca del club a los correos transaccionales                         | S      | T2, T5     | No: sale fuera de la aplicación                  |

**Tanda 2 · Las posiciones (antes de E10)**

| #   | Ticket                                                                   | Tamaño | Depende de | auto-merge                    |
| --- | ------------------------------------------------------------------------ | ------ | ---------- | ----------------------------- |
| T8  | Guarda las posiciones de juego por club, con las tres actuales sembradas | M      | T1         | No: migración y esquema       |
| T9  | El perfil y el directorio leen las posiciones del club, no la constante  | M      | T8         | No: cambia datos de miembros  |
| T10 | Pantalla de Admin para crear, renombrar, reordenar y archivar posiciones | M      | T8, T6     | No: permisos                  |
| T11 | Los textos del inicio de sesión que escribe el club, por idioma          | S      | T6         | No: lo ve quien no ha entrado |

Total: **11 tickets**, L. La tanda 1 cierra la advertencia del plan maestro
sobre E7 y E11; la tanda 2 cierra la de E10.
