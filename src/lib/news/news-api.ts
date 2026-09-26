import { z } from "zod";
import { ApiError } from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { InvalidNewsFeedCursorError } from "./news-feed";
import {
  EmptyNewsAudienceError,
  ForeignNewsGroupError,
  InvalidNewsBodyError,
  InvalidNewsTitleError,
  NEWS_CATEGORIES,
  type NewsGateways,
  NewsForbiddenError,
  NewsPostNotFoundError,
} from "./news-posts";
import { createSupabaseNewsGateways } from "./supabase-news-gateways";

/**
 * Lo que comparten los endpoints de noticias (#327): cómo se cablean, cómo
 * leen el id del camino y cómo responde cada error del dominio con su código
 * de la convención.
 */

/** La forma de lo que manda quien publica. Recortar y medir el título es del
 * dominio; aquí sólo se exige la forma. Los ids de grupo tienen que ser uuid
 * para no mandarle a Postgres un valor que rechazaría. */
export const newsDraftSchema = z.object({
  category: z.enum(NEWS_CATEGORIES),
  title: z.string(),
  body: z.string(),
  audience: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("club") }),
    z.object({ kind: z.literal("groups"), groupIds: z.array(z.uuid()) }),
  ]),
});

/** Un id que no es un uuid no puede nombrar ninguna publicación: responde
 * como una que no existe. */
export function readNewsPostId(value: string): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", new NewsPostNotFoundError().message);
  }
  return value;
}

export function requireNewsGateways(): NewsGateways {
  const wiring = createSupabaseNewsGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

const VALIDATION_ERRORS = [
  InvalidNewsTitleError,
  InvalidNewsBodyError,
  EmptyNewsAudienceError,
  ForeignNewsGroupError,
  InvalidNewsFeedCursorError,
] as const;

export function asNewsApiError(error: unknown): never {
  if (
    error instanceof Error &&
    VALIDATION_ERRORS.some((type) => error instanceof type)
  ) {
    throw new ApiError("validation_error", error.message);
  }
  // Nunca `forbidden` para una publicación que no le corresponde a quien la
  // pide: el dominio ya la convirtió en "no existe" (RF-5).
  if (error instanceof NewsPostNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof NewsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}
