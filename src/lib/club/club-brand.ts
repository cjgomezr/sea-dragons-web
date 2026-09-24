import { DEFAULT_ACCENT_COLOR } from "./accent-color";

/**
 * La marca del club (E18a, RF-1, RF-2 y RF-3): nombre, iniciales y acento, leídos de
 * `public.clubs` en vez de escritos en el código. Aquí vive la parte pura: el
 * respaldo, las iniciales derivadas y la caché. Hablar con Supabase es cosa de
 * `supabase-club-brand.ts`.
 */

export type ClubBrand = {
  readonly name: string;
  readonly initials: string;
  /** Tal cual lo guarda la base. Si se puede pintar lo decide
   * `accent-stylesheet.ts`. */
  readonly accentColor: string;
};

/** Lo que guarda la base. Sin iniciales es `null`, nunca la cadena vacía
 * (`clubs_initials_length` en `0022_club_brand.sql`). */
export type ClubBrandRow = {
  readonly name: string;
  readonly initials: string | null;
  readonly accentColor: string;
};

/** La red si la base no contesta: la marca sale en todas las pantallas, y una
 * caída no puede tumbarlas. Son los valores que `0022_club_brand.sql` sembró. */
export const DEFAULT_CLUB_BRAND: ClubBrand = {
  name: "Victoria Seadragons",
  initials: "VS",
  accentColor: DEFAULT_ACCENT_COLOR,
};

const DERIVED_INITIALS_WORD_COUNT = 2;

/** La primera letra de las dos primeras palabras del nombre, en mayúsculas. */
export function deriveInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, DERIVED_INITIALS_WORD_COUNT)
    .map((word) => word.charAt(0).toLocaleUpperCase())
    .join("");
}

function toClubBrand(row: ClubBrandRow): ClubBrand {
  return {
    name: row.name,
    initials: row.initials ?? deriveInitials(row.name),
    accentColor: row.accentColor,
  };
}

export type ClubBrandReader = {
  read(): Promise<ClubBrand>;
  /** Lo llama quien guarda un cambio de la marca, para que la siguiente
   * visita lo vea sin esperar a que caduque la caché. */
  invalidate(): void;
};

export type CachedClubBrandReaderOptions = {
  readonly fetchRow: () => Promise<ClubBrandRow>;
  readonly reportFailure: (error: unknown) => void;
  readonly timeToLiveMs: number;
  /** Una base que no contesta no devuelve un error: deja la consulta colgada,
   * y con ella cada pantalla. Pasado este plazo se pinta con el respaldo. */
  readonly readTimeoutMs: number;
  readonly now: () => number;
};

type CacheEntry = {
  readonly brand: Promise<ClubBrand>;
  readonly expiresAtMs: number;
};

async function fetchWithinTimeout(
  fetchRow: () => Promise<ClubBrandRow>,
  timeoutMs: number,
): Promise<ClubBrandRow> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`la base no contestó en ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([fetchRow(), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Una consulta por caducidad, no por visita. Se guarda la promesa y no el
 * valor, para que las visitas que llegan a la vez con la caché vacía compartan
 * la misma consulta. Un fallo se sirve con el respaldo y no se guarda: la
 * visita siguiente vuelve a intentarlo.
 */
export function createCachedClubBrandReader({
  fetchRow,
  reportFailure,
  timeToLiveMs,
  readTimeoutMs,
  now,
}: CachedClubBrandReaderOptions): ClubBrandReader {
  let cached: CacheEntry | null = null;

  function startFetch(): CacheEntry {
    const entry: CacheEntry = {
      brand: Promise.resolve()
        .then(() => fetchWithinTimeout(fetchRow, readTimeoutMs))
        .then(toClubBrand, (error: unknown) => {
          // Sólo si nadie la sustituyó entre medias: una invalidación
          // posterior ya dejó en la caché una consulta más nueva.
          if (cached === entry) {
            cached = null;
          }
          reportFailure(error);
          return DEFAULT_CLUB_BRAND;
        }),
      expiresAtMs: now() + timeToLiveMs,
    };
    return entry;
  }

  return {
    read(): Promise<ClubBrand> {
      if (cached === null || now() >= cached.expiresAtMs) {
        cached = startFetch();
      }
      return cached.brand;
    },
    invalidate(): void {
      cached = null;
    },
  };
}
