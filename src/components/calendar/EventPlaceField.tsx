import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { MapPin } from "@phosphor-icons/react/dist/ssr/MapPin";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useRef, useState } from "react";
import { buildMapsUrl, type EventPlace } from "@/lib/events/event-place";
import type { PlaceSuggestion } from "@/lib/events/place-search";
import {
  FieldIssue,
  type FieldProps,
  fieldId,
  issueAttributes,
} from "./EventFormFields";
import { type PlaceSearchState, usePlaceSearch } from "./use-place-search";

/**
 * El campo Lugar del diálogo de evento (#652, RF-5 y D1 del PRD de E24): un
 * `combobox` que sugiere primero los lugares del club y después los de
 * Photon. Elegir uno lo sustituye por la tarjeta del lugar, con "Ver en el
 * mapa", una × para cambiarlo y "Dónde exactamente". Lo escrito sin elegir
 * nada se guarda como texto libre, y vuelve tal cual al quitar el elegido.
 *
 * La opción activa se anuncia con `aria-activedescendant`: el foco no sale
 * del campo mientras se recorre la lista.
 */

type PlaceOption =
  | { readonly kind: "place"; readonly suggestion: PlaceSuggestion }
  | { readonly kind: "freeText" };

type PlaceFieldProps = FieldProps & {
  readonly onChoose: (place: EventPlace) => void;
};

const NO_ACTIVE_OPTION = -1;
const ICON_SIZE = 18;
const SEARCH_ICON_SIZE = 16;
const LISTBOX_ID = `${fieldId("location")}-lugares`;
const LABEL_ID = `${fieldId("location")}-etiqueta`;

function optionId(index: number): string {
  return `${LISTBOX_ID}-${index}`;
}

/** El lugar tal como se guarda: sin de dónde salió. */
function toEventPlace(suggestion: PlaceSuggestion): EventPlace {
  const { name, address } = suggestion;
  return suggestion.lat === null
    ? { name, address, lat: null, lng: null }
    : { name, address, lat: suggestion.lat, lng: suggestion.lng };
}

/** Las sugerencias y, si hay algo escrito, quedarse con ello al final. */
function listOptions(
  search: PlaceSearchState,
  text: string,
): readonly PlaceOption[] {
  const places: readonly PlaceOption[] =
    search.kind === "found"
      ? search.suggestions.places.map((suggestion) => ({
          kind: "place",
          suggestion,
        }))
      : [];
  return text.trim() === "" ? places : [...places, { kind: "freeText" }];
}

function isSearchDown(search: PlaceSearchState): boolean {
  return (
    search.kind === "failed" ||
    (search.kind === "found" && !search.suggestions.searchAvailable)
  );
}

/** La opción siguiente o la anterior, dando la vuelta en los extremos. */
function stepActive(active: number, step: 1 | -1, count: number): number {
  if (active === NO_ACTIVE_OPTION) {
    return step === 1 ? 0 : count - 1;
  }
  return (active + step + count) % count;
}

function OptionContent({
  translate,
  option,
}: Pick<FieldProps, "translate"> & {
  readonly option: PlaceOption;
}): React.JSX.Element {
  if (option.kind === "freeText") {
    return (
      <span className="event-place-free-text">
        {translate("calendar.form.place.freeText")}
      </span>
    );
  }
  const { name, address } = option.suggestion;
  return (
    <>
      <MapPin aria-hidden="true" focusable="false" size={ICON_SIZE} />
      <span className="event-place-lines">
        <span className="event-place-name">{name}</span>
        {address === null ? null : (
          <span className="event-place-address">{address}</span>
        )}
      </span>
    </>
  );
}

