# PRD: E1 · Fundación técnica

**Estado:** aprobado · **Fecha:** 23 de agosto de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4) y
`docs/plan-maestro.md` (epic E1). Cubre FR-079, NFR-009, NFR-010, CON-002 y
CON-004.

## 1. Problema

El bootstrap dejó un esqueleto que camina (una página, un endpoint de salud, un
tema claro/oscuro y una tabla `clubs`), pero no las piezas que los otros quince
epics van a repetir cientos de veces: cómo responde un endpoint de la API v1,
cómo se audita una acción sensible, cómo se prueba que una política RLS
realmente niega lo que debe negar, y qué aspecto tiene la aplicación. Sin eso,
cada epic inventaría su propia convención y habría que unificarlas después.

El costo es concreto: `design-system.md` lleva hoy un azul por defecto
(`#2563EB`) marcado como provisional, aunque el prototipo real de Claude Design
está en el repo con los colores del club. Cada ticket de UI que se trabaje antes
de corregirlo produce pantallas que habrá que rehacer, y su revisión visual cae
al modo heurístico por falta de mockups.

## 2. Usuarios y contexto

- **Usuario primario:** los agentes de la fábrica y quien revise sus PRs. E1 es
  infraestructura: lo consumen los tickets de E2 a E16, no un miembro del club.
- **Usuario secundario:** cualquier persona del club que abra la aplicación y
  deba reconocerla como el sitio de los Seadragons y no como una plantilla.
- **Hoy lo resuelve así:** no hay convención escrita. El único endpoint
  existente (`/api/v1/health`) devuelve una forma propia que nadie declaró como
  contrato.

## 3. Objetivo y métricas de éxito

Objetivo: que un ticket de E2 en adelante pueda escribirse sin decidir nada de
plataforma.

- Todo endpoint nuevo usa el helper de respuesta de RF-3, verificable con un
  test que falle si un handler devuelve una forma distinta.
- Toda acción sensible que los epics posteriores registren cabe en
  `recordAuditEvent` sin cambiar su firma.
- El `ui-reviewer` trabaja en modo comparación (Modo A) en el 100% de los
  tickets de UI posteriores, porque cada pantalla tiene su imagen en
  `docs/mockups/`.
- Los valores de color y tipografía de `design-system.md` coinciden con los del
  prototipo, comprobable con una lectura del `.dc.html`.

## 4. Alcance

**Incluido (v1):**

- Tokens de marca del prototipo aplicados al design system y al CSS global.
- Exportación de las pantallas del prototipo a `docs/mockups/`.
- Convención de respuesta, códigos y errores de la API v1.
- Tabla `audit_log` con `club_id` y RLS, más su helper de escritura.
- Arnés para probar políticas RLS.
- App shell con la navegación de las secciones del producto y rutas de destino
  vacías.

**Ya entregado por el bootstrap, no se rehace:**

- `supabase/migrations/0001_clubs.sql` con el patrón obligatorio `club_id` + RLS
  y el club único de CON-004.
- FR-079 (tema claro/oscuro con persistencia): `src/lib/theme.ts`,
  `src/components/ThemeToggle.tsx`, `src/components/ThemeScript.tsx` y sus tests
  en `tests/unit/theme.test.ts`, `tests/unit/theme-toggle.test.tsx` y
  `tests/theme.spec.ts`. E1 no vuelve a implementarlo; RF-1 y RF-6 solo cambian
  cómo se ve.
- `src/app/api/v1/health/route.ts` y `src/lib/health.ts`, que RF-3 adapta a la
  convención en lugar de reescribir.

**Explícitamente fuera (por ahora):**

- Autenticación, sesión y cualquier tabla de miembros: eso es E2 y E5.
- Entornos, hosting, migraciones en CI y scheduler: eso es E16.
- El contenido real de las secciones del menú: cada epic llena la suya.
- Middleware de autorización: la convención de RF-3 deja el hueco, pero el
  permission matrix se implementa en E3.

## 5. Requerimientos funcionales

### RF-1 · Tokens de marca del prototipo · Must

`design-system.md` y `src/app/globals.css` usan los valores del handoff de
diseño en lugar de los provisionales.

- **Dado** el prototipo `docs/Seadragons Platform.dc.html`, **cuando** se lee su
  bloque de variables, **entonces** `design-system.md` declara acento `#1C6EA4`
  en claro y `#33A1E0` en oscuro, fondo `#EFF3F7` y `#0C1A26`, panel `#FFFFFF` y
  `#13283A`, texto `#1C3245` y `#E8F0F7`, borde `#DEE6ED` y `#274055`, éxito
  `#2E9E86` y `#6FD6B4`, aviso `#C99A3E` y `#F2CE78`.
- **Dado** el mismo prototipo, **cuando** se revisa la tipografía, **entonces**
  el design system declara Archivo para texto, Space Grotesk para titulares y
  Space Mono para datos y etiquetas monoespaciadas, con familias de respaldo del
  sistema.
