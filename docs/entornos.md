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

### Comprobadas en cada PR (issue #93)

`migrations.yml` levanta un Postgres limpio dentro del propio runner y aplica
todo el histórico en orden de nombre con `scripts/apply-migrations.sh`. Si
alguna migración no aplica limpia, el PR queda en rojo. El job no habla con
ninguna base real ni recibe ningún secreto, y corre aunque el PR no traiga
migraciones nuevas: lo que se comprueba es que el histórico completo sigue
aplicando.

Para reproducirlo contra un Postgres local:

```bash
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file supabase/ci/roles.sql
DATABASE_URL=postgresql://... bash scripts/apply-migrations.sh
```

`supabase/ci/roles.sql` crea los roles de la API (`anon`, `authenticated`,
`service_role`) que Supabase trae de fábrica y un Postgres pelado no tiene; sin
ellos las migraciones fallan por el motivo equivocado. Los tests de
`tests/unit/scripts/apply-migrations.test.ts` que necesitan una base se saltan
solos mientras no exista `MIGRATIONS_TEST_DATABASE_URL`, así que `npm test`
pasa igual en una máquina sin Postgres.

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
- **Preview**: el despliegue de Vercel que se genera por cada PR abierto.
  Todavía no existe (lo crea el issue #91); esta tabla dice a dónde debe
  apuntar cuando exista.
- **Producción**: el despliegue de Vercel que sirve desde `main`. El proyecto
  de Supabase de producción ya existe (`seadragons-prod`, ver arriba); el
  despliegue en Vercel que lo usaría todavía no (issue #91).
- **CI**: los workflows de GitHub Actions (`.github/workflows/`).

`NEXT_PUBLIC_SUPABASE_URL`: en local, `.env.local` apunta a `seadragons-dev`.
En preview, apunta a `seadragons-dev`, **nunca** al proyecto de producción
(#92). En producción, apunta a `seadragons-prod`; nadie la configura todavía
en Vercel porque el despliegue es el #91. En CI, iría como secret del
repositorio, pendiente de configurar (ver comentario en `claude-backlog.yml`).
La pone quien desarrolla en local; en Vercel/CI, quien administre esos
secretos (#91, #92).

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
En preview, la URL que genera Vercel (pendiente de #91). En producción, la
URL de producción (pendiente de #91). En CI, la fija el workflow con la URL
del servidor que acaba de levantar. Playwright toma el valor por defecto; en
CI/Vercel lo fija el workflow.

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