function PlaceOptions({
  translate,
  options,
  activeIndex,
  onChoose,
}: Pick<FieldProps, "translate"> & {
  readonly options: readonly PlaceOption[];
  readonly activeIndex: number;
  readonly onChoose: (option: PlaceOption) => void;
}): React.JSX.Element {
  return (
    <ul
      className="event-place-options"
      id={LISTBOX_ID}
      role="listbox"
      aria-label={translate("calendar.form.place.suggestions")}
    >
      {options.map((option, index) => (
        <li
          key={
            option.kind === "freeText"
              ? "freeText"
              : `${index}-${option.suggestion.name}`
          }
          id={optionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          className={`event-place-option event-place-option-${option.kind}`}
          // Sin esto el campo pierde el foco antes del clic y la lista se
          // cierra bajo el puntero.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(option)}
        >
          <OptionContent translate={translate} option={option} />
        </li>
      ))}
    </ul>
  );
}

function usePlaceListKeys(options: {
  readonly count: number;
  readonly isExpanded: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly chooseAt: (index: number) => boolean;
}): {
  readonly activeIndex: number;
  readonly resetActive: () => void;
  readonly handleKeyDown: (event: React.KeyboardEvent) => void;
} {
  const [active, setActive] = useState(NO_ACTIVE_OPTION);
  const activeIndex = active < options.count ? active : NO_ACTIVE_OPTION;

  function move(event: React.KeyboardEvent, step: 1 | -1): void {
    event.preventDefault();
    if (!options.isExpanded) {
      options.open();
      return;
    }
    setActive(stepActive(activeIndex, step, options.count));
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      move(event, 1);
    } else if (event.key === "ArrowUp") {
      move(event, -1);
    } else if (event.key === "Enter" && options.chooseAt(activeIndex)) {
      event.preventDefault();
    } else if (event.key === "Escape" && options.isExpanded) {
      // Cierra la lista, no el diálogo que la contiene.
      event.preventDefault();
      event.stopPropagation();
      options.close();
    }
  }

  return {
    activeIndex,
    resetActive: () => setActive(NO_ACTIVE_OPTION),
    handleKeyDown,
  };
}

function PlaceSearch({
  translate,
  form,
  issueTextFor,
  onChange,
  onChoose,
  inputRef,
}: PlaceFieldProps & {
  readonly inputRef: React.Ref<HTMLInputElement>;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const search = usePlaceSearch(form.location, isOpen);
  const options = isOpen ? listOptions(search, form.location) : [];
  const isExpanded = options.length > 0;
  const keys = usePlaceListKeys({
    count: options.length,
    isExpanded,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    chooseAt: (index) => {
      const option = options.at(index);
      if (index === NO_ACTIVE_OPTION || option === undefined) {
        return false;
      }
      choose(option);
      return true;
    },
  });

  function choose(option: PlaceOption): void {
    setIsOpen(false);
    keys.resetActive();
    if (option.kind === "place") {
      onChoose(toEventPlace(option.suggestion));
    }
  }

  const issueText = issueTextFor("location");
  const { activeIndex } = keys;
  return (
    <div className="auth-field">
      <label htmlFor={fieldId("location")}>
        {translate("calendar.form.location")}
      </label>
      <div className="event-place-search">
        <MagnifyingGlass
          aria-hidden="true"
          focusable="false"
          size={SEARCH_ICON_SIZE}
        />
        <input
          ref={inputRef}
          id={fieldId("location")}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isExpanded}
          aria-controls={LISTBOX_ID}
          aria-activedescendant={
            activeIndex === NO_ACTIVE_OPTION ? undefined : optionId(activeIndex)
          }
          value={form.location}
          placeholder={translate("calendar.form.locationPlaceholder")}
          autoComplete="off"
          {...issueAttributes("location", issueText)}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onKeyDown={keys.handleKeyDown}
          onChange={(event) => {
            setIsOpen(true);
            keys.resetActive();
            onChange({ location: event.target.value });
          }}
        />
      </div>
      {isOpen && (isExpanded || isSearchDown(search)) ? (
        <div className="event-place-popup">
          {isExpanded ? (
            <PlaceOptions
              translate={translate}
              options={options}
              activeIndex={activeIndex}
              onChoose={choose}
            />
          ) : null}
          {isSearchDown(search) ? (
            <p className="event-place-note">
              {translate("calendar.form.place.searchUnavailable")}
            </p>
          ) : null}
        </div>
      ) : null}
      <FieldIssue field="location" text={issueText} />
    </div>
  );
}

