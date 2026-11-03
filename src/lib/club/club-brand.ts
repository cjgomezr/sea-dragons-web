import { DEFAULT_ACCENT_COLOR } from "./accent-color";
import { NO_SIGN_IN_TEXTS, type SignInTexts } from "./sign-in-texts";
import { NO_SOCIAL_LINKS, type SocialLinks } from "./social-links";

/**
 * La marca del club (E18a, RF-1 a RF-4): nombre, iniciales, acento y logo, leídos de
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
  /** La dirección pública del logo (#295). Sin logo, la marca son las
   * iniciales. */
  readonly logoUrl: string | null;
  /** El lema y el párrafo del inicio de sesión (#301). Un idioma sin texto
   * del club usa el del catálogo. */
  readonly signInTexts: SignInTexts;
  /** Las redes del club (#964): la entrada y la navegación las enseñan. */
  readonly socialLinks: SocialLinks;
};

/** Lo que guarda la base. Sin iniciales es `null`, nunca la cadena vacía
 * (`clubs_initials_length` en `0022_club_brand.sql`). */
export type ClubBrandRow = {
  readonly name: string;
  readonly initials: string | null;
  readonly accentColor: string;
  readonly logoUrl: string | null;
  readonly signInTexts: SignInTexts;
};

/** La red si la base no contesta: la marca sale en todas las pantallas, y una
 * caída no puede tumbarlas. Son los valores que `0022_club_brand.sql` sembró. */
export const DEFAULT_CLUB_BRAND: ClubBrand = {
  name: "Victoria Seadragons",
  initials: "VS",
  accentColor: DEFAULT_ACCENT_COLOR,
  logoUrl: null,
  signInTexts: NO_SIGN_IN_TEXTS,
  socialLinks: NO_SOCIAL_LINKS,
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

function toClubBrand(row: ClubBrandRow, socialLinks: SocialLinks): ClubBrand {
  return {
    name: row.name,
    initials: row.initials ?? deriveInitials(row.name),
    accentColor: row.accentColor,
    logoUrl: row.logoUrl,
    signInTexts: row.signInTexts,
    socialLinks,
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
  /** Las redes van aparte (#964): si no se pueden leer, la marca se pinta
   * igual, sin ellas, en vez de caer entera al respaldo. */
  readonly fetchSocialLinks: () => Promise<SocialLinks>;
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

async function fetchWithinTimeout<T>(
  fetch: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`la base no contestó en ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([fetch(), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

type Fetched<T> =
  | { readonly kind: "read"; readonly value: T }
  | { readonly kind: "failed"; readonly error: unknown };

function settle<T>(fetching: Promise<T>): Promise<Fetched<T>> {
  return fetching.then(
    (value): Fetched<T> => ({ kind: "read", value }),
    (error: unknown): Fetched<T> => ({ kind: "failed", error }),
  );
}

/**
 * Una consulta por caducidad, no por visita. Se guarda la promesa y no el
 * valor, para que las visitas que llegan a la vez con la caché vacía compartan
 * la misma consulta. Un fallo se sirve con el respaldo y no se guarda: la
 * visita siguiente vuelve a intentarlo. Si sólo fallan las redes, la marca
 * sale sin ellas.
 */
export function createCachedClubBrandReader({
  fetchRow,
  fetchSocialLinks,
  reportFailure,
  timeToLiveMs,
  readTimeoutMs,
  now,
}: CachedClubBrandReaderOptions): ClubBrandReader {
  let cached: CacheEntry | null = null;

  async function fetchBrand(entry: CacheEntry): Promise<ClubBrand> {
    const [row, socialLinks] = await Promise.all([
      settle(fetchWithinTimeout(fetchRow, readTimeoutMs)),
      settle(fetchWithinTimeout(fetchSocialLinks, readTimeoutMs)),
    ]);
    const failures = [row, socialLinks].flatMap((fetched) =>
      fetched.kind === "failed" ? [fetched.error] : [],
    );
    // Sólo si nadie la sustituyó entre medias: una invalidación posterior ya
    // dejó en la caché una consulta más nueva.
    if (failures.length > 0 && cached === entry) {
      cached = null;
    }
    failures.forEach((error) => reportFailure(error));
    if (row.kind === "failed") {
      return DEFAULT_CLUB_BRAND;
    }
    return toClubBrand(
      row.value,
      socialLinks.kind === "read" ? socialLinks.value : NO_SOCIAL_LINKS,
    );
  }

  function startFetch(): CacheEntry {
    const entry: CacheEntry = {
      // Corre en otra vuelta, cuando `entry` ya existe.
      brand: Promise.resolve().then(() => fetchBrand(entry)),
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
