# PRD: E16a · Entornos y despliegue

**Estado:** aprobado · **Fecha:** 7 de septiembre de 2026 (gasto resuelto el 8) · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4) y
`docs/plan-maestro.md` (epic E16, partido en E16a y E16b al escribir este
documento). Cubre NFR-003 y la parte de P4 de `docs/preguntas-abiertas.md`
relativa a entornos, hosting, secretos y migraciones en CI.

## 1. Problema

Todo lo que la fábrica ha construido hasta hoy vive en una sola máquina y una
sola base de datos. No hay producción. No hay forma de que alguien que no sea
el dueño del portátil vea la aplicación, y no hay ningún sitio donde el club
pueda usarla.

Peor: el único proyecto de Supabase que existe es `seadragons-dev`. Si mañana
se abriera el registro, la primera persona que se inscribiera dejaría sus datos
personales en la base de desarrollo, la misma que los tests de RLS truncan y
resiembran en cada corrida. Ese es un problema de privacidad (NFR-011) antes
que de comodidad.

Y hay un bloqueo concreto: **la E2 no puede empezar sin esto**. El plan maestro
la hace depender de E16 porque autenticación necesita un sitio donde correr, un
callback de OAuth con un dominio estable y secretos separados por entorno. Hoy
E1 está cerrada y E2 espera solo por aquí.

Las migraciones son el tercer frente. Se aplican a mano por MCP desde la sesión
de quien trabaja. Funciona con una persona; con dos, la base y el repositorio se
separan sin que nadie se entere.

## 2. Usuarios y contexto

El usuario de este epic no es el socio del club: es **quien trabaja en la
plataforma**, hoy una persona y pronto más de una, más los workers headless de
la fábrica.

Para el socio, el efecto es indirecto pero real: hasta que exista producción, la
plataforma no existe. NFR-003 fija 99,0% de disponibilidad mensual best-effort,
sin SLA contractual, y exige que el mantenimiento planificado quede fuera de las
horas de entrenamiento (martes y jueves 18:00–22:00, sábados 08:00–13:00
AEST/AEDT) y se anuncie con 48 horas.

Contexto que ya está decidido y no se rediscute aquí:

- Supabase de desarrollo: `seadragons-dev`, ref `xcfrpcvomjjmfoztifuo`, en
  Sídney (`ap-southeast-2`), organización SeaDragons. Se eligió Sídney por
  latencia y por residencia de datos personales en Australia, que importa para
  E15 y NFR-011.
- Stack Next.js 16 App Router, API REST versionada bajo `src/app/api/v1`
  (CON-002).
- **Ambos entornos van en plan gratuito.** El 8 de septiembre de 2026 se
  comprobó contra la API de Supabase que la organización SeaDragons está en plan
  `free` y que crear un segundo proyecto en ella cuesta 0 al mes: el plan
  gratuito admite dos proyectos activos por organización. Vercel se usa en plan
  Hobby. Si alguno de los dos exige pagar, la decisión vuelve al dueño antes de
  gastar nada.

## 3. Objetivo y métricas de éxito

Que exista un entorno de producción al que se despliega solo, con sus datos
separados de los de desarrollo y sus migraciones aplicadas por CI.

Medible así:

1. Un merge a `main` deja la versión nueva sirviendo en producción sin que nadie
   corra un comando.
2. Un PR abierto produce una URL de preview que alguien puede abrir y mirar.
3. Ninguna credencial de producción existe en el portátil de nadie ni en el
   repositorio.
4. Una migración nueva llega a producción por el mismo camino que el código, no
   por una sesión de MCP.
5. La caída de producción llega como aviso, no como un mensaje de alguien del
   club diciendo que la web no carga.

## 4. Alcance

### Dentro

- Proyecto de Supabase de producción, separado del de desarrollo, en Sídney.
- Despliegue en Vercel: producción desde `main` y preview por PR.
- Secretos por entorno, sin solaparse.
- Aplicación de migraciones en CI, con la de producción bajo control.
- Monitoreo de disponibilidad y aviso de caída (NFR-003).
- Documentación de la ventana de mantenimiento.

### Fuera

