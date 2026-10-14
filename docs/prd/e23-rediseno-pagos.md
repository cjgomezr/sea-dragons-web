# PRD: E23 · El rediseño de Pagos

**Estado:** borrador · **Fecha:** 14 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/design_handoff_payments/` (el prototipo `Payments Upgrade.dc.html`, su `README.md` de handoff, `support.js` y cinco capturas en `screenshots/`). Se construyen **1a** en escritorio y **2a**, **2b** y **2c** en móvil, por debajo de 768 px. La **1b** es una exploración descartada y no se construye. Es una épica añadida después del plan. Cambia cómo se presenta E12 y E13 en `/pagos`, y les añade tres cosas: el recibo de cada pago, comprar varias unidades de un extra y la venta de extras ya cerrados.

El `README.md` del handoff es parte de este PRD: tiene las medidas, los colores, los textos y cada estado. Lo que dice aquí manda sobre él cuando no coinciden.

Las decisiones van marcadas como D1 a D13. D1, D2, D3, D4 y D13 las tomó el dueño el 14 de octubre de 2026; D5 la delegó.

- **D1.** **Los levies pasan a ser "extras del club", opcionales.** Nada vence ni queda pendiente. Se quitan la lista de quién falta, el recuento de faltantes y su columna en el CSV. El SRD no los pedía (FR-069 solo pide listar, cobrar y apuntar en el historial); los añadió E13.
- **D2.** **Un extra se puede comprar en varias unidades** (buzos, camisetas). Cada extra lo decide en Stripe con `metadata.seadragons_max_quantity`: sin ese dato, o con `1`, se compra una vez por socio, como hoy (una inscripción a un torneo). Con un número mayor, el socio elige la cantidad en Stripe Checkout (`adjustable_quantity`) y puede volver a comprar más tarde.
- **D3.** **No se muestra lo recaudado.** Ni en la lista ni en el detalle. Para el dinero está el panel de Stripe, que además sabe de reembolsos y comisiones. La app enseña unidades vendidas y quién compró.
- **D4.** **El método y el motivo del fallo se guardan a partir de ahora.** El webhook apunta la marca y los cuatro últimos dígitos de la tarjeta de cada cobro, y el motivo cuando falla. Los pagos anteriores a E23 no los tienen y muestran "—"; no se rellenan desde Stripe.
- **D5.** **Los extras cerrados siguen visibles para el Admin y el Committee.** Un extra archivado en Stripe deja de venderse, pero sus compradores hacen falta después (entregar las camisetas, contar a los de la cena). La pestaña los lista en un apartado "Cerrados", debajo de los que están a la venta, si tienen al menos una venta.
- **D6.** **El recibo se resuelve al pedirlo.** Ya se guardan `stripe_invoice_id` y `stripe_charge_id` en cada pago. Un endpoint nuevo devuelve la URL en el momento, porque las de Stripe caducan: la `hosted_invoice_url` de la factura para la membresía, y el `receipt_url` del cobro para extras y packs. No se activa `invoice_creation` en Checkout, porque Stripe lo cobra aparte. No se añade `receiptUrl` a `PaymentView`, contra lo que sugiere el handoff.
- **D7.** **La lista de extras del admin sale de un solo endpoint de resumen** con las unidades vendidas y los compradores de cada extra, abiertos y cerrados. El handoff pedía `loadLevyPayers` al elegir cada fila, pero la tabla enseña los totales de todas las filas desde el principio. Los compradores de un extra se piden al elegirlo y se guardan por extra, como dice el handoff.
- **D8.** **Un pago fallido se reintenta desde el aviso de arriba** (`MembershipNotice`, #474), no desde la fila del historial. La fila enseña el motivo y nada más.
- **D9.** Están diseñados el **escritorio y el móvil, en tema oscuro**. El corte es 768 px. El tema claro aplica el mismo diseño con los tokens claros, y la tableta usa el de escritorio. Los estados que el móvil no dibuja (Casual con packs, exención, pendiente, esperando a Stripe) llevan en la tarjeta del plan lo mismo que la tira de escritorio, apilado. Sin mockup propio, el `ui-reviewer` los revisa contra `design-system.md`, como en E21 y E22.
- **D10.** **Los colores sueltos ya son tokens desde E21 y E22:** `--color-hover` (`#1a3349`), `--color-segment-selected` (`#1d4869`) y `--color-editor-bar` (`#0f2131`, la cabecera de tabla). Se reutilizan; si un nombre no encaja con su uso aquí, se renombra en un solo sitio, sin duplicar el color.
- **D11.** **Ningún objetivo táctil baja de 44 px**, como E22 D11. Lo que el handoff dibuja más pequeño (la fila del extra a 40 px) llega a 44 px de zona táctil.
- **D12.** **El español usa tú, no vos,** como el resto de `es.ts`: "Opcional · compra lo que necesites", no "comprá".
- **D13.** **Un extra puede pedir una talla (u otra opción) al comprarlo.** El comité lo decide en Stripe con `metadata.seadragons_options` (por ejemplo `S,M,L,XL`). Checkout enseña un desplegable obligatorio con esas opciones (`custom_fields`, sin coste extra en Stripe), y el webhook guarda la opción elegida en el pago. Es una opción por compra: dos M y una L son dos compras. La etiqueta del desplegable es un solo texto de Stripe y no sigue el idioma de la interfaz.

