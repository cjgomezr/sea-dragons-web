# Preguntas abiertas antes de escribir tickets

Auditoría del `SRD_Victoria_Seadragons_Club_Platform.md` (v1.3) y de
`plan-maestro.md`, hecha durante el bootstrap del repo (22 de agosto de 2026).

Este archivo NO decide nada. Lista lo que hay que resolver, con las opciones
concretas sobre la mesa y el epic al que pega cada una. Cuando una decisión se
tome, va escrita al SRD o al plan maestro, y su fila se marca resuelta aquí.

Estado: **nada resuelto todavía.**

---

## 1. Bloqueadores: un ticket no se puede escribir sin esto

### B1 · La membresía Family no está especificada · E12

FR-062 ofrece Family a $70 AUD/mes "cubriendo hasta 4 miembros". La sección 9
lo admite: `Family: covers up to 4 linked Members [TBD]: linking model`. No hay
FR que describa el vínculo, ni AC que lo verifique.

Hay que decidir:

- ¿Quién crea el vínculo? ¿El titular invita por email, o un Admin los enlaza?
- ¿Los 3 familiares tienen cuenta propia con rol Player, o son dependientes sin
  login?
- Si tienen cuenta: ¿aparecen en el directorio? ¿pueden hacer RSVP? ¿cuentan
  para la asistencia y las evaluaciones?
- ¿Qué pasa cuando el titular cancela o le falla el pago? ¿Se suspenden los 4?
- ¿Un familiar puede salirse y pasarse a plan individual?

Sin esto, E12 queda a medio construir. Es la decisión más cara de las cuatro.

### B2 · El registro con Google y Apple no puede cumplir el propio registro · E2

FR-009 exige elegir membresía en el sign-up. FR-081 exige fecha de nacimiento.
FR-082 exige consentimiento de tutor si el registrante es menor. Google y Apple
(FR-004, FR-005) no entregan nada de eso.

Hace falta un paso de "completar registro" post-OAuth que ningún FR describe.
Hay que decidir:

- ¿La cuenta existe en estado incompleto hasta que se complete, o no se crea
  hasta terminar el paso?
- ¿Qué puede ver o hacer una cuenta incompleta? Lo natural es nada salvo esa
  misma pantalla.
- ¿Cómo se relaciona ese estado con el bloqueo por consentimiento de NFR-012,
  que también impide activar la cuenta? ¿Son el mismo estado o dos distintos?

Salen de aquí 1 o 2 FRs nuevas, sus ACs y probablemente un ticket propio.

### B3 · El jugador no puede editar su propio perfil · E5

La matriz de permisos de la sección 4 le da al Player "manage own profile",
pero ninguna de las 82 FRs lo permite. Solo el Admin crea miembros (FR-020).

La consecuencia es concreta: el directorio muestra país, posición y nivel de
experiencia (FR-015), el auto-registro (FR-001) no captura ninguno de los tres,
y **el país no se captura en ningún sitio, ni siquiera en el alta por Admin**.
Todo el que se registre solo queda con su ficha a medias y sin forma de
arreglarla.

Hay que decidir:

- Qué campos edita el propio miembro y cuáles quedan reservados al Admin. El
  número y el vencimiento AUF, por ejemplo, son registro federativo.
- Dónde se captura el país.
- Si el auto-registro pide posición y experiencia, o se completan después.

Relacionado, y también sin FR: **no existe forma de dar de baja o desactivar a
un miembro**. La sección 9 menciona un atributo `status` y la retención tras la
salida, pero nadie lo escribe ni lo cambia. Decidir si entra en Release 1.

### B4 · Dos números clave no tienen definición · E8, E9, E10

**El porcentaje de asistencia.** FR-042 dice "calcular el % desde los registros
guardados". Solo AC-017 insinúa la fórmula `(Present + Late) / total`. Falta el
denominador: ¿todas las sesiones del club, o solo aquellas a las que el miembro
estaba targeteado? Quien entró en mayo no debería arrastrar marzo. El número
sale en directorio, perfil y dashboard, así que si está mal, está mal en tres
sitios. Decidir la fórmula exacta y escribirla como FR.

**El OVR de quien no tiene evaluación.** FR-046 balancea equipos con el OVR,
pero nada dice qué hacer con un jugador sin evaluar. FR-051 inicializa las
categorías en 5, sin decir quién ni cuándo crea esa evaluación. Opciones:

- (a) crear la evaluación con todo en 5 al crear el miembro;
- (b) tratar al no evaluado como 5.0 solo para balancear, sin persistir nada;
- (c) excluirlo del auto-balance y exigir que el coach lo asigne a mano.

Sin elegir una, E10 no es implementable.

---

## 2. Contradicciones internas del SRD

### C1 · FR-053 contra AC-035 · E9

FR-053: los cambios de categorías aplican a evaluaciones "creadas **o
editadas** después del cambio". AC-035: las evaluaciones guardadas antes del
cambio "conservarán sus categorías y OVR originales". Chocan exactamente en el
caso "evaluación vieja que un coach edita hoy".

Elegir una: o editar migra la evaluación al set nuevo, o el set de una
evaluación es inmutable y solo cambia al recrearla.

### C2 · FR-046 pide dos objetivos que se pelean, y su AC no lo verifica · E10

- FR-046 exige minimizar la diferencia de puntaje **y** garantizar cobertura de
  posiciones. En escuadras chicas o desbalanceadas los dos objetivos se
  contradicen. Falta decir cuál gana.
