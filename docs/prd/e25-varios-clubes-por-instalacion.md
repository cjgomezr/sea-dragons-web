# PRD: E25 · Varios clubes en una misma instalación

**Estado:** borrador · **Fecha:** 14 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code) · **Épica:** #663

Fuente: `docs/plan-maestro.md` (E18a, E18b y la decisión técnica "`club_id` + RLS en toda tabla desde el día uno", NFR-009) y CON-004 del SRD. `docs/preguntas-abiertas.md` deja sin resolver B6, que bloquea a E18b y no a esta épica, y B8, nueva, que bloquea sólo la puesta en producción de los subdominios (sección 9).

## 1. Problema

El dueño vende la licencia de la plataforma a otros clubes. Hoy cada club necesita su propia instalación: su proyecto de Supabase, su despliegue en Vercel y sus variables. Con dos o tres clubes eso se puede llevar a mano; con diez, cada versión nueva hay que publicarla diez veces y cada instalación es una factura más. E18b iba a automatizar ese alta y esa publicación, pero espera una decisión de negocio (B6) que no tiene fecha.

El esquema ya está preparado para otra salida: las 34 tablas de datos llevan `club_id`, las claves foráneas compuestas impiden mezclar filas de dos clubes, y el servidor saca el club de la fila del miembro en cada petición. Lo que falta es lo que hoy da por hecho que sólo hay un club: la pantalla de entrada, el registro y la recuperación de contraseña buscan el club por una constante (`DEFAULT_CLUB_SLUG`), la marca vive en una caché única para todo el proceso, los correos salen con esa marca única, y los pagos van a una sola cuenta de Stripe.

## 2. Usuarios y contexto

- **El dueño de la plataforma:** quiere sumar un club sin montar otra instalación.
- **Los miembros de cada club:** entran por la dirección de su club y ven su marca, sus datos y nada de los demás. No tienen por qué saber que comparten instalación con otros.
- **El Admin de cada club:** administra lo suyo exactamente como hoy.
- **Hoy lo resuelven así:** una instalación por club, montada a mano.

## 3. Objetivo y métricas de éxito

- Objetivo: que una sola instalación sirva a varios clubes, cada uno en su subdominio, sin que ninguno vea datos de otro.
- Métricas:
  - La suite de aislamiento con dos clubes (RF-5) pasa en CI en cada pull request, sin excepciones.
  - Una instalación con un solo club, como la de hoy, se comporta exactamente igual que antes de esta épica.
  - Sumar un club a una instalación existente no exige desplegar nada.

## 4. Alcance

**Incluido (v1):**

- Saber de qué club es cada petición por su subdominio, con un respaldo para las instalaciones de un solo club.
- La marca, el registro, la confirmación de cuenta y la recuperación de contraseña del club de la petición.
- La sesión vale sólo en el subdominio de su club.
- Los correos con la marca del club de quien los recibe.
- Los pagos, sólo para el club al que pertenece la cuenta de Stripe de la instalación.
- Una suite de pruebas que demuestra el aislamiento con dos clubes.
- Cerrar la lectura pública de la lista de clubes.
- Un script para dar de alta un club con su primer Admin (Could).

**Explícitamente fuera (por ahora):**

- Una cuenta de Stripe por club (Stripe Connect). Los demás clubes de la instalación no cobran hasta esa épica.
- Un remitente de correo por club. Todos los correos salen de la dirección de la instalación, con el nombre y la marca de su club.
- Un dominio propio por club. Sólo subdominios.
- Un rol de plataforma por encima del Admin, y una pantalla para dar de alta clubes.
- Una persona en dos clubes. Sigue siendo una cuenta por club (`members.user_id` único); quien quiera estar en dos usa dos correos.
- Una zona horaria por club. Todos los clubes siguen en `Australia/Melbourne` (`CLUB_TIME_ZONE`). Un club fuera de Melbourne necesita su propia épica.
- El cupo de correos del directorio (`reserve_directory_email_quota`), que sigue siendo uno para toda la instalación porque la cuenta de Resend es una.
- E18b. Con esta épica, dar de alta un club en una instalación compartida pasa a ser una fila nueva; E18b se replantea cuando B6 se resuelva.

## 5. Requerimientos funcionales

### RF-1 · El club de cada petición sale de su subdominio · Must

