# Cómo empezar a trabajar en Seadragons

Guía para quien se suma al equipo. Desde una máquina vacía hasta tener tu
primer ticket mergeado. Calcula una hora la primera vez.

Si algo no te funciona, salta al final: hay una tabla con los fallos que nos
han pasado a todos y su arreglo.

## 0. Qué vas a hacer, en corto

Los tickets viven en GitHub. Tú te asignas uno y lanzas un script: un agente lo
implementa en tu máquina, en una copia aislada del repositorio, escribiendo las
pruebas antes que el código. Cuando termina, abre un pull request y tú lo
revisas y lo mergeas.

Tu trabajo no es teclear el código, es **decidir qué se construye y comprobar
que lo construido está bien**. Eso incluye mirar capturas de pantalla, leer
descripciones de pull request y decir que no cuando algo no convence.

## 1. Accesos que necesitas antes de empezar

Pídeselos a quien lleva el proyecto si te falta alguno:

1. **GitHub:** permiso de escritura en `cjgomezr/sea-dragons-web`. Sin esto no
   puedes subir ramas.
2. **Supabase:** acceso al proyecto **`seadragons-dev`**, que es la base de
   desarrollo. Nunca vas a necesitar la de producción.
3. **Claude:** tu propia cuenta con Claude Code. El agente corre en tu máquina,
   con tu sesión.

## 2. Instalar el entorno

### 2.1 Programas

- **Node 22.** La versión exacta está en `.nvmrc`. Si usas `nvm`:
  `nvm install 22 && nvm use 22`.
- **git.**
- **GitHub CLI (`gh`).** Es la herramienta con la que la fábrica habla con
  GitHub. En Windows: `winget install GitHub.cli`.
- **jq.** Lo usan los scripts. En Windows: `winget install jqlang.jq`.

Comprueba que están:

```bash
node --version   # v22.x
gh --version
jq --version
```

### 2.2 El repositorio

```bash
git clone https://github.com/cjgomezr/sea-dragons-web.git
cd sea-dragons-web
npm install
npx playwright install --with-deps chromium
```

El último comando descarga el navegador con el que se toman las capturas de
pantalla. Si te lo saltas, cualquier ticket que toque una pantalla te va a
fallar sin decirte por qué.

### 2.3 Entrar en GitHub desde la terminal

```bash
gh auth login
gh auth refresh -s project
```

**El segundo comando no es opcional.** La fábrica mueve la tarjeta de cada
ticket en el tablero del proyecto, y el permiso para eso no viene con el
inicio de sesión normal. Si te lo saltas, tu primer ticket falla con un error
de permisos que no explica nada.

## 3. Las credenciales: tu archivo `.env.local`

La aplicación y buena parte de las pruebas hablan con Supabase de verdad. Para
eso necesitas un archivo `.env.local` en la raíz del repositorio. **No está en
git y nunca debe estarlo.**

Crea el archivo con estas cinco variables:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
RESEND_API_KEY=...
EMAIL_FROM=...
```

**De dónde sale cada una:**

- Las tres de Supabase, del panel de `seadragons-dev`, en **Settings → API**.
  La URL y la clave `anon` están a la vista. La `service_role` está más abajo,
  oculta tras un botón de revelar.
- Las dos de Resend te las pasa quien lleva el proyecto. Resend es lo que manda
  los correos de la aplicación.

**Tres reglas con esto:**

1. **Nunca uses las credenciales de producción.** Comprueba que la URL dice
   `seadragons-dev`. El proyecto tiene una guarda que se queja si apuntas a
   producción, pero no te fíes de ella.
2. **La clave `service_role` se salta todas las reglas de seguridad de la base
   de datos.** Trátala como una contraseña: nada de mandarla por chat de
   equipo ni pegarla en un issue.
3. **No la copies dentro del repositorio** en ningún otro archivo, ni en un
   comentario "temporal".

## 4. Comprobar que quedó bien

Corre esto en orden. Si algo falla, no sigas: mira la tabla del final.

```bash
npm run lint        # sin avisos
npm run typecheck   # sin errores
npm test            # unas 3.000 pruebas, unos 4 minutos
```

Después, levanta la aplicación:

```bash
npm run dev
```

Abre `http://localhost:3417`. Deberías ver la pantalla de entrar del club. Para
la suite de pantallas, **cierra antes el servidor** (Ctrl+C) y corre:

