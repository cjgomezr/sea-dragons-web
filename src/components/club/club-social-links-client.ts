import { z } from "zod";
import {
  type ApiRequestFailure,
  type ApiRequestOutcome,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { CLUB_SOCIAL_LINKS_API_PATH } from "@/lib/auth/routes";
import {
  SOCIAL_LINK_MAX_LENGTH,
  SOCIAL_NETWORKS,
  type SocialLinkIssue,
  type SocialLinkIssueCode,
  type SocialLinks,
  socialNetworkDomain,
} from "@/lib/club/social-links";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que la sección Redes (#963) le pide a la API v1 y cómo reduce cada
 * respuesta a algo que pintar. Nada habla con la base: la aplicación nativa
 * de Release 2 usará este mismo camino (CON-002).
 */

const linkSchema = z.string().nullable();

const responseSchema = z.object({
  data: z.object({
    instagram: linkSchema,
    tiktok: linkSchema,
    youtube: linkSchema,
    facebook: linkSchema,
    whatsapp: linkSchema,
    website: linkSchema,
  }),
});

export type SocialLinksRead =
  { readonly kind: "loaded"; readonly links: SocialLinks } | ApiRequestFailure;

async function readLinksResponse(
  request: Promise<ApiRequestOutcome>,
): Promise<SocialLinksRead> {
  const read = readApiPayload(await request, responseSchema);
  return read.kind === "failed"
    ? read
    : { kind: "loaded", links: read.value.data };
}

export function loadSocialLinks(): Promise<SocialLinksRead> {
  return readLinksResponse(requestApi(CLUB_SOCIAL_LINKS_API_PATH));
}

export function saveSocialLinks(links: SocialLinks): Promise<SocialLinksRead> {
  return readLinksResponse(
    requestApi(CLUB_SOCIAL_LINKS_API_PATH, {
      method: "PUT",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(links),
    }),
  );
}

const ISSUE_CODES: readonly SocialLinkIssueCode[] = [
  "too_long",
  "not_https",
  "not_a_link",
  "wrong_domain",
  "whatsapp_group",
];

/** La red de la que habla un 400 (`instagram.wrong_domain`), si es una de
 * esta sección. */
export function readSocialLinkIssue(
  failure: ApiRequestFailure,
): SocialLinkIssue | null {
  if (failure.failure !== "validation_error") {
    return null;
  }
  for (const network of SOCIAL_NETWORKS) {
    for (const code of ISSUE_CODES) {
      if (failure.reason === `${network}.${code}`) {
        return { network, code };
      }
    }
  }
  return null;
}

export function describeSocialLinkIssue(
  translate: Translator,
  { network, code }: SocialLinkIssue,
): string {
  switch (code) {
    case "too_long":
      return translate("clubSettings.socialLinks.issue.too_long", {
        max: SOCIAL_LINK_MAX_LENGTH,
      });
    case "wrong_domain":
      // La web del club acepta cualquier dominio, así que nunca llega aquí:
      // la rama sólo estrecha el tipo para `socialNetworkDomain`.
      return network === "website"
        ? translate("clubSettings.socialLinks.issue.not_a_link")
        : translate("clubSettings.socialLinks.issue.wrong_domain", {
            domain: socialNetworkDomain(network),
          });
    case "not_https":
    case "not_a_link":
    case "whatsapp_group":
      return translate(`clubSettings.socialLinks.issue.${code}`);
  }
}
