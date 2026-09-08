# Entornos

Dos proyectos de Supabase, separados, en la misma organización (SeaDragons) y
la misma región. Ver `docs/prd/e16a-entornos-y-despliegue.md` (RF-1) para el
porqué de la separación.

## seadragons-dev

- **Ref:** `xcfrpcvomjjmfoztifuo`
- **Región:** `ap-southeast-2` (Sídney)
- **Para qué sirve:** desarrollo y tests. Es la base que los tests de RLS
  truncan y resiembran en cada corrida. Nunca debe recibir datos reales de un
  socio: si el registro se abriera antes de tener producción, esos datos
  quedarían mezclados con datos de prueba.

## seadragons-prod

- **Ref:** pendiente. El proyecto todavía no existe. Crearlo exige entrar al
  dashboard de Supabase con la cuenta del dueño (organización SeaDragons,
  nombre `seadragons-prod`, plan Free); ningún worker headless puede hacerlo.
  Ver issue #89.
- **Región:** `ap-southeast-2` (Sídney), la misma que desarrollo, por
  residencia de datos personales en Australia (NFR-011).
- **Para qué sirve:** datos reales de los socios del club. Ningún test debe
  poder alcanzarlo, ni siquiera por accidente: el guardia de entorno de la
  suite (`src/lib/supabase/environment-guard.ts`, enganchado en
  `tests/support/rls.ts`) falla de inmediato si la URL configurada no es la de
  `seadragons-dev`.

## Credenciales

Ninguna clave de ningún proyecto vive en este documento ni en ningún otro
archivo versionado del repositorio. Cada entorno declara sus variables en
`.env.local` (local, fuera de git) o en los secretos de despliegue
correspondientes; qué variable hace falta y para qué sirve está descrito en
`.env.local.example`, sin valores reales.
