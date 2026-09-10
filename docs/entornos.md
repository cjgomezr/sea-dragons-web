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
- **Variables de entorno:** qué va en cada ámbito está decidido y escrito en
  `entornos.json`; ver "Secretos por entorno" más abajo. Mientras nadie las
  haya pegado en el panel, `GET /api/v1/health` responde 503 diciendo qué
  falta, que es el comportamiento correcto y no un despliegue roto.

### Qué contesta `GET /api/v1/health`

Sano, responde 200 con `supabaseProjectRef` (el ref del proyecto de Supabase al
que apunta ese entorno) y `commit` (el sha que está sirviendo, tomado de
`VERCEL_GIT_COMMIT_SHA`). Los dos son públicos; ninguna clave sale en la
respuesta, y `tests/unit/api/health-route.test.ts` lo comprueba.

Enfermo, responde 503 con la forma de error de la API v1
(`{ error: { code, message } }`), que **no** lleva el ref ni el sha. Es
deliberado: el cuerpo de error es el mismo para toda la API y este endpoint no
lo rompe por comodidad de un consumidor. Durante una caída, la versión
desplegada se consulta en el panel de Vercel (Deployments), y el monitoreo del
#95 solo necesita distinguir 200 de 503.

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

## Secretos por entorno (issue #92)

Basta con configurar una variable en el ámbito equivocado para que el preview
de un PR cualquiera escriba en la base de producción, y el fallo es silencioso:
todo sigue funcionando, sólo que contra la base que no era. Por eso la
separación no vive en la cabeza de nadie sino en `entornos.json`, el manifiesto
de entornos, que declara para cada variable de qué origen sale en local,
preview, producción y CI.

El manifiesto marca dos cosas por variable. `secret` es lo que nunca puede
llegar al navegador. `writeCredential` es lo que puede escribir en una base de
Supabase de este proyecto. Y marca `seadragons-prod` como origen de producción.
Con esas tres marcas, `tests/unit/entornos-manifest.test.ts` comprueba dos
reglas y nombra la variable culpable cuando alguna se rompe:

1. Sólo el entorno de producción admite orígenes de producción. Poner el ref o
   la llave de `seadragons-prod` en preview, en local o en CI deja el test en
   rojo.
2. Preview no lleva ninguna credencial de escritura, ni siquiera la de
   desarrollo.

### Qué se pega en cada ámbito de Vercel

| Variable                        | Preview          | Production        |
| ------------------------------- | ---------------- | ----------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `seadragons-dev` | `seadragons-prod` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `seadragons-dev` | `seadragons-prod` |
| `SUPABASE_SERVICE_ROLE_KEY`     | no se pone       | `seadragons-prod` |

Las dos primeras salen de Supabase Dashboard → el proyecto que toque → Project
Settings → API. La tercera, del mismo sitio, y sólo en Production.

**Ojo al ámbito Development de Vercel.** Existe, y es el que la integración de
Supabase habría rellenado sola. Se deja vacío a propósito: en este proyecto el
desarrollo pasa en `.env.local`, no en `vercel dev`, así que una credencial ahí
sería una copia más que rotar y que nadie usa.

### Preview no tiene llave de servicio, y es deliberado

`SUPABASE_SERVICE_ROLE_KEY` no se configura en el ámbito Preview. Un preview
sirve para mirar la aplicación, y para eso alcanza la llave anónima con RLS
por delante.

Eso resuelve además el caso del **PR que viene de un fork**. Un preview de un
fork se construye con las variables del ámbito Preview, las mismas que
cualquier otro preview; si ahí no hay ninguna credencial de escritura, el fork
tampoco puede recibirla. La garantía es de construcción, no de confianza, y el
test la vigila.

Si algún día un endpoint de servidor necesita la llave de servicio, en preview
no la va a encontrar, y lo que ocurre entonces está escrito:
`createServiceRoleClient` lanza un error que nombra la variable que falta
(`src/lib/supabase/service-client.ts`). Falla diciendo por qué, que es lo que
se le pide a un preview de un fork. Lo que no se hace nunca es rellenarla con
la de desarrollo para que "avance".

### La llave de servicio no sale del servidor

