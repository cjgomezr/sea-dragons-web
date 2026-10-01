"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SearchIcon } from "@/components/NavIcons";
import { useDismissal } from "@/components/use-dismissal";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { SearchResults } from "@/lib/search/search";
import { SEARCH_GROUP_SIZE } from "@/lib/search/search-limits";
import {
  type SearchGroupKey,
  type SearchViewer,
  searchResultDestination,
  seeAllDestination,
} from "./search-destinations";
import {
  type ListedOption,
  type SearchOption,
  type SearchOptionGroup,
  SearchResultList,
} from "./SearchResultList";
import { type GlobalSearchState, useGlobalSearch } from "./use-global-search";

/**
 * La búsqueda global (#427, RF-8 del PRD de E14): el cuadro "Buscar socios,
 * eventos, noticias" y la lista agrupada que abre. Es de cliente porque
 * pregunta a la API mientras se escribe.
 *
 * El mismo componente sirve a los dos tamaños: en escritorio vive en la barra
 * de arriba del contenido (`bar`) y la lista cuelga de él; en el móvil la
 * abre la lupa a pantalla completa (`screen`), con el foco ya en el cuadro.
 *
 * Es un combobox con listbox (patrón ARIA): el foco se queda en el cuadro,
 * las flechas marcan una opción y Enter la abre.
 */

export type SearchLayout = "bar" | "screen";

const GROUP_ORDER: readonly SearchGroupKey[] = ["members", "events", "news"];

/** Los grupos con algo, en orden, con "Ver todos" detrás de los que tienen
 * más de los que caben. */
function listOptionGroups(
  results: SearchResults,
  destinations: {
    readonly viewer: SearchViewer;
    readonly text: string;
    readonly now: Date;
  },
): readonly SearchOptionGroup[] {
  let nextIndex = 0;
  const indexed = (option: SearchOption): ListedOption => {
    const listed = { ...option, index: nextIndex };
    nextIndex += 1;
    return listed;
  };
  return GROUP_ORDER.filter((key) => results[key].total > 0).map((key) => {
    const group = results[key];
    const options: SearchOption[] = group.items.map((result) => ({
      kind: "result",
      result,
      href: searchResultDestination(
        result,
        destinations.viewer,
        destinations.now,
      ),
    }));
    if (group.total > SEARCH_GROUP_SIZE) {
      options.push({
        kind: "seeAll",
        group: key,
        href: seeAllDestination(key, destinations.text),
      });
    }
    return { key, total: group.total, options: options.map(indexed) };
  });
}

function totalOf(results: SearchResults): number {
  return GROUP_ORDER.reduce((sum, key) => sum + results[key].total, 0);
}

/** Lo que oye el lector de pantalla al llegar la respuesta. El fallo lo
 * anuncia su propio `alert`. */
function announcementOf(
  translate: Translator,
  state: GlobalSearchState,
): string | null {
  return state.kind === "found"
    ? translate("search.announcement", { count: totalOf(state.results) })
    : null;
}

/** Fuera de un campo de texto, `/` lleva a la búsqueda, como en tantos
 * sitios. Dentro de uno es una barra que alguien está escribiendo. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function useSlashShortcut(
  isEnabled: boolean,
  inputRef: React.RefObject<HTMLInputElement | null>,
): void {
  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
      if (event.key !== "/" || hasModifier || isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled, inputRef]);
}

function SearchPopup({
  translate,
  state,
  groups,
  listbox,
  onRetry,
}: {
  readonly translate: Translator;
  readonly state: Exclude<GlobalSearchState, { kind: "idle" }>;
  readonly groups: readonly SearchOptionGroup[];
  readonly listbox: React.ReactNode;
  readonly onRetry: () => void;
}): React.JSX.Element {
  switch (state.kind) {
    case "loading":
      return <p className="search-message">{translate("search.loading")}</p>;
    case "failed":
      return (
        <div className="search-message search-failure" role="alert">
          <p>{translate("search.error")}</p>
          <button type="button" className="auth-secondary" onClick={onRetry}>
            {translate("search.retry")}
          </button>
        </div>
      );
    case "found":
      return groups.length === 0 ? (
        <p className="search-message">
          {translate("search.empty", { text: state.text })}
        </p>
      ) : (
        <>{listbox}</>
      );
  }
}

/** La opción marcada vale sólo para la respuesta en la que se marcó. */
type ActiveOption = {
  readonly results: SearchResults;
  readonly index: number;
};