La dirección de cada club es `<slug>.<dominio base>`. El dominio base es una variable de entorno nueva, `APP_BASE_DOMAIN`.

- **Dado** una petición a `seadragons.<dominio base>`, **cuando** llega, **entonces** su club es el de slug `seadragons`, y el resto de la petición lo usa.
- **Dado** un subdominio que no es el slug de ningún club, **cuando** llega una petición, **entonces** responde 404 con una pantalla que dice que ese club no existe, y no muestra la marca de ningún otro.
- **Dado** una instalación con un solo club, **cuando** llega una petición sin subdominio o a cualquier host (`localhost:3417`, un preview de Vercel, el dominio de hoy), **entonces** su club es ese club. Es lo que mantiene funcionando sin cambios las instalaciones de hoy.
- **Dado** una instalación con varios clubes, **cuando** llega una petición sin subdominio de club, **entonces** responde 404 con la pantalla de club no encontrado.
- **Dado** un subdominio con mayúsculas, **cuando** llega, **entonces** se trata igual que en minúsculas.
- **Dado** un desarrollador en su máquina, **cuando** abre `<slug>.localhost:3417`, **entonces** entra a ese club, sin tocar el DNS.

### RF-2 · La marca es la del club de la petición · Must

- **Dado** dos clubes con nombres, logos y colores distintos, **cuando** se abre la pantalla de entrada de cada uno, **entonces** cada una muestra su marca y sus textos de inicio de sesión.
- **Dado** que un Admin cambia la marca de su club, **cuando** se guarda, **entonces** la caché sólo se invalida para ese club, y la marca de los demás no se vuelve a leer.
- **Dado** el manifiesto, el icono y los metadatos de la página, **cuando** se piden desde el subdominio de un club, **entonces** son los de ese club.

### RF-3 · Registro, confirmación y recuperación en el club de la petición · Must

- **Dado** una persona que se registra en `otroclub.<dominio base>`, **cuando** completa el registro, **entonces** su cuenta queda en ese club, no en el de la constante.
- **Dado** un correo que ya tiene cuenta en otro club de la instalación, **cuando** se intenta registrar con él, **entonces** la respuesta es la misma que hoy da a un correo ya registrado, sin decir en qué club está.
- **Dado** una petición de recuperación desde el subdominio de un club con el correo de alguien de otro club, **cuando** se procesa, **entonces** no se manda ningún correo y la respuesta es la misma que para un correo desconocido.
- **Dado** el reenvío del correo de confirmación, **cuando** se pide desde un subdominio, **entonces** sólo actúa sobre cuentas de ese club.
- **Dado** el código, **cuando** se busca `DEFAULT_CLUB_SLUG` fuera de las pruebas y de la semilla, **entonces** no aparece.

### RF-4 · La sesión vale sólo en su club · Must

- **Dado** que alguien inicia sesión en `seadragons.<dominio base>`, **cuando** abre `otroclub.<dominio base>`, **entonces** allí no tiene sesión y ve la pantalla de entrada de ese club.
- **Dado** las cookies de sesión, **cuando** se emiten, **entonces** no llevan atributo `Domain`, así que el navegador sólo las manda al subdominio que las creó.
- **Dado** una petición con una sesión válida cuyo miembro es de otro club que el de la petición, **cuando** llega a la frontera, **entonces** una pantalla la manda a la entrada y la API responde 401, sin hacer el trabajo. Es la defensa si una cookie llegara por otro camino.

### RF-5 · El aislamiento está demostrado con dos clubes · Must

Una suite de integración siembra dos clubes con los mismos datos de ejemplo (miembros, grupos, eventos, noticias, asistencias, evaluaciones, equipos, avisos, membresías) y ataca la API con un miembro de cada rol de cada club.

- **Dado** un miembro del club A con cualquier rol, **cuando** pide cada listado (directorio, grupos, eventos y agenda, noticias, avisos, panel, búsqueda, asistencia, evaluaciones, equipos, historial de pagos), **entonces** ninguna fila es del club B.
- **Dado** el identificador de una fila del club B, **cuando** un miembro del club A la pide, la edita o la borra por la API, **entonces** recibe 404 y la fila no cambia.
- **Dado** un miembro del club A, **cuando** consulta las tablas directamente con su sesión (RLS), **entonces** no ve ninguna fila del club B.
- **Dado** que se añade una tabla o un endpoint nuevo con datos de club, **cuando** se escribe su ticket, **entonces** la suite tiene que ampliarse en el mismo cambio. Lo recuerda una nota en `nextjs-supabase-practices`.

