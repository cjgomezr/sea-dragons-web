/**
 * De qué cliente viene una petición, reducido a un cubo contra el que contar
 * peticiones (#173).
 *
 * En Vercel la IP del cliente llega en `x-forwarded-for` (primer valor, el que
 * pone el borde) o en `x-real-ip`. Fuera de Vercel esas cabeceras las puede
 * poner cualquiera, así que esto limita el abuso corriente y no a un atacante
 * decidido: contra una ráfaga repartida entre muchas procedencias no hace
 * nada, y eso se resuelve en otro sitio.
 *
 * El valor que devuelve no se guarda en claro en ninguna parte: quien lo anota
 * guarda un hash con clave (ver `supabase-registration-request-log.ts`).
 */

const FORWARDED_FOR_HEADER = "x-forwarded-for";
const REAL_IP_HEADER = "x-real-ip";

/** Cubo de quien no trae ninguna cabecera de IP. Es uno solo y compartido a
 * propósito: sin él, quitar la cabecera sería la forma de saltarse el límite. */
export const SHARED_CLIENT_BUCKET = "(sin ip)";

const IPV6_GROUPS = 8;
/** Un cliente doméstico recibe un /64 entero, así que contar por dirección
 * exacta no limita nada: bastaría cambiar el último grupo en cada petición. */
const IPV6_PREFIX_GROUPS = 4;

const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/;

function areHexGroups(groups: readonly string[]): boolean {
  return groups.every((group) => IPV6_GROUP_PATTERN.test(group));
}

function splitGroups(part: string): string[] {
  return part === "" ? [] : part.split(":");
}

/** Los ocho grupos de una IPv6, con el `::` desplegado y cada grupo sin ceros
 * a la izquierda. Devuelve `null` si el texto no es una IPv6 que este código
 * sepa leer: una dirección rara no debe tumbar el registro, sólo contar como
 * su propio cubo. */
function expandIpv6(address: string): string[] | null {
  const parts = address.split("::");
  if (parts.length > 2) {
    return null;
  }

  const head = splitGroups(parts[0] ?? "");
  const tail = parts.length === 2 ? splitGroups(parts[1] ?? "") : [];
  if (!areHexGroups(head) || !areHexGroups(tail)) {
    return null;
  }

  const missing = IPV6_GROUPS - head.length - tail.length;
  if (parts.length === 2 ? missing < 1 : missing !== 0) {
    return null;
  }

  return [...head, ...Array<string>(missing).fill("0"), ...tail].map((group) =>
    group.replace(/^0+(?=.)/, ""),
  );
}

/** Deja una IPv6 reducida a su /64; cualquier otra cosa se queda como está.
 * Una IPv4 ya identifica a un cliente por sí sola. */
function toBucket(address: string): string {
  if (!address.includes(":")) {
    return address;
  }
  const groups = expandIpv6(address);
  return groups === null
    ? address
    : groups.slice(0, IPV6_PREFIX_GROUPS).join(":");
}

/** `x-forwarded-for` es una lista, y el primer valor es el cliente: los demás
 * son los proxies por los que pasó. */
function firstValueOf(header: string | null): string | null {
  const first = header?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first === "" ? null : first;
}

function readFirstAddress(headers: Headers): string | null {
  for (const header of [FORWARDED_FOR_HEADER, REAL_IP_HEADER]) {
    const address = firstValueOf(headers.get(header));
    if (address !== null) {
      return address;
    }
  }
  return null;
}

/** El cubo contra el que se cuentan las peticiones de esta petición. */
export function readClientBucket(headers: Headers): string {
  const address = readFirstAddress(headers);
  return address === null ? SHARED_CLIENT_BUCKET : toBucket(address);
}
