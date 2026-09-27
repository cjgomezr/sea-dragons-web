import type { NewsNoticeGateways } from "@/lib/news/news-publication-notice";

/**
 * Publicar sin avisar a nadie, para la integración que publica en el club
 * sembrado de `seadragons-dev` y no mira los avisos (#332). Con los de verdad,
 * cada publicación a todo el club avisaría a sus socios reales.
 */
export const QUIET_NEWS_NOTICES: NewsNoticeGateways = {
  newsAudience: { findAudienceMemberIds: async () => [] },
  notifications: {
    findRecipients: async () => new Map(),
    insertNotifications: async () => {},
    insertNotification: async () => {},
    pruneNotificationsOf: async () => new Map(),
    runAfterResponse: () => {},
  },
};