- FR-046 pide el mínimo global, que es un problema de partición. AC-019 solo
  verifica un óptimo local: "que no mejore moviendo un solo jugador". El AC no
  prueba el FR.
- AC-019 introduce equipos de igual tamaño (6 y 6). El FR nunca lo pidió.
- NFR-002 exige menos de 2 segundos para 30 jugadores, así que el algoritmo hay
  que escribirlo, no dejarlo a interpretación del worker.
- Escuadras impares: la tabla de riesgos las menciona, ningún requisito las
  regula.

Salida esperada: un FR reescrito que fije el orden de prioridad de los
objetivos, el algoritmo (o su criterio de aceptación exacto) y el trato de las
escuadras impares.

### C3 · Casual no encaja en el modelo de cobro mensual · E12, E13

- FR-063 cobra "cuotas mensuales automáticamente en la fecha de facturación"
  sin excluir a Casual, que es prepago por sesión (FR-064).
- FR-065 manda mostrar "próxima fecha de cargo", que para un Casual no existe.
  Decidir qué muestra su panel de plan.
- FR-066 permite cambiar de plan al siguiente ciclo, pero no dice qué pasa con
  el **saldo de sesiones prepagas** al pasar de Casual a Full, ni al revés.
  ¿Se reembolsa, se congela, se pierde?

---

## 3. FRs sin criterio de aceptación

El SRD afirma en su "Orphan check" que toda FR está cubierta por al menos una
AC. No es cierto. Estas siete no aparecen en ninguna AC de la sección 8:

| FR     | Qué es                                        | Epic |
| ------ | --------------------------------------------- | ---- |
| FR-047 | Swap sugerido en el team builder              | E10  |
| FR-066 | Cambio de plan al siguiente ciclo             | E12  |
| FR-043 | Dividir la escuadra en dos equipos con nombre | E10  |
| FR-054 | Editar una evaluación existente               | E9   |
| FR-033 | Vista agenda                                  | E7   |
| FR-022 | Asistencia en el perfil propio                | E5   |
| FR-012 | Exactamente cuatro roles                      | E3   |

FR-066 duele especialmente: fue una resolución de la v1.2, la escribieron como
FR y se olvidaron del AC.

Otras cuatro tienen cobertura solo indirecta, de refilón dentro de un AC ajeno:
FR-026 (asignar miembros a grupos), FR-027 (grupos como audiencia), FR-029 (los
cuatro tipos de evento) y FR-032 (filtrado por audiencia). Conviene darles AC
propia.

Por qué importa: el paso 6 del ciclo de la fábrica marca los checkboxes de
aceptación "solo los que un test que pasa demuestre". Una FR sin AC llega al
ticket con un criterio inventado por el modelo.

---

## 4. Huecos del plan maestro

### P1 · El plan nunca declara el stack

Habla de `app/api/v1`, Supabase Auth, Supabase Storage y RLS, así que lo asume,
pero "Decisiones técnicas transversales" no dice cuál es el stack. El bootstrap
ya lo fijó y quedó escrito en `CLAUDE.md`: **Next.js 16 (App Router) +
TypeScript estricto + Supabase + Stripe desde E12, puerto 3417**. Falta bajarlo
al plan maestro como decisión, no como suposición.

### P2 · Cuatro NFRs no tienen epic

- **NFR-011 (Privacy Act 1988)** es el grave. Exige aviso de privacidad en el
  sign-up y un mecanismo de acceso y borrado de datos en 30 días. Son pantallas
  y endpoints reales que ningún epic contempla. Decidir: ¿epic propio, o se
  reparte entre E2 (el aviso) y E5 (acceso y borrado)?
- NFR-001 (rendimiento), NFR-003 (disponibilidad) y NFR-008 (escala) no
  aparecen. Aunque sean transversales, conviene decir dónde se verifican.

### P3 · Falta la infraestructura de trabajos programados

FR-072 (aviso antes de la renovación) y FR-031 (generar ocurrencias de eventos
recurrentes) necesitan un scheduler. Ningún epic lo incluye y E12 está
dimensionado sin él. Decidir la pieza (pg_cron de Supabase, Edge Function
programada, cron externo) y en qué epic entra.

### P4 · No hay epic de despliegue

E1 cubre esquema, RLS, convención de API y app shell, pero nada de entornos,
migraciones en CI ni hosting. Decidir dónde corre la app y quién aplica las
migraciones antes de que E2 necesite un entorno real.

### P5 · Detalles menores

- La columna "Issue" del plan lista `#1` a `#14`, issues que todavía no
  existen. Se llenan cuando se creen los epics.
- Rutas `data/SRD_...md` corregidas a `docs/` durante el bootstrap. Hecho.
- En el SRD, AC-037 aparece antes que AC-036.
- En el SRD, la sección 3.2 cita FR-034 para la vista agenda. La agenda es
  FR-033; FR-034 es el RSVP.

---

## 5. Falta el prototipo de diseño

El SRD nombra como fuente `Seadragons Platform.dc.html`, el handoff de Claude
Design. No está en el repo.

Con ese archivo en `docs/mockups/`, el agente `ui-reviewer` trabaja en Modo A y
compara cada pantalla contra su mockup, bastante mejor que el modo heurístico.
Además los tokens de marca saldrían del diseño real en vez de los valores por
defecto que quedaron puestos.

Mientras no esté, `design-system.md` usa el azul por defecto `#2563EB` y el
stack de fuentes del sistema, ambos marcados como provisionales.
