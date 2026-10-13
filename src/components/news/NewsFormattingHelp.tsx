"use client";

import { MarkdownLogo } from "@phosphor-icons/react/dist/ssr/MarkdownLogo";
import { useState, useSyncExternalStore } from "react";
import type { Translator } from "@/lib/i18n/translator";
import { BODY_FORMATS } from "@/lib/news/news-body-format";
import { Icon } from "@/components/Icon";

/**
 * El pie del editor (#598): la pista con los atajos, que es también la que
 * describe al área, y la ayuda de formato, una chuleta plegada de la sintaxis
 * que admite el cuerpo. Los atajos se nombran como los ve quien escribe: ⌘
 * en los Mac y Ctrl en el resto. El servidor no sabe en qué equipo se abre,
 * así que dice Ctrl hasta que el navegador lo cuente.
 */

const APPLE_PLATFORM = /Mac|iPhone|iPad/;
const APPLE_MODIFIER = "⌘";
const OTHER_MODIFIER = "Ctrl+";

function subscribeToNothing(): () => void {
  return () => undefined;
}

function useShortcutModifier(): string {
  return useSyncExternalStore(
    subscribeToNothing,
    () =>
      APPLE_PLATFORM.test(window.navigator.userAgent)
        ? APPLE_MODIFIER
        : OTHER_MODIFIER,
    () => OTHER_MODIFIER,
  );
}

function FormattingCheatSheet({
  translate,
  id,
  labelledBy,
}: {
  readonly translate: Translator;
  readonly id: string;
  readonly labelledBy: string;
}): React.JSX.Element {
  return (
    <section className="news-body-help" id={id} aria-labelledby={labelledBy}>
      <dl>
        {BODY_FORMATS.map((format) => (
          <div className="news-body-help-row" key={format}>
            <dt>{translate(`news.publish.editor.format.${format}`)}</dt>
            <dd>
              <code>{translate(`news.publish.editor.help.${format}`)}</code>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function NewsFormattingHelp({
  translate,
  idPrefix,
  hintId,
}: {
  readonly translate: Translator;
  readonly idPrefix: string;
  readonly hintId: string;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const modifier = useShortcutModifier();
  const buttonId = `${idPrefix}-ayuda`;
  const sheetId = `${idPrefix}-chuleta`;
  return (
    <>
      <div className="news-body-footer">
        <span className="news-body-hint">
          <Icon glyph={MarkdownLogo} />
          <span id={hintId}>
            {translate("news.publish.bodyHint", { modifier })}
          </span>
        </span>
        <button
          type="button"
          id={buttonId}
          className="news-body-help-toggle"
          aria-expanded={isOpen}
          aria-controls={sheetId}
          onClick={() => setIsOpen((current) => !current)}
        >
          {translate("news.publish.editor.help")}
        </button>
      </div>
      {isOpen ? (
        <FormattingCheatSheet
          translate={translate}
          id={sheetId}
          labelledBy={buttonId}
        />
      ) : null}
    </>
  );
}
