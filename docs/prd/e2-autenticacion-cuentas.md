# PRD: E2 · Autenticación y cuentas

**Estado:** borrador · **Fecha:** 11 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4), epic E2 de
`docs/plan-maestro.md` y la decisión B2 de `docs/preguntas-abiertas.md`. Cubre
FR-001 a FR-009, FR-081 a FR-083, INT-006 y NFR-004, NFR-005, NFR-007, NFR-012.

INT-004 (Google) e INT-005 (Apple) quedan **aplazados por decisión del dueño el
11 de septiembre de 2026**. La sección 4 dice por qué y cuándo se retoman.

## 1. Problema

La plataforma no tiene puerta. Hay un esqueleto de aplicación con siete
secciones, una API versionada y una base de datos con su club sembrado, pero no
existe forma de que una persona sea alguien dentro del sistema. Sin cuentas no
hay a quién atribuir una confirmación de asistencia, una evaluación ni un cobro,
así que ninguna de esas épicas puede empezar.

Es el cuello de botella del plan. Seis épicas dependen de esta, directa o
indirectamente, y el tronco común completo (roles, grupos, directorio,
notificaciones) sale de aquí. Mientras tanto el club sigue llevando la lista de
socios en una hoja de cálculo y coordinando por WhatsApp, que es exactamente lo
que la plataforma existe para reemplazar.

## 2. Usuarios y contexto

- **Visitante que quiere unirse al club:** llega desde el enlace que alguien le
  pasó por WhatsApp, casi siempre desde el móvil, de pie y con poca paciencia.
  No conoce la plataforma. Si el registro le pide algo que no tiene a mano,
  abandona y vuelve a preguntar por WhatsApp.
- **Socio que ya está registrado:** vuelve cada semana a mirar el calendario o
  a confirmar entrenamiento. Quiere entrar rápido y no volver a escribir la
  contraseña cada vez.
- **Menor de 18 con su tutor:** el club tiene jugadores juveniles. El menor hace
  el registro y el consentimiento lo da su madre, padre o tutor, casi siempre
  desde otro dispositivo y en otro momento.
- **Hoy lo resuelven así:** no hay cuentas. La pertenencia al club es una fila en
  una hoja de cálculo que mantiene una persona a mano.

## 3. Objetivo y métricas de éxito

**Objetivo:** que un visitante se cree una cuenta, quede registrado con todos los
datos que el club necesita y llegue al panel principal sin que nadie le ayude.

Métricas:

- Un registro completo se termina en menos de 3 minutos desde la pantalla de
  entrada.
- Cero cuentas en estado activo sin los datos obligatorios. Se comprueba con una
  consulta, no con confianza.
- Cero cuentas activas de menores de 18 sin consentimiento registrado.
- Cero rutas alcanzables sin sesión, salvo las tres públicas: registro, inicio
  de sesión y recuperación de contraseña.

## 4. Alcance

### Dentro

- Registro con nombre completo, correo, país, contraseña y tipo de membresía.
- Fecha de nacimiento en el registro, y consentimiento del tutor cuando la fecha
  indica menos de 18 años.
- Estado `incomplete` de la cuenta y pantalla de completar registro, con el paso
  a `active` en cuanto no falta nada.
- Inicio de sesión con correo y contraseña.
- Cierre de sesión desde cualquier pantalla.
- Recuperación de contraseña por enlace enviado al correo registrado.
- Rol Player asignado a toda cuenta nueva.
- La tabla de miembros, con `club_id` y sus políticas de acceso.
- La frontera de sesión en el servidor: todo lo que no sean las tres pantallas
  públicas exige sesión, también por llamada directa a la API.
- Registro en la bitácora de auditoría de los eventos de cuenta.

### Fuera

- **Inicio de sesión con Google y con Apple.** Aplazados. Ver abajo.
- La matriz de permisos por rol y las solicitudes de cambio de rol. Son E3. Aquí
  toda cuenta nace Player y nadie puede cambiarlo todavía.
- El directorio, la edición del propio perfil y el alta de un socio por parte de
  un Admin. Son E5.
- La baja de un socio. Es E5. Aquí el estado `inactive` existe en el modelo pero
  nada lo escribe.
