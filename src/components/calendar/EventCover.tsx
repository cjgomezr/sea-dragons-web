import { useState } from "react";
import type { EventType } from "@/lib/events/event-creation";
import {
  type EventCoverIconSize,
  EventCoverFallback,
} from "./EventCoverFallback";

/**
 * La imagen de un evento (#644) o, sin ella, el fondo de su tipo (#641). Es
 * decorativa: el título, al lado, ya nombra el evento.
 *
 * Un `<img>` y no `next/image`, como la portada de una noticia: la dirección
 * es firmada y de vida corta, y el optimizador de Next la pediría sin la firma.
 * Una imagen que no carga (la firma caducó) cae al fondo del tipo en vez de
 * dejar un icono roto; una dirección nueva se vuelve a intentar.
 */
export function EventCover({
  url,
  eventType,
  iconSize,
}: {
  readonly url: string | null;
  readonly eventType: EventType;
  readonly iconSize: EventCoverIconSize;
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url === null || url === failedUrl) {
    return <EventCoverFallback eventType={eventType} iconSize={iconSize} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ver el comentario del componente.
    <img
      className="event-cover-image"
      src={url}
      alt=""
      onError={() => setFailedUrl(url)}
    />
  );
}
