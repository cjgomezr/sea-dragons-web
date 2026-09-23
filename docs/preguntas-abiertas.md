# Preguntas abiertas antes de escribir tickets

Auditoría del `SRD_Victoria_Seadragons_Club_Platform.md` y de `plan-maestro.md`,
hecha durante el bootstrap del repo (22 de agosto de 2026).

Estado: **todo lo auditado entonces quedó resuelto el 23 de agosto de 2026.**
Las decisiones están escritas en el SRD v1.4 y en el plan maestro; este archivo
queda como registro de qué se preguntó y qué se respondió. Cada punto apunta al
FR o AC que lo cierra.

**Abierto después:** B5, el 16 de septiembre de 2026, que bloquea los tickets de
E12, y B6, el 22 de septiembre de 2026, que bloquea los de E18b.

---

## 1. Bloqueadores: un ticket no se puede escribir sin esto

### B1 · La membresía Family no está especificada · E12 · RESUELTO

**Decisión: Family sale de Release 1.** El club lanza con tres tipos, Full $45,
Student $32 y Casual $15 por sesión. No se diseña ni se construye modelo de
vínculo familiar: una familia se afilia como membresías individuales.

Escrito en FR-062, FR-009, §3.2, §9 (entidad Membership), ASS-011 e INT-001. Con
esto desaparece la decisión más cara de la auditoría y E12 encoge.

Lo que queda registrado para cuando Family vuelva: quién crea el vínculo, si los
familiares tienen cuenta propia, qué pasa al fallar el pago del titular y cómo se
sale a plan individual. Nada de eso se decide ahora.

### B2 · El registro con Google y Apple no puede cumplir el propio registro · E2 · RESUELTO

**Decisión: un único estado `incomplete`.** Toda cuenta nace `incomplete` hasta
que estén los datos que exigen FR-001, FR-009 y FR-081 y, si aplica, el
consentimiento de FR-082. Una cuenta `incomplete` solo alcanza la pantalla de
completar registro y el cierre de sesión, incluso por API directa. Pasa a
`active` en cuanto no falta nada.

No son dos estados. El bloqueo por falta de datos y el bloqueo por falta de
consentimiento (NFR-012) son el mismo, lo que evita la máquina de estados doble
que insinuaba el SRD v1.3.

Escrito en FR-083, AC-038 y en la nota de NFR-012.

**Apostilla del 11 de septiembre de 2026.** Google y Apple se aplazan a
Release 2, así que en Release 1 el único camino que llega a la pantalla de
completar registro es el de correo y contraseña. La decisión de un único estado
sigue en pie y no cambia: FR-083 la pide igual para ese camino, y es justo la
pieza que un proveedor externo necesitará el día que entre. El motivo del
aplazamiento y el momento de retomarlo están en
`docs/prd/e2-autenticacion-cuentas.md`.

### B3 · El jugador no puede editar su propio perfil · E5 · RESUELTO

**Decisión: el miembro edita su ficha, el Admin conserva el registro federativo.**

- Edita el propio miembro: nombre, país, posición, nivel de experiencia, género
  y foto (FR-084, AC-039).
- Reservado al Admin: rol, número y vencimiento AUF, grupos y estado. Un intento
  de cambiarlos desde la propia cuenta se rechaza también por API.
- El país se captura en el alta: FR-001 lo pide en el registro y FR-020 en el
  alta por Admin. Era el campo que el directorio mostraba y nadie recogía.

**Ajustado el 22 de septiembre de 2026:** el miembro puede escribir su propio
número de AUF y su vencimiento, pero quedan **sin verificar** hasta que un
Admin los confirme, y una vez verificados solo el Admin los corrige. El resto
de lo reservado (rol, grupos y estado) sigue igual. Está en el PRD de E5 como
RF-12.

**Baja de miembro, que era el hueco relacionado: entra en Release 1.** FR-085 y
AC-040. Un Admin mueve el estado entre `active` e `inactive`. El inactivo no
inicia sesión, sale del directorio salvo filtro explícito, no es targeteable y
conserva su historial.

### B4 · Dos números clave no tienen definición · E8, E9, E10 · RESUELTO

