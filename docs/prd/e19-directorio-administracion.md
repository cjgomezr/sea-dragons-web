# PRD: E19 · El directorio para la administración

**Estado:** aprobado · **Fecha:** 5 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: la conversación con el dueño del 4 y el 5 de octubre de 2026. Es una épica añadida después del plan (ver `docs/plan-maestro.md`) y amplía la E5 (directorio y perfiles). El SRD v1.6 la recoge en FR-088 a FR-093, con sus criterios AC-055 a AC-060. `docs/preguntas-abiertas.md` no tiene nada pendiente sobre ella.

Las decisiones que tomó el dueño van marcadas como D1 a D8:

- **D1.** El teléfono propio es opcional.
- **D2.** El contacto de emergencia (nombre, teléfono y relación) es obligatorio, pero no bloquea nada: no se pide al crear la cuenta, se completa en el perfil y un aviso que no se puede cerrar lo recuerda en el inicio y en el perfil.
- **D3.** El teléfono propio tampoco se pide al crear la cuenta. Su aviso sí se puede cerrar.
- **D4.** En un menor, el contacto de emergencia propuesto es su tutor.
- **D5.** El correo y el teléfono de un socio los ven Admin y Committee. El contacto de emergencia lo ven Admin, Committee y Coach, porque el Coach es quien está en la piscina.
- **D6.** La exportación es solo CSV, sin librerías nuevas. Excel lo abre directamente.
- **D7.** Los correos se mandan desde la propia aplicación, a los socios que se elijan en el directorio.
- **D8.** El directorio puede mandar como mucho 50 correos cada 24 horas. El resto del cupo de Resend queda para los correos de cuenta.

## 1. Problema

El directorio enseña lo que el club comparte con todos (FR-015), pero no sirve para administrar. Un Admin o alguien del comité que tiene que avisar a un grupo de socios no tiene a mano ni su correo ni su teléfono. Tampoco puede sacar en un minuto la lista de quién tiene el AUF vencido o de quién juega de Forward, porque hoy el único filtro es el rol. Y si alguien se lesiona en la piscina, nadie sabe a quién llamar: la aplicación no guarda ningún contacto de emergencia.

## 2. Usuarios y contexto

- **Admin, sobre todo desde el portátil:** lleva el registro federativo y las cuotas. Necesita listas filtradas (AUF vencido, membresía pendiente, sin contacto de emergencia), escribirles y, a veces, pasar la lista a una hoja de cálculo.
- **Committee, desde el portátil o el móvil:** organiza eventos y comunicaciones. Necesita el contacto de los socios y mandarles un correo a un grupo.
- **Coach, desde el móvil en la piscina:** si alguien se lesiona, necesita llamar a su contacto de emergencia con un toque.
- **Cualquier socio:** completa su teléfono y su contacto de emergencia en el perfil cuando la aplicación se lo recuerda.
- **Hoy lo resuelven así:** el Admin abre la ficha de cada socio una por una, copia los correos a mano a su programa de correo y lleva los teléfonos en un grupo de WhatsApp o en una hoja aparte. El contacto de emergencia no existe en ningún sitio.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que Admin y Committee encuentren, contacten y exporten a cualquier subconjunto de socios sin salir de la aplicación, y que el club tenga un contacto de emergencia por socio.
- **Métricas:**
  - Un Admin saca la lista de socios con el AUF vencido y la descarga en CSV en menos de 30 segundos.
  - A los 60 días del lanzamiento, el 90% de los socios activos tiene contacto de emergencia.
  - Un Committee manda un correo a un grupo filtrado en menos de 2 minutos sin abrir otro programa.
  - Cero correos de cuenta (invitación, confirmación, recuperación de contraseña) bloqueados por culpa de un envío desde el directorio.

## 4. Alcance

**Incluido (v1):**

- El teléfono propio y el contacto de emergencia en el perfil, con su aviso en el inicio y en el perfil.
- El contacto de cada socio en el directorio y en la ficha, según el rol de quien mira.
- Filtros nuevos y combinables en el directorio: posición, grupo, AUF, estado de la membresía, sin teléfono y sin contacto de emergencia.
- Exportar a CSV la lista que se está viendo.
- Mandar un correo a los socios de la lista desde la aplicación.