## 1. Problema

Pagos es una columna de tarjetas grandes donde se mezcla lo de cada socio con lo de la junta: un Admin ve, debajo de cada levy, la tabla de quién pagó y quién falta. El historial es una lista plana sin agrupar, sin filtro y sin recibo, así que un socio que necesita el comprobante de una cuota tiene que pedírselo al tesorero. Los levies se presentan como deudas ("faltan 12"), cuando el club los quiere vender como algo opcional. Y no se puede vender ropa: cada levy se compra una sola vez por socio.

## 2. Usuarios y contexto

- **Cualquier socio, sobre todo desde el móvil:** mira su plan y su próximo cobro, compra extras y busca un recibo.
- **Admin y Committee, desde el portátil:** quieren saber cuántos se vendieron de cada extra y a quién entregárselos.
- **Hoy lo resuelven así:** el recibo lo saca el tesorero del panel de Stripe y lo manda por correo. Las tallas y las cantidades de ropa se apuntan por WhatsApp y se cobran como varios levies o en efectivo.

## 3. Objetivo y métricas de éxito

- **Objetivo:** separar lo personal de la gestión, que cada socio tenga sus recibos sin pedirlos, y poder vender más de una unidad de un extra.
- **Métricas:**
  - Un socio abre el recibo de cualquier pago cobrado en un clic desde el historial.
  - Un socio compra tres unidades de un extra con varias unidades en un solo Checkout, y el historial y la lista de compradores dicen 3.
  - Ningún miembro sin `viewLevyPayers` ve la pestaña de extras ni recibe sus datos: un test de la API y otro de la pantalla lo comprueban.
  - Nada de lo que hoy hacen E12 y E13 desaparece: los tests de comportamiento existentes siguen pasando, adaptados a la estructura nueva sin quitarles casos (salvo los de la lista de faltantes, que D1 quita).

## 4. Alcance

**Incluido (v1):**

- Las pestañas Mi membresía y Extras del club, con la pestaña en la URL (`?tab=extras`).
- La tira del plan en escritorio y la tarjeta del plan en móvil, con todos los estados que hoy tiene `PlanCard`.
- Los extras del socio en filas compactas, con Comprar, Comprado y la cantidad comprada.
- El historial agrupado por mes, con filtro, método, motivo del fallo, recibo y exportar a CSV.
- Guardar método y motivo del fallo en cada pago nuevo (D4).
- Comprar varias unidades (D2) y elegir talla u otra opción al comprar (D13).
- La pestaña de extras del Admin y el Committee, con lista, detalle, compradores, CSV y extras cerrados (D5).
- El móvil 2a, 2b y 2c, con la hoja inferior del detalle.
- Tema claro y tableta (D9), inglés y español.

**Explícitamente fuera (por ahora):**

- Lo recaudado y cualquier cifra de dinero agregada (D3).
- Recordatorios, faltantes y progreso contra un total (D1).
- Más de una opción por compra (tallas distintas en un mismo Checkout) y más de un desplegable por extra.
- Stock o unidades máximas a la venta.
- Reembolsos desde la app.
- Rellenar el método de los pagos antiguos (D4).
- Crear o editar extras desde la app: siguen creándose en Stripe (FR-069).
- La exploración 1b del prototipo.

## 5. Requerimientos funcionales

Para medidas, colores y textos de cada pieza, ver el `README.md` del handoff. Cada RF se cumple en inglés y en español, en claro y oscuro, a 375, 768 y 1440.

### RF-1 · Las pestañas de Pagos · Must

Lo personal y la gestión van separados.