function ChosenPlace({
  translate,
  place,
  issueText,
  onRemove,
  changeRef,
}: Pick<FieldProps, "translate"> & {
  readonly place: EventPlace;
  readonly issueText: string | null;
  readonly onRemove: () => void;
  readonly changeRef: React.Ref<HTMLButtonElement>;
}): React.JSX.Element {
  return (
    <div className="auth-field">
      <span className="event-place-label" id={LABEL_ID}>
        {translate("calendar.form.location")}
      </span>
      <div
        className="event-place-chosen"
        role="group"
        aria-labelledby={LABEL_ID}
      >
        <span className="event-place-pin" aria-hidden="true">
          <MapPin weight="fill" size={ICON_SIZE} />
        </span>
        <span className="event-place-lines">
          <span className="event-place-name">{place.name}</span>
          {place.address === null ? null : (
            <span className="event-place-address">{place.address}</span>
          )}
        </span>
        <a
          className="event-place-map"
          href={buildMapsUrl({ location: place.name, place })}
          target="_blank"
          rel="noopener noreferrer"
        >
          {translate("calendar.form.place.checkOnMap")}{" "}
          <span className="visually-hidden">
            {translate("calendar.event.opensMap")}
          </span>
        </a>
        <button
          ref={changeRef}
          type="button"
          className="agenda-icon-button"
          aria-label={translate("calendar.form.place.change")}
          onClick={onRemove}
        >
          <X aria-hidden="true" focusable="false" size={ICON_SIZE} />
        </button>
      </div>
      <FieldIssue field="location" text={issueText} />
    </div>
  );
}

function PlaceDetailField({
  translate,
  form,
  issueTextFor,
  onChange,
}: FieldProps): React.JSX.Element {
  const issueText = issueTextFor("placeDetail");
  return (
    <div className="auth-field">
      <label htmlFor={fieldId("placeDetail")}>
        {translate("calendar.form.place.detail")}{" "}
        <span className="event-form-optional">
          · {translate("calendar.form.place.optional")}
        </span>
      </label>
      <input
        id={fieldId("placeDetail")}
        type="text"
        value={form.placeDetail}
        placeholder={translate("calendar.form.place.detailPlaceholder")}
        autoComplete="off"
        {...issueAttributes("placeDetail", issueText)}
        onChange={(event) => onChange({ placeDetail: event.target.value })}
      />
      <FieldIssue field="placeDetail" text={issueText} />
    </div>
  );
}

type FocusTarget = "search" | "change";

export function EventPlaceField(props: FieldProps): React.JSX.Element {
  const { translate, form, issueTextFor, onChange } = props;
  const searchRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  // El campo y la tarjeta se sustituyen: el foco pasa al que aparece, pero
  // sólo si se cambió desde aquí, no al abrir el diálogo.
  const pendingFocus = useRef<FocusTarget | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === "search") {
      searchRef.current?.focus();
    } else if (target === "change") {
      changeRef.current?.focus();
    }
  }, [form.place]);

  if (form.place === null) {
    return (
      <PlaceSearch
        {...props}
        inputRef={searchRef}
        onChoose={(place) => {
          pendingFocus.current = "change";
          onChange({ place });
        }}
      />
    );
  }
  return (
    <>
      <ChosenPlace
        translate={translate}
        place={form.place}
        issueText={issueTextFor("location")}
        changeRef={changeRef}
        onRemove={() => {
          pendingFocus.current = "search";
          onChange({ place: null });
        }}
      />
      <PlaceDetailField {...props} />
    </>
  );
}
