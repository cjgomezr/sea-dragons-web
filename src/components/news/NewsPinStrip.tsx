import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { useId } from "react";
import type { Translator } from "@/lib/i18n/translator";
import {
  NEWS_PIN_DURATIONS,
  type NewsPinDuration,
} from "@/lib/news/news-pin-duration";

const WARNING_ICON_SIZE = 14;

/**
 * La tira "Fijar arriba durante" (#595, el "#2a" del handoff de E22), debajo
 * de la fila o en la destacada. Cada duración es un botón que fija en el
 * acto: no son radios, porque recorrerlos con las flechas fijaría a cada paso.
 * Esc la cierra igual que Cancelar; quien la abrió devuelve el foco.
 *
 * Mientras se guarda, las duraciones se marcan desactivadas sin `disabled`:
 * así el foco no se pierde si el servidor dice que no y hay que elegir otra
 * vez. Lo que impide la segunda petición es `useNewsPinning`.
 */
export function NewsPinStrip({
  translate,
  id,
  replacesPinned,
  isSaving,
  onChoose,
  onCancel,
}: {
  readonly translate: Translator;
  /** El que nombra la chincheta en su `aria-controls`. */
  readonly id: string;
  /** Si hay otra fijada que esta reemplazaría. */
  readonly replacesPinned: boolean;
  readonly isSaving: boolean;
  readonly onChoose: (duration: NewsPinDuration) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const labelId = useId();
  return (
    <div
      id={id}
      className="news-pin-strip"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel();
        }
      }}
    >
      <div className="news-pin-strip-choices">
        <span id={labelId} className="news-pin-strip-label">
          {translate("news.pin.stripLabel")}
        </span>
        <div
          className="news-pin-durations"
          role="group"
          aria-labelledby={labelId}
        >
          {NEWS_PIN_DURATIONS.map((duration) => (
            <button
              key={duration}
              type="button"
              className="news-pin-duration"
              aria-disabled={isSaving}
              onClick={() => onChoose(duration)}
            >
              {translate(`news.pin.duration.${duration}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="directory-link-button"
          onClick={onCancel}
        >
          {translate("news.pin.cancel")}
        </button>
      </div>
      {replacesPinned ? (
        <p className="news-pin-strip-warning">
          <WarningCircle
            aria-hidden="true"
            focusable="false"
            size={WARNING_ICON_SIZE}
            color="currentColor"
          />
          {translate("news.pin.replaces")}
        </p>
      ) : null}
    </div>
  );
}