**Porcentaje de asistencia.** `(Present + Late) / sesiones elegibles`, donde
elegible es un evento de tipo Training que targeteaba al miembro y cuya fecha es
posterior o igual a su fecha de alta. Redondeo al entero. Con cero sesiones
elegibles se muestra "sin datos", nunca 0%. Quien entró en mayo ya no arrastra
marzo. Escrito en FR-042, AC-017 y AC-017b.

**OVR del no evaluado.** Opción (b): entra al auto-balance con 5.0 calculado al
vuelo, sin persistir ninguna evaluación, y la interfaz lo marca "sin evaluar". No
se crean evaluaciones fantasma ni se obliga al coach a asignar a mano. Escrito en
FR-086 y AC-053.

### B5 · Qué significa elegir membresía antes de pagarla · E12 · SIN RESOLVER

**Qué se observó.** Al probar el registro en producción (16 de septiembre de
2026), quien se registra elige su tipo de membresía y, en cuanto confirma el
correo y completa los datos, su cuenta queda `active` y usa toda la aplicación
sin haber pagado nada.

**Por qué no es un error.** FR-009 pide elegir la membresía durante el alta, y la
historia de usuario de unirse al club "en menos de un minuto" lo pide en un solo
paso. `active` es el estado de la **cuenta** (FR-083 y la decisión B2): significa
que puede operar, no que haya pagado. El PRD de E2 lo dejó escrito: el tipo de
membresía "se captura y se guarda, pero no se cobra nada"
(`docs/prd/e2-autenticacion-cuentas.md`). Hoy no existe nada de cobro: es E12.

**Qué ya prevé el SRD.** La entidad `Membership` (§9) tiene su propio `status`,
distinto del `status` de la entidad `Member`, y lo actualizan los webhooks de
Stripe (INT-002, FR-071). O sea, el SRD sí separa "cuenta activa" de "membresía
al día". Lo que no hace es definir la segunda.

**Lo que hay que decidir antes de escribir los tickets de E12:**

1. **Qué estados tiene una membresía.** El SRD solo usa "Active" como ejemplo
   (FR-065, AC-025, AC-027). Falta la lista completa (por ejemplo: pendiente de
   primer pago, activa, con pago fallido, vencida) y qué evento de Stripe mueve
   de uno a otro.
2. **Qué puede hacer un miembro cuya membresía no está al día.** El SRD solo prevé
   la alerta y el reintento (FR-070, FR-071). No dice si conserva el calendario,
   el RSVP y el directorio, o si solo ve el aviso de pago.
3. **Qué pasa entre el registro y el primer cobro.** Si se paga durante el alta,
   al entrar por primera vez, o hay un plazo. Y cómo encaja Casual, que no tiene
   cobro recurrente sino packs prepagados (FR-063, FR-064).

**Qué no se toca mientras tanto.** El registro sigue pidiendo la membresía y
activando la cuenta como hoy. Decidirlo ahora sería adelantar trabajo: no hay
nada que cobrar hasta E12.

### B6 · De quién son las cuentas de cada instalación · E18b · SIN RESOLVER

**De dónde sale.** El 22 de septiembre de 2026 el dueño decidió vender la
licencia a otros clubes con un modelo de **un club por instalación** (E18): cada
club tiene su propio despliegue y su propia base, en vez de compartir una
aplicación multi-cliente. Ese modelo necesita un procedimiento de alta de clubes
y otro de publicación de versiones, y los dos dependen de una decisión de
negocio que nadie ha tomado.

**La pregunta.** Las cuentas de Supabase, Vercel, Resend y Stripe de cada
instalación, ¿son del club o del dueño?

- **Del club:** el club paga su infraestructura directamente (hoy, unos 45
  dólares al mes entre Vercel Pro y Supabase Pro) y cobra a sus miembros con su
  propio Stripe. A cambio tiene acceso a todo, y es más difícil controlar la
  licencia y que actualice cuando sale una versión.
- **Del dueño:** la infraestructura va dentro de la cuota de la licencia y las
  versiones se publican desde un solo sitio. A cambio la factura, el soporte de
  la infraestructura y el riesgo son del dueño. Stripe es aparte en este caso:
  el dinero de las cuotas de los miembros tiene que llegar al club, no al dueño.