- El cobro de la membresía. Es E12. Aquí el tipo de membresía se captura y se
  guarda, pero no se cobra nada.
- Cambiar la contraseña estando dentro. No lo pide ningún requerimiento del SRD
  y se resuelve con el flujo de recuperación.

### El aplazamiento de Google y Apple

FR-004, FR-005, INT-004 e INT-005 piden inicio de sesión con Google y con Apple.
Los dos salen de esta entrega por decisión del dueño, tomada el 11 de septiembre
de 2026 con el costo sobre la mesa. No es un olvido y no es deuda escondida:
está escrito aquí para que se retome a sabiendas.

**El motivo es el costo, y es solo el de Apple.** Google no cobra por el inicio
de sesión: el proyecto en la nube y sus credenciales son gratis, y con los
permisos que pide un login corriente ni siquiera hace falta pasar la auditoría
de verificación. Apple sí cobra. Iniciar sesión con Apple es una prestación del
Apple Developer Program, 99 dólares al año, y la cuenta gratuita no la habilita.
La regla del proyecto es que si hay que pagar, no se hace.

**Por qué también sale Google, que es gratis.** Entregar solo uno de los dos deja
la pantalla a medias y obliga a escribir dos veces la pantalla de completar
registro: una para el camino de correo y otra para el camino de proveedor, que
llega sin fecha de nacimiento ni tipo de membresía. Ese trabajo doble no se
ahorra entregando Google hoy, así que los dos caminos se retoman juntos.

**Cuándo se retoma.** En Release 2, la aplicación móvil. Ahí los 99 dólares dejan
de ser opcionales: las reglas de la tienda de Apple obligan a ofrecer su inicio
de sesión si la aplicación ofrece el de otro proveedor. Conviene saber de
antemano que un club se inscribe como organización, y eso exige entidad legal y
su identificador comercial, que es trámite y no un pago con tarjeta.

**Qué deja preparado esta entrega.** El estado `incomplete` y la pantalla de
completar registro se construyen igual, porque los pide FR-083 para el camino de
correo. Son justo la pieza que un proveedor externo necesita el día que entre:
una cuenta creada por Google llega sin tipo de membresía ni fecha de nacimiento
y aterriza en esa misma pantalla. Añadir un proveedor después es conectar el
botón, no rehacer el registro.

**Consecuencia en el diseño, que hay que decir en voz alta.** El mockup
`docs/mockups/auth-light.png` dibuja los dos botones bajo un separador que dice
"or continue with". La implementación no los lleva, así que el separador y los
dos botones se omiten. El mockup se queda como está, porque describe el destino
y no esta entrega. **La revisión visual tiene que saberlo o lo marcará como
defecto**, así que el ticket de la pantalla de entrada lo dice en su cuerpo.

### El correo transaccional y el dominio

INT-006 pide correo transaccional y esta épica lo necesita para una sola cosa:
el enlace de recuperación de contraseña. Las invitaciones de socios llegan en
E5 y los avisos de cobro en E12, sobre esta misma pieza.

**Proveedor elegido el 11 de septiembre de 2026: Resend.** Su plan gratuito da
3.000 correos al mes con tope de 100 al día, y deja verificar hasta tres
dominios sin costo. Un club de este tamaño manda un correo por alta y alguno
por contraseña olvidada, así que no se acerca al límite.

**Lo que falta no es el proveedor, es el dominio.** Sin un dominio verificado,
Resend solo envía desde su dirección de pruebas y solo al correo de la propia
cuenta. Sirve para desarrollar y no sirve para socios. Un dominio cuesta entre
10 y 15 dólares al año, así que choca con la regla de no pagar, y queda como
decisión del dueño en la sección 9. El club probablemente lo quiere igual: hoy
la plataforma vive en una dirección de Vercel, que está bien para trabajar pero
no para mandársela a alguien que se acaba de apuntar.

**El servicio de correo que trae Supabase no es una alternativa.** Manda 2
correos por hora, sin garantía de entrega ni de disponibilidad, y su propia
documentación dice que no se use en producción. Alcanza para probar a mano
durante el desarrollo y para nada más.

