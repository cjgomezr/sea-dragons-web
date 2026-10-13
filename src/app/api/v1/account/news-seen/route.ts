import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { NO_CONTENT_STATUS } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { requireNewsSeenGateway } from "@/lib/news/news-api";
import { markNewsSeen } from "@/lib/news/news-seen";

/**
 * La marca de la última visita a Noticias (#424, D2 del PRD de E14): la
 * pantalla de Noticias la registra al abrirse, y también al abrir una
 * publicación. Actúa siempre sobre quien identifica la cookie de sesión;
 * responde 204 sin cuerpo.
 */

// Escribe la fila de quien llama.
export const dynamic = "force-dynamic";

const postNewsSeen = createApiRoute<never>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    try {
      await markNewsSeen(requireNewsSeenGateway(), {
        userId,
        now: new Date(),
      });
      return { status: NO_CONTENT_STATUS };
    } catch (error) {
      return asAccountApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postNewsSeen,
});