- **Dado** un usuario en tema claro y otro en oscuro, **cuando** cargan
  cualquier pantalla, **entonces** los colores renderizados son los del token
  correspondiente y el contraste de texto sobre fondo cumple WCAG AA.
- **Dado** que el cambio altera píxeles, **cuando** corre `npx playwright test`,
  **entonces** las líneas base de `tests/ui.spec.ts-snapshots` están regeneradas
  y pasan.

### RF-2 · Mockups del prototipo en `docs/mockups/` · Must

Cada pantalla del prototipo existe como imagen para que el `ui-reviewer` compare
contra el diseño.

- **Dado** el prototipo renderizado, **cuando** corre el script de exportación,
  **entonces** `docs/mockups/` contiene una imagen por pantalla web (dashboard,
  directory, calendar, attendance, team, evaluations, news, payments y auth) y
  por pantalla móvil (home, calendar, team, news, payments).
- **Dado** que el producto tiene dos temas, **cuando** se exporta, **entonces**
  cada pantalla existe en claro y en oscuro, con el tema en el nombre del
  archivo.
- **Dado** un archivo de mockup, **cuando** se abre, **entonces** mide al menos
  1320 px de ancho en las vistas web y 390 px en las móviles, suficiente para
  juzgar tipografía y espaciado.
- **Dado** que el script debe poder repetirse, **cuando** se ejecuta dos veces
  seguidas, **entonces** produce el mismo conjunto de archivos sin intervención
  manual.

### RF-3 · Convención de la API v1 · Must

Todo handler bajo `src/app/api/v1` responde con la misma forma, los mismos
códigos y el mismo tratamiento de errores.

- **Dado** un handler que termina bien, **cuando** responde, **entonces** el
  cuerpo es `{ "data": ... }` con código 200 o 201, y nunca mezcla datos con
  campos de error.
- **Dado** un handler que falla, **cuando** responde, **entonces** el cuerpo es
  `{ "error": { "code": ..., "message": ... } }` con un `code` de un conjunto
  cerrado y tipado, y el código HTTP que le corresponde: 400 validación, 401 sin
  sesión, 403 sin permiso, 404 no existe, 409 conflicto, 422 regla de negocio,
  500 fallo inesperado.
- **Dado** un cuerpo de petición que no cumple el esquema declarado, **cuando**
  llega al handler, **entonces** se rechaza con 400 y un mensaje que nombra los
  campos inválidos, sin llegar a la base de datos.
- **Dado** un error inesperado dentro de un handler, **cuando** se propaga,
  **entonces** la respuesta es 500 con un mensaje genérico, el detalle se
  registra en el servidor, y ningún mensaje de Postgres o de Supabase llega al
  cliente.
- **Dado** el endpoint `/api/v1/health` ya existente, **cuando** se aplica la
  convención, **entonces** responde con la misma forma que el resto y sus tests
  siguen pasando.

### RF-4 · `audit_log` y su helper · Must

Existe dónde y cómo registrar las acciones que NFR-010 exige retener.

- **Dado** el esquema, **cuando** se aplica la migración, **entonces** existe
  `public.audit_log` con `club_id` obligatorio, actor, acción, entidad afectada,
  resultado, metadatos en JSON y marca de tiempo, con RLS habilitado.
- **Dado** un usuario autenticado que no es Admin, **cuando** consulta
  `audit_log` por API directa, **entonces** no obtiene ninguna fila.
- **Dado** una acción sensible, **cuando** el código llama a
  `recordAuditEvent`, **entonces** queda una fila con actor, marca de tiempo y
  resultado, y la llamada no puede escribir en otro club que el suyo.
- **Dado** que el registro falla (base caída), **cuando** ocurre dentro de una
  operación de negocio, **entonces** el error se propaga con contexto en lugar
  de silenciarse.

### RF-5 · Arnés de pruebas de RLS · Must

Se puede escribir un test que demuestre que una política niega lo que debe
negar, y los epics siguientes lo reutilizan.

- **Dado** el arnés, **cuando** un test pide un cliente para un rol concreto,
  **entonces** recibe un cliente Supabase que actúa con ese rol y no con la
  llave de servicio.
- **Dado** una tabla con RLS, **cuando** el test consulta como usuario sin
  permiso, **entonces** el resultado es vacío o error de permiso, y el test lo
  afirma explícitamente.
- **Dado** un entorno sin credenciales de Supabase, **cuando** corre la suite,
  **entonces** los tests de RLS se saltan con un mensaje que dice qué falta, y
  el resto de la suite pasa.
- **Dado** el arnés recién escrito, **cuando** se ejecuta contra `clubs` y
  `audit_log`, **entonces** hay al menos un test que pasa y uno que demuestra la
  negación.