**Explícitamente fuera (por ahora):**

- Pedir el teléfono o el contacto de emergencia al crear la cuenta (D2, D3).
- Bloquear el RSVP, el pago o cualquier pantalla por no tener contacto de emergencia (D2).
- Exportar a `.xlsx` o a PDF (D6).
- SMS o WhatsApp desde la aplicación.
- Guardar el historial de correos enviados dentro de la aplicación. Queda en la bitácora (NFR-010), sin pantalla propia.
- Adjuntos, formato rico o plantillas en el correo: es texto plano.
- Darse de baja de los correos del club. Son mensajes operativos del club a sus socios, no publicidad (ver la sección 9).
- Que Committee vea el AUF o el estado de la membresía (ver la sección 9).

## 5. Requerimientos funcionales

### RF-1 · Teléfono y contacto de emergencia en el perfil · Must

Cada socio guarda en su perfil su teléfono (opcional, D1) y su contacto de emergencia: nombre, teléfono y relación (D2).

- **Dado** el perfil propio, **cuando** el socio lo abre, **entonces** ve una sección "Contacto" con su teléfono y su contacto de emergencia (nombre, teléfono y relación).
- **Dado** un teléfono escrito con espacios, guiones, paréntesis o un `+` inicial, **cuando** se guarda, **entonces** se acepta si quedan entre 8 y 15 dígitos, y si no, el campo dice qué está mal.
- **Dado** un contacto de emergencia con solo alguno de sus tres datos, **cuando** se guarda, **entonces** se rechaza con el aviso junto al campo que falta: el contacto va entero o no va.
- **Dado** un menor con tutor registrado (FR-082), **cuando** abre su contacto de emergencia vacío, **entonces** el formulario propone el nombre de su tutor y la relación "Tutor"; el teléfono lo tiene que escribir, porque del tutor solo se guarda el correo (D4).
- **Dado** el registro y el completar registro, **cuando** se miran, **entonces** no piden ni el teléfono ni el contacto de emergencia (D2, D3).
- **Dado** `PATCH` al perfil propio con estos campos, **cuando** se guarda, **entonces** responde el perfil actualizado; un socio no puede escribir el contacto de otro.

### RF-2 · Avisos mientras falte · Must

Un aviso en el inicio y en el perfil recuerda lo que falta, sin bloquear nada.

- **Dado** un socio activo sin contacto de emergencia, **cuando** abre el inicio o el perfil, **entonces** ve un aviso que lo explica ("Para que el club sepa a quién llamar si te pasa algo en la piscina") con un enlace a completarlo, y el aviso no se puede cerrar (D2).
- **Dado** un socio sin teléfono propio y con contacto de emergencia, **cuando** abre el inicio o el perfil, **entonces** ve un aviso del teléfono que sí se puede cerrar; cerrado, no vuelve en ese navegador.
- **Dado** que faltan los dos, **cuando** se pinta el inicio, **entonces** se ve un solo aviso que pide los dos y el enlace lleva a la sección "Contacto" del perfil.
- **Dado** un socio con los dos datos, **cuando** abre el inicio, **entonces** no ve ningún aviso.
- **Dado** el aviso, **cuando** se pinta, **entonces** no bloquea el RSVP, Pagos ni ninguna otra pantalla.

### RF-3 · El contacto en el directorio y en la ficha según el rol · Must

Quien puede verlo, lo ve donde trabaja: en el directorio y en la ficha (D5).

- **Dado** un Admin o un Committee, **cuando** abre el directorio, **entonces** cada socio enseña su correo, su teléfono y su contacto de emergencia.
- **Dado** un Coach, **cuando** abre el directorio, **entonces** cada socio enseña su contacto de emergencia y nada más de lo de contacto.
- **Dado** un Player, **cuando** abre el directorio o pide su API, **entonces** no recibe ni el correo, ni el teléfono, ni el contacto de emergencia de nadie: la respuesta del servidor no los incluye.
- **Dado** un teléfono en la pantalla, **cuando** se toca en el móvil, **entonces** llama (`tel:`); un correo abre el programa de correo (`mailto:`).
- **Dado** un Admin en la ficha de un socio, **cuando** la abre, **entonces** ve y puede corregir el teléfono y el contacto de emergencia (por ejemplo, si se los pasaron por mensaje), y el cambio queda en la bitácora.
- **Dado** un dato que falta, **cuando** se pinta, **entonces** sale su etiqueta con un guion, como el resto del directorio.