- **Los jobs de `pg_cron`** (FR-031, ocurrencias recurrentes; FR-072, aviso
  pre-renovación) y **la prueba de carga** (NFR-001, NFR-008). Van a E16b. No es
  un aplazamiento por comodidad: los jobs necesitan las tablas de eventos (E7) y
  de membresías (E12, E13), y la prueba de carga exige sembrar 500 miembros,
  5.000 ocurrencias y 50.000 asistencias, que son tablas de E5, E7 y E8. Escribir
  esos tickets hoy sería escribirlos contra un esquema que no existe.
- Dominio propio y correo transaccional. El dominio se puede añadir cuando el
  club decida el nombre; nada de E2 lo necesita, porque la URL de Vercel sirve
  como callback de OAuth.
- Entorno de staging separado de los previews. Los previews por PR cubren la
  necesidad hoy; añadir un tercer entorno tiene coste y no resuelve ningún
  problema actual.
- Migrar el proyecto de desarrollo. Se queda como está.

## 5. Requerimientos funcionales

### RF-1 · Proyecto de Supabase de producción · Must

Existe un segundo proyecto de Supabase, separado del de desarrollo, con el
esquema completo aplicado y ninguna fila de datos de prueba.

- **Dado** el proyecto de producción recién creado, **cuando** se aplican todas
  las migraciones del repositorio, **entonces** su esquema es idéntico al de
  desarrollo, verificable comparando la lista de migraciones aplicadas.
- **Dado** el proyecto de producción, **cuando** se consulta su región,
  **entonces** es `ap-southeast-2`, por la misma razón que el de desarrollo.
- **Dado** cualquier test de la suite, **cuando** corre en cualquier máquina,
  **entonces** no puede alcanzar el proyecto de producción: sus credenciales no
  están en ningún `.env` local ni en los secretos que los tests reciben.

### RF-2 · Despliegue en Vercel desde `main` · Must

- **Dado** un merge a `main` cuyos checks pasan, **cuando** termina el merge,
  **entonces** la versión nueva queda sirviendo en producción sin intervención.
- **Dado** un despliegue que falla al construir, **cuando** ocurre, **entonces**
  la versión anterior sigue sirviendo y el fallo es visible en el PR o en el
  commit.
- **Dado** el despliegue de producción, **cuando** se elige su región,
  **entonces** es la de Sídney, para no cruzar el Pacífico en cada consulta a
  Supabase.
- **Dado** el plan Hobby de Vercel, **cuando** se configura el proyecto,
  **entonces** queda anotado en el repositorio que ese plan es de uso no
  comercial, y que E12 (cobros por Stripe) obliga a revisarlo antes de cobrarle a
  nadie.

### RF-3 · Preview por PR · Must

- **Dado** un PR abierto, **cuando** su build termina, **entonces** existe una
  URL de preview accesible desde el propio PR.
- **Dado** un preview, **cuando** se ejecuta, **entonces** apunta al Supabase de
  **desarrollo**, nunca al de producción.
- **Dado** un PR que viene de un fork, **cuando** se construye su preview,
  **entonces** no recibe ningún secreto que permita escribir en ninguna base.

### RF-4 · Secretos por entorno · Must

- **Dado** el conjunto de variables que la aplicación necesita, **cuando** se
  configuran, **entonces** cada entorno (producción, preview, local) tiene las
  suyas y ninguna credencial de producción aparece fuera de producción.
- **Dado** la clave `service_role` de Supabase, **cuando** se configura,
  **entonces** nunca viaja en una variable `NEXT_PUBLIC_*` ni llega al navegador.
- **Dado** un desarrollador nuevo, **cuando** clona el repositorio, **entonces**
  existe un `.env.example` que enumera todas las variables necesarias con su
  propósito y sin un solo valor real.
- **Dado** cualquier documento, log, comentario o descripción de PR que la
  fábrica escriba, **cuando** se revisa, **entonces** no contiene el valor de
  ninguna variable de entorno.

### RF-5 · Migraciones aplicadas por CI · Must

- **Dado** un PR que añade una migración, **cuando** corre CI, **entonces** se
  verifica que la migración aplica limpia sobre un esquema igual al de
  producción, y el PR falla si no.
- **Dado** un merge a `main` con una migración nueva, **cuando** termina,
  **entonces** la migración queda aplicada en producción por el mismo camino que
  el código.