**Por qué bloquea.** Cambia qué hace el script de alta (crear cuentas o pedir
acceso a las del club) y el de publicación (desplegar desde una cuenta o desde
varias). Se decide antes de escribir los tickets de E18b.

**Acotado el 23 de septiembre de 2026.** El dueño prefiere decidirlo más
adelante, así que E18 se partió (ver `docs/plan-maestro.md`): B6 bloquea sólo a
E18b, el alta de clubes y la publicación de versiones. E18a, que saca la marca
del código y hace configurables las posiciones de juego, no depende de esta
respuesta y se trabaja ya. Lo que sigue en pie: sin E18b no se puede operar de
verdad el modelo de un club por instalación, así que esta decisión es condición
para el primer cliente.

### B7 · Un Coach que también juega · E7, E8, E9, E10 · RESUELTO

**De dónde sale.** El 23 de septiembre de 2026, preparando la reunión con el
equipo, salió la pregunta: en el club hay gente que entrena a otros y además
juega. ¿Necesitan dos roles?

**Decisión: un rol por persona, el que le da los permisos.** El rol responde a
"qué puede hacer en la aplicación", no a "qué es en el club". Quien entrena y
además juega es Coach, porque jugar no da ningún permiso extra: confirmar
asistencia a un evento, ver el calendario y pagar la membresía los alcanza
cualquier miembro. Se mantienen los cuatro roles de FR-012 y AC-048, y E3 no se
toca.

**La regla que se deriva, y es lo que de verdad importa:**

> **La participación sale del RSVP y de los grupos, nunca del rol.**

Los tickets de E7, E8 y E10 nacen con esto:

- **E7 y E8:** quién juega una sesión sale de quién confirmó asistencia. Un
  Coach que confirma cuenta como cualquier otro, y su porcentaje de asistencia
  se calcula igual.
- **E10:** los equipos se arman con quienes confirmaron asistencia a ese evento.
  Filtrar por rol `Player` dejaría fuera al Coach que juega, y eso sí sería un
  fallo.
- **E4:** si algún día hace falta distinguir quién entrena de quién dirige, es
  un grupo ("Coaching staff"), no un rol. Una persona está en varios grupos; de
  rol solo tiene uno.

**Consecuencia asumida, que el club conoce.** Las evaluaciones solo las ven
Admin y Coach, ni siquiera el jugador ve la suya (FR-055, AC-023). Un Coach que
juega verá su propia evaluación. Se acepta: es personal de entrenamiento.

**Por qué se descartó multi-rol.** Obliga a definir qué pasa cuando los permisos
se cruzan, a rehacer las reglas de la base de datos de E3, las solicitudes de
rol y su auditoría, y la pantalla de administración. Todo eso para expresar algo
que en permisos ya está resuelto.

---

## 2. Contradicciones internas del SRD

### C1 · FR-053 contra AC-035 · E9 · RESUELTO

**Gana AC-035: el set de categorías de una evaluación guardada es inmutable.**
Editar ratings no migra nada. Para llevar una evaluación vieja al set actual hay
una acción explícita, "actualizar al set actual", que la reconstruye: las
categorías nuevas entran en 5, las desactivadas se descartan y el OVR se
recalcula. FR-053 reescrita, AC-054 nueva.

### C2 · FR-046 pide dos objetivos que se pelean · E10 · RESUELTO

FR-046 reescrita con prioridad explícita:

1. Cobertura de posición como restricción dura donde la escuadra lo permita.
2. Mínima diferencia de puntaje combinado sujeta a lo anterior.
3. Tamaños que no difieran en más de un jugador.

Y con el algoritmo escrito, no dejado a interpretación del worker: orden
descendente por OVR, reparto en serpiente, y luego el intercambio de a un par que
más reduzca la diferencia, repetido hasta que ninguno mejore o se agote el
presupuesto de tiempo de NFR-002. Escuadra impar: el sobrante va al equipo de
menor puntaje combinado.

AC-019 reescrita para verificar eso mismo, AC-019b para la escuadra impar y
AC-019c para el límite de 2 segundos con 30 jugadores.

