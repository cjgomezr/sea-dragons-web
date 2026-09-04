---
name: nextjs-supabase-practices
description: Reglas idiomáticas de Next.js 16 (App Router) + Supabase para este proyecto. Úsala al escribir o revisar cualquier archivo .ts/.tsx bajo src/, cualquier migración SQL bajo supabase/migrations/, o cualquier handler de la API v1. Cubre Server vs Client Components, RLS como frontera de seguridad, manejo de errores de Supabase, contrato de los endpoints y qué se testea a qué nivel.
---

# Next.js + Supabase en Victoria Seadragons

Reglas que un agente puede APLICAR y un revisor puede VERIFICAR. Cada una tiene
un porqué que viene del SRD o del plan maestro. No son estilo: incumplirlas
produce bugs de seguridad o rompe CON-002.

## 1. La seguridad vive en la base de datos, no en la UI

**Toda tabla nace con RLS activo y al menos una policy explícita.** Una tabla
con `enable row level security` y sin policy niega todo, que es el fallo
seguro. Una tabla sin RLS es un incidente, no un descuido.

**Ocultar algo en la UI no es protegerlo.** NFR-004 exige aplicar la matriz de
permisos de la sección 4 del SRD en el servidor para el 100% de las peticiones.
El caso canónico es BR-007: un Player no puede leer evaluaciones **ni las
propias** (FR-055, AC-023). Si esa restricción vive solo en un `if` de React,
está rota: la API responde igual a quien la llame directo.

Regla práctica al escribir un ticket con datos sensibles: escribe primero el
test que ataca la API directamente con el rol equivocado y espera un rechazo.
Si ese test pasa sin policy, la policy falta.

**`club_id` en toda tabla nueva** (NFR-009), aunque Release 1 opere un solo
club. `clubs` es la única excepción: es la raíz del tenant. Ver el patrón
documentado en `supabase/migrations/0001_clubs.sql`.

**Toda tabla declara sus `GRANT` explícitos.** Este proyecto de Supabase no
trae los permisos por defecto para `anon`, `authenticated` ni `service_role`:
sin un `grant`, PostgREST responde `401 permission denied` antes de que RLS
llegue a evaluarse. El peligro no es el 401, es el falso verde que produce. Un
test que espera "este rol no debe ver nada" pasa igual, sin que la policy se
haya ejecutado nunca. El patrón, junto al de `club_id`, está en
`supabase/migrations/0001_clubs.sql`:

```sql
grant select on public.<tabla> to anon, authenticated;
grant select, insert, update, delete on public.<tabla> to service_role;
```

Concede solo los verbos que la tabla necesita: `audit_log` es de inserción y
lectura, así que nadie recibe `update` ni `delete`. El `GRANT` abre la puerta;
quién ve qué filas lo sigue decidiendo RLS.

**La `service_role` key nunca sale del servidor.** No se importa en un
componente cliente, no se pone en una variable `NEXT_PUBLIC_*`, no se pasa como
prop. Solo `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` son
públicas, y lo son porque RLS es lo que protege los datos detrás de ellas.
Si un handler necesita saltarse RLS, ese es un motivo que se justifica en la
descripción del PR.

## 2. Server Components por defecto

Un componente es de servidor salvo que necesite estado, efectos, eventos del
navegador o APIs del DOM. `"use client"` es una decisión que se justifica, no
el arranque por defecto.

Empuja el `"use client"` hacia las hojas del árbol. Marcar un layout entero
como cliente arrastra consigo todo lo que renderiza.

Nunca leas secretos ni construyas clientes privilegiados de Supabase dentro de
un componente marcado `"use client"`: ese código se envía al navegador.

## 3. Los endpoints de `src/app/api/v1` son el producto, no un detalle

CON-002: Release 2 es una app React Native que consume **exactamente** estos
endpoints. Un handler que asume que el llamador es la web propia es un bug
futuro.

- Toda funcionalidad se expone bajo `src/app/api/v1/...`. La versión en la ruta
  no se negocia.
- Cada handler declara su tipo de retorno explícito (`Promise<NextResponse>`).
- La forma de la respuesta es un tipo nombrado y exportado, no un objeto
  literal improvisado en el `return`.