- **Dado** una migración que falla al aplicarse en producción, **cuando** ocurre,
  **entonces** el fallo es ruidoso y queda registrado, nunca silencioso.
- **Dado** el estado de las migraciones, **cuando** se compara repositorio contra
  producción, **entonces** hay una forma de comprobar que no divergieron.

### RF-6 · Monitoreo de disponibilidad · Should

- **Dado** producción caída o respondiendo error, **cuando** ocurre durante más
  de un umbral definido, **entonces** llega un aviso a una persona.
- **Dado** NFR-003, **cuando** se mide la disponibilidad mensual, **entonces**
  existe un sitio donde consultarla.
- **Dado** una ventana de mantenimiento planificada, **cuando** se programa,
  **entonces** queda fuera de las horas de entrenamiento del club, que están
  documentadas en el repositorio para que nadie tenga que recordarlas.

## 6. Casos borde y estados de error

**El proyecto de producción se crea vacío y alguien lo usa antes de tiempo.**
Entre crearlo y tener autenticación (E2) hay una ventana en la que la base
existe sin nadie que la use. No debe quedar accesible con credenciales por
defecto ni con RLS desactivado.

**Un preview escribiendo en producción.** Es el fallo más caro de esta épica y
el más fácil de cometer: basta con configurar una variable en el ámbito
equivocado. Merece una comprobación explícita, no confianza.

**Un PR desde un fork.** GitHub degrada el token y no entrega secretos. El
preview debe seguir construyéndose o fallar diciendo por qué, nunca romperse de
forma confusa.

**Dos migraciones que llegan a `main` el mismo día.** Deben aplicarse en orden y
de forma idempotente; la segunda no puede asumir que la primera no corrió.

**Una migración que aplica en desarrollo y falla en producción.** Ocurre cuando
los esquemas ya divergieron. La comprobación de RF-5 en el PR existe para
atraparlo antes del merge.

**El despliegue automático con la fábrica corriendo.** Un merge de un worker
dispara producción. Es lo que queremos, pero significa que un PR mal revisado
llega a usuarios reales. La mitigación no es técnica: es que un humano mergea,
que ya es la regla del proyecto.

**Credenciales rotadas.** Cuando una clave se rota, hay más de un sitio que
actualizar. Debe estar escrito dónde, o la próxima rotación deja medio sistema
roto.

## 7. UX / UI

No aplica: este epic no cambia ninguna pantalla. No lleva `ui-review`.

## 8. Requerimientos no funcionales

- **NFR-003** (99,0% mensual best-effort, sin SLA): lo verifica el monitoreo de
  RF-6. La ventana de mantenimiento fuera de horas de entrenamiento se documenta
  en el repositorio.
- **NFR-011 / CON-006** (Privacy Act 1988, residencia de datos): el proyecto de
  producción va en Sídney, y la separación dev/prod de RF-1 es lo que hace
  posible el borrado y la exportación de E15 sin arrastrar datos de prueba.
- **NFR-001 y NFR-008** (rendimiento y volumen) NO se verifican aquí. Son de
  E16b, con la prueba de carga.

## 9. Preguntas abiertas

1. ~~**Plan de Vercel y de Supabase.**~~ **Resuelta el 8 de septiembre de 2026.**
   El segundo proyecto de Supabase cuesta 0, verificado contra la API: la
   organización está en plan `free` y admite dos proyectos activos. Se crean los
   dos y RF-1 se mantiene entera. Vercel va en Hobby. La regla de fondo la puso
   el dueño: en esta fase del proyecto, si algo hay que pagarlo, no se hace.
2. ~~**Nombre del proyecto en Vercel.**~~ **Resuelta el 8 de septiembre de
   2026: `victoria-seadragons`.** Define la URL `victoria-seadragons.vercel.app`,
   que es la que verán los socios en la pantalla de consentimiento de Google
   cuando E2 traiga OAuth, y coincide con el slug del club que siembra la
   migración `0001_clubs`. Se descartó `seadragons` a secas por genérico y
   `seadragons-web` porque se lee como un artefacto de programador. El 8 de
   septiembre ninguno de los cuatro candidatos respondía en `*.vercel.app`, lo
   que indica que nadie sirve ahí, no que el nombre esté libre.