### RF-4 · Filtros del directorio · Must

Filtros nuevos que se combinan entre sí y con la búsqueda y el rol que ya existen. Cada uno solo lo ve quien puede ver el dato que filtra.

- **Dado** cualquier socio, **cuando** abre el directorio, **entonces** puede filtrar por posición del catálogo del club.
- **Dado** un Admin, un Coach o un Committee (los que gestionan grupos), **cuando** abre el directorio, **entonces** puede filtrar por grupo.
- **Dado** un Admin, **cuando** abre el directorio, **entonces** puede filtrar por AUF (sin número, vencido, vence en los próximos 30 días, sin verificar) y por estado de la membresía (pendiente, en prueba, activa, pago fallido, cancelada, exenta).
- **Dado** un Admin o un Committee, **cuando** abre el directorio, **entonces** puede filtrar por "sin teléfono" y "sin contacto de emergencia".
- **Dado** varios filtros, **cuando** se aplican, **entonces** el directorio enseña los socios que cumplen todos a la vez, y dice cuántos son.
- **Dado** unos filtros elegidos, **cuando** se recarga la página o se comparte la dirección, **entonces** se mantienen, porque viven en la URL.
- **Dado** `GET /api/v1/directory` con un filtro que el rol de quien pide no tiene, **cuando** llega, **entonces** 403 con `reason`; con un valor desconocido, 400 con `reason`.
- **Dado** un filtro sin resultados, **cuando** se aplica, **entonces** el directorio lo dice y ofrece quitar los filtros.

### RF-5 · Exportar la lista a CSV · Must

Admin y Committee descargan en CSV la lista que están viendo (D6).

- **Dado** un Admin o un Committee con el directorio filtrado, **cuando** pulsa "Exportar CSV", **entonces** descarga un archivo con una fila por cada socio de la lista y las columnas que su rol ve en la pantalla.
- **Dado** el archivo, **cuando** se abre en Excel, **entonces** los acentos salen bien (UTF-8 con BOM) y las cabeceras están en el idioma de quien exporta.
- **Dado** un dato que empieza por `=`, `+`, `-` o `@`, **cuando** se escribe en el CSV, **entonces** va escapado para que Excel no lo ejecute como fórmula.
- **Dado** el nombre del archivo, **cuando** se descarga, **entonces** lleva el club y la fecha del día en Melbourne.
- **Dado** una exportación, **cuando** se hace, **entonces** la bitácora guarda quién exportó, cuándo, con qué filtros y cuántos socios.
- **Dado** un Coach o un Player, **cuando** pide la exportación por la API, **entonces** 403 con `reason`, y la pantalla no le ofrece el botón.

### RF-6 · Mandar un correo desde el directorio · Must

Admin y Committee escriben un correo a los socios de la lista y la aplicación lo manda (D7).

- **Dado** un Admin o un Committee con el directorio filtrado, **cuando** pulsa "Escribir correo", **entonces** se abre un formulario con los destinatarios (la lista actual, a la que puede quitar socios), el asunto y el mensaje en texto plano.
- **Dado** el asunto vacío o de más de 150 caracteres, o el mensaje vacío o de más de 5.000, **cuando** se intenta enviar, **entonces** se rechaza con el aviso junto al campo.
- **Dado** el formulario completo, **cuando** pulsa enviar, **entonces** un diálogo confirma a cuántos socios va antes de mandar nada.
- **Dado** el envío, **cuando** sale, **entonces** cada socio recibe su propio correo, sin ver las direcciones de los demás. Sale desde la dirección del club, con respuesta a la dirección de quien lo escribió.
- **Dado** el correo, **cuando** se arma, **entonces** el asunto y el mensaje van tal como se escribieron, y el pie ("Te escribe {nombre}, {rol} de {club}") va en el idioma de cada destinatario.
- **Dado** el envío terminado, **cuando** se pinta el resultado, **entonces** dice cuántos se mandaron y, si alguno falló, a quiénes.
- **Dado** un envío, **cuando** se hace, **entonces** la bitácora guarda quién lo mandó, cuándo, el asunto y a cuántos socios (el cuerpo no se guarda).
- **Dado** las cuentas dadas de baja, **cuando** se arma la lista de destinatarios, **entonces** se quedan fuera aunque estén en el filtro.
- **Dado** un Coach o un Player, **cuando** pide el envío por la API, **entonces** 403 con `reason`.