### RF-6 · Los correos llevan la marca del club de quien los recibe · Must

- **Dado** un correo de confirmación, recuperación, invitación, aviso de renovación o correo del directorio, **cuando** se manda a un miembro del club B, **entonces** lleva el nombre, el logo y los colores del club B, y los enlaces apuntan a su subdominio.
- **Dado** la exportación del directorio, **cuando** la descarga un Admin del club B, **entonces** el nombre del archivo es el de su club.
- **Dado** el remitente, **cuando** sale cualquier correo, **entonces** es la dirección de la instalación (`EMAIL_FROM`), con el nombre del club como nombre visible.

### RF-7 · Sólo cobra el club dueño de la cuenta de Stripe · Must

Las claves de Stripe son de una cuenta, y el dinero va a quien tiene la cuenta. Sin esta regla, el segundo club cobraría en la cuenta del primero.

- **Dado** la variable nueva `STRIPE_CLUB_SLUG`, **cuando** la instalación arranca, **entonces** sólo ese club tiene pagos.
- **Dado** una instalación con un solo club y sin `STRIPE_CLUB_SLUG`, **cuando** arranca, **entonces** ese club tiene pagos, como hoy.
- **Dado** un miembro de un club sin pagos, **cuando** abre la sección de pagos o llama a sus endpoints, **entonces** ve que los pagos no están disponibles en su club, y no se crea nada en Stripe.
- **Dado** un evento de Stripe que no corresponde a una membresía del club con pagos, **cuando** llega el webhook, **entonces** se registra y se ignora, sin tocar ninguna membresía.

### RF-8 · La lista de clubes no es pública · Should

- **Dado** un cliente anónimo, **cuando** consulta directamente `clubs` o `club_sign_in_texts`, **entonces** no ve ninguna fila. La pantalla de entrada lee la marca y los textos de su club desde el servidor.
- **Dado** un miembro con sesión, **cuando** consulta `clubs`, **entonces** sólo ve el suyo.

### RF-9 · Un script da de alta un club con su primer Admin · Could

- **Dado** el dueño con acceso a la instalación, **cuando** corre el script con un slug, un nombre y el correo del primer Admin, **entonces** se crea el club con sus posiciones, categorías de evaluación y packs por defecto, y el Admin recibe la invitación con el enlace a su subdominio.
- **Dado** un slug que ya existe o que no es válido como subdominio, **cuando** se corre el script, **entonces** se niega sin crear nada.

## 6. Casos borde y estados de error

- **Subdominio desconocido:** 404 con su pantalla, sin la marca de otro club.
- **Instalación con un club que pasa a tener dos:** desde ese momento, el host sin subdominio deja de servir al primero; la guía avisa que antes hay que configurar el subdominio del club existente.
- **Slugs que chocan con nombres reservados** (`www`, `api`, `app`, `admin`): el script de alta los rechaza.
- **Una persona invitada a un segundo club con el mismo correo:** la invitación falla con un mensaje para el Admin que dice que ese correo ya tiene cuenta en la instalación, sin decir en qué club.
- **Caché de la marca:** el cambio de un club invalida sólo su entrada; un club no se queda con la marca de otro tras un reinicio.
- **Un enlace de correo viejo, sin subdominio,** en una instalación de varios clubes: lleva a la pantalla de club no encontrado.
- **Previews de Vercel:** sirven contra `seadragons-dev`, que tiene un solo club, así que funcionan por el respaldo de RF-1.
- **Un miembro dado de baja en un club:** sigue sin poder entrar, también en el subdominio de otro club.

## 7. UX / UI

- Una sola pantalla nueva: **club no encontrado**, con el mismo esqueleto que la pantalla de entrada y sin marca de ningún club. Sin mockup: revisión heurística contra `design-system.md`.
- La sección de pagos de un club sin pagos muestra un estado vacío que lo explica. Sin mockup: sigue el estado vacío de pagos de E23.
- Todo lo demás se ve igual que hoy, con la marca del club de la petición.
- Viewports: 375 / 768 / 1440, tema claro y oscuro, inglés y español.

