# [Título imperativo y específico]

## Contexto

[1-3 frases: por qué existe esta tarea, qué problema del usuario resuelve.
Enlace al PRD/issue padre si aplica.]

## Criterios de aceptación

- [ ] **Dado** [estado inicial], **cuando** [acción], **entonces** [resultado observable]
- [ ] **Dado** ..., **cuando** ..., **entonces** ...

<!-- Cada criterio = un test. Incluir siempre los casos borde. -->

## Tests esperados (escribir PRIMERO, antes del código: TDD)

- `describe("...")`: [comportamiento feliz]
- `describe("...")`: [caso borde: vacío / null / entrada enorme]
- `describe("...")`: [caso de error: dependencia externa falla]

## UI (solo si aplica)

- Mockup: `[docs/mockups/pantalla.png]`, o bien "Sin mockup: revisión heurística contra design-system.md"
- Pantallas a verificar: [...]
- Viewports: 375 / 768 / 1440

## Fuera de alcance

- [Lo que explícitamente NO se hace en este ticket]

## Notas técnicas (opcional)

- [Archivos probablemente afectados, decisiones ya tomadas, gotchas]

---

Labels: `pending`, `priority:[high|medium|low]`, `size:[S|M]`[, `blocked-by-N`]
