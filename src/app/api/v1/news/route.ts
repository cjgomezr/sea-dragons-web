import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type NewsFeedResponsePage, listNewsFeed } from "@/lib/news/news-feed";
import {
  asNewsApiError,
  requireNewsGateways,
  requireNewsSeenGateway,
} from "@/lib/news/news-api";

/**
 * El feed de quien llama (#327, RF-4 del PRD de E11): las publicaciones
 * dirigidas a él, de la más reciente a la más antigua, de 20 en 20. La
 * siguiente página se pide con `?cursor=` y el `nextCursor` de la anterior.
 *
 * Lo alcanza cualquier cuenta activa: la frontera ya respondió 401 o 403 a
 * quien no tiene sesión o la tiene a medias. La audiencia la aplica el
 * servidor con los grupos de quien llama.
 *
 * Cada página trae además la última visita a Noticias de quien llama (#594).
 * La pantalla registra la visita después de leer la primera, así que la de
 * esa página es la de antes de abrir; la de las siguientes ya es esta.
 */

// Depende de la sesión de quien llama y de lo publicado ahora.
export const dynamic = "force-dynamic";

const CURSOR_PARAM = "cursor";

export type NewsFeedResponse = NewsFeedResponsePage;

const getNewsFeed = createApiRoute<NewsFeedResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const cursor = request.nextUrl.searchParams.get(CURSOR_PARAM);
    try {
      const [page, seenAt] = await Promise.all([
        listNewsFeed(requireNewsGateways(), {
          callerId,
          ...(cursor === null ? {} : { cursor }),
          now: new Date(),
        }),
        requireNewsSeenGateway().findNewsSeenAt(callerId),
      ]);
      return { data: { ...page, seenAt } };
    } catch (error) {
      asNewsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getNewsFeed,
});