```bash
npx playwright test
```

Esa tarda unos minutos y abre y cierra el navegador solo. Si termina en verde,
tu entorno está listo.

> Importante: el servidor de desarrollo y las pruebas de pantalla usan el mismo
> puerto (3417). No los tengas corriendo a la vez.

## 5. Tu primer ticket, paso a paso

### 5.1 Elige y reserva

Mira los tickets de tu épica en GitHub. Los que se pueden trabajar están
etiquetados `pending` y **no** tienen ninguna etiqueta `blocked-by-N` de un
issue todavía abierto.

Reserva el tuyo asignándotelo. Eso es lo que impide que otra persona se lo
lleve:

```bash
gh issue edit 326 --add-assignee @me
```

### 5.2 Ponte al día con main

**Este paso se olvida y cuesta caro.** La copia aislada donde trabaja el agente
nace de tu `main` local, no del de GitHub. Si tu `main` tiene dos días, el
agente construye sobre código viejo y el conflicto aparece al final.

```bash
git checkout main
git pull --ff-only
```

### 5.3 Lanza la fábrica

```bash
ONLY_MINE=1 MAX_ISSUES=1 bash scripts/process-backlog.sh
```

Qué significa cada parte:

- `ONLY_MINE=1`: que solo mire tickets asignados a ti. Sin esto puede llevarse
  el de otra persona.
- `MAX_ISSUES=1`: que pare después de uno.

A partir de ahí el agente trabaja solo: se pone la etiqueta `in-progress`, crea
su rama `impl-326`, escribe las pruebas, implementa hasta que pasan, pide una
revisión de código y abre el pull request en borrador. Tarda entre 45 minutos y
2 horas según el tamaño.

**Puedes dejarlo corriendo y hacer otra cosa**, pero no cierres esa terminal y
no lances otro ticket en la misma máquina a la vez.

### 5.4 Cuando termina

Primero lee la descripción del pull request. Fíjate sobre todo en la sección
**⚠ Not verified**, si la hay: ahí el agente escribe lo que no pudo comprobar.

Después mira los checks en GitHub:

- **`checks`**: pruebas, lint y tipos.
- **`migraciones`**: aplica todas las migraciones del repositorio sobre una base
  vacía.
- **Visual baselines**: compara capturas de pantalla.

Si tu ticket cambió alguna pantalla, **la comparación visual va a salir roja, y
es lo normal**: significa "esto cambió, mira si querías que cambiara". Descarga
el artefacto `visual-diff` de esa corrida, abre las imágenes terminadas en
`-diff.png` y comprueba dos cosas: que el cambio es el que pedía el ticket, y
que **no cambió ninguna pantalla que tu ticket no tocaba**. Si cambió otra,
investiga antes de aceptar.

Cuando las hayas mirado y estés de acuerdo:

```bash
gh workflow run visual-baselines.yml --ref impl-326 -f reviewed_run_url=<url de la corrida roja>
```

Eso regenera las capturas y las guarda como referencia nueva. Tarda unos diez
minutos. Después habrá que aprobar las corridas que quedan esperando (las lanza
un bot y GitHub las deja en espera).

El proceso completo está explicado en `docs/como-funciona-la-fabrica.md`.

### 5.5 Mergear

Con todo en verde:

```bash
gh pr ready 340 && gh pr merge 340 --squash --delete-branch
git pull --ff-only
```

El pull request lleva `Closes #326`, así que el issue se cierra solo.

### 5.6 Si el agente se atasca

