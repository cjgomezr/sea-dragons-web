import type { AudienceMembersGateway } from "@/lib/notifications/audience-members";
import {
  type NotificationBroadcastWriter,
  notifyMembers,
} from "@/lib/notifications/notify-member";
import type { NewsAttachmentGateways } from "./news-attachments";
import type { NewsPost } from "./news-posts";

/**
 * El aviso a la audiencia cuando se publica algo (#332, RF-7 del PRD de E11,
 * FR-061). Va por la puerta única de avisos, que ya sabe no avisar a una
 * cuenta dada de baja ni dos veces a la misma persona.
 *
 * Sólo se avisa al publicar: editar y volver a publicar una retirada no pasan
 * por aquí (D2). Y el aviso nunca tumba la publicación, que ya está guardada
 * cuando se llega aquí: un fallo se registra y nada más, como el aviso de un
 * cambio de rol (#267).
 */

export type NewsNoticeGateways = {
  readonly newsAudience: AudienceMembersGateway;
  readonly notifications: NotificationBroadcastWriter;
};

/** Lo que necesita publicar: guardar, ligar los adjuntos y avisar. */
export type NewsPublishGateways = NewsAttachmentGateways & NewsNoticeGateways;

export async function announceNewsPost(
  gateways: NewsNoticeGateways,
  post: NewsPost,
): Promise<void> {
  let audienceIds: readonly string[];
  try {
    audienceIds = await gateways.newsAudience.findAudienceMemberIds({
      clubId: post.clubId,
      audience: post.audience,
    });
  } catch (error) {
    console.error(
      `[news] no se pudo leer la audiencia de la publicación ${post.id}; nadie recibe su aviso`,
      error,
    );
    return;
  }
  // `notifyMembers` no lanza: un aviso perdido queda registrado allí.
  await notifyMembers(gateways.notifications, {
    type: "news_post_published",
    data: { postId: post.id, category: post.category, title: post.title },
    recipientUserIds: audienceIds.filter((id) => id !== post.author.id),
  });
}