- Los errores se responden con un código HTTP correcto y un cuerpo que dice qué
  pasó. Ver `src/app/api/v1/health/route.ts`: sin credenciales responde 503 y
  nombra las variables que faltan, en vez de fingir que está sano.
- `export const dynamic = "force-dynamic"` en cualquier handler cuya respuesta
  dependa del usuario, de la sesión o del estado actual de la base. Un endpoint
  de datos personales cacheado como estático filtra datos entre usuarios.

## 4. Los errores de Supabase no se tragan

El cliente de Supabase **no lanza**: devuelve `{ data, error }`. Un
`const { data } = await supabase.from(...)` que ignora `error` es la forma más
fácil de convertir un fallo en un `null` silencioso que revienta tres capas más
arriba.

Siempre:

```ts
const { data, error } = await supabase.from("events").select("*");
if (error) {
  // manejarlo o propagarlo con contexto; nunca seguir como si nada
}
```

Prohibido `?? []`, `|| {}` y cadenas de `?.` puestas para que el tipo compile
cuando lo que hay debajo es un error sin mirar.

## 5. Tipos: el dominio se modela, no se aproxima

- Uniones discriminadas antes que objetos con campos opcionales. Los estados
  del SRD son discretos y se modelan como tales: el RSVP es
  `"yes" | "maybe" | "no"` (FR-034), la asistencia es
  `"present" | "late" | "absent"` (FR-038), el rol es uno de cuatro (FR-012).
  Un `status?: string` es una invitación a estados imposibles.
- Nada de `any`. Para lo que llega de fuera, `unknown` y estrecha.
- Los tipos generados de la base son la fuente de verdad de las filas; no
  reescribas a mano la forma de una tabla en TypeScript.
- Dinero: importes en AUD y **siempre en centavos enteros** (CON-005,
  NFR-006). Nunca un `number` en float para un precio.

## 6. Qué se testea a qué nivel

La cáscara ya deja el patrón montado, síguelo:

- **Lógica pura en `src/lib/`** con Vitest. Es donde van los cálculos del SRD:
  el porcentaje de asistencia (FR-042), el OVR (FR-052), el auto-balance
  (FR-046). Extraerlos de los componentes es lo que los hace testeables.
- **Componentes** con Testing Library, consultados por rol y nombre accesible
  (`getByRole("button", { name: ... })`), nunca por clase CSS ni por
  `data-testid`. Si no se puede consultar por rol, probablemente el componente
  tiene un problema de accesibilidad, no el test.
- **Policies RLS**: su test ataca la API o la base con el rol equivocado y
  espera el rechazo. Una policy sin ese test no está verificada.
- **Playwright** para lo que solo existe en un navegador real: persistencia
  entre recargas, regresión visual y axe. El caso que ya está en el repo
  (`tests/theme.spec.ts`) encontró un bug real que los unitarios no veían.

Convención de extensiones, no la rompas: `*.test.ts(x)` es Vitest,
`*.spec.ts` es Playwright. Los dos runners se reparten por ahí.

## 7. Trampas específicas de este proyecto

**Zona horaria.** El club es de Melbourne y opera en AEST/AEDT (NFR-003). Los
eventos recurrentes (FR-030, FR-031) generan ocurrencias que pueden cruzar un
cambio de horario de verano. Guarda instantes en UTC (`timestamptz`), pero
genera las ocurrencias sobre la hora local del club, o la sesión de las 19:00
se mueve sola a las 18:00 a mitad de temporada.

**Las líneas base visuales son por plataforma.** Las de Windows (`-win32`) no
le sirven al worker de la nube (`-linux`). Si cambias la UI en local, tras
mergear ejecuta `gh workflow run visual-baselines.yml` para regenerar las de
Linux, o el Stop gate de CI bloqueará el siguiente ticket.

**El puerto es el 3417 y es estricto.** Si algo ya responde ahí, no es tu
servidor: libéralo. Nunca apuntes los tests a otro puerto para esquivarlo.

**Nunca imprimas el contenido de un `.env*`.** Para comprobar que una variable
existe: `grep -c '^NOMBRE=' .env.local`.
