/**
 * Los límites de la búsqueda global (#425, RF-7 del PRD de E14), aparte de
 * `search.ts` para que la pantalla (#427) los comparta con el servidor sin
 * arrastrar al navegador lo que sólo corre en él.
 */

/** Cuántos resultados enseña cada grupo (RF-7). */
export const SEARCH_GROUP_SIZE = 5;

/** Con una sola letra coincide medio club: no es una búsqueda (RF-7). */
export const SEARCH_TEXT_MIN_LENGTH = 2;