### RF-6 · App shell con navegación por secciones · Must

La aplicación se ve como el prototipo y permite llegar a cada sección.

- **Dado** un usuario en escritorio, **cuando** abre la aplicación, **entonces**
  ve la barra lateral del prototipo con las secciones Dashboard, Directorio,
  Calendario, Equipos, Evaluaciones, Noticias y Pagos, más la marca del club y
  el conmutador de tema.
- **Dado** un usuario en móvil (375 px), **cuando** abre la aplicación,
  **entonces** la navegación se adapta al patrón móvil del prototipo sin
  scroll horizontal.
- **Dado** que se selecciona una sección, **cuando** se navega a ella,
  **entonces** su ruta existe, muestra un marcador de "en construcción" con el
  nombre de la sección y el elemento de navegación queda marcado como actual.
- **Dado** cualquier pantalla, **cuando** se recorre con teclado, **entonces**
  el foco es visible en cada elemento interactivo y `axe` no reporta
  violaciones.

## 6. Casos borde y estados de error

- **Prototipo sin red:** `docs/support.js` carga React 18 desde unpkg. Si la
  máquina que exporta los mockups no tiene salida a internet, el script debe
  fallar con un mensaje claro, y la alternativa es vendorizar `react` y
  `react-dom` junto al prototipo antes de capturar.
- **Base de datos no configurada:** sin variables de Supabase, los endpoints
  responden 503 con el código de error correspondiente (ya lo hace `health`) y
  los tests de RLS se saltan. Nunca se cae con una excepción sin manejar.
- **Ruta desconocida bajo `/api/v1`:** responde 404 con la forma de error de la
  convención, no con el HTML de error de Next.
- **Viewport estrecho (360 px, el mínimo de ASS-004):** el shell no produce
  scroll horizontal.
- **Tema del sistema en oscuro y preferencia guardada en claro:** gana la
  preferencia guardada, que es lo que ya hacen los tests del bootstrap.
- **Escritura concurrente en `audit_log`:** dos acciones simultáneas del mismo
  actor producen dos filas, no una perdida.

## 7. UX / UI

- **Mockups:** `docs/Seadragons Platform.dc.html` es la fuente. RF-2 lo convierte
  en imágenes bajo `docs/mockups/`, que es donde los tickets posteriores apuntan
  y donde el `ui-reviewer` busca su referencia de Modo A.
- **Flujo principal:** abrir la aplicación, reconocer la marca, moverse entre
  secciones, cambiar de tema.
- **Viewports a soportar:** 375 / 768 / 1440.

## 8. Requerimientos no funcionales

- **Rendimiento:** el shell no añade dependencias de cliente pesadas; la
  navegación entre secciones es de servidor salvo el conmutador de tema.
- **Accesibilidad:** cumple `design-system.md`, `axe` sin violaciones, foco
  visible, contraste AA con los tokens nuevos.
- **Seguridad:** `audit_log` nace con RLS (NFR-009, NFR-010). Ningún mensaje de
  error filtra detalle interno al cliente.
- **Compatibilidad:** la convención de RF-3 tiene que servir tal cual a la app
  React Native de Release 2 (CON-002), así que el contrato es JSON puro y no
  depende de nada específico del navegador.

## 9. Preguntas abiertas

Ninguna. Los bloqueadores del SRD que tocaban a E1 (P1 el stack, P5 la columna
de issues, §5 el prototipo ausente) quedaron resueltos el 23 de agosto de 2026 y
están registrados en `docs/preguntas-abiertas.md`.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                               | Tamaño | Depende de | Auto-merge sugerido                                              |
| --- | ------------------------------------------------------------------------------ | ------ | ---------- | ---------------------------------------------------------------- |
| 1   | Aplicar los tokens de marca del prototipo a `design-system.md` y `globals.css` | S      | ninguna    | Sí: cambio de estilos fijado por las líneas base visuales        |
| 2   | Exportar las pantallas del prototipo a `docs/mockups/`                         | S      | ninguna    | Sí: genera documentación, no toca código de runtime              |
| 3   | Convención de respuesta y errores de la API v1                                 | M      | ninguna    | No: es el contrato base que consumen los quince epics siguientes |
| 4   | Tabla `audit_log` con `club_id` y RLS más el helper `recordAuditEvent`         | M      | ninguna    | No: dato sensible y frontera de seguridad                        |
| 5   | Arnés de pruebas de RLS reutilizable                                           | M      | 4          | No: define cómo se verifica la seguridad del resto del proyecto  |
| 6   | App shell con navegación por secciones y rutas de destino                      | M      | 1, 2       | No: pantalla nueva sin línea base previa que la fije             |

`ui-review` sugerido para los tickets 1 y 6, que son los que cambian lo que se
ve. Los tickets 3, 4 y 5 son backend puro y 2 solo produce imágenes de
referencia.
