"use client";

import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { LinkSimple } from "@phosphor-icons/react/dist/ssr/LinkSimple";
import { ListBullets } from "@phosphor-icons/react/dist/ssr/ListBullets";
import { ListNumbers } from "@phosphor-icons/react/dist/ssr/ListNumbers";
import { TextB } from "@phosphor-icons/react/dist/ssr/TextB";
import { TextItalic } from "@phosphor-icons/react/dist/ssr/TextItalic";
import { Fragment, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  EMAIL_FORMATS,
  type EmailFormat,
} from "@/lib/directory/email-toolbar-format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La barra de formato del correo (#859, RF-4 del PRD de E33). Es una
 * `toolbar` de WAI-ARIA: un solo botón en el orden del tabulador y las
 * flechas para moverse entre ellos. Cada botón cancela el `mousedown`, así el
 * área no pierde el foco ni la selección antes de que llegue el clic.
 */

const GLYPHS: Readonly<Record<EmailFormat, PhosphorGlyph>> = {
  bold: TextB,
  italic: TextItalic,
  link: LinkSimple,
  bulletList: ListBullets,
  numberedList: ListNumbers,
};

/** Las listas van detrás de una raya, como en el handoff. */
const FIRST_LIST_FORMAT: EmailFormat = "bulletList";

const LAST_INDEX = EMAIL_FORMATS.length - 1;

function indexForKey(key: string, current: number): number | null {
  switch (key) {
    case "ArrowRight":
      return current === LAST_INDEX ? 0 : current + 1;
    case "ArrowLeft":
      return current === 0 ? LAST_INDEX : current - 1;
    case "Home":
      return 0;
    case "End":
      return LAST_INDEX;
    default:
      return null;
  }
}

export function DirectoryEmailToolbar({
  translate,
  controlsId,
  onFormat,
}: {
  readonly translate: Translator;
  readonly controlsId: string;
  readonly onFormat: (format: EmailFormat) => void;
}): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const next = indexForKey(event.key, activeIndex);
    if (next === null) {
      return;
    }
    event.preventDefault();
    setActiveIndex(next);
    buttonRefs.current[next]?.focus();
  }

  return (
    <div
      className="directory-email-toolbar"
      role="toolbar"
      aria-label={translate("directory.email.toolbar")}
      aria-controls={controlsId}
      onKeyDown={handleKeyDown}
    >
      {EMAIL_FORMATS.map((format, index) => (
        <Fragment key={format}>
          {format === FIRST_LIST_FORMAT ? (
            <span
              className="directory-email-toolbar-separator"
              aria-hidden="true"
            />
          ) : null}
          <button
            ref={(element) => {
              buttonRefs.current[index] = element;
            }}
            type="button"
            className="directory-email-toolbar-button"
            aria-label={translate(`directory.email.format.${format}`)}
            tabIndex={index === activeIndex ? 0 : -1}
            onMouseDown={(event) => event.preventDefault()}
            onFocus={() => setActiveIndex(index)}
            onClick={() => onFormat(format)}
          >
            <Icon glyph={GLYPHS[format]} />
          </button>
        </Fragment>
      ))}
    </div>
  );
}
