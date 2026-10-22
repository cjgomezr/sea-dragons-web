/** Sin mayúsculas ni acentos, para que "maria" encuentre a "María" (FR-017).
 * `NFD` separa cada letra de su tilde y el reemplazo se queda con la letra. */
function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** La búsqueda por nombre del directorio y de la lista de Evaluaciones. */
export function matchesNameSearch(fullName: string, search: string): boolean {
  return normalizeForSearch(fullName).includes(normalizeForSearch(search));
}

/** Dos nombres que se leen igual sin mirar mayúsculas, tildes ni los espacios
 * de los bordes: "Señor Squad" y " senor squad" (E32, D1). */
export function isSameName(one: string, other: string): boolean {
  return normalizeForSearch(one.trim()) === normalizeForSearch(other.trim());
}
