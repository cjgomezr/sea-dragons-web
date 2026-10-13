import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { NewsPostStatus } from "./news-posts";

/**
 * La marca de la última visita a Noticias (#424, D2 del PRD de E14). El
 * dashboard cuenta como sin leer lo publicado después de ella, y el feed
 * marca con ella lo nuevo (#594). Se escribe siempre sobre quien llama, nunca
 * sobre un id de la petición.
 */

/** Sin ninguna visita, lo de los últimos 30 días cuenta como sin leer (D2). */
export const NEWS_UNREAD_WINDOW_DAYS = 30;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type NewsSeenMark = {
  readonly userId: string;
  /** El instante en ISO. */
  readonly seenAt: string;
};

export type NewsSeenGateway = {
  /** `not_found` si no hay ningún socio con ese `userId`. */
  markNewsSeen(mark: NewsSeenMark): Promise<"marked" | "not_found">;
  /** La última visita, o `null` si nunca abrió Noticias. Lanza
   * `MemberNotFoundError` si no hay ningún socio con ese `userId`. */
  findNewsSeenAt(userId: string): Promise<string | null>;
};

/** El instante, en milisegundos, desde el que lo publicado cuenta como sin
 * leer: la última visita o, sin ella, el principio de la ventana. */
export function newsUnreadCutoff(seenAt: string | null, now: Date): number {
  return seenAt === null
    ? now.getTime() - NEWS_UNREAD_WINDOW_DAYS * DAY_IN_MS
    : Date.parse(seenAt);
}

/** Una retirada sólo le llega a quien la publicó; no es algo que leer. */
export function isNewsUnread(
  post: { readonly publishedAt: string; readonly status: NewsPostStatus },
  cutoffMs: number,
): boolean {
  return post.status === "published" && Date.parse(post.publishedAt) > cutoffMs;
}

export async function markNewsSeen(
  gateway: NewsSeenGateway,
  request: { readonly userId: string; readonly now: Date },
): Promise<void> {
  const outcome = await gateway.markNewsSeen({
    userId: request.userId,
    seenAt: request.now.toISOString(),
  });
  if (outcome === "not_found") {
    throw new MemberNotFoundError(request.userId);
  }
}