### C3 · Casual no encaja en el modelo de cobro mensual · E12, E13 · RESUELTO

- FR-063 excluye a Casual del cargo recurrente de forma explícita.
- FR-065: el panel de un Casual muestra saldo de sesiones y "sin cargo
  recurrente" en lugar de próxima fecha de cargo.
- FR-087, nueva: al pasar de Casual a plan mensual el saldo prepago se congela.
  Ni se reembolsa ni se pierde, no se decrementa mientras el plan mensual esté
  vigente y vuelve a gastarse si el miembro regresa a Casual. De mensual a Casual
  se arranca en cero. AC-041 lo verifica.

---

## 3. FRs sin criterio de aceptación · RESUELTO

Las siete huérfanas ya tienen AC propia, y las cuatro que solo tenían cobertura
de refilón también:

| FR     | Qué es                                        | AC nueva |
| ------ | --------------------------------------------- | -------- |
| FR-047 | Swap sugerido en el team builder              | AC-042   |
| FR-066 | Cambio de plan al siguiente ciclo             | AC-043   |
| FR-043 | Dividir la escuadra en dos equipos con nombre | AC-044   |
| FR-054 | Editar una evaluación existente               | AC-045   |
| FR-033 | Vista agenda                                  | AC-046   |
| FR-022 | Asistencia en el perfil propio                | AC-047   |
| FR-012 | Exactamente cuatro roles                      | AC-048   |
| FR-026 | Asignar miembros a grupos                     | AC-049   |
| FR-027 | Grupos como audiencia                         | AC-050   |
| FR-029 | Los cuatro tipos de evento                    | AC-051   |
| FR-032 | Filtrado por audiencia                        | AC-052   |

El "Orphan check" de §15 dejó de afirmar que todo estaba cubierto y ahora declara
qué faltaba y dónde se cubrió.

---

## 4. Huecos del plan maestro

### P1 · El plan nunca declara el stack · RESUELTO

El stack quedó escrito en "Decisiones técnicas transversales" del plan maestro:
Next.js 16 (App Router), TypeScript estricto, Supabase, Stripe desde E12, puerto 3417. Ya no es una suposición que hay que deducir de las rutas.

### P2 · Cuatro NFRs no tienen epic · RESUELTO

- **NFR-011 (Privacy Act 1988)** es ahora el epic **E15, Privacidad y datos
  personales**: aviso de privacidad en el registro, exportación de datos, borrado
  o anonimización dentro de 30 días y política de retención tras la baja.
- NFR-001 y NFR-008 se verifican con la prueba de carga de E16, NFR-003 con el
  monitoreo del hosting. Escrito en el propio texto de cada NFR, para que ningún
  ticket funcional cargue con ellos.

### P3 · Falta la infraestructura de trabajos programados · RESUELTO

`pg_cron` de Supabase, dentro del epic **E16**. De ahí cuelgan la generación de
ocurrencias recurrentes (FR-031) y el aviso previo a la renovación (FR-072).

### P4 · No hay epic de despliegue · RESUELTO

También **E16**: entornos, hosting, secretos por entorno y aplicación de
migraciones en CI. E2 y E7 dependen de él.

### P5 · Detalles menores · RESUELTO

- La columna "Issue" del plan apunta a los issues reales creados el 23 de agosto.
- Rutas `data/SRD_...md` corregidas a `docs/` durante el bootstrap.
- AC-036 y AC-037 quedaron en orden.
- §3.2 cita FR-033 para la vista agenda, que es la correcta.

---

## 5. Falta el prototipo de diseño · RESUELTO

`Seadragons Platform.dc.html` y su runtime `support.js` ya están en `docs/`. De
ahí salen los tokens de marca reales (acento `#1C6EA4` claro y `#33A1E0` oscuro,
fondo `#EFF3F7` y `#0C1A26`, tipografías Archivo, Space Grotesk y Space Mono) y
las pantallas contra las que compara el `ui-reviewer`.

Dos tickets de E1 lo bajan a tierra: uno aplica los tokens a `design-system.md` y
`globals.css`, otro exporta cada pantalla del prototipo a `docs/mockups/` para que
el revisor trabaje en modo comparación y no en modo heurístico.
