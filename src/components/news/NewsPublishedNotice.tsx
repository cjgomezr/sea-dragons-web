"use client";

import { useEffect, useRef, useState } from "react";
import { formatClubShortDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import {
  type PublishedAudience,
  type PublishedNotice,
  forgetPublishedNotice,
  readPublishedNotice,
  takeDeletedNotice,
} from "./news-published-notice";

/**
 * "Publicada · avisamos a {audiencia}" en el feed, al volver de publicar
 * (#597), o "Publicada y fijada…" si salió fijada (#599), o "Post
 * deleted." al volver de borrar una (#958). La región de
 * estado está siempre, vacía si no hay nada que decir, y no ocupa sitio
 * vacía: el feed no se mueve por ella.
 */

function describeAudience(
  translate: Translator,
  audience: PublishedAudience,
): string {
  if (audience.kind === "club") {
    return translate("news.published.audience.club");
  }
  return new Intl.ListFormat(translate.locale, {
    type: "conjunction",
  }).format(audience.groupNames);
}

function describeNotice(
  translate: Translator,
  notice: PublishedNotice,
): string {
  const audience = describeAudience(translate, notice.audience);
  const { pin } = notice;
  if (pin.kind === "none") {
    return translate("news.published.notice", { audience });
  }
  if (pin.until === null) {
    return translate("news.published.pinnedNotice", { audience });
  }
  return translate("news.published.pinnedUntilNotice", {
    audience,
    date: formatClubShortDay(translate.locale, new Date(pin.until)),
  });
}

/** Lo que el feed tiene que decir al llegar: que se publicó una, o que se
 * borró una. */
type FeedNotice =
  | { readonly kind: "published"; readonly notice: PublishedNotice }
  | { readonly kind: "deleted" };

/** El aviso pendiente, o null, y los olvida: salen una sola vez. */
function takePendingNotice(): FeedNotice | null {
  const published = readPublishedNotice();
  forgetPublishedNotice();
  if (takeDeletedNotice()) {
    return { kind: "deleted" };
  }
  return published === null ? null : { kind: "published", notice: published };
}

function describeFeedNotice(
  translate: Translator,
  pending: FeedNotice,
): string {
  return pending.kind === "deleted"
    ? translate("news.post.announce.deleted")
    : describeNotice(translate, pending.notice);
}

export function NewsPublishedNotice({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  const [notice, setNotice] = useState<FeedNotice | null>(null);
  // Lo leído sobrevive a que React monte dos veces en desarrollo: la segunda
  // vez ya no está en `sessionStorage`, porque la primera lo borró.
  const pending = useRef<FeedNotice | null | undefined>(undefined);

  // La región se pinta vacía y el aviso entra en el cuadro siguiente: un
  // lector de pantalla sólo anuncia lo que cambia dentro de una región que ya
  // estaba. Leer tras montar evita además que el servidor, que no tiene
  // `sessionStorage`, pinte otra cosa que el navegador.
  useEffect(() => {
    if (pending.current === undefined) {
      pending.current = takePendingNotice();
    }
    const stored = pending.current;
    if (stored === null) {
      return;
    }
    const frame = requestAnimationFrame(() => setNotice(stored));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="news-published-status" role="status">
      {notice === null ? null : (
        <p className="news-published-notice">
          {describeFeedNotice(translate, notice)}
        </p>
      )}
    </div>
  );
}