- **Dado** un miembro con `viewLevyPayers` (Admin, Committee), **cuando** abre Pagos, **entonces** ve la barra Mi membresía | Extras del club, con el número de extras a la venta en la segunda, y abre en Mi membresía.
- **Dado** un miembro sin ese permiso, **cuando** abre Pagos, **entonces** no hay barra de pestañas y ve el contenido de Mi membresía.
- **Dado** un miembro sin ese permiso, **cuando** abre `/pagos?tab=extras`, **entonces** ve Mi membresía y no se pide ningún dato de ventas.
- **Dado** un Admin, **cuando** cambia de pestaña, **entonces** la URL refleja `?tab=extras` o la quita, y recargar o volver atrás deja la misma pestaña.
- **Dado** el móvil, **cuando** un Admin abre Pagos, **entonces** la barra es un control segmentado de dos partes y 44 px de zona táctil.

### RF-2 · La tira del plan · Must

El plan cabe en una fila en escritorio y en una tarjeta en móvil, sin perder ningún estado.

- **Dado** un socio con plan activo, **cuando** abre Mi membresía, **entonces** ve el nombre del plan, la etiqueta de estado (`CHIP_TONES`), el precio por mes, el próximo cobro y la tarjeta ("Visa •••• 4242 · exp 08/28"), con Cambiar plan y Actualizar tarjeta a la derecha.
- **Dado** un socio con exención, Casual, pendiente, eligiendo plan o esperando a Stripe, **cuando** abre Mi membresía, **entonces** ve lo mismo que hoy (`PlanDetails`, `PlanChoice`, `PendingOffer`, `SubscriptionWaitStatus`, Volver a suscribirse según `PlanActions`) dentro de la tira o de la tarjeta.
- **Dado** un socio Casual, **cuando** abre Mi membresía, **entonces** ve las sesiones que le quedan y los botones de los packs en la propia tira, sin tarjeta aparte.
- **Dado** la vuelta de Stripe (suscripción, tarjeta, pack, extra), **cuando** el socio regresa a Pagos, **entonces** ve los mismos avisos y esperas de hoy.
- **Dado** el móvil, **cuando** se ve la tarjeta, **entonces** lleva el nombre y el estado, dos líneas con icono y los dos botones lado a lado de 44 px.

### RF-3 · Guardar el método y el motivo del fallo · Must

El historial puede decir con qué se pagó y por qué falló (D4).

- **Dado** un cobro de membresía, de pack o de extra, **cuando** el webhook lo apunta, **entonces** guarda la marca y los cuatro últimos dígitos de la tarjeta del cobro.
- **Dado** un cobro de membresía fallido, **cuando** el webhook lo apunta, **entonces** guarda el motivo legible que da Stripe (por ejemplo "Your card was declined."), o nada si Stripe no lo da.
- **Dado** un pago anterior a E23, **cuando** se lee, **entonces** el método y el motivo son nulos y la migración no falla ni lo toca.
- **Dado** el webhook repetido para el mismo evento, **cuando** llega, **entonces** no duplica el pago ni cambia lo guardado (la idempotencia de `stripe_events` sigue igual).
- **Dado** la migración, **cuando** se aplica dos veces, **entonces** no falla (`apply-migrations.test.ts`).

### RF-4 · El recibo de cada pago · Must

Cada pago cobrado tiene su comprobante en Stripe, sin coste extra (D6).

- **Dado** un pago de membresía cobrado, **cuando** el socio pide su recibo, **entonces** el endpoint devuelve la `hosted_invoice_url` de su factura.
- **Dado** un pago de extra o de pack cobrado, **cuando** el socio pide su recibo, **entonces** el endpoint devuelve el `receipt_url` del cobro.
- **Dado** un pago de otro socio, **cuando** alguien pide su recibo, **entonces** el endpoint responde 404, también para un Admin.
- **Dado** un pago fallido o pendiente, o Stripe sin URL, **cuando** se pide el recibo, **entonces** responde 404 y la fila no enseña el icono.
- **Dado** el icono del recibo, **cuando** el socio lo pulsa, **entonces** se abre en una pestaña nueva (`target="_blank" rel="noopener"`).
- **Dado** Stripe sin configurar o caído, **cuando** se pide el recibo, **entonces** el socio ve un error con su texto en los dos idiomas, y el resto de la pantalla sigue funcionando.

### RF-5 · El historial agrupado y filtrado · Must

Cada pago se encuentra rápido.

