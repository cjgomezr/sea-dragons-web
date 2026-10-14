import { PushPin } from "@phosphor-icons/react/dist/ssr/PushPin";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { formatClubShortDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import {
  type NewsPinChoice,
  newsPinChoiceEnd,
  selectedNewsPinDuration,
} from "@/lib/news/news-pin-choice";
import {
  NEWS_PIN_DURATIONS,
  type NewsPinDuration,
} from "@/lib/news/news-pin-duration";

/**
 * La caja de fijar del formulario (#599, el punto 5 del "#2b" del handoff de
 * E22). Solo la ve el Admin: quien la pinta lo decide, y el servidor lo
 * vuelve a comprobar (#592).
 *
 * A diferencia de la tira del feed (#595), elegir una duración no fija nada
 * en el acto: se guarda con el formulario. Por eso aquí las duraciones sí son
 * radios, y las flechas las recorren sin efectos.
 */

const ICON_SIZE = 14;
const IDS = {
  label: "publicar-fijar",
  hint: "publicar-fijar-pista",
  durations: "publicar-fijar-duracion",
} as const;

function PinEnd({
  translate,
  until,
}: {
  readonly translate: Translator;
  readonly until: string | null;
}): React.JSX.Element {
  return (
    <p className="news-pin-field-end">
      {until === null
        ? translate("news.publish.pin.staysUntilUnpinned")
        : translate("news.publish.pin.unpinsOn", {
            date: formatClubShortDay(translate.locale, new Date(until)),
          })}
    </p>
  );
}

function PinDurations({
  translate,
  selected,
  onChoose,
}: {
  readonly translate: Translator;
  readonly selected: NewsPinDuration | null;
  readonly onChoose: (duration: NewsPinDuration) => void;
}): React.JSX.Element {
  return (
    <fieldset className="news-pin-field-durations">
      <legend className="visually-hidden">
        {translate("news.pin.stripLabel")}
      </legend>
      <div className="news-category-segments">
        {NEWS_PIN_DURATIONS.map((duration) => {
          const id = `${IDS.durations}-${duration}`;
          return (
            <div className="news-category-segment" key={duration}>
              <input
                id={id}
                type="radio"
                name={IDS.durations}
                value={duration}
                checked={duration === selected}
                onChange={() => onChoose(duration)}
              />
              <label htmlFor={id}>
                {translate(`news.pin.duration.${duration}`)}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function PinOptions({
  translate,
  choice,
  replacedTitle,
  onChoose,
}: {
  readonly translate: Translator;
  readonly choice: Exclude<NewsPinChoice, { readonly kind: "off" }>;
  readonly replacedTitle: string | null;
  readonly onChoose: (duration: NewsPinDuration) => void;
}): React.JSX.Element {
  return (
    <div className="news-pin-field-options">
      <PinDurations
        translate={translate}
        selected={selectedNewsPinDuration(choice)}
        onChoose={onChoose}
      />
      <PinEnd
        translate={translate}
        until={newsPinChoiceEnd(choice, new Date())}
      />
      {replacedTitle === null ? null : (
        <p className="news-pin-strip-warning">
          <WarningCircle
            aria-hidden="true"
            focusable="false"
            size={ICON_SIZE}
            color="currentColor"
          />
          {translate("news.publish.pin.replaces", { title: replacedTitle })}
        </p>
      )}
    </div>
  );
}

export function NewsPinField({
  translate,
  choice,
  replacedTitle,
  onToggle,
  onChoose,
}: {
  readonly translate: Translator;
  readonly choice: NewsPinChoice;
  /** La otra fijada vigente, que fijar esta quitaría. */
  readonly replacedTitle: string | null;
  readonly onToggle: () => void;
  readonly onChoose: (duration: NewsPinDuration) => void;
}): React.JSX.Element {
  const isOn = choice.kind !== "off";
  return (
    <div
      className={isOn ? "news-pin-field news-pin-field-on" : "news-pin-field"}
    >
      <button
        type="button"
        className="news-pin-switch"
        role="switch"
        aria-checked={isOn}
        aria-labelledby={IDS.label}
        aria-describedby={IDS.hint}
        onClick={onToggle}
      />
      <div className="news-pin-field-body">
        <p className="news-pin-field-label" id={IDS.label}>
          <PushPin
            aria-hidden="true"
            focusable="false"
            size={ICON_SIZE}
            color="currentColor"
          />
          {translate("news.publish.pin.label")}
        </p>
        <p className="news-pin-field-hint" id={IDS.hint}>
          {translate("news.publish.pin.hint")}
        </p>
        {isOn ? (
          <PinOptions
            translate={translate}
            choice={choice}
            replacedTitle={replacedTitle}
            onChoose={onChoose}
          />
        ) : null}
      </div>
    </div>
  );
}
