/** El orden alfabético de las listas de grupos y de socios, sin distinguir
 * mayúsculas. Se ordena en el adaptador y no con `order by`, que seguiría el
 * collation de la base: con `C`, "alevines" saldría detrás de "Senior Squad",
 * y dev y producción podrían no coincidir. */
const NAME_ORDER = new Intl.Collator("en", { sensitivity: "base" });

/** "Élite" y "Elite" empatan para el collator y los dos caben en la base; el
 * desempate por código hace que su orden no dependa de cómo lleguen las filas. */
export function compareNames(a: string, b: string): number {
  const byName = NAME_ORDER.compare(a, b);
  if (byName !== 0) {
    return byName;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