`npm run check:client-bundle` revisa `.next/static`, que es lo que el navegador
descarga, y falla nombrando el chunk si encuentra el nombre de una variable
secreta o una clave de servidor pegada como literal. `checks.yml` lo corre en
cada PR, después del build: revisar el código fuente diría qué se pretendía
publicar, no qué se publicó.

Busca nombres de variable y no valores porque la llave anónima tiene la misma
forma que la de servicio y sí viaja al navegador con todo derecho. El nombre,
en cambio, sólo aparece en el bundle si llegó hasta ahí el módulo de servidor
que lo menciona, que es exactamente el error que se quiere cazar: un componente
de cliente importando código de servidor.

Hoy el bundle no contiene ninguna de las dos cosas, y tampoco contiene ninguna
variable de Supabase: la aplicación todavía es un esqueleto y ningún componente
de cliente habla con la base. El chequeo importa a partir de E2, cuando el
navegador empiece a autenticar.

## Rotación de credenciales

Cuando una clave se rota hay que cambiarla en **todos** los sitios donde vive,
o medio sistema se queda con la vieja. Esta es la lista, una fila por sitio.
Sale de `entornos.json` y `tests/unit/entornos-doc.test.ts` falla si la tabla y
el manifiesto se separan.

| Variable                    | Entorno    | Dónde se cambia                                                                          |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY` | local      | .env.local, en la máquina de quien desarrolla, fuera de git                              |
| `SUPABASE_SERVICE_ROLE_KEY` | production | Vercel, proyecto victoria-seadragons, Settings, Environment Variables, ámbito Production |
| `SUPABASE_ACCESS_TOKEN`     | local      | .env.local, en la máquina de quien desarrolla, fuera de git                              |

El orden importa. Primero se genera la clave nueva, después se actualiza cada
fila de la tabla, y sólo al final se revoca la vieja: al revés deja la
aplicación caída durante el hueco. Un despliegue de Vercel toma las variables
al construirse, así que después de cambiarlas hay que redesplegar; editarlas no
basta.

Las variables públicas no se rotan, se sustituyen: cambiar el ref de Supabase
significa cambiar de proyecto, y eso es una migración, no una rotación.

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

Después de aplicarlas compara el esquema resultante contra
`supabase/ci/schema-expected.txt`, que es lo que el repositorio declara tener.
Una migración editada después de haberse aplicado a mano aplica limpia sobre una
base vacía y deja otro esquema: esa es la diferencia que este paso caza. **Al
añadir una migración hay que regenerar ese archivo**, y el propio fallo dice
cómo: `bash scripts/check-schema-snapshot.sh --write` si tienes Postgres, o
copiando del log la descripción completa que el job imprime cuando no coincide.

Para reproducirlo contra un Postgres local:

```bash
export DATABASE_URL=postgresql://postgres@127.0.0.1:5432/una_base_vacia
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file supabase/ci/roles.sql
bash scripts/apply-migrations.sh
bash scripts/check-schema-snapshot.sh
```

Dos avisos para quien regenere el archivo desde su máquina. Hazlo contra un
Postgres 17, la misma versión mayor que usa el job: la descripción sale del
catálogo, pero el texto de un `CREATE INDEX` o de una restricción ha cambiado de
formato entre versiones mayores, y regenerar con un 16 deja el check rojo sin
que nadie haya tocado el esquema. Y conéctate con un superusuario llamado
`postgres`: las líneas `grant ... postgres ...` llevan el nombre del rol dueño,
así que con otro nombre (Homebrew crea el tuyo) verás siete líneas de diferencia
que no son un cambio de esquema.

`supabase/ci/roles.sql` crea los roles de la API (`anon`, `authenticated`,
`service_role`) que Supabase trae de fábrica y un Postgres pelado no tiene; sin
ellos las migraciones fallan por el motivo equivocado. Hoy alcanza porque
ninguna migración toca el esquema `auth`: la primera policy que use `auth.uid()`
va a romper este job, y lo que hay que ampliar entonces es `roles.sql`, no la
migración.

Los tests de `tests/unit/scripts/apply-migrations.test.ts` que necesitan una
base se saltan solos mientras no exista `MIGRATIONS_TEST_DATABASE_URL`, así que
`npm test` pasa igual en una máquina sin Postgres. En el workflow de migraciones
no se pueden saltar: `REQUIRE_MIGRATIONS_POSTGRES=1` convierte el salto en un
fallo, porque ahí son media cobertura de la comprobación.

## Una trampa del plan Free

Free pausa un proyecto tras una semana sin actividad. Producción va a estar
vacía y sin tráfico hasta que E2 traiga autenticación, así que es probable
encontrarla pausada y tener que restaurarla desde el dashboard. Deja de ocurrir
cuando el monitoreo del issue #95 empiece a consultar `/api/v1/health`.

## Catálogo de variables (issue #90)

Para cada variable de `.env.example`, en qué entornos vive y quién la pone.
Esto es la versión en prosa: la que leen los tests es `entornos.json`, y las
dos no pueden separarse sin que la suite se ponga en rojo.

Los cuatro entornos posibles:

- **Local**: la máquina de quien desarrolla, en `.env.local` (nunca
  commiteado).
- **Preview**: el despliegue de Vercel que se genera por cada PR abierto. Ya
  existe; sus variables todavía no, así que esto dice a dónde deben apuntar
  cuando alguien las configure.
- **Producción**: el despliegue de Vercel que sirve desde `main`. Existen los
  dos lados, el proyecto de Supabase (`seadragons-prod`) y el despliegue; lo
  que falta es conectarlos con variables de entorno.
- **CI**: los workflows de GitHub Actions (`.github/workflows/`).

`NEXT_PUBLIC_SUPABASE_URL`: en local, `.env.local` apunta a `seadragons-dev`.
En preview, apunta a `seadragons-dev`, **nunca** al proyecto de producción. En
producción, apunta a `seadragons-prod`. En CI no existe, y es a propósito: sin
ella, el guardia de entorno se salta las pruebas de RLS en vez de hablar con
ninguna base, así que un runner no puede tocar datos de nadie. La pone quien
desarrolla en local; en Vercel, quien administre el proyecto.

`NEXT_PUBLIC_SUPABASE_ANON_KEY`: en local, la del proyecto `seadragons-dev`.
En preview, la misma llave anónima de `seadragons-dev`. En producción, la
llave anónima de `seadragons-prod`, distinta a la de desarrollo. En CI no
existe, por el mismo motivo que la anterior. La pone quien desarrolla en local;
en Vercel, quien administre el proyecto.

`SUPABASE_SERVICE_ROLE_KEY`: la llave de servicio, la única que se salta
RLS. En local, la de `seadragons-dev`, en `.env.local`, nunca en un `.env`
versionado. **En preview no existe**, ni siquiera la de desarrollo: es lo que
impide que el preview de un fork reciba una credencial de escritura (ver
"Secretos por entorno"). En producción, la de `seadragons-prod`, nunca la misma
que desarrollo. En CI tampoco existe. La pone quien desarrolla en local; en
Vercel, quien administre el proyecto.

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
La leen `scripts/ui-preflight.sh` y las specs de Playwright para saber contra
qué servidor apuntar, y nadie más: la aplicación desplegada no la lee nunca.
Por eso no aplica a preview, a producción ni a CI, y ponerla en Vercel sería
configuración muerta. Quien necesite mover el puerto la exporta a mano.

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

`MIGRATIONS_TEST_DATABASE_URL`: opcional en local, y solo útil a quien tenga un
Postgres a mano: los tests del aplicador de migraciones crean y destruyen bases
desechables desde esa conexión, y se saltan solos si no está. No aplica a
preview ni a producción. En CI la pone `migrations.yml`, apuntando al Postgres
efímero del propio runner. **Nunca apunta a un proyecto de Supabase:** esos
tests truncan y borran bases.

`REQUIRE_MIGRATIONS_POSTGRES`: no se pone en local. No aplica a preview ni a
producción. En CI la pone solo `migrations.yml`, a `1`, para que la falta de
Postgres sea un fallo en vez de un salto silencioso. `checks.yml` no la pone a
propósito: ahí `npm test` corre sin base y saltarse esos tests es lo correcto.

**Qué protege este documento y qué no.** `tests/unit/entornos-doc.test.ts`
rechaza cualquier cadena con forma de clave de Supabase, en los dos formatos que
Supabase entrega: el JWT clásico y el nuevo con prefijo `sb_`. Nombrar una
variable no es filtrarla, así que el catálogo de arriba las nombra todas. Lo que
nunca puede aparecer aquí es un valor.
