import { MemberNotFoundError } from "@/lib/auth/account-activation";

/**
 * La marca de la última visita a Noticias (#424, D2 del PRD de E14). El
 * dashboard cuenta como sin leer lo publicado después de ella. Se escribe
 * siempre sobre quien llama, nunca sobre un id de la petición.
 */

export type NewsSeenMark = {
  readonly userId: string;
  /** El instante en ISO. */
  readonly seenAt: string;
};

export type NewsSeenGateway = {
  /** `not_found` si no hay ningún socio con ese `userId`. */
  markNewsSeen(mark: NewsSeenMark): Promise<"marked" | "not_found">;
};

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
