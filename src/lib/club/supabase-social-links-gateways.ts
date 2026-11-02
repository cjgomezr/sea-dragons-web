import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  SOCIAL_NETWORKS,
  type SocialLinkRow,
  type SocialLinks,
  type SocialLinksGateways,
  toSocialLinks,
} from "./social-links";

/**
 * Adaptador entre las redes del club (#963) y Supabase.
 *
 * Va por la llave de servicio: `0091_club_social_links.sql` no deja escribir
 * a nadie más, y el club de quien lee sin sesión se encuentra por su `slug`,
 * que `anon` no puede leer. Escribir sólo llega aquí después de que el
 * dominio comprobó que quien pide es Admin.
 */

const SOCIAL_LINKS_TABLE = "club_social_links";
const LINK_COLUMNS = "network, url";

type Environment = Readonly<Record<string, string | undefined>>;

async function findClubIdBySlug(
  serviceClient: SupabaseClient,
  slug: string,
): Promise<string> {
  const { data, error } = await serviceClient
    .from("clubs")
    .select("id")
    .eq("slug", slug)
    .single<{ id: string }>();
  if (error) {
    throw new Error(`No se encontró el club ${slug}: ${error.message}`);
  }
  return data.id;
}

async function findSocialLinks(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<SocialLinks> {
  const { data, error } = await serviceClient
    .from(SOCIAL_LINKS_TABLE)
    .select(LINK_COLUMNS)
    .eq("club_id", clubId)
    .overrideTypes<SocialLinkRow[], { merge: false }>();
  if (error) {
    throw new Error(
      `No se pudieron leer las redes del club ${clubId}: ${error.message}`,
    );
  }
  return toSocialLinks(data);
}

async function upsertLinks(
  serviceClient: SupabaseClient,
  clubId: string,
  rows: readonly SocialLinkRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const { error } = await serviceClient.from(SOCIAL_LINKS_TABLE).upsert(
    rows.map((row) => ({ club_id: clubId, ...row })),
    { onConflict: "club_id,network" },
  );
  if (error) {
    throw new Error(
      `No se pudieron guardar las redes del club ${clubId}: ${error.message}`,
    );
  }
}

async function deleteLinks(
  serviceClient: SupabaseClient,
  clubId: string,
  networks: readonly string[],
): Promise<void> {
  if (networks.length === 0) {
    return;
  }
  const { error } = await serviceClient
    .from(SOCIAL_LINKS_TABLE)
    .delete()
    .eq("club_id", clubId)
    .in("network", networks);
  if (error) {
    throw new Error(
      `No se pudieron quitar las redes del club ${clubId}: ${error.message}`,
    );
  }
}

/** Guarda las redes con enlace y borra las demás. El dominio ya validó todas
 * antes de llegar aquí, así que una red que no vale no deja nada a medias. */
async function replaceSocialLinks(
  serviceClient: SupabaseClient,
  clubId: string,
  links: SocialLinks,
): Promise<SocialLinks> {
  const kept = SOCIAL_NETWORKS.flatMap((network): SocialLinkRow[] => {
    const url = links[network];
    return url === null ? [] : [{ network, url }];
  });
  const removed = SOCIAL_NETWORKS.filter((network) => links[network] === null);
  await upsertLinks(serviceClient, clubId, kept);
  await deleteLinks(serviceClient, clubId, removed);
  return findSocialLinks(serviceClient, clubId);
}

export function createSocialLinksGateways(
  serviceClient: SupabaseClient,
): SocialLinksGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    socialLinks: {
      findClubIdBySlug: (slug) => findClubIdBySlug(serviceClient, slug),
      findSocialLinks: (clubId) => findSocialLinks(serviceClient, clubId),
      replaceSocialLinks: (clubId, links) =>
        replaceSocialLinks(serviceClient, clubId, links),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type SocialLinksGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: SocialLinksGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseSocialLinksGateways(
  env: Environment,
): SocialLinksGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createSocialLinksGateways(createServiceRoleClient(env)),
  };
}
