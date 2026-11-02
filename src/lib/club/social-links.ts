import {
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import { type ClubSettingsGateways, findAdministrator } from "./club-settings";
import { countCharacters } from "./sign-in-texts";

/**
 * Las redes del club (#963, RF-1 y D1 a D3 del PRD de E37): un enlace por
 * red, guardado en `club_social_links`. Son públicas a propósito: la pantalla
 * de entrar las enseñará antes de que nadie inicie sesión.
 *
 * Cada red sólo acepta enlaces de su dominio, para que un enlace que se hace
 * pasar por Instagram no lleve a otro sitio. La web del club acepta
 * cualquiera. La misma validación corre en el formulario y en el servidor.
 */

/** El orden en que se enseñan. */
export const SOCIAL_NETWORKS = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "whatsapp",
  "website",
] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** El límite de `club_social_links_url_length`, medido tras recortar. */
export const SOCIAL_LINK_MAX_LENGTH = 300;

/** Sin enlace es `null`, nunca la cadena vacía. */
export type SocialLinks = { readonly [N in SocialNetwork]: string | null };

export const NO_SOCIAL_LINKS: SocialLinks = {
  instagram: null,
  tiktok: null,
  youtube: null,
  facebook: null,
  whatsapp: null,
  website: null,
};

/** Las redes con dominio propio: todas menos la web del club. */
export type DomainBoundNetwork = Exclude<SocialNetwork, "website">;

/** Los dominios que acepta cada red; el primero es el que se nombra en el
 * aviso. Un enlace de WhatsApp además tiene que ser un número o un canal. */
const DOMAINS_OF_NETWORK: Readonly<
  Record<DomainBoundNetwork, readonly string[]>
> = {
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  facebook: ["facebook.com", "fb.com"],
  whatsapp: ["wa.me", "whatsapp.com"],
};

/** Los prefijos con los que las propias redes comparten sus enlaces: el
 * móvil (`m.`) y los enlaces cortos de TikTok (`vm.`). */
const ALLOWED_HOST_PREFIX = /^(?:www\.|m\.|vm\.)/;

const WHATSAPP_NUMBER_PATH = /^\/\d+\/?$/;
const WHATSAPP_CHANNEL_PATH = /^\/channel\/[^/]+\/?$/;
/** Un enlace de invitación a un grupo deja entrar a quien lo abra (D3). */
const WHATSAPP_GROUP_HOST = "chat.whatsapp.com";

const HTTPS_PREFIX = /^https:\/\//i;

export type SocialLinkIssueCode =
  "too_long" | "not_https" | "not_a_link" | "wrong_domain" | "whatsapp_group";

export type SocialLinkIssue = {
  readonly network: SocialNetwork;
  readonly code: SocialLinkIssueCode;
};

export type SocialLinksValidation =
  | { readonly kind: "valid"; readonly links: SocialLinks }
  | { readonly kind: "invalid"; readonly issues: readonly SocialLinkIssue[] };

/** El dominio que nombra "Pega un enlace de instagram.com.". */
export function socialNetworkDomain(network: DomainBoundNetwork): string {
  const [domain] = DOMAINS_OF_NETWORK[network];
  if (domain === undefined) {
    throw new Error(`La red ${network} no tiene dominio.`);
  }
  return domain;
}

function normalizeLink(url: string | null): string | null {
  const trimmed = url?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Sin los espacios de los extremos, y vacío como ninguno: así lo guarda la
 * base. */
function normalizeSocialLinks(links: SocialLinks): SocialLinks {
  return {
    instagram: normalizeLink(links.instagram),
    tiktok: normalizeLink(links.tiktok),
    youtube: normalizeLink(links.youtube),
    facebook: normalizeLink(links.facebook),
    whatsapp: normalizeLink(links.whatsapp),
    website: normalizeLink(links.website),
  };
}

function parseLink(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    // `new URL` sólo lanza si no es un enlace: eso es lo que se pregunta.
    return null;
  }
}

/** El dominio sin `www.`, `m.` ni `vm.`. `URL` ya lo deja en minúsculas. */
function bareHost(link: URL): string {
  return link.hostname.replace(ALLOWED_HOST_PREFIX, "");
}

function isWhatsappLink(link: URL): boolean {
  const host = bareHost(link);
  return (
    (host === "wa.me" && WHATSAPP_NUMBER_PATH.test(link.pathname)) ||
    (host === "whatsapp.com" && WHATSAPP_CHANNEL_PATH.test(link.pathname))
  );
}

function findDomainIssue(
  network: SocialNetwork,
  link: URL,
): SocialLinkIssueCode | null {
  if (network === "website") {
    return null;
  }
  if (network === "whatsapp") {
    if (link.hostname === WHATSAPP_GROUP_HOST) {
      return "whatsapp_group";
    }
    return isWhatsappLink(link) ? null : "wrong_domain";
  }
  return DOMAINS_OF_NETWORK[network].includes(bareHost(link))
    ? null
    : "wrong_domain";
}