**Cómo se prueba todo esto sin un proveedor de correo.** Es la pregunta
práctica, porque la confirmación del correo se decidió obligatoria y el servicio
incorporado de Supabase no solo manda 2 mensajes por hora: además **se niega a
escribir a direcciones que no sean del equipo del proyecto**. Una dirección de
prueba inventada no recibe nada, así que el desarrollo no puede apoyarse en que
el correo llegue.

En los tests no se manda ningún correo. La llave de servicio permite crear una
cuenta ya confirmada y generar el enlace de confirmación sin enviarlo, así que
el flujo completo se prueba de forma determinista, sin red y sin límites. Es lo
que los tickets 2, 3 y 6 especifican.

Para probar a mano contra `seadragons-dev` hay un guión de desarrollo que, con
esa misma llave, imprime el enlace de confirmación de una cuenta recién creada.
Sirve con cualquier dirección de prueba y no gasta ningún envío.

**Lo que no se hace es apagar la confirmación en desarrollo.** Sería la salida
fácil y deja el entorno de desarrollo comportándose distinto al de producción,
que es la clase de diferencia que se descubre tarde y en el peor momento.

**Cómo se reparte esa espera entre los tickets.** Los tickets 1 a 6 se
desarrollan y se prueban contra dobles, sin hablar con ningún proveedor, así
que ninguno depende del dominio. El ticket 7 es el único que necesita la cuenta
de Resend, el dominio verificado y la credencial. Si el dominio tarda, ese
ticket espera y los otros seis se entregan igual, con el aviso escrito de que
la recuperación de contraseña todavía no llega a un socio real.

## 5. Requerimientos funcionales

### RF-1 · Registro con correo y contraseña · Must

Cubre FR-001, FR-002, FR-008, FR-009, FR-081. Un visitante crea su cuenta con
nombre completo, correo, país, contraseña, tipo de membresía y fecha de
nacimiento.

- **Dado** un visitante en el formulario de registro, **cuando** envía nombre,
  correo, país, contraseña válida, tipo de membresía y fecha de nacimiento,
  **entonces** se crea la cuenta con el rol Player y el tipo elegido.
- **Dado** un visitante en el formulario, **cuando** envía una contraseña de 7
  caracteres o menos, **entonces** se rechaza y el mensaje dice el mínimo de 8.
- **Dado** un correo que ya tiene cuenta, **cuando** alguien intenta registrarse
  con él, **entonces** no se crea una segunda cuenta y el mensaje no revela si
  ese correo existe.
- **Dado** un tipo de membresía fuera de Full, Student y Casual, **cuando** llega
  por API directa, **entonces** se rechaza con 422 y nombra el campo.

### RF-2 · Cuenta incompleta y pantalla de completar registro · Must

Cubre FR-083 y la decisión B2. Toda cuenta nace `incomplete` y solo alcanza la
pantalla de completar registro y el cierre de sesión hasta que no le falte nada.

- **Dado** un registro al que le falta algún dato obligatorio, **cuando** la
  cuenta se crea, **entonces** queda en estado `incomplete`.
- **Dado** un registro con todos los datos pero con el correo sin confirmar,
  **cuando** la cuenta se crea, **entonces** queda `incomplete` igual, y la
  pantalla dice que falta confirmar el correo y ofrece reenviarlo.
- **Dado** una cuenta cuyo único pendiente es la confirmación, **cuando** se
  abre el enlace del correo, **entonces** la cuenta pasa a `active`.
- **Dado** una cuenta `incomplete`, **cuando** intenta abrir cualquier ruta que
  no sea completar registro o cerrar sesión, **entonces** se la redirige a
  completar registro; **y cuando** esa misma ruta se pide por API directa,
  **entonces** responde 403 sin hacer el trabajo.
- **Dado** una cuenta `incomplete` a la que ya no le falta nada, **cuando**
  se guarda el último dato, **entonces** pasa a `active` sin intervención de
  nadie.
- **Dado** una cuenta `active`, **cuando** entra, **entonces** llega al panel
  principal y no vuelve a ver la pantalla de completar registro.

### RF-3 · Consentimiento del tutor para menores · Must

