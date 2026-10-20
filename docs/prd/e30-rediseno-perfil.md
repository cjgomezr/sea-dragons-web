# PRD: E30 · El rediseño del perfil y de la ficha del socio

**Estado:** borrador · **Fecha:** 19 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/design_handoff_profile/`. Contiene el prototipo `Profile Upgrade.dc.html`, su `README.md` de handoff, `support.js` y siete capturas en `screenshots/`. Se construyen **#1a** en escritorio y **#2a** en móvil, por debajo de 768 px, en las tres vistas del selector "Ver como": Yo, Admin y Committee.

Es una épica añadida después del plan. Una sola disposición sirve a dos pantallas:

- el perfil propio (`ProfileScreen`, `src/components/account/*`), de E5 y E17;
- la ficha de un socio (`MemberRecordScreen`, `src/components/directory/MemberRecord*`), de E5 y E19.

Abre la ficha, en lectura, al Committee y al Coach.

El `README.md` del handoff es parte de este PRD. Tiene las medidas, los colores, los textos y la matriz de visibilidad. Cuando no coinciden, manda lo que dice aquí.

Las decisiones van de D1 a D15. D1 a D3 las tomó el dueño el 19 de octubre de 2026. Las demás salen del handoff y del código actual, y el dueño las ratifica al aprobar este PRD.

- **D1.** **El Committee abre la ficha de un socio, en lectura.** Ve el contacto, el contacto de emergencia, la membresía, la asistencia y los grupos. No ve el AUF, la fecha de nacimiento, la evaluación ni el género. Todo lo que escribe sigue siendo solo del Admin.
- **D2.** **La fecha de alta se enseña, pero no se edita.** En "Ficha del club" el Admin edita la fecha de nacimiento, como hoy. La fecha de alta (`joined_on`) es solo lectura, porque decide qué sesiones cuentan en la asistencia.
- **D3.** **El Coach abre la ficha en lectura, como el Committee**, con una diferencia que viene de E19 D5: el correo y el teléfono los ven Admin y Committee, no el Coach. El Coach ve el contacto de emergencia, la membresía, la asistencia y los grupos.
- **D4.** **El género no sale nunca de la cuenta del socio.** Solo lo ve y lo edita él, con el candado "solo tú". La API de la ficha no lo devuelve a nadie.
- **D5.** **Cada tarjeta se lee primero y se edita aparte.** Cada una tiene su Editar, con Guardar y Cancelar, y guarda por su cuenta con los guardados de hoy: `saveOwnProfile` para el socio y `saveMemberRecord` para el Admin. Abrir una tarjeta no abre otra. Si hay una abierta con cambios y se abre otra, se pregunta si se descartan.
- **D6.** **Se conservan las reglas de hoy:** las posiciones ofrecidas y las retiradas, la propuesta de tutor (`emergencyContactProposal`), el aviso de consentimiento del tutor al cambiar la fecha de nacimiento, que un AUF sin tocar no se manda, y `validateFullName` y `contactIssuesOf`.
- **D7.** **Los controles del Admin no cambian, solo se mueven.** `MemberRoleControl` (con su confirmación), `MembershipWaiverControl`, `MemberStatusControl` e `InvitationResend` pasan al menú ⋯ con su misma lógica. "Desactivar" pide confirmación en línea.
- **D8.** **La franja de datos que faltan sustituye a `ContactReminderNotice` en el perfil**, y usa `contactReminderOf`. Por ahora cuenta el contacto de emergencia, el teléfono y el país. Cada ficha de lo que falta abre su tarjeta en edición y pone el foco en su primer campo.
- **D9.** **La asistencia de la tarjeta es la de la temporada**, con las últimas 10, la misma de E27 (D1 y D13): `season_starts_on` (#744) y el cálculo del inicio (#746).
- **D10.** **La evaluación sigue la regla de hoy.** El Admin ve la nota global, la fecha y hasta cuatro categorías, con "Abrir" a la evaluación entera. El socio ve el aviso de que es privada o, si se le enseña, el mismo resumen que la ficha (nota global, fecha y barras) con todas sus categorías, porque no tiene otro sitio donde verlas; sin evaluación, "Sin evaluar". Committee y Coach no la ven en la ficha (D1, D3).
- **D11.** **La ficha amplía su `GET`** con `positionName`, `experienceLevel`, `country`, `role` y `membershipPlan`, y devuelve a cada rol solo su parte (D1, D3, D4). Los `PATCH` siguen siendo solo del Admin.
- **D12.** **"Solicitar un cambio de rol" reutiliza `RoleRequestPanel`.** Con una solicitud pendiente, enseña su estado en lugar del botón.
- **D13.** **Los colores sueltos se vuelven tokens o reutilizan los de E21 a E29.** El degradado de la cabecera va como token. Ningún hex nuevo en las reglas.
- **D14.** **Ningún objetivo táctil baja de 44 px en el móvil.** Los campos miden 48 px con texto de 16 px. El español usa tú.
- **D15.** **Están diseñados el escritorio y el móvil, en tema oscuro.** El corte es 768 px. El tema claro aplica el mismo diseño con los tokens claros, y la tableta usa el de escritorio. Lo que no está dibujado (errores al guardar, socio sin foto, cargando) lo revisa el `ui-reviewer` contra `design-system.md`.

## 1. Problema

El perfil es un formulario siempre abierto: para mirar un dato hay que leerlo dentro de un campo, y un solo Guardar mezcla cambios de partes distintas. No se ve de un vistazo qué falta. La ficha del Admin es otra pantalla con otra forma, y sus acciones (rol, exención, desactivar) van sueltas por la página. El Committee y el Coach no pueden ver la ficha de un socio, aunque necesitan su contacto de emergencia o sus grupos.

## 2. Usuarios y contexto

- **Socio:** mira y completa su perfil, sobre todo desde el móvil.
- **Admin:** abre la ficha desde el directorio para verificar el AUF, corregir datos, cambiar el rol o desactivar.
- **Committee:** consulta el contacto y la membresía de un socio.
- **Coach:** consulta el contacto de emergencia y los grupos, sobre todo en la piscina.
- **Hoy lo resuelven así:** el socio, bajando por un formulario; el Admin, en una página distinta; el Committee y el Coach, sin ficha.

## 3. Objetivo y métricas de éxito

- **Objetivo:** una sola ficha que cada uno lee de un vistazo y edita por partes, con lo que le toca según su rol.
- **Métricas:**
  - Un socio completa el dato que le falta en dos toques desde la franja de arriba.
  - Ningún rol recibe de la API un dato que la matriz no le da: lo comprueban los tests de la API por rol.
  - Nada de lo que hoy guardan el perfil y la ficha se pierde: sus tests de comportamiento siguen pasando, adaptados a las tarjetas.

## 4. Alcance

**Incluido (v1):**

- La cabecera con foto, nombre, rol, "posición · experiencia · país" y fichas de estado.
- Las franjas: datos que faltan (Yo), AUF pendiente con Verificar (Admin), confirmación de desactivar y aviso de guardado.
- Las tarjetas Sobre mí, Contacto, Registro AUF y Ficha del club, con lectura y edición por tarjeta.
- La columna derecha: Membresía, Asistencia, Grupos, Evaluación y Rol.
- Los botones de contacto del staff y el menú ⋯ del Admin.
- La ficha en lectura para Committee y Coach, y su acceso.
- El móvil (#2a), con la hoja inferior del menú ⋯.

**Fuera de alcance (no v1):**

- Editar la fecha de alta (D2).
- Que Committee o Coach editen algo.
- Cambiar el plan de membresía desde el perfil (sigue en Pagos).
- Contar más datos en "lo que falta" que contacto de emergencia, teléfono y país.

## 5. Requerimientos funcionales

### RF-1 · Lo que devuelve la ficha (Must)

- **Dado** un Admin, **cuando** pide la ficha de un socio, **entonces** recibe lo de hoy más `positionName`, `experienceLevel`, `country`, `role` y `membershipPlan`, sin el género.
- **Dado** un Committee, **cuando** la pide, **entonces** recibe nombre, foto, rol, posición, experiencia, país, correo, teléfono, contacto de emergencia, membresía, asistencia y grupos; no recibe AUF, fecha de nacimiento, evaluación ni género.
- **Dado** un Coach, **cuando** la pide, **entonces** recibe lo mismo que el Committee sin correo ni teléfono (D3).
- **Dado** un Player, **cuando** la pide, **entonces** recibe 403.
- **Dado** Committee o Coach, **cuando** mandan cualquier `PATCH` o `POST` de la ficha, **entonces** reciben 403.
- **Dado** Committee o Coach, **cuando** abren `/directorio/{id}`, **entonces** la frontera les deja pasar; hoy los manda fuera.

### RF-2 · Cabecera y franjas (Must)

- **Dado** cualquiera de las vistas, **cuando** se pinta, **entonces** la cabecera lleva la foto de 96 px con su anillo, el nombre en H1, la píldora del rol, "posición · experiencia · país" y las fichas de estado: membresía, AUF (no a Committee ni a Coach) y "Socio desde {mes año}".
- **Dado** el socio en su perfil, **cuando** se pinta, **entonces** la foto lleva el botón de cámara que abre `ProfilePhoto`.
- **Dado** el staff, **cuando** se pinta, **entonces** a la derecha salen los botones de 40 px de correo, llamada y contacto de emergencia, según lo que su rol ve (D3).
- **Dado** el socio con datos que faltan, **cuando** se pinta, **entonces** sale la franja con el anillo de progreso, "Tu perfil está casi completo. Falta:" y una ficha por dato que abre su tarjeta en edición con el foco en su primer campo; con todo completo, no sale.
- **Dado** el Admin y un AUF sin verificar, **cuando** se pinta, **entonces** sale la franja "{nombre} añadió el AUF **{número}** (vence el {fecha}). Revísalo y verifícalo." con Verificar AUF (`verifyMemberRecordAuf`).
- **Dado** cualquier guardado correcto, **cuando** termina, **entonces** sale el aviso de esa tarjeta ("Sobre mí guardado", "Contacto guardado", "AUF verificado") con `role="status"`.

### RF-3 · Sobre mí y Contacto (Must)

- **Dado** Sobre mí en lectura, **cuando** se pinta, **entonces** es una lista `dl` en dos columnas: nombre, país, posición y experiencia, y el género con candado solo para el socio.
- **Dado** el socio, **cuando** pulsa Editar en Sobre mí, **entonces** la tarjeta lleva borde de acento y campos para nombre, país, posición (con la retirada marcada), experiencia (segmento de tres) y género ("solo tú"), con Cancelar y Guardar.
- **Dado** Contacto en lectura, **cuando** se pinta, **entonces** salen el teléfono en mono con el correo debajo, y el contacto de emergencia "{nombre} · {relación}" con su teléfono, o "Aún no añadido" en aviso.
- **Dado** el socio o el Admin, **cuando** pulsan Editar en Contacto, **entonces** salen el teléfono, "CONTACTO DE EMERGENCIA", nombre y relación lado a lado, y su teléfono, con la propuesta de tutor de hoy.
- **Dado** Guardar con un error de validación, **cuando** vuelve, **entonces** la tarjeta sigue abierta con el error en su campo.
- **Dado** Cancelar, **cuando** se pulsa, **entonces** la tarjeta vuelve a lectura sin cambios y el foco vuelve a su Editar.

### RF-4 · AUF y Ficha del club (Must)

- **Dado** el socio o el Admin, **cuando** se pinta Registro AUF, **entonces** salen número (mono), vencimiento ("{fecha} · en {n} días", en aviso si faltan menos de 90) y estado (Verificado o Pendiente).
- **Dado** el socio, **cuando** el AUF no está verificado, **entonces** puede proponerlo o editarlo; verificado, es lectura con "Verificado por el club. Pide a un Admin que lo cambie."
- **Dado** el Admin, **cuando** se pinta, **entonces** Registro AUF lleva "🔒 Admin" y se edita como hoy.
- **Dado** el Admin, **cuando** se pinta Ficha del club, **entonces** salen la fecha de nacimiento ("{fecha} · {edad}"), que edita con el aviso de consentimiento de hoy, y la fecha de alta, solo lectura (D2).
- **Dado** Committee o Coach, **cuando** se pinta, **entonces** no salen Registro AUF ni Ficha del club.

### RF-5 · La columna derecha (Must)

- **Dado** cualquier vista, **cuando** se pinta Membresía, **entonces** salen el plan y "Activa · se renueva el {fecha}" (o su estado); el socio ve además "Pagos".
- **Dado** cualquier vista, **cuando** se pinta Asistencia, **entonces** salen "Esta temporada", el porcentaje, "{n} de {m} sesiones" y "Últimas 10" con su leyenda (D9); sin sesiones, "Todavía no hay sesiones esta temporada.".
- **Dado** Grupos, **cuando** se pinta, **entonces** salen como fichas; el Admin tiene "Editar", que abre `GroupsField`.
- **Dado** Evaluación, **cuando** se pinta, **entonces** sigue D10.
- **Dado** el socio, **cuando** se pinta Rol, **entonces** sale "Rol · {rol}", "¿Coach o committee? Pídeselo a un Admin." y Solicitar, o el estado de su solicitud pendiente (D12).

### RF-6 · El menú ⋯ del Admin (Must)

- **Dado** el Admin, **cuando** pulsa ⋯, **entonces** se abre un menú de 260 px con Cambiar rol (con el rol actual), Eximir de la cuota, Reenviar invitación (solo con la cuenta `incomplete`) y, tras una línea, Desactivar socio en peligro; se cierra como el menú de cuenta.
- **Dado** cada opción, **cuando** se elige, **entonces** hace lo de hoy con su control (D7).
- **Dado** Desactivar, **cuando** se elige, **entonces** sale la franja de confirmación "¿Desactivar a {nombre}? No podrá entrar. Su historial se queda y puedes reactivarlo después." con Cancelar y Desactivar.

### RF-7 · El móvil (Must)

- **Dado** menos de 768 px, **cuando** se pinta, **entonces** hay una barra de 52 px con volver (44 px), el título ("Mi perfil" o "Socio") y, para el Admin, ⋯ (44 px).
- **Dado** el móvil, **cuando** se pinta la cabecera, **entonces** va centrada, con la foto de 96 px, el nombre de 22 px, "rol · posición · experiencia" y las fichas; el staff tiene debajo tres botones iguales de 48 px.
- **Dado** el móvil, **cuando** se pintan las tarjetas, **entonces** las filas de lectura miden al menos 46 px (58 en Contacto), Editar tiene 44 px, y en edición los campos son de 48 px con texto de 16 px y Cancelar y Guardar de 48 px.
- **Dado** el móvil, **cuando** se pintan, **entonces** Asistencia y Membresía van lado a lado, y el AUF es una fila de 58 px.
- **Dado** el Admin en el móvil, **cuando** pulsa ⋯, **entonces** sale una hoja inferior con filas de 52 px y Desactivar en peligro tras una línea.
- **Dado** 320 px, **cuando** se pinta cada vista, **entonces** no hay scroll horizontal.

## 6. Casos borde y estados de error

- **Socio sin foto:** sus iniciales.
- **Sin posición, sin país o sin experiencia:** "—" en lectura, y cuentan en lo que falta solo los de D8.
- **Socio dado de baja (inactivo):** la ficha lo dice y el menú ofrece Reactivar en lugar de Desactivar, como hoy.
- **Guardar falla por red:** la tarjeta sigue abierta con el aviso y lo escrito.
- **Dos tarjetas:** abrir otra con cambios sin guardar pregunta (D5).
- **Menor de edad:** la propuesta de tutor y el aviso de consentimiento de hoy.
- **Idioma:** todos los textos nuevos en `en.ts` y `es.ts`.

## 7. UX / UI

- Diseño: `docs/design/design_handoff_profile/` (#1a escritorio, #2a móvil; capturas 01 a 07). La captura 04 enseña la ficha AUF al Committee; manda el texto (D1): sin ficha AUF.
- Viewports a revisar: 375, 768 y 1440, en claro y oscuro.
- El `ui-reviewer` compara contra las capturas (Modo A) y revisa contra `design-system.md` lo no dibujado, incluida la vista del Coach.

## 8. Requerimientos no funcionales

- **Seguridad:** la proyección por rol se hace en el servidor; el género nunca sale de la cuenta del socio; todas las escrituras de la ficha siguen exigiendo `manageUsersAndRoles`.
- **Accesibilidad:** WCAG AA, axe sin violaciones en cada vista, foco al abrir y cerrar cada tarjeta, el menú y la hoja.
- **Dependencias:** ninguna nueva.

## 9. Preguntas abiertas

Ninguna. Las que dejaba el handoff (el Committee) y las que salieron al leerlo (la fecha de alta y el Coach) las decidió el dueño el 19 de octubre de 2026 (D1 a D3).

## 10. Descomposición en tickets (para write-ticket)

Todos con `ui-review`, salvo el 1.

| #   | Título propuesto                                                              | Tamaño | Depende de | Auto-merge sugerido             |
| --- | ----------------------------------------------------------------------------- | ------ | ---------- | ------------------------------- |
| 1   | Abre la ficha del socio en lectura a Committee y Coach y amplía lo que trae   | M      | ninguna    | No: permisos y datos personales |
| 2   | Rehace la cabecera del perfil y de la ficha con sus franjas                   | M      | 1          | No: pantalla nueva              |
| 3   | Pasa Sobre mí y Contacto a tarjetas que se leen y se editan por separado      | M      | 2          | No: cambia cómo se guarda       |
| 4   | Pasa el AUF y la ficha del club a tarjetas                                    | S      | 3          | No: datos del Admin             |
| 5   | Rehace la columna derecha con membresía, asistencia, grupos, evaluación y rol | M      | 2, #746    | No: pantalla nueva              |
| 6   | Junta las acciones del Admin en el menú ⋯ con los botones de contacto         | M      | 2          | No: desactivar y cambiar rol    |
| 7   | Pinta la ficha en lectura para Committee y Coach                              | S      | 1, 3, 4, 5 | No: lo que ve cada rol          |
| 8   | Lleva el perfil y la ficha al móvil con la hoja del menú ⋯                    | M      | 3 a 7      | No: pantalla nueva              |