## 8. Requerimientos no funcionales

- **Seguridad:** el club de la petición se resuelve una vez, en la frontera (`src/proxy.ts`), y viaja con la petición hasta el handler, como hace hoy el rol. Es el equivalente a un aspecto: ningún endpoint lo calcula por su cuenta. RLS sigue siendo la red de abajo.
- **Sin cambio de modelo de sesión:** el club no se mete en el token de Supabase (custom access token hook). Hoy cada identidad es de un club y el servidor ya lo saca de `members` en cada petición; un dato más en el token duplicaría eso y quedaría viejo si el miembro cambia de club.
- **Compatibilidad:** las instalaciones de un club no necesitan ninguna variable nueva para seguir funcionando.
- **Rendimiento:** resolver el club por subdominio es una lectura cacheada por slug, no una consulta por petición.
- **Idiomas:** los textos nuevos salen del catálogo, en inglés y en español.
- **Accesibilidad:** sin violaciones de axe en las pantallas nuevas.

## 9. Preguntas abiertas

- [ ] **B8 · Qué dominio aloja los subdominios.** Hace falta un dominio del dueño con DNS comodín (`*.<dominio>`) apuntando a Vercel, y el comodín añadido al proyecto de Vercel, que exige usar los nameservers de Vercel para ese dominio. ¿Se usa `volleytip.com`, que ya es del dueño, o se compra uno para la plataforma? La responde el dueño. Bloquea sólo la puesta en producción de los subdominios: todo se construye y se prueba con `<slug>.localhost` y con el respaldo de un solo club.

Decisiones del dueño (14 de octubre de 2026):

- Esta épica cubre los datos y el club por subdominio. Stripe por club y correo por club son épicas propias.
- Subdominio por club, no dominio propio.
- Conviven los dos modelos: una instalación admite uno o varios clubes con el mismo código.
- El alta de clubes con pantalla y un rol de plataforma quedan fuera.

Decisiones tomadas en la sesión, que el dueño puede revertir:

- Una cuenta por club (se mantiene `members.user_id` único).
- El club no va en el token de sesión (sección 8).
- RF-9, el script de alta, entra como Could: sin él, el dueño da de alta un club con SQL documentado en `docs/entornos.md`.

## 10. Descomposición en tickets (para write-ticket)

| #   | Issue | Título propuesto                                                                              | Tamaño | Depende de | Auto-merge sugerido                          |
| --- | ----- | --------------------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------- |
| 1   | #664  | Demuestra con dos clubes que ningún endpoint ni tabla deja ver datos del otro                 | M      | ninguna    | No: es la prueba de la frontera de seguridad |
| 2   | #665  | Resuelve el club de cada petición por su subdominio, con respaldo para un solo club           | M      | ninguna    | No: frontera de cada petición                |
| 3   | #666  | Lee la marca del club de la petición, con caché por club                                      | M      | 2          | No: cambia qué ve cada club antes de entrar  |
| 4   | #667  | Registra, confirma y recupera cuentas en el club de la petición                               | M      | 2          | No: toca autenticación                       |
| 5   | #668  | Deja la sesión válida sólo en el subdominio de su club                                        | M      | 2          | No: toca autenticación                       |
| 6   | #669  | Manda cada correo con la marca y el subdominio del club de quien lo recibe                    | S      | 3          | No: correos a miembros reales                |
| 7   | #670  | Deja cobrar sólo al club dueño de la cuenta de Stripe de la instalación                       | M      | 2          | No: toca pagos                               |
| 8   | #671  | Cierra la lectura pública de clubes y de los textos de entrada                                | S      | 3          | No: cambia políticas RLS                     |
| 9   | #672  | Da de alta un club con su primer Admin desde un script                                        | S      | 4          | No: crea datos y manda invitaciones          |
| 10  | #673  | Documenta el dominio comodín, `<slug>.localhost` y el alta de clubes en la guía y en entornos | S      | 2          | Sí: sólo documentación                       |

El 1 va primero y sin dependencias a propósito: siembra los dos clubes directamente con la clave de servicio, así que no espera al registro por subdominio, y deja la red puesta antes de tocar la frontera. Debería pasar casi entero ya hoy, porque los gateways filtran por `club_id`; lo que falle es un hallazgo.
