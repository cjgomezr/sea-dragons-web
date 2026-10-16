import { MapPin } from "@phosphor-icons/react/dist/ssr/MapPin";
import { type MapPoint, buildMapEmbedUrl } from "@/lib/events/event-place";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La vista previa del mapa que abre la tarjeta del lugar (#658, RF-15 y D3
 * del PRD de E24): el mapa embebido de OpenStreetMap, sin API key, con el
 * marcador en el lugar.
 *
 * El `iframe` es inerte: ni recibe el foco ni lo lee un lector de pantalla,
 * y una capa encima recoge el toque y abre Google Maps. Esa capa no es otra
 * parada del tabulador porque "Cómo llegar", debajo, ya lleva al mismo sitio.
 * Debajo de todo está el fondo con el pin, que es lo que queda a la vista
 * mientras el mapa no llega o si no llega nunca. La franja mide lo mismo
 * desde el principio, así que el panel no se mueve al cargar.
 */

const OPENSTREETMAP_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

export function EventPlaceMap({
  translate,
  place,
  mapsUrl,
}: {
  readonly translate: Translator;
  readonly place: MapPoint & { readonly name: string };
  readonly mapsUrl: string;
}): React.JSX.Element {
  return (
    <div className="agenda-place-map">
      <div className="agenda-place-map-fallback" aria-hidden="true">
        <MapPin focusable="false" size={28} weight="fill" />
      </div>
      <iframe
        className="agenda-place-map-frame"
        src={buildMapEmbedUrl(place)}
        title={translate("calendar.panel.mapTitle", { place: place.name })}
        loading="lazy"
        inert
      />
      <a
        className="agenda-place-map-cover"
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        aria-hidden="true"
      />
      <a
        className="agenda-place-map-attribution"
        href={OPENSTREETMAP_COPYRIGHT_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        {translate("calendar.panel.mapAttribution")}{" "}
        <span className="visually-hidden">
          {translate("calendar.panel.opensNewTab")}
        </span>
      </a>
    </div>
  );
}