Cubre FR-082 y NFR-012. Una fecha de nacimiento que indica menos de 18 años
exige nombre del tutor, su correo y su consentimiento explícito.

- **Dado** un registrante cuya fecha de nacimiento le hace tener 16 años,
  **cuando** intenta completar el registro sin consentimiento, **entonces** la
  cuenta no se activa y sigue `incomplete`.
- **Dado** ese mismo registrante, **cuando** quedan registrados nombre del tutor,
  correo del tutor y el consentimiento con su marca de tiempo, **entonces** la
  cuenta se activa.
- **Dado** un registrante que cumple 18 años entre el registro y el
  consentimiento, **cuando** se evalúa si hace falta consentimiento, **entonces**
  manda la edad en el momento del registro, y eso queda escrito.
- **Dado** una cuenta de menor sin consentimiento, **cuando** se consulta la base,
  **entonces** no hay ninguna fila activa en esa condición.

### RF-4 · Inicio de sesión · Must

Cubre FR-003. Un usuario registrado entra con su correo y su contraseña.

- **Dado** un usuario registrado, **cuando** envía credenciales válidas,
  **entonces** obtiene sesión y llega al panel principal, o a completar registro
  si su cuenta está `incomplete`.
- **Dado** credenciales incorrectas, **cuando** las envía, **entonces** el mensaje
  es el mismo tanto si el correo no existe como si la contraseña no coincide.
- **Dado** una sesión válida, **cuando** el usuario vuelve más tarde sin haber
  cerrado sesión, **entonces** sigue dentro sin volver a escribir la contraseña.

### RF-5 · Cierre de sesión desde cualquier pantalla · Must

Cubre FR-007.

- **Dado** un usuario con sesión en cualquier pantalla de la aplicación,
  **cuando** cierra sesión, **entonces** la sesión termina y aterriza en la
  pantalla de entrada.
- **Dado** una sesión recién cerrada, **cuando** se intenta usar de nuevo esa
  misma credencial contra la API, **entonces** responde 401.

### RF-6 · Recuperación de contraseña · Must

Cubre FR-006, NFR-007 e INT-006.

- **Dado** un correo registrado, **cuando** se pide recuperar la contraseña,
  **entonces** sale un enlace a ese correo y la pantalla confirma el envío.
- **Dado** un correo que no tiene cuenta, **cuando** se pide recuperar,
  **entonces** la pantalla dice exactamente lo mismo y no se envía nada. No se
  revela quién tiene cuenta.
- **Dado** un enlace de recuperación, **cuando** se usa por segunda vez,
  **entonces** ya no sirve.
- **Dado** un enlace de recuperación, **cuando** pasan 60 minutos desde su
  emisión, **entonces** ya no sirve, y el mensaje ofrece pedir otro.
- **Dado** una contraseña nueva de 7 caracteres o menos, **cuando** se envía en
  el formulario de recuperación, **entonces** se rechaza con el mismo mínimo de
  8 que el registro.

### RF-7 · Frontera de sesión en el servidor · Must

Cubre NFR-004. La comprobación vive en el servidor, no en el navegador.

- **Dado** cualquier ruta de la aplicación que no sea registro, inicio de sesión
  o recuperación, **cuando** se pide sin sesión, **entonces** se responde con
  redirección a la entrada.
- **Dado** cualquier endpoint de `api/v1` que no sea de salud, **cuando** se pide
  sin sesión, **entonces** responde 401 con el cuerpo de error de la convención.
- **Dado** una fila de otro club en la base, **cuando** se consulta con la sesión
  de un socio, **entonces** no aparece. Lo garantizan las políticas de la base y
  no el código de la aplicación.

### RF-8 · Auditoría de los eventos de cuenta · Should

Cubre NFR-010 sobre la tabla `audit_log`, que E1 ya creó.

- **Dado** una cuenta que se crea, se activa, cambia de contraseña o registra un
  consentimiento de tutor, **cuando** ocurre, **entonces** queda una entrada en
  la bitácora con quién, qué y cuándo.
- **Dado** una entrada de la bitácora, **cuando** se lee, **entonces** no contiene
  la contraseña ni el enlace de recuperación, ni en claro ni troceados.

