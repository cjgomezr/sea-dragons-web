import { PushPin } from "@phosphor-icons/react/dist/ssr/PushPin";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { NEWS_POST_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsFeedItem } from "@/lib/news/news-feed";
import { NewsCover } from "./NewsCover";
import { NewsAttachmentMark, NewsFeedMeta } from "./NewsFeedMeta";
import {
  NewsPinFailure,
  type PinControls,
  usePinStripToggle,
} from "./NewsPinControls";
import { NewsPinStrip } from "./NewsPinStrip";

const PIN_ICON_SIZE = 18;

/**
 * Una fila de la lista del feed (#329, rehecha en #594): la miniatura de la
 * portada o el fondo de su categoría, y al lado la línea de categoría, el
 * título y una línea de extracto. El enlace es sólo el título, para que un
 * lector de pantalla anuncie cada fila con su título y nada más; la fila
 * entera se pulsa porque el enlace la cubre por CSS.
 *
 * Al Admin le añade la chincheta (#595), que abre debajo la tira de duración.
 */
export function NewsFeedRow({
  translate,
  post,
  now,
  isUnread,
  shouldTakeFocus,
  pinControls,
}: {
  readonly translate: Translator;
  readonly post: NewsFeedItem;
  readonly now: Date;
  readonly isUnread: boolean;
  /** La primera fila de una página recién cargada: recibe el foco para que
   * quien pulsó "Cargar más" siga leyendo desde ahí. */
  readonly shouldTakeFocus: boolean;
  /** Nulo para quien no puede fijar (D1). */
  readonly pinControls: PinControls | null;
}): React.JSX.Element {
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (shouldTakeFocus) {
      linkRef.current?.focus();
    }
  }, [shouldTakeFocus]);

  return (
    <li className="news-row">
      <div className="news-row-thumbnail">
        <NewsCover
          url={post.coverThumbnailUrl}
          category={post.category}
          iconSize={32}
        />
      </div>
      <div className="news-row-body">
        <NewsFeedMeta
          translate={translate}
          post={post}
          now={now}
          unreadMark={isUnread ? "dot" : "none"}
        >
          <NewsAttachmentMark
            translate={translate}
            count={post.attachmentCount}
          />
        </NewsFeedMeta>
        <h3 className="news-row-title">
          <Link
            ref={linkRef}
            href={NEWS_POST_PATH.replace("[id]", post.id)}
            className="news-row-link"
          >
            {post.title}
          </Link>
        </h3>
        <p className="news-row-excerpt">{post.excerpt}</p>
      </div>
      {pinControls === null ? null : (
        <RowPinning
          translate={translate}
          title={post.title}
          controls={pinControls}
        />
      )}
    </li>
  );
}

function RowPinning({
  translate,
  title,
  controls,
}: {
  readonly translate: Translator;
  readonly title: string;
  readonly controls: PinControls;
}): React.JSX.Element {
  const stripId = useId();
  const { toggleRef, cancel, onToggleKeyDown } = usePinStripToggle(controls);
  const { pinning } = controls;
  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="news-row-pin"
        aria-label={translate("news.pin.row", { title })}
        aria-expanded={pinning.isStripOpen}
        aria-controls={pinning.isStripOpen ? stripId : undefined}
        onClick={controls.onToggleStrip}
        onKeyDown={onToggleKeyDown}
      >
        <PushPin
          aria-hidden="true"
          focusable="false"
          size={PIN_ICON_SIZE}
          color="currentColor"
        />
      </button>
      {pinning.isStripOpen ? (
        <div className="news-row-pinning">
          <NewsPinStrip
            translate={translate}
            id={stripId}
            replacesPinned={controls.replacesPinned}
            isSaving={pinning.isSaving}
            onChoose={controls.onChoose}
            onCancel={cancel}
          />
          <NewsPinFailure translate={translate} pinning={pinning} />
        </div>
      ) : null}
    </>
  );
}