- **Dado** pagos de varios meses, **cuando** el socio abre el historial, **entonces** van agrupados por mes, del más reciente al más antiguo, con el nombre del mes en el idioma de la interfaz.
- **Dado** el filtro, **cuando** el socio elige Todos, Pagados o Fallidos, **entonces** solo quedan esos pagos y los meses vacíos desaparecen; Pendientes solo aparece si hay alguno.
- **Dado** un filtro sin resultados, **cuando** se aplica, **entonces** se ve "No payments match this filter." / su traducción.
- **Dado** un pago, **cuando** se muestra, **entonces** lleva fecha, descripción, método (o "—"), importe en mono a la derecha y estado como punto y palabra, nunca solo color.
- **Dado** un pago fallido con motivo, **cuando** se muestra, **entonces** el motivo va en rojo debajo de la descripción.
- **Dado** un extra comprado en varias unidades, **cuando** se muestra, **entonces** la descripción dice la cantidad ("2026 club jersey × 3").
- **Dado** Exportar CSV, **cuando** el socio lo pulsa, **entonces** descarga desde el navegador un CSV con fecha, descripción, método, importe (AUD) y estado de los pagos que deja ver el filtro.
- **Dado** el móvil, **cuando** se ve el historial, **entonces** cada fila mide al menos 56 px con el círculo de estado, la descripción con la fecha y el motivo, y el importe con el estado; tocar una fila cobrada abre su recibo.
- **Dado** un socio Casual, **cuando** abre el historial, **entonces** `SessionActivity` sigue debajo, con el mismo estilo de tabla.
- **Dado** un socio sin pagos, **cuando** abre el historial, **entonces** ve el estado vacío de hoy, sin filtro ni exportar.

### RF-6 · Comprar varias unidades · Must

Un extra puede venderse en cantidad (D2).

- **Dado** un extra sin `seadragons_max_quantity` o con `1`, **cuando** el socio lo compra, **entonces** el Checkout es de una unidad, y después la fila dice "Comprado" sin botón, como hoy.
- **Dado** un extra con `seadragons_max_quantity` = 10, **cuando** el socio pulsa Comprar, **entonces** Checkout le deja elegir entre 1 y 10 unidades.
- **Dado** ese Checkout cobrado con 3 unidades, **cuando** llega el webhook, **entonces** el pago se apunta con cantidad 3 e importe total, en un solo registro.
- **Dado** un socio que ya compró 3 de un extra de varias unidades, **cuando** vuelve a Pagos, **entonces** la fila dice "Comprado × 3" y el botón Comprar sigue disponible.
- **Dado** un valor de `seadragons_max_quantity` no válido (texto, 0, negativo), **cuando** se lee el catálogo, **entonces** el extra se trata como de una unidad y no rompe la lista.
- **Dado** un pago de extra anterior a E23, **cuando** se lee, **entonces** cuenta como una unidad.

### RF-7 · Los extras del socio · Must

Comprar un extra es una fila, no una tarjeta.

- **Dado** extras a la venta, **cuando** el socio abre Mi membresía, **entonces** ve la etiqueta "Extras del club" con la pista "Opcional · compra lo que necesites" y una fila por extra: nombre, descripción en una línea, "Comprado el {fecha}" si lo compró, precio y acción.
- **Dado** Comprar, **cuando** el socio lo pulsa, **entonces** abre Stripe Checkout con `requestLevyCheckout`, como hoy.
- **Dado** ningún extra a la venta, **cuando** se abre Mi membresía, **entonces** el apartado no aparece.
- **Dado** el móvil, **cuando** se ve el apartado, **entonces** cada fila mide al menos 56 px, con nombre, precio y Comprar o Comprado a la derecha.

### RF-8 · El resumen de ventas para la gestión · Must

Los números de todos los extras llegan en una llamada (D7).

- **Dado** un Admin o Committee, **cuando** pide el resumen, **entonces** recibe cada extra a la venta y cada extra cerrado con al menos una venta, con nombre, descripción, precio, unidades vendidas y número de compradores, y si está abierto o cerrado.
- **Dado** cualquier otro rol, **cuando** pide el resumen o los compradores de un extra, **entonces** responde 403.
- **Dado** los compradores de un extra (abierto o cerrado), **cuando** se piden, **entonces** llegan nombre, correo, unidades y fecha de cada compra, sin lista de faltantes (D1).
- **Dado** un socio que compró el mismo extra dos veces, **cuando** se listan los compradores, **entonces** aparece una fila por compra, y las unidades vendidas las suman.
- **Dado** Stripe sin configurar, **cuando** se pide el resumen, **entonces** responde como hoy el listado de levies (`stripe_not_configured`), y la pestaña lo explica.