function nextIndex(
  current: number | null,
  count: number,
  key: "ArrowDown" | "ArrowUp",
): number {
  if (current === null) {
    return key === "ArrowDown" ? 0 : count - 1;
  }
  const step = key === "ArrowDown" ? 1 : -1;
  return (current + step + count) % count;
}

export function GlobalSearch({
  locale,
  viewer,
  layout,
  onClose,
  leading = null,
}: {
  readonly locale: Locale;
  readonly viewer: SearchViewer;
  readonly layout: SearchLayout;
  /** Se cerró la búsqueda: con Escape o al abrir un resultado. */
  readonly onClose?: () => void;
  /** Lo que va antes del cuadro en su fila: la flecha de cerrar del móvil. */
  readonly leading?: React.ReactNode;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const router = useRouter();
  const baseId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const search = useGlobalSearch();
  const { state } = search;
  // En la pantalla entera la lista es la pantalla: siempre está abierta.
  const [isExpanded, setIsExpanded] = useState(layout === "screen");
  const [active, setActive] = useState<ActiveOption | null>(null);
  const collapse = useCallback(
    () => setIsExpanded(layout === "screen"),
    [layout],
  );

  useSlashShortcut(layout === "bar", inputRef);
  useDismissal({
    isOpen: isExpanded && layout === "bar",
    containerRef,
    onEscape: collapse,
    onPressOutside: collapse,
    onFocusOutside: collapse,
  });
  useEffect(() => {
    if (layout === "screen") {
      inputRef.current?.focus();
    }
  }, [layout]);

  const groups =
    state.kind === "found"
      ? listOptionGroups(state.results, {
          viewer,
          text: state.text,
          now: new Date(),
        })
      : [];
  const options = groups.flatMap((group) => group.options);
  const isPopupOpen = isExpanded && state.kind !== "idle";
  const hasListbox = isPopupOpen && options.length > 0;
  const activeIndex =
    state.kind === "found" && active?.results === state.results
      ? active.index
      : null;
  const listboxId = `${baseId}-resultados`;
  const optionId = (index: number): string => `${baseId}-opcion-${index}`;

  function close(): void {
    search.setText("");
    setActive(null);
    collapse();
    onClose?.();
  }

  function choose(href: string): void {
    router.push(href);
    close();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!hasListbox || state.kind !== "found") {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = nextIndex(activeIndex, options.length, event.key);
      setActive({ results: state.results, index });
      // El foco no se mueve del cuadro, así que el navegador no desplaza la
      // página hasta la opción marcada: se trae a la vista a mano.
      document.getElementById(optionId(index))?.scrollIntoView({
        block: "nearest",
      });
      return;
    }
    const chosen = activeIndex === null ? undefined : options[activeIndex];
    if (event.key === "Enter" && chosen !== undefined) {
      event.preventDefault();
      choose(chosen.href);
    }
  }

  return (
    <div ref={containerRef} className={`global-search global-search-${layout}`}>
      <div className="global-search-row">
        {leading}
        <div className="global-search-field">
          <SearchIcon />
          <label className="visually-hidden" htmlFor={`${baseId}-cuadro`}>
            {translate("search.label")}
          </label>
          <input
            ref={inputRef}
            id={`${baseId}-cuadro`}
            type="search"
            role="combobox"
            className="global-search-input"
            placeholder={translate("search.placeholder")}
            autoComplete="off"
            enterKeyHint="search"
            aria-autocomplete="list"
            aria-expanded={hasListbox}
            aria-controls={hasListbox ? listboxId : undefined}
            aria-activedescendant={
              hasListbox && activeIndex !== null
                ? optionId(activeIndex)
                : undefined
            }
            value={search.text}
            onChange={(event) => {
              search.setText(event.target.value);
              setIsExpanded(true);
            }}
            onFocus={() => setIsExpanded(true)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
      {/* Desde que se abre la búsqueda y no antes: un lector de pantalla
          sólo anuncia los cambios de una región que ya estaba, y una región
          vacía en cada pantalla sería una más que tropezar sin motivo. */}
      {isExpanded ? (
        <p className="visually-hidden" role="status">
          {announcementOf(translate, state)}
        </p>
      ) : null}
      {isPopupOpen ? (
        <div className="global-search-popup">
          <SearchPopup
            translate={translate}
            state={state}
            groups={groups}
            onRetry={search.retry}
            listbox={
              <SearchResultList
                id={listboxId}
                translate={translate}
                groups={groups}
                activeIndex={activeIndex}
                optionId={optionId}
                onChoose={choose}
              />
            }
          />
        </div>
      ) : null}
    </div>
  );
}
