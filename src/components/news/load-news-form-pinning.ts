import type { NewsFormPinning } from "./NewsPublishForm";
import { loadNewsFeed } from "./news-client";

/**
 * Lo que la caja de fijar del formulario (#599) necesita saber al abrirse:
 * cuál es la fijada vigente, para avisar de que se reemplaza. Sale del
 * `pinned` de la primera página del feed, una vez al cargar la pantalla y no
 * a cada vuelta del interruptor. Quien no puede fijar no ve la caja, así que
 * no se pide nada.
 */

export type NewsFormPinningLoad =
  | { readonly kind: "loaded"; readonly pinning: NewsFormPinning | null }
  | { readonly kind: "failed" };

export async function loadNewsFormPinning(
  canPin: boolean,
): Promise<NewsFormPinningLoad> {
  if (!canPin) {
    return { kind: "loaded", pinning: null };
  }
  const feed = await loadNewsFeed(null);
  if (feed.kind === "failed") {
    return { kind: "failed" };
  }
  const { pinned } = feed.page;
  return {
    kind: "loaded",
    pinning: {
      pinnedNow:
        pinned === null ? null : { id: pinned.id, title: pinned.title },
    },
  };
}
