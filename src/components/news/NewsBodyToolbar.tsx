import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { Link } from "@phosphor-icons/react/dist/ssr/Link";
import { ListBullets } from "@phosphor-icons/react/dist/ssr/ListBullets";
import { ListNumbers } from "@phosphor-icons/react/dist/ssr/ListNumbers";
import { Quotes } from "@phosphor-icons/react/dist/ssr/Quotes";
import { TextB } from "@phosphor-icons/react/dist/ssr/TextB";
import { TextH } from "@phosphor-icons/react/dist/ssr/TextH";
import { TextItalic } from "@phosphor-icons/react/dist/ssr/TextItalic";
import { Fragment } from "react";
import type { Translator } from "@/lib/i18n/translator";
import type { BodyFormat } from "@/lib/news/news-body-format";
import { Icon } from "@/components/Icon";

/**
 * La barra de formato del editor (#598): botones de icono separados en tres
 * grupos, como en el handoff. Cada botón cancela el `mousedown`, así el área
 * no pierde el foco ni la selección antes de que el clic llegue.
 */

const GLYPHS: Readonly<Record<BodyFormat, PhosphorGlyph>> = {
  bold: TextB,
  italic: TextItalic,
  heading: TextH,
  bulletList: ListBullets,
  numberedList: ListNumbers,
  quote: Quotes,
  link: Link,
};

const FORMAT_GROUPS: readonly (readonly BodyFormat[])[] = [
  ["bold", "italic"],
  ["heading", "bulletList", "numberedList", "quote"],
  ["link"],
];

export function NewsBodyToolbar({
  translate,
  controlsId,
  onFormat,
}: {
  readonly translate: Translator;
  readonly controlsId: string;
  readonly onFormat: (format: BodyFormat) => void;
}): React.JSX.Element {
  return (
    <div
      className="news-body-toolbar"
      role="group"
      aria-label={translate("news.publish.editor.toolbar")}
    >
      {FORMAT_GROUPS.map((formats, index) => (
        <Fragment key={formats.join()}>
          {index > 0 ? (
            <span className="news-body-toolbar-separator" aria-hidden="true" />
          ) : null}
          {formats.map((format) => (
            <button
              key={format}
              type="button"
              className="news-body-toolbar-button"
              aria-label={translate(`news.publish.editor.format.${format}`)}
              aria-controls={controlsId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onFormat(format)}
            >
              <Icon glyph={GLYPHS[format]} />
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