A veces termina poniendo la etiqueta `needs-human` y un comentario. Eso pasa
cuando el problema no lo puede resolver él: falta una credencial, un permiso, o
hay un conflicto que no se atreve a resolver. Lee su comentario: dice qué falta
y dónde conseguirlo.

## 6. Reglas de convivencia

Somos varios trabajando a la vez y compartimos dos cosas: la rama `main` y la
base de datos de desarrollo.

1. **Una fábrica por máquina, y una a la vez.** Dos agentes en el mismo
   portátil se pelean por el puerto 3417.
2. **Avisa antes de correr la suite de pantallas** si sabes que alguien más
   está en medio de un ticket. Esas pruebas crean y borran miembros de prueba
   en la base compartida, y dos corridas a la vez se estorban.
3. **Avisa cuando apliques una migración** en `seadragons-dev`. Es una base
   para todos.
4. **Mergea seguido y pequeño.** Dos pull requests de un día casi nunca chocan;
   dos de una semana chocan siempre.
5. **Cuando mergees, dilo.** Es la señal para que los demás actualicen su `main`
   y rebasen lo que tengan abierto.
6. **Cuidado con el número de la migración.** Si dos personas añaden una a la
   vez, las dos querrán el mismo número. Antes de empezar un ticket con
   migración, mira cuál es el último en `supabase/migrations/`.
7. **No trabajes dos tickets de la misma pantalla a la vez** que otra persona.
   El segundo tendrá que rehacer capturas.

## 7. Cuando algo falla

| Síntoma                                                              | Qué pasa                                                         | Arreglo                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| El primer ticket falla al mover la tarjeta del tablero               | A `gh` le falta el permiso `project`                             | `gh auth refresh -s project`                  |
| Las pruebas de pantalla fallan todas nada más empezar                | Falta el navegador de Playwright                                 | `npx playwright install --with-deps chromium` |
| "something already answers at http://localhost:3417"                 | Tienes el servidor de desarrollo abierto, o una corrida anterior | Cierra el servidor y vuelve a lanzar          |
| Fallan pruebas de integración con "rate limit" o inicios de sesión   | Alguien más está corriendo la suite contra la misma base         | Espera unos minutos y repite. No es tu código |
| `typecheck` falla en `.next/dev/types` después de correr la suite    | Tipos generados que quedaron a medias                            | Borra la carpeta `.next` y repite             |
| Fallan dos pruebas de migración con "invalid byte sequence for UTF8" | Fallo conocido de Windows con acentos en psql                    | Ignóralo, en CI pasan                         |
| Prettier reformatea archivos que no tocaste                          | El repositorio vive a 80 columnas                                | Déjalo reformatear y commitea el resultado    |
| El tablero dice "sub-issues not in this project"                     | GitHub tarda en indexar las tarjetas nuevas                      | Espera. Aparecen solas en unas horas          |

## 8. Dónde está escrito lo demás

- **`CLAUDE.md`**: las reglas que sigue el agente. Vale la pena leerlo entero
  una vez, porque explica por qué hace lo que hace.
- **`docs/como-funciona-la-fabrica.md`**: la fábrica explicada con diagramas,
  incluido el detalle de la comparación visual.
- **`docs/plan-maestro.md`**: todas las épicas, su orden y sus dependencias.
- **`docs/prd/<tu-épica>.md`**: los requisitos de lo que vas a construir. Léelo
  antes del primer ticket.
- **`docs/preguntas-abiertas.md`**: las decisiones que se tomaron y las que
  siguen abiertas.
- **`design-system.md`**: colores, espaciados y reglas de accesibilidad.

## 9. Lo primero que deberías hacer hoy

1. Termina los pasos 1 a 4 y comprueba que la suite pasa en tu máquina.
2. Lee el PRD de tu épica.
3. Coge el ticket más pequeño que esté libre y llévalo hasta el merge. Es la
   forma más rápida de entender el ciclo completo.