### RF-7 · El envío no deja sin correos de cuenta · Must

Los correos de cuenta (invitación, confirmación, recuperación) salen del mismo cupo del proveedor y no pueden quedarse sin él.

- **Dado** los envíos del directorio de las últimas 24 horas, **cuando** se calcula cuántos caben, **entonces** son 50 menos los ya mandados por el directorio (D8), y los correos de cuenta conservan su propio cupo sin que el directorio les reste.
- **Dado** un envío con más destinatarios de los que caben, **cuando** se intenta, **entonces** no se manda nada y el formulario dice cuántos caben hoy, para que reduzca la lista o espere.
- **Dado** el proveedor caído o sin configurar, **cuando** se intenta enviar, **entonces** no se manda nada y se dice que el envío no está disponible ahora.
- **Dado** dos envíos a la vez, **cuando** se cuentan contra el cupo, **entonces** entre los dos no pasan de lo que cabe.

## 6. Casos borde y estados de error

- **Club sin socios que cumplan el filtro:** el directorio lo dice. Exportar y escribir correo quedan deshabilitados con el motivo.
- **Socio sin correo confirmado:** recibe el correo igual; su correo es el de su cuenta.
- **Invitación pendiente (cuenta `incomplete`):** aparece en el directorio y en los filtros. Recibe correos del directorio, porque ya es del club.
- **Teléfono con prefijo internacional o local:** se guarda tal como se escribió, sin espacios sobrantes. Solo se valida el número de dígitos; no se convierte de formato.
- **Contacto de emergencia igual al propio teléfono:** se acepta, pero el formulario avisa de que debería ser otra persona.
- **Menor que cumple 18 años:** su contacto de emergencia sigue siendo el que tenga; no se borra.
- **Un socio se da de baja mientras otro escribe un correo:** sale de los destinatarios al enviar, no al abrir el formulario.
- **Dos Admin corrigen el contacto de la misma ficha a la vez:** gana el último que guarda, como el resto de la ficha, y los dos cambios quedan en la bitácora.
- **Lista de exportación vacía:** no se descarga un archivo vacío; el botón está deshabilitado.
- **Nombres con comas, comillas o saltos de línea:** el CSV los entrecomilla como pide el formato.
- **Envío que falla a medias:** los que salieron, salieron. El resultado dice a quiénes no llegó, y reintentar solo a esos es mandar otro correo con esa lista.
- **Doble clic en enviar:** se manda una sola vez.
- **Permisos que cambian:** si a un Committee le quitan el rol con el formulario abierto, el servidor rechaza el envío con 403.

## 7. UX / UI

- **Mockups:** `docs/mockups/directory-light.png` y `directory-dark.png` para la forma de la lista, las tarjetas y los controles. Los filtros nuevos, el formulario de correo y el aviso del inicio no están dibujados: revisión heurística contra `design-system.md`.
- **Flujos principales:**
  1. El Admin abre el directorio, elige "AUF: vencido" y "Posición: Forward", ve cuántos son, pulsa "Exportar CSV" o "Escribir correo".
  2. El socio ve el aviso en el inicio, toca "Completar", llega a la sección "Contacto" del perfil, guarda y el aviso desaparece.
  3. El Coach, en la piscina, busca al socio en el directorio y toca el teléfono de su contacto de emergencia para llamar.
- **Filtros en el móvil:** detrás de un botón "Filtros" con el número de filtros activos, en una hoja que se abre desde abajo. En escritorio, en la barra sobre la tabla.
- **Viewports:** 375 / 768 / 1440, claro y oscuro, en inglés y español.

