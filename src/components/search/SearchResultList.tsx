import Link from "next/link";
import { MemberAvatar } from "@/components/MemberAvatar";
import { positionName } from "@/lib/club/club-positions";
import { formatCalendarDayAt } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type {
  EventSearchResult,
  MemberSearchResult,
  NewsSearchResult,
  SearchResult,
} from "@/lib/search/search";
import type { SearchGroupKey } from "./search-destinations";

/**
 * La lista agrupada de la búsqueda global (#427): un `listbox` con un `group`
 * por tipo, como pide el patrón ARIA del combobox. El foco no entra nunca:
 * se queda en el cuadro, y la opción marcada la dice `aria-activedescendant`.
 *
 * Cada opción es un enlace para que abrirla en otra pestaña siga siendo
 * posible; un clic normal lo resuelve quien la pinta, que además cierra la
 * búsqueda.
 */

export type SearchOption =
  | {
      readonly kind: "result";
      readonly result: SearchResult;
      readonly href: string;
    }
  | {
      readonly kind: "seeAll";
      readonly group: SearchGroupKey;
      readonly href: string;
    };

/** Una opción con su sitio en la lista entera, que es el que recorren las
 * flechas de un grupo al siguiente. */
export type ListedOption = SearchOption & { readonly index: number };

export type SearchOptionGroup = {
  readonly key: SearchGroupKey;
  readonly total: number;
  readonly options: readonly ListedOption[];
};

const GROUP_TITLES = {
  members: "search.group.members",
  events: "search.group.events",
  news: "search.group.news",
} as const satisfies Record<SearchGroupKey, string>;

const SEE_ALL_TEXTS = {
  members: "search.seeAll.members",
  events: "search.seeAll.events",
  news: "search.seeAll.news",
} as const satisfies Record<SearchGroupKey, string>;

const AVATAR_SIZE_PX = 32;

function MemberContent({
  translate,
  member,
}: {
  readonly translate: Translator;
  readonly member: MemberSearchResult;
}): React.JSX.Element {
  return (
    <>
      <MemberAvatar
        fullName={member.fullName}
        photoUrl={member.photoUrl}
        size={AVATAR_SIZE_PX}
        className="search-result-avatar"
      />
      <span className="search-result-text">
        <span className="search-result-title">{member.fullName}</span>
        {member.position === null ? null : (
          <span className="search-result-detail">
            {positionName(member.position.names, translate.locale)}
          </span>
        )}
      </span>
    </>
  );
}

function EventContent({
  translate,
  event,
}: {
  readonly translate: Translator;
  readonly event: EventSearchResult;
}): React.JSX.Element {
  const when = formatCalendarDayAt(
    translate.locale,
    event.startsOn,
    event.startTime,
  );
  return (
    <span className="search-result-text">
      <span className="search-result-title">{event.title}</span>
      <span className="search-result-detail">
        {event.isCancelled
          ? `${translate("search.event.cancelled")} · ${when}`
          : `${when} · ${event.location}`}
      </span>
    </span>
  );
}

function NewsContent({
  translate,
  post,
}: {
  readonly translate: Translator;
  readonly post: NewsSearchResult;
}): React.JSX.Element {
  return (
    <span className="search-result-text">
      <span className="search-result-title">{post.title}</span>
      <span className="search-result-detail">
        {translate(`news.category.${post.category}`)}
      </span>
    </span>
  );
}

function ResultContent({
  translate,
  result,
}: {
  readonly translate: Translator;
  readonly result: SearchResult;
}): React.JSX.Element {
  switch (result.kind) {
    case "member":
      return <MemberContent translate={translate} member={result} />;
    case "event":
      return <EventContent translate={translate} event={result} />;
    case "news":
      return <NewsContent translate={translate} post={result} />;
  }
}

/** Con una tecla modificadora el enlace se abre en otra pestaña o ventana,
 * y esta pantalla no se mueve: la búsqueda sigue abierta. */
function opensElsewhere(event: React.MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export type SearchResultListProps = {
  readonly id: string;
  readonly translate: Translator;
  readonly groups: readonly SearchOptionGroup[];
  readonly activeIndex: number | null;
  readonly optionId: (index: number) => string;
  readonly onChoose: (href: string) => void;
};

function OptionLink({
  props,
  option,
}: {
  readonly props: SearchResultListProps;
  readonly option: ListedOption;
}): React.JSX.Element {
  const { translate } = props;
  const isActive = option.index === props.activeIndex;
  return (
    <Link
      id={props.optionId(option.index)}
      href={option.href}
      role="option"
      aria-selected={isActive}
      tabIndex={-1}
      className={
        option.kind === "seeAll"
          ? "search-option search-see-all"
          : "search-option"
      }
      onClick={(event) => {
        if (!opensElsewhere(event)) {
          event.preventDefault();
          props.onChoose(option.href);
        }
      }}
    >
      {option.kind === "result" ? (
        <ResultContent translate={translate} result={option.result} />
      ) : (
        translate(SEE_ALL_TEXTS[option.group])
      )}
    </Link>
  );
}

export function SearchResultList(
  props: SearchResultListProps,
): React.JSX.Element {
  const { translate } = props;
  return (
    <div
      id={props.id}
      role="listbox"
      className="search-listbox"
      aria-label={translate("search.results")}
    >
      {props.groups.map((group) => {
        const title = translate(GROUP_TITLES[group.key]);
        return (
          <div
            key={group.key}
            role="group"
            className="search-group"
            aria-label={translate("search.groupLabel", {
              group: title,
              total: group.total,
            })}
          >
            {/* El nombre del grupo ya lo dice su etiqueta: esto es la vista. */}
            <div className="search-group-header" aria-hidden="true">
              <span>{title}</span>
              <span className="search-group-total">{group.total}</span>
            </div>
            {group.options.map((option) => (
              <OptionLink key={option.index} props={props} option={option} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
