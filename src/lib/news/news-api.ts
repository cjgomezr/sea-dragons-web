import { z } from "zod";
import { ApiError } from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { NEWS_ATTACHMENTS_MAX_PER_POST } from "./news-attachments";
import { InvalidNewsFeedCursorError } from "./news-feed";
import { NewsPostChangedError, NewsPostNotYoursError } from "./news-management";
import { InvalidNewsPinUntilError } from "./news-pin-rule";
import {
  type NewsPinChange,
  NewsPinForbiddenError,
  NewsPinWithdrawnPostError,
} from "./news-pins";
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

/** El motivo del 409 al fijar una retirada (#592), para que la pantalla lo
 * explique sin leer la frase. */
export const NEWS_POST_WITHDRAWN_REASON = "news_post_withdrawn";

/** Hasta cuándo se fija (#592): una fecha con zona, o `null` para "hasta que
 * la desfije". Que esté en el futuro lo comprueba el dominio. */
export const newsPinSchema = z.object({
  until: z.iso.datetime({ offset: true }).nullable(),
});

/** `pin` al publicar o editar: `{ until }` fija, `null` desfija y sin él no
 * se toca. Solo un Admin puede mandarlo (D1). */
const newsPinFieldSchema = newsPinSchema.nullable().optional();

/** El cambio de fijado que pide el cuerpo de publicar o editar. */
export function toNewsPinChange(
  pin: z.infer<typeof newsPinFieldSchema>,
): NewsPinChange {
  if (pin === undefined) {
    return { kind: "keep" };
  }
  return pin === null ? { kind: "unpin" } : { kind: "pin", until: pin.until };
}

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
  // Los ids de las subidas previas (#330), en el orden en que se eligieron.
  // Opcional: publicar sin adjuntos sigue siendo el mismo cuerpo de #327.
  attachmentUploadIds: z
    .array(z.uuid())
    .max(NEWS_ATTACHMENTS_MAX_PER_POST)
    .default([]),
  // La portada subida antes (#591). Opcional: sin ella sale sin portada.
  coverUploadId: z.uuid().nullable().default(null),
  pin: newsPinFieldSchema,
});

/** Una edición (#331): el mismo borrador, sin adjuntos, y la marca de
 * editada que se tenía delante. Es obligatoria, `null` incluido: sin ella no
 * hay forma de saber si se pisaría a otra persona. `coverUploadId` (#591)
 * pone otra portada, `null` la quita, y sin él la portada sigue como está. */
export const newsEditSchema = newsDraftSchema
  .omit({ attachmentUploadIds: true, coverUploadId: true })
  .extend({
    expectedEditedAt: z.iso.datetime({ offset: true }).nullable(),
    coverUploadId: z.uuid().nullable().optional(),
  });

export const newsStatusSchema = z.object({
  status: z.enum(["published", "withdrawn"]),
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
  InvalidNewsPinUntilError,
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
  if (
    error instanceof NewsForbiddenError ||
    error instanceof NewsPostNotYoursError ||
    error instanceof NewsPinForbiddenError
  ) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof NewsPostChangedError) {
    throw new ApiError("conflict", error.message);
  }
  if (error instanceof NewsPinWithdrawnPostError) {
    throw new ApiError("conflict", error.message, NEWS_POST_WITHDRAWN_REASON);
  }
  return asAccountApiError(error);
}
