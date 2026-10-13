"use client";

import { useEffect, useRef, useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import {
  type PublishedAudience,
  forgetPublishedNotice,
  readPublishedNotice,
} from "./news-published-notice";

/**
 * "Publicada · avisamos a {audiencia}" en el feed, al volver de publicar
 * (#597). La región de estado está siempre, vacía si no hay nada que decir, y
 * no ocupa sitio vacía: el feed no se mueve por ella.
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

export function NewsPublishedNotice({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  const [audience, setAudience] = useState<PublishedAudience | null>(null);
  // Lo leído sobrevive a que React monte dos veces en desarrollo: la segunda
  // vez ya no está en `sessionStorage`, porque la primera lo borró.
  const pending = useRef<PublishedAudience | null | undefined>(undefined);

  // La región se pinta vacía y el aviso entra en el cuadro siguiente: un
  // lector de pantalla sólo anuncia lo que cambia dentro de una región que ya
  // estaba. Leer tras montar evita además que el servidor, que no tiene
  // `sessionStorage`, pinte otra cosa que el navegador.
  useEffect(() => {
    if (pending.current === undefined) {
      pending.current = readPublishedNotice();
      forgetPublishedNotice();
    }
    const notice = pending.current;
    if (notice === null) {
      return;
    }
    const frame = requestAnimationFrame(() => setAudience(notice));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="news-published-status" role="status">
      {audience === null ? null : (
        <p className="news-published-notice">
          {translate("news.published.notice", {
            audience: describeAudience(translate, audience),
          })}
        </p>
      )}
    </div>
  );
}