function findLinkIssue(
  network: SocialNetwork,
  url: string,
): SocialLinkIssueCode | null {
  if (countCharacters(url) > SOCIAL_LINK_MAX_LENGTH) {
    return "too_long";
  }
  if (!HTTPS_PREFIX.test(url)) {
    return "not_https";
  }
  const link = parseLink(url);
  if (link === null || link.hostname === "") {
    return "not_a_link";
  }
  return findDomainIssue(network, link);
}

/** Los enlaces tal como se guardarían, o un aviso por cada red que no vale,
 * en el orden de las redes. */
export function validateSocialLinks(links: SocialLinks): SocialLinksValidation {
  const normalized = normalizeSocialLinks(links);
  const issues = SOCIAL_NETWORKS.flatMap((network): SocialLinkIssue[] => {
    const url = normalized[network];
    const code = url === null ? null : findLinkIssue(network, url);
    return code === null ? [] : [{ network, code }];
  });
  return issues.length === 0
    ? { kind: "valid", links: normalized }
    : { kind: "invalid", issues };
}

/** Si un borrador guardaría lo mismo que `stored`. */
export function isSameSocialLinks(
  draft: SocialLinks,
  stored: SocialLinks,
): boolean {
  const a = normalizeSocialLinks(draft);
  const b = normalizeSocialLinks(stored);
  return SOCIAL_NETWORKS.every((network) => a[network] === b[network]);
}

function isSocialNetwork(value: string): value is SocialNetwork {
  return (SOCIAL_NETWORKS as readonly string[]).includes(value);
}

/** Una fila de `club_social_links`. */
export type SocialLinkRow = {
  readonly network: string;
  readonly url: string;
};

/** Una red sin fila no tiene enlace. Una red que no existe es una fila que
 * `club_social_links_network_check` no dejaría existir: se falla. */
export function toSocialLinks(rows: readonly SocialLinkRow[]): SocialLinks {
  return rows.reduce<SocialLinks>((links, { network, url }) => {
    if (!isSocialNetwork(network)) {
      throw new Error(`Enlace de una red que no hay: ${network}.`);
    }
    return { ...links, [network]: url };
  }, NO_SOCIAL_LINKS);
}

export type SocialLinksGateways = {
  readonly members: ClubSettingsGateways["members"];
  readonly socialLinks: {
    findClubIdBySlug(slug: string): Promise<string>;
    findSocialLinks(clubId: string): Promise<SocialLinks>;
    /** Deja las redes del club como `links`: borra las que no tienen
     * enlace y guarda las demás. */
    replaceSocialLinks(
      clubId: string,
      links: SocialLinks,
    ): Promise<SocialLinks>;
  };
  readonly audit: AuditLogWriter;
};

export class SocialLinksValidationError extends Error {
  readonly issues: readonly SocialLinkIssue[];

  constructor(issues: readonly SocialLinkIssue[]) {
    super(
      `Las redes del club tienen enlaces que no valen: ${issues
        .map((issue) => `${issue.network} (${issue.code})`)
        .join(", ")}.`,
    );
    this.name = "SocialLinksValidationError";
    this.issues = issues;
  }
}

/** Las redes del club de esta instalación. Sin comprobar quién pide: son
 * públicas (D2). */
export async function readClubSocialLinks(
  gateways: Pick<SocialLinksGateways, "socialLinks">,
  request: { readonly clubSlug: string },
): Promise<SocialLinks> {
  const clubId = await gateways.socialLinks.findClubIdBySlug(request.clubSlug);
  return gateways.socialLinks.findSocialLinks(clubId);
}

function changedNetworks(
  links: SocialLinks,
  stored: SocialLinks,
): readonly SocialNetwork[] {
  return SOCIAL_NETWORKS.filter(
    (network) => links[network] !== stored[network],
  );
}

function recordLinksChanged(
  audit: AuditLogWriter,
  actor: AuditActor,
  networks: readonly SocialNetwork[],
): Promise<void> {
  return recordAuditEvent(audit, {
    actor,
    clubId: actor.clubId,
    action: "club.social_links_changed",
    entityType: "club",
    entityId: actor.clubId,
    result: "success",
    metadata: { networks },
  });
}

/**
 * Todo o nada: si una red no vale, no se guarda ninguna. Valida antes de
 * leer nada y anota después de escribir, como los textos del inicio de
 * sesión.
 */
export async function updateSocialLinks(
  gateways: SocialLinksGateways,
  request: { readonly callerId: string; readonly links: SocialLinks },
): Promise<SocialLinks> {
  const validation = validateSocialLinks(request.links);
  if (validation.kind === "invalid") {
    throw new SocialLinksValidationError(validation.issues);
  }
  const caller = await findAdministrator(gateways, request.callerId);
  const stored = await gateways.socialLinks.findSocialLinks(caller.clubId);
  const networks = changedNetworks(validation.links, stored);
  if (networks.length === 0) {
    return stored;
  }
  const saved = await gateways.socialLinks.replaceSocialLinks(
    caller.clubId,
    validation.links,
  );
  await recordLinksChanged(
    gateways.audit,
    { id: request.callerId, clubId: caller.clubId },
    networks,
  );
  return saved;
}