## 6. Casos borde y estados de error

- **Correo ya registrado.** No se crea una segunda cuenta y el mensaje es neutro,
  igual que el de credenciales incorrectas. Enumerar cuentas desde el formulario
  de registro es una fuga de datos personales.
- **Registro abandonado a la mitad.** La cuenta queda `incomplete`. Al volver a
  entrar aterriza en completar registro con lo que ya había escrito.
- **Fecha de nacimiento en el futuro o imposible.** Se rechaza en el servidor, no
  solo en el formulario.
- **El tutor nunca da el consentimiento.** La cuenta se queda `incomplete` para
  siempre y no se activa sola. No hay caducidad automática en esta entrega.
- **Dos pestañas abiertas.** Cerrar sesión en una deja la otra sin sesión en
  cuanto pide algo al servidor. No se queda mostrando datos de una sesión
  muerta.
- **Cuenta `incomplete` llamando a la API directamente.** Responde 403. Es el
  caso que el SRD nombra explícitamente en AC-038 y el que se olvida siempre,
  porque la interfaz ya redirige y parece suficiente.
- **Enlace de recuperación caducado o ya usado.** Mensaje claro y un botón para
  pedir otro, nunca una pantalla en blanco ni un error técnico.
- **El correo de recuperación no llega.** El usuario puede volver a pedirlo. Hay
  un límite de peticiones por correo y por ventana de tiempo, para que el
  formulario no sirva de ametralladora contra el buzón de nadie.
- **Intentos de inicio de sesión en ráfaga.** Hay un límite por correo y por
  origen. Superado, se responde con espera, no con silencio.
- **País no seleccionado.** Es obligatorio por FR-001 y se valida en el servidor.
- **Contraseña que cumple el mínimo pero es la palabra "password".** Fuera de
  alcance: el SRD solo fija longitud mínima y no vamos a inventar una política
  que nadie pidió.

## 7. UX / UI

- **Mockups:** `docs/mockups/auth-light.png` y `docs/mockups/auth-dark.png` para
  la pantalla de entrada, en tema claro y oscuro. Las pantallas de registro,
  completar registro y recuperación no tienen mockup propio y siguen el mismo
  lenguaje: panel de marca a la izquierda, formulario a la derecha.
- **Divergencia declarada con el mockup:** el separador "or continue with" y los
  botones de Google y Apple no se implementan. Ver la sección 4.
- **Flujo principal:** entrada, crear cuenta, formulario de registro, completar
  registro si falta algo, panel principal.
- **Flujo del menor:** el registro detecta la edad por la fecha de nacimiento y
  pide los datos del tutor en la misma pantalla de completar registro. El
  consentimiento se recoge en el mismo sitio, con su marca de tiempo.
- **Viewports a soportar:** 375, 768 y 1440.
- Toda pantalla de esta épica lleva la etiqueta `ui-review`.

## 8. Requerimientos no funcionales

- **Contraseñas (NFR-005):** se guardan solo como hash con sal, con un algoritmo
  vigente, y todo el tráfico va por TLS. Lo cumple el servicio de autenticación
  de Supabase. Aquí se declara y se comprueba que no se reimplementa, porque
  escribir el propio hash de contraseñas es un error clásico y caro.
- **Enlaces de recuperación (NFR-007):** un solo uso, 60 minutos de vida.
- **Frontera de sesión (NFR-004):** en el servidor, para el 100% de las
  peticiones.
- **Menores (NFR-012):** sin consentimiento no hay cuenta activa, y por tanto no
  hay tratamiento de sus datos en una cuenta operativa.
- **Alcance por club (NFR-009):** la tabla de miembros lleva `club_id` desde la
  primera migración, igual que el resto del esquema.
- **Rendimiento:** el registro y el inicio de sesión responden por debajo de 1
  segundo en el percentil 95, dentro del objetivo general de NFR-001.
- **Accesibilidad:** sin violaciones de axe. Los formularios llevan etiquetas
  reales, los errores se anuncian, y se puede recorrer todo con teclado.

## 9. Preguntas abiertas