## 8. Requerimientos no funcionales

- **Seguridad:** el correo, el teléfono y el contacto de emergencia se filtran en el servidor según el rol (NFR-004), nunca solo en la pantalla. Las columnas nuevas viven en `members`, que hoy solo deja leer la fila propia por la API de datos (`members_select_own`); el directorio sigue leyendo con la llave de servicio y decide qué devuelve.
- **Privacidad:** el contacto de emergencia es un dato de un tercero. El aviso de privacidad de la E15 tiene que mencionarlo.
- **Bitácora:** exportar, enviar un correo y corregir el contacto de otro dejan entrada (NFR-010).
- **Rendimiento:** el directorio filtrado responde en menos de 500 ms p95 con 500 socios (NFR-001). La exportación tarda menos de 2 segundos con 500 socios.
- **Accesibilidad:** axe sin violaciones en el directorio con filtros abiertos, el formulario de correo, el diálogo de confirmación y los avisos (`design-system.md`). Los botones de llamar y los filtros cumplen 44 px en el móvil.
- **Idiomas:** todos los textos nuevos en los dos catálogos (E17).
- **Dependencias:** ninguna nueva. El CSV se escribe a mano y el correo usa el emisor de Resend que ya existe.

## 9. Preguntas abiertas

- [ ] **Plan de Resend.** El plan gratuito da 100 correos al día, compartidos con los correos de cuenta, y hoy el cupo propio corta en 80. Un correo a todo el club no cabe con margen. RF-7 deja al directorio en 50 correos cada 24 horas (D8), pero si se van a mandar correos a todo el club a menudo, hace falta un plan de pago. La decisión es del dueño, y no bloquea los tickets.
- [ ] **¿Committee ve el AUF y el estado de la membresía?** Hoy solo los ve el Admin (BR-008, #453), y este PRD lo deja así: Committee no tiene esos filtros ni esas columnas en el CSV. La decisión es del dueño.
- [ ] **Baja de los correos del club.** Este PRD trata los correos como mensajes operativos del club a sus socios, sin enlace para darse de baja. Si el comité quiere usarlos para promociones o patrocinadores, la ley australiana de spam pide ese enlace. La decisión es del comité.
- [x] **SRD v1.6.** Resuelto: el SRD añade FR-088 a FR-093 con AC-055 a AC-060, y deja escrito en la sección 3.2 y en ASS-009 que esta exportación no es la del panel que la v1.2 sacó del alcance.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                                | Tamaño | Depende de | Auto-merge sugerido                                      |
| --- | ----------------------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------------------- |
| 1   | Guarda el teléfono y el contacto de emergencia en el perfil (RF-1)                              | M      | ninguna    | No: datos personales nuevos y migración                  |
| 2   | Avisa en el inicio y en el perfil mientras falte el contacto (RF-2)                             | S      | 1          | No: comportamiento nuevo en el inicio                    |
| 3   | Enseña el contacto en el directorio y en la ficha según el rol, y sus dos filtros (RF-3, RF-4)  | M      | 1          | No: permisos por rol sobre datos personales              |
| 4   | Filtra el directorio por posición, grupo, AUF y membresía, combinables y en la URL (RF-4)       | M      | ninguna    | No: lógica nueva y permisos por filtro                   |
| 5   | Exporta a CSV la lista filtrada del directorio (RF-5)                                           | S      | 3, 4       | No: datos personales que salen de la aplicación          |
| 6   | Manda un correo desde el directorio, sin tocar la reserva de los correos de cuenta (RF-6, RF-7) | M      | 4          | No: envía correos a socios y gasta el cupo del proveedor |

Carriles: 1 y 4 arrancan a la vez. Detrás de 1 van 2 y 3, en paralelo. 5 y 6 cierran. Los filtros de contacto ("sin teléfono", "sin contacto de emergencia") van en el ticket 3 y no en el 4, para que el 4 no espere al 1.

Conflictos a vigilar: el ticket 1 trae migración y el 4 puede traerla (para el filtro por grupo). Si corren a la vez, el que entre segundo renumera. Los tickets 3, 4, 5 y 6 tocan la misma pantalla del directorio: mejor que no corran los cuatro a la vez.
