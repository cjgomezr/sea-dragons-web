# Entornos

Dos proyectos de Supabase, separados, en la misma organización (SeaDragons) y
la misma región. Ver `docs/prd/e16a-entornos-y-despliegue.md` (RF-1) para el
porqué de la separación.

Ambos van en plan Free. Verificado contra la API el 8 de septiembre de 2026: la
organización está en plan `free` y el segundo proyecto cuesta 0 al mes.

## seadragons-dev

- **Ref:** `xcfrpcvomjjmfoztifuo`
- **URL:** `https://xcfrpcvomjjmfoztifuo.supabase.co`
- **Región:** `ap-southeast-2` (Sídney)
- **Para qué sirve:** desarrollo y tests. Es la base que los tests de RLS
  truncan y resiembran en cada corrida. Nunca debe recibir datos reales de un
  socio: quedarían mezclados con datos de prueba.

## seadragons-prod

- **Ref:** `weqhmtpvgewomslpvefu`
- **URL:** `https://weqhmtpvgewomslpvefu.supabase.co`
- **Región:** `ap-southeast-2` (Sídney), la misma que desarrollo, por
  residencia de datos personales en Australia (NFR-011).
- **Creado:** 8 de septiembre de 2026, con el esquema del repositorio aplicado
  (`0001_clubs`, `0002_audit_log`). La única fila que existe es el club
  `victoria-seadragons`, que la propia migración siembra porque Release 1 opera
  un único club (CON-004). No hay datos de prueba.
- **Para qué sirve:** datos reales de los socios del club. Ningún test debe
  poder alcanzarlo, ni siquiera por accidente: el guardia de entorno de la
  suite (`src/lib/supabase/environment-guard.ts`, enganchado en
  `vitest.setup.ts`, que corre antes que cualquier archivo de test) falla de
  inmediato si la URL configurada no es la de `seadragons-dev`.

El ref y la URL son públicos: viajan en cada petición que hace el navegador.
Lo que nunca sale de su sitio son las claves, y eso es lo que cubre la sección
siguiente.

## Vercel

El despliegue vive en Vercel, proyecto `victoria-seadragons`, en la cuenta
personal `cjgomezr`. Producción sirve desde `main`, en
https://victoria-seadragons.vercel.app/. Cada PR abierto genera su propia URL de
preview, visible desde el propio PR. Un build que falla no reemplaza nada: la
versión anterior sigue sirviendo y el fallo queda en rojo en el commit o en el
PR.

- **Región de funciones:** `syd1` (Sídney), declarada en `vercel.json` y
  verificada en la respuesta (`x-vercel-id: syd1::...`). El importador de Vercel
  ya no pregunta la región, así que el primer despliegue salió en Estados Unidos
  y hubo que cambiarla a mano. Está en el repositorio para que no vuelva a
  depender de que alguien se acuerde de mirar el panel.
- **Framework:** Next.js, también declarado en `vercel.json`.
- **Sin la integración de Supabase que ofrece el importador.** Se descartó a
  propósito: inyecta las credenciales de un solo proyecto en Production,
  Preview y Development a la vez, que es justo lo que el issue #92 existe para
  impedir.
- **Variables de entorno:** ninguna configurada todavía. Hasta que el #92 las
  ponga, `GET /api/v1/health` responde 503 en producción diciendo qué falta, que
  es el comportamiento correcto y no un despliegue roto.

### El plan es Hobby, y Hobby es de uso no comercial

El proyecto está en el plan **Hobby**, que sus términos limitan a uso **no
comercial**. Hoy la plataforma no cobra nada, así que encaja.

**E12 (cobros por Stripe) obliga a revisar esta decisión antes de cobrarle a
nadie.** En cuanto el club acepte un pago a través de la plataforma, el uso
deja de ser plausiblemente no comercial y el proyecto tiene que pasar a un plan
de pago, con el gasto aprobado por el dueño. No es una tarea de infraestructura
que se pueda aplazar hasta que alguien se queje: es una condición del
proveedor.

## Credenciales

Ninguna clave de ningún proyecto vive en este documento ni en ningún otro
archivo versionado del repositorio.