- [x] **¿Hace falta confirmar el correo antes de activar la cuenta?** Resuelto
      el 11 de septiembre de 2026: **sí**. El SRD no lo pedía, pero el correo es
      el canal de recuperación y el de las invitaciones de E5, y una dirección
      sin verificar deja esos dos flujos en nada. Un correo sin confirmar es
      otra razón para que la cuenta siga `incomplete`, no un estado nuevo, en
      línea con la decisión B2. Ver RF-2 y la sección 4.
- [x] **¿Qué proveedor de correo transaccional (INT-006)?** Resuelto el 11 de
      septiembre de 2026: **Resend**. Su plan gratuito da 3.000 correos al mes
      con tope de 100 al día y permite verificar hasta tres dominios sin costo.
      Para un club que manda un correo por alta y alguno por contraseña
      olvidada, sobra. Ver la sección 4.
- [ ] **¿Compra el club un dominio propio?** Es lo único que falta para que el
      correo llegue a un socio real, y cuesta entre 10 y 15 dólares al año. Lo
      decide el dueño. No bloquea seis de los siete tickets; sí bloquea el
      séptimo. Ver la sección 4.
- [ ] **¿A nombre de quién van las cuentas de servicio?** Hoy Supabase, Vercel y
      el monitoreo están a nombre personal del dueño. Antes de que existan socios
      reales conviene pasar todo a un correo del club. No bloquea ningún
      requerimiento de esta épica, pero es más barato ahora que después.
- [ ] **¿Cuál es el límite de intentos de inicio de sesión?** El SRD no fija
      número. La propuesta es apoyarse en el límite que el servicio de
      autenticación ya trae y no escribir uno propio, declarándolo en la
      documentación.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                            | Tamaño | Depende de | Auto-merge sugerido                                           |
| --- | --------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------- |
| 1   | Tabla de miembros con `club_id`, estado de cuenta y sus políticas de acceso | M      | ninguna    | No: es la frontera de seguridad de todos los datos personales |
| 2   | Registro con correo y contraseña, con la cuenta naciendo `incomplete`       | M      | 1          | No: crea cuentas y toca datos personales de menores           |
| 3   | Pantalla de completar registro y paso automático a `active`                 | M      | 2          | No: decide cuándo una cuenta pasa a operar                    |
| 4   | Consentimiento del tutor para registrantes menores de 18                    | M      | 3          | No: obligación legal, y el fallo es silencioso                |
| 5   | Inicio y cierre de sesión, con la frontera de sesión en el servidor         | M      | 1          | No: es la puerta de toda la aplicación                        |
| 6   | Recuperación de contraseña con enlace de un solo uso                        | M      | 5          | No: camino clásico de toma de cuentas                         |
| 7   | Correo transaccional con Resend: remitente verificado y plantillas          | S      | 6          | No: necesita un dominio y una credencial que crea una persona |

Siete tickets, dentro del rango que el plan maestro estimó para esta épica.

**Los siete llevan `ui-review` salvo el 1 y el 7**, que no dibujan pantalla.

**Ninguno es auto-merge, y aquí ni siquiera hay discusión.** Los siete caen de
lleno en la lista de excepciones del propio criterio: autenticación, permisos y
datos personales de menores. El dueño ratifica o veta esta lista en la puerta de
`write-ticket`.

**Aviso sobre lo que un worker headless no puede hacer.** El ticket 7 necesita
una cuenta en Resend, un dominio verificado como remitente y una credencial
pegada como secreto. Eso no lo hace un agente, y ya sabemos cómo termina si lo
intenta. Se escribe con la parte automatizable separada de la manual: el worker
entrega la integración, las plantillas y los tests contra un doble, y se detiene
diciendo exactamente qué falta y dónde va.

**Por qué el 7 va al final y no al principio.** El orden natural diría que el
correo se resuelve antes que la recuperación de contraseña, pero eso ataría los
seis tickets anteriores a la compra de un dominio. Al revés no se ata nada: el
ticket 6 entrega el flujo completo contra un doble de envío, y el 7 cambia ese
doble por el proveedor real cuando el dominio exista. Si el dominio nunca llega,
lo que queda sin entregar es un ticket, no la épica.
