"use client";

import { useEffect, useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import {
  type PublishedAudience,
  forgetPublishedNotice,
  readPublishedNotice,
} from "./news-published-notice";

/**
 * "Publicada · avisamos a {audiencia}" en el feed, al volver de publicar
 * (#597). La región de estado está siempre, vacía si no hay nada que decir, y
 * no ocupa sitio: el feed no se mueve por ella.
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
  // Se llega aquí desde publicar sin recargar, así que se lee al montar en
  // el navegador. Leer no lo borra: en desarrollo React monta dos veces, y la
  // segunda tiene que ver lo mismo. Se borra después, en el efecto.
  const [audience] = useState<PublishedAudience | null>(readPublishedNotice);

  useEffect(() => {
    forgetPublishedNotice();
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