- **En local:** solo credenciales de `seadragons-dev`, en `.env.local`, fuera
  de git. Qué variable hace falta y para qué sirve se describe en
  `.env.example`, sin valores reales (issue #90).
- **De producción:** no viven en el portátil de nadie. Van a los secretos del
  despliegue (Vercel) y del repositorio (GitHub Actions) cuando existan esos
  entornos (issues #91, #92 y #94). Poner una credencial de producción en
  `.env.local` hace fallar la suite entera por el guardia de entorno, y eso es
  deliberado.
- **Password de la base de producción:** no se fijó al crear el proyecto por
  API. Cuando el #94 lo necesite, se genera en el dashboard (Settings →
  Database → Reset database password) y se pega como secreto del repositorio.

## Migraciones

El esquema de producción se sembró a mano el 8 de septiembre de 2026, por MCP,
porque no había otra vía: el workflow que las aplica es el issue #94 y todavía
no existe. **Es un arranque, no el procedimiento.** En cuanto el #94 esté
mergeado, ninguna migración vuelve a aplicarse desde la sesión de nadie: llegan
a producción por el mismo camino que el código.

Los dos proyectos tienen la misma lista de migraciones por nombre
(`0001_clubs`, `0002_audit_log`). Las marcas de versión difieren, porque cada
proyecto las sella con la fecha en que las recibió; lo que tiene que coincidir
es el conjunto de nombres.

## Una trampa del plan Free

Free pausa un proyecto tras una semana sin actividad. Producción va a estar
vacía y sin tráfico hasta que E2 traiga autenticación, así que es probable
encontrarla pausada y tener que restaurarla desde el dashboard. Deja de ocurrir
cuando el monitoreo del issue #95 empiece a consultar `/api/v1/health`.

## Catálogo de variables (issue #90)

Para cada variable de `.env.example`, en qué entornos vive y quién la pone.
Los cuatro entornos posibles:

- **Local**: la máquina de quien desarrolla, en `.env.local` (nunca
  commiteado).
- **Preview**: el despliegue de Vercel que se genera por cada PR abierto. Ya
  existe; sus variables todavía no (issue #92), así que esta tabla dice a dónde
  deben apuntar cuando alguien las configure.
- **Producción**: el despliegue de Vercel que sirve desde `main`. Existen los
  dos lados, el proyecto de Supabase (`seadragons-prod`) y el despliegue; lo
  que falta es conectarlos con variables de entorno (issue #92).
- **CI**: los workflows de GitHub Actions (`.github/workflows/`).

`NEXT_PUBLIC_SUPABASE_URL`: en local, `.env.local` apunta a `seadragons-dev`.
En preview, apunta a `seadragons-dev`, **nunca** al proyecto de producción
(#92). En producción, apunta a `seadragons-prod`; nadie la ha configurado
todavía en Vercel, y eso es el #92. En CI, iría como secret del repositorio,
pendiente de configurar (ver comentario en `claude-backlog.yml`). La pone quien
desarrolla en local; en Vercel/CI, quien administre esos secretos (#92).

`NEXT_PUBLIC_SUPABASE_ANON_KEY`: en local, la del proyecto `seadragons-dev`.
En preview, la misma llave anónima de `seadragons-dev`. En producción, la
llave anónima de `seadragons-prod`, distinta a la de desarrollo. En CI, como
secret del repositorio, pendiente de configurar. La pone quien desarrolla en
local; en Vercel/CI, quien administre esos secretos.

`SUPABASE_SERVICE_ROLE_KEY`: la llave de servicio, la única que se salta
RLS. En local, la de `seadragons-dev`, en `.env.local`, nunca en un `.env`
versionado. Si algún endpoint de servidor la necesita en preview, es también la
de `seadragons-dev`. En producción, la de `seadragons-prod`, nunca la misma que
desarrollo. En CI, como secret del repositorio, pendiente de configurar. La pone
quien desarrolla en local; en Vercel/CI, quien administre esos secretos.

Esta es la variable a la que hay que tenerle respeto. Nunca lleva el prefijo
`NEXT_PUBLIC_`: con ese prefijo Next.js la metería en el bundle del navegador y
cualquiera podría leer y escribir toda la base saltándose RLS.
`tests/unit/env-example.test.ts` lo verifica. Solo se usa en código de servidor,
a través de `src/lib/supabase/service-client.ts`.

`SUPABASE_ACCESS_TOKEN`: en local, un token personal de cuenta completa (no
de proyecto). No aplica a preview ni a producción: no lo lee el runtime de la
aplicación, solo el CLI/MCP de quien desarrolla. Tampoco aplica hoy a CI:
nadie corre el CLI de Supabase ahí todavía. Cada quien genera el suyo en
Supabase Dashboard → Account → Access Tokens.

`APP_URL`: opcional en local (si no se pone, usa `http://localhost:3417`).
En preview, la URL que genera Vercel para ese PR. En producción,
https://victoria-seadragons.vercel.app/. En CI, la fija el workflow con la URL
del servidor que acaba de levantar. Playwright toma el valor por defecto; en
CI/Vercel lo fija el workflow.

`VERCEL_GIT_COMMIT_SHA`: el sha del commit que se está sirviendo. No se pone
nunca a mano: la inyecta el build de Vercel en preview y en producción. En
local y en CI no existe, y `GET /api/v1/health` devuelve `commit: null` en vez
de inventarse un valor. Es la única variable que el código lee y que no está en
`.env.example`, a propósito: escribirla en `.env.local` haría que el endpoint
afirmara servir un commit que no es el del disco. La exclusión está declarada
en `tests/support/env-vars.ts`, junto a su porqué.

`CI`: no se pone en local. En preview y producción la pone Vercel
automáticamente; en CI la pone GitHub Actions automáticamente. Nunca a mano,
nunca en `.env.local`.

`FABRICA_REUSE_SERVER`: opcional en local (`1` para reusar un `npm run dev`
ya corriendo). No aplica a preview, producción ni CI. La pone quien
desarrolla, a mano, cuando lo necesita.

`START_DELAY_MS`: no aplica al desarrollo normal ni a preview, producción o
CI como despliegue. Solo existe dentro del fixture de
`tests/unit/scripts/ui-preflight.test.ts`, que la pone a sí mismo.

**Qué protege este documento y qué no.** `tests/unit/entornos-doc.test.ts`
rechaza cualquier cadena con forma de clave de Supabase, en los dos formatos que
Supabase entrega: el JWT clásico y el nuevo con prefijo `sb_`. Nombrar una
variable no es filtrarla, así que el catálogo de arriba las nombra todas. Lo que
nunca puede aparecer aquí es un valor.
