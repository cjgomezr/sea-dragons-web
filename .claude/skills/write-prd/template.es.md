# PRD: [Nombre de la funcionalidad]

**Estado:** borrador | aprobado · **Fecha:** [...] · **Autor:** [...]

## 1. Problema

[2-4 frases. Qué duele, a quién, y qué pasa hoy sin esta funcionalidad.
Con evidencia si existe: métricas, quejas, tickets de soporte.]

## 2. Usuarios y contexto

- **Usuario primario:** [quién, qué sabe, desde qué dispositivo]
- **Hoy lo resuelve así:** [workaround actual]

## 3. Objetivo y métricas de éxito

- Objetivo: [una frase]
- Métricas: [ej. "el 80% de los usuarios completa X en < 2 min", "reducir tickets de soporte de Y en 50%"]

## 4. Alcance

**Incluido (v1):** [...]
**Explícitamente fuera (por ahora):** [...]

## 5. Requerimientos funcionales

### RF-1 · [Nombre] · [Must|Should|Could]

[Descripción en una frase.]

- **Dado** ..., **cuando** ..., **entonces** ...
- **Dado** ..., **cuando** ..., **entonces** ...

### RF-2 · [Nombre] · [Must|Should|Could]

[...]

## 6. Casos borde y estados de error

- [Estado vacío: ...]
- [Límites: entrada máxima, listas enormes, ...]
- [Errores: red caída, permisos insuficientes, ...]
- [Concurrencia: dos usuarios editan a la vez → ...]

## 7. UX / UI

- Mockups: [rutas o "sin mockup: aplica design-system.md"]
- Flujos: [pasos del flujo principal]
- Viewports a soportar: 375 / 768 / 1440

## 8. Requerimientos no funcionales

- Rendimiento: [ej. respuesta < 200ms p95]
- Accesibilidad: cumple design-system.md (axe sin violaciones)
- Seguridad: [autenticación/autorización relevante]

## 9. Preguntas abiertas

- [ ] [Pregunta que bloquea algún RF, y de quién es la respuesta]

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto | Tamaño | Depende de | Auto-merge sugerido                      |
| --- | ---------------- | ------ | ---------- | ---------------------------------------- |
| 1   | [...]            | S      | ninguna    | Sí: [razón en una línea]                 |
| 2   | [...]            | M      | 1          | No: [toca lógica de negocio o seguridad] |
