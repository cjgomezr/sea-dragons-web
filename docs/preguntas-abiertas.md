# Preguntas abiertas antes de escribir tickets

Auditoría del `SRD_Victoria_Seadragons_Club_Platform.md` y de `plan-maestro.md`,
hecha durante el bootstrap del repo (22 de agosto de 2026).

Estado: **todo resuelto el 23 de agosto de 2026.** Las decisiones están escritas
en el SRD v1.4 y en el plan maestro; este archivo queda como registro de qué se
preguntó y qué se respondió. Cada punto apunta al FR o AC que lo cierra.

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

### B3 · El jugador no puede editar su propio perfil · E5 · RESUELTO

**Decisión: el miembro edita su ficha, el Admin conserva el registro federativo.**

- Edita el propio miembro: nombre, país, posición, nivel de experiencia, género
  y foto (FR-084, AC-039).
- Reservado al Admin: rol, número y vencimiento AUF, grupos y estado. Un intento
  de cambiarlos desde la propia cuenta se rechaza también por API.
- El país se captura en el alta: FR-001 lo pide en el registro y FR-020 en el
  alta por Admin. Era el campo que el directorio mostraba y nadie recogía.

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