3. **Cuándo deja de servir el plan Hobby de Vercel.** Dos límites distintos, y
   conviene no confundirlos.

   El primero es de uso: Hobby es para uso no comercial. Mientras no haya cobros
   ni socios reales da igual, pero E12 mete Stripe y eso ya es actividad
   comercial. La decisión no es de hoy; dejarla escrita sí, para que E12 no se la
   encuentre de golpe.

   El segundo es de propiedad, y es el que se pasa por alto: **Hobby solo existe
   para cuentas personales.** Un Team de Vercel es de pago. Así que la cuenta del
   club no puede ser una organización sin pagar: sería otra cuenta personal con
   el correo del club, en Hobby. En un club de voluntarios eso es un riesgo real,
   no burocrático: el despliegue queda a nombre de una persona, y si esa persona
   se va, alguien tiene que tener esas credenciales. Lo mismo aplica al proyecto
   de Supabase.

4. **A quién llega el aviso de caída.** Hoy solo hay una persona. Cuando entren
   más, hay que decidir si avisa a todos o hay rotación.
5. **Dominio propio, y tiene fecha límite: antes de E2.** No es una preferencia
   estética, es lo que decide si migrar de cuenta duele o no. Renombrar un
   proyecto en Vercel es un ajuste en Settings. Lo caro es que al cambiar la URL
   hay que volver a registrarla en las consolas de Google y de Apple, y eso solo
   pasa si E2 ya salió apuntando a `*.vercel.app`. Si el OAuth se registra
   contra un dominio propio desde el principio, mover la cuenta de Vercel después
   no toca ninguna consola externa: solo cambia a dónde apunta el DNS. También
   ahorra reescribir los enlaces de los correos de E6.

## 10. Descomposición en tickets (para write-ticket)

| Issue | Título propuesto                                                                    | Tamaño | Depende de | Auto-merge sugerido                                         |
| ----- | ----------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------- |
| #89   | Crear el proyecto de Supabase de producción y aplicarle el esquema                  | M      | ninguna    | No: crea la base que llevará datos personales reales        |
| #90   | Documentar las variables de entorno en `.env.example` y dónde vive cada una         | S      | ninguna    | No: su test decide si un PR pasa, no es un `.md` inerte     |
| #91   | Desplegar en Vercel desde `main` con preview por PR                                 | M      | #89, #90   | No: es lo que pone la aplicación delante de usuarios reales |
| #92   | Separar los secretos por entorno y probar que un preview no ve producción           | M      | #89, #91   | No: frontera de seguridad, y el fallo es silencioso         |
| #93   | Verificar en cada PR que la migración aplica sobre un esquema como el de producción | M      | #89        | No: puerta que decide si una migración entra                |
| #94   | Aplicar las migraciones a producción al mergear                                     | M      | #92, #93   | No: escribe en la base de producción                        |
| #95   | Monitorear la disponibilidad y avisar de las caídas                                 | S      | #91        | No: hay que comprobar que el aviso llega de verdad          |

Ninguno lleva `ui-review`: este epic no toca pantallas.

**Ninguno es auto-merge, y no es exceso de celo.** Cinco de los siete escriben en
producción o mueven credenciales, que es exactamente la lista de excepciones que
fija el propio criterio de auto-merge. Los otros dos se discutieron y tampoco lo
llevan: el #95 no vale nada si el aviso no llega, y eso solo se comprueba
mirándolo; el #90 parecía documentación inerte, pero su test compara
`process.env` contra `.env.example` y decide si un PR pasa. El dueño ratificó
esta lista el 8 de septiembre de 2026.

**Aviso sobre lo que un worker headless NO puede hacer aquí.** Los tickets #89,
#91, #92 y #95 necesitan crear cuentas, aceptar términos, generar credenciales y
pegarlas como secretos. Nada de eso lo puede hacer un agente, y ya sabemos cómo
acaba si lo intenta. Los cuatro se escribieron con la parte automatizable
separada de la manual: el worker entrega la configuración, los tests y la
documentación, y se detiene declarando exactamente qué credencial falta y dónde
va. Si esa separación se ignora, cuatro de siete acaban en `needs-human`
habiendo gastado su corrida.
