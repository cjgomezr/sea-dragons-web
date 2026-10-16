import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Copy } from "@phosphor-icons/react/dist/ssr/Copy";
import { NavigationArrow } from "@phosphor-icons/react/dist/ssr/NavigationArrow";
import { useEffect, useState } from "react";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import { addressOf, buildMapsUrl, placeTextOf } from "@/lib/events/event-place";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La tarjeta del lugar en el panel del evento (#648, RF-4 y RF-7 del PRD de
 * E24): el nombre y la dirección del lugar elegido, o el texto libre, con
 * Copiar dirección y "Cómo llegar" a todo el ancho. El mapa embebido llega con
 * #658.
 *
 * Copiar enseña un check unos segundos y lo anuncia en una región que está
 * siempre en el DOM: un lector de pantalla sólo lee los cambios de una región
 * que ya estaba. Sin portapapeles (un contexto que no es seguro) o sin
 * permiso, lo dice en vez de dar por hecho que salió.
 */

type CopyStatus = "idle" | "copied" | "failed";

/** Lo que dura el check, o el aviso de que no se pudo, antes de volver al
 * icono de copiar: otro intento vuelve a anunciarse. */
const COPY_FEEDBACK_MS = 2500;

const COPY_ANNOUNCEMENTS = {
  idle: null,
  copied: "calendar.panel.addressCopied",
  failed: "calendar.panel.copyFailed",
} as const;

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard === undefined) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function PlaceLines({
  event,
}: {
  readonly event: Pick<AgendaEvent, "location" | "place" | "placeDetail">;
}): React.JSX.Element {
  const { place, placeDetail } = event;
  const address = addressOf(place);
  return (
    <div className="agenda-place-card-text">
      <p className="agenda-place-card-name">
        {place === null ? event.location : place.name}
      </p>
      {address === null ? null : (
        <p className="agenda-place-card-address">{address}</p>
      )}
      {placeDetail === null ? null : (
        <p className="agenda-place-card-address">{placeDetail}</p>
      )}
    </div>
  );
}

export function EventPlaceCard({
  translate,
  event,
}: {
  readonly translate: Translator;
  readonly event: Pick<AgendaEvent, "location" | "place" | "placeDetail">;
}): React.JSX.Element {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(
      () => setCopyStatus("idle"),
      COPY_FEEDBACK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  async function copyAddress(): Promise<void> {
    const isCopied = await copyToClipboard(placeTextOf(event));
    setCopyStatus(isCopied ? "copied" : "failed");
  }

  const announcement = COPY_ANNOUNCEMENTS[copyStatus];
  const CopyGlyph = copyStatus === "copied" ? Check : Copy;
  return (
    <div className="agenda-place-card">
      <div className="agenda-place-card-body">
        <PlaceLines event={event} />
        <button
          type="button"
          className="agenda-icon-button"
          aria-label={translate("calendar.panel.copyAddress")}
          onClick={() => void copyAddress()}
        >
          <CopyGlyph aria-hidden="true" focusable="false" size={18} />
        </button>
      </div>
      <p
        className={
          copyStatus === "failed"
            ? "agenda-place-card-status is-failed"
            : "agenda-place-card-status"
        }
        role="status"
      >
        {announcement === null ? null : translate(announcement)}
      </p>
      <a
        className="agenda-directions"
        href={buildMapsUrl(event)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <NavigationArrow aria-hidden="true" focusable="false" size={16} />
        {translate("calendar.panel.directions")}{" "}
        <span className="visually-hidden">
          {translate("calendar.event.opensMap")}
        </span>
      </a>
    </div>
  );
}