### RF-9 · La pestaña de extras en escritorio · Must

Ver qué se vendió y a quién, sin cifras de dinero (D3).

- **Dado** extras, **cuando** un Admin abre la pestaña, **entonces** ve la línea "{n} extras a la venta · creados por el comité en Stripe" y la tabla EXTRA · PRECIO · VENDIDOS, con el primero elegido.
- **Dado** una fila, **cuando** el Admin la elige con clic o teclado, **entonces** queda marcada (fondo y barra de acento) y el panel enseña nombre, descripción, precio, las fichas Vendidos y Compradores, la lista de compradores y Exportar CSV.
- **Dado** extras cerrados con ventas, **cuando** se ve la pestaña, **entonces** van en un apartado "Cerrados" debajo de la tabla, con la misma fila y el mismo panel.
- **Dado** Exportar CSV, **cuando** se pulsa, **entonces** descarga con `levyPayersCsv` y `saveFile` nombre, correo, unidades, fecha e importe, sin columnas de faltantes.
- **Dado** un extra ya pedido, **cuando** se vuelve a elegir, **entonces** no se pide otra vez.
- **Dado** ningún extra, ni abierto ni cerrado, **cuando** se abre la pestaña, **entonces** se ve un estado vacío que dice que los extras se crean en Stripe.

### RF-10 · La pestaña de extras en móvil · Must

Lo mismo, con la hoja inferior.

- **Dado** el móvil, **cuando** un Admin abre la pestaña, **entonces** ve la línea de cabecera y filas de al menos 64 px con nombre y precio, unidades vendidas y una flecha.
- **Dado** una fila, **cuando** la toca, **entonces** se abre la hoja inferior (reutilizando `directory/BottomSheet.tsx`) con el detalle, las fichas, los compradores con scroll y Exportar CSV de 46 px.
- **Dado** la hoja abierta, **cuando** el Admin la arrastra, pulsa Escape o toca fuera, **entonces** se cierra y el foco vuelve a la fila.

### RF-11 · La talla al comprar · Should

Vender ropa sin apuntar tallas por WhatsApp (D13).

- **Dado** un extra con `seadragons_options` = `S,M,L,XL`, **cuando** el socio pulsa Comprar, **entonces** Checkout le pide elegir una de esas opciones antes de pagar, y no deja pagar sin elegir.
- **Dado** un extra sin `seadragons_options`, **cuando** se compra, **entonces** Checkout no enseña ningún desplegable, como hoy.
- **Dado** ese Checkout cobrado con la opción M, **cuando** llega el webhook, **entonces** el pago se apunta con la opción M.
- **Dado** un pago con opción, **cuando** el socio lo ve en su historial, **entonces** la descripción la incluye ("2026 club jersey × 2 · M").
- **Dado** un extra con opciones, **cuando** un Admin abre su detalle, **entonces** ve las unidades vendidas por opción ("S: 4 · M: 9 · L: 6"), y la lista de compradores y el CSV llevan una columna con la opción.
- **Dado** un valor de `seadragons_options` vacío, con más de 200 opciones o con opciones repetidas o en blanco, **cuando** se lee el catálogo, **entonces** se descartan las vacías y repetidas, y si no queda ninguna el extra se vende sin desplegable.
- **Dado** el comité que cambia las opciones en Stripe después de vender, **cuando** se ve el detalle, **entonces** las compras antiguas conservan la opción que eligieron, aunque ya no esté en la lista.

## 6. Casos borde y estados de error

