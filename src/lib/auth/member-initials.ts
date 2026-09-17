/** Las iniciales de la cabecera de Mi cuenta (docs/mockups/mobile-profile-light.png):
 * la primera letra del nombre y la del último apellido, que es como se
 * reconoce a alguien en el club. Se toma el primer carácter entero, no la
 * primera unidad UTF-16, para no partir una letra fuera del plano básico. */
export function memberInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return [first, last]
    .flatMap((word) => (word === undefined ? [] : [[...word][0] ?? ""]))
    .join("")
    .toLocaleUpperCase();
}