- **Sin Stripe configurado:** Mi membresía se ve como hoy (`paymentsConfigured`), sin extras ni recibos. La pestaña de extras dice que Stripe no está configurado.
- **Historial largo:** se carga entero, como hoy. Con cientos de pagos los grupos por mes siguen funcionando; paginar queda fuera.
- **Extra borrado en Stripe** (no archivado): sus compras siguen en el historial con su descripción; en "Cerrados" aparece con el nombre guardado en el pago.
- **Nombre del extra cambiado en Stripe:** la lista de gestión usa el nombre actual; el historial del socio, la descripción con la que pagó.
- **Compra en dos pestañas a la vez de un extra de una unidad:** sigue el rechazo `levy_already_paid` de hoy en la segunda; si las dos llegan a cobrarse, se apuntan las dos y el Admin las ve.
- **Cantidad máxima cambiada en Stripe entre la lista y el pago:** manda lo que Stripe cobró.
- **Opción con un texto largo o raro:** se guarda tal cual la devolvió Stripe y se muestra recortada con elipsis; en el CSV va completa.
- **Webhook sin datos de tarjeta** (otro método de pago): el método se guarda nulo y se muestra "—".
- **Fallo al cargar los compradores:** el panel muestra el error y un Reintentar; la lista sigue.
- **Fallo al pedir el recibo:** aviso en línea, sin perder el filtro.
- **Permisos:** la pestaña se decide en el servidor (`viewLevyPayers`), y los dos endpoints de gestión responden 403 por su cuenta, no solo porque la interfaz los esconda.

## 7. UX / UI

- Mockups: `docs/design/design_handoff_payments/` (1a, 2a, 2b, 2c). Las capturas se copian a `docs/mockups/` como `payments-redesign-*-dark.png` y `mobile-payments-redesign-*-dark.png`.
- Flujos:
  1. Socio: abre Pagos, ve su plan, compra un extra en Checkout, vuelve, lo ve como comprado y su recibo en el historial.
  2. Admin: abre Pagos, cambia a Extras del club, elige un extra, ve compradores y exporta el CSV.
- Viewports a soportar: 375 / 768 / 1440.
- Iconos de Phosphor (ya instalado): `calendar-blank`, `credit-card`, `currency-dollar`, `download-simple`, `receipt`, `check`, `x`, `check-circle`, `caret-right`.

## 8. Requerimientos no funcionales

- Rendimiento: el resumen de ventas responde en una sola llamada, con una lectura a Stripe por petición y no una por extra.
- Accesibilidad: cumple `design-system.md` (axe sin violaciones). Las pestañas son `tablist`; el estado nunca va solo en color; el panel y la hoja mueven el foco y lo devuelven.
- Seguridad: el recibo solo se resuelve para pagos del propio socio (RLS de `payments` y comprobación en el endpoint). Los compradores y el resumen solo para `viewLevyPayers`. Ningún secreto de Stripe sale al cliente.
- Sin dependencias nuevas.

## 9. Preguntas abiertas

- Ninguna bloquea. D1 a D4 y D13 las decidió el dueño y D5 la delegó.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                     | Tamaño | Depende de | Auto-merge sugerido                                 |
| --- | ------------------------------------------------------------------------------------ | ------ | ---------- | --------------------------------------------------- |
| 1   | Separa Pagos en Mi membresía y Extras del club, con la pestaña en la URL             | S      | ninguna    | No: decide quién ve la pestaña de gestión           |
| 2   | Rehace la tira del plan en escritorio y la tarjeta del plan en móvil                 | M      | 1          | No: toca los flujos de suscripción, tarjeta y packs |
| 3   | Guarda el método y el motivo del fallo de cada pago                                  | M      | ninguna    | No: migración y webhook de cobros                   |
| 4   | Abre el recibo de Stripe de cada pago cobrado                                        | M      | ninguna    | No: endpoint nuevo sobre pagos, con permisos        |
| 5   | Rehace el historial con grupos por mes, filtro, método, recibo y CSV                 | M      | 1, 3, 4    | No: área de pagos                                   |
| 6   | Permite comprar varias unidades de un extra                                          | M      | 3          | No: lógica de cobro y webhook                       |
| 7   | Rehace los extras del socio en filas, con Comprar, Comprado y la cantidad            | S      | 1, 6       | No: área de pagos                                   |
| 8   | Añade el resumen de ventas y los compradores sin faltantes, con los extras cerrados  | M      | 6          | No: endpoints de gestión con permisos               |
| 9   | Rehace la pestaña de extras en escritorio con la lista, el detalle y los compradores | M      | 1, 8       | No: área de pagos                                   |
| 10  | Lleva la pestaña de extras al móvil con la hoja del detalle                          | S      | 9          | No: área de pagos                                   |
| 11  | Pide la talla al comprar un extra y la enseña en el historial y en los compradores   | M      | 6, 8       | No: lógica de cobro y webhook                       |

Orden sugerido: 1, 3 y 4 van en paralelo al principio. El 6 espera al 3 porque los dos tocan el webhook. Después 2, 5, 7 y 8, después 9 y 10, y el 11 al final, cuando ya existen la cantidad y la lista de compradores.
