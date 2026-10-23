"use client";

import { Eye } from "@phosphor-icons/react/dist/ssr/Eye";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { useLayoutEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import {
  DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH,
  type DraftFieldProblem,
} from "@/lib/directory/directory-email-rules";
import {
  type EmailFormat,
  applyEmailFormat,
} from "@/lib/directory/email-toolbar-format";
import { formatCharacterCount } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { BodyEdit, BodySelection } from "@/lib/news/news-body-format";
import type { EmailRecipient } from "./DirectoryEmailComposer";
import { DirectoryEmailFieldError } from "./DirectoryEmailFieldError";
import { DirectoryEmailPreview } from "./DirectoryEmailPreview";
import { DirectoryEmailToolbar } from "./DirectoryEmailToolbar";

/**
 * El mensaje del correo (#859, RF-4 del PRD de E33): las pestañas Escribir y
 * Vista previa, la barra de formato con sus atajos, el área y un pie con la
 * ayuda y el contador. Las pestañas siguen el patrón de WAI-ARIA con
 * activación automática, como las del editor de Noticias.
 *
 * El área no se desmonta en la Vista previa, sólo se esconde: así conserva la
 * selección al volver.
 */

export const EDITOR_TABS = ["write", "preview"] as const;

export type EditorTab = (typeof EDITOR_TABS)[number];

export const MESSAGE_ID = "correo-directorio-mensaje";
const MESSAGE_HINT_ID = "correo-directorio-mensaje-ayuda";
const MESSAGE_ERROR_ID = "correo-directorio-mensaje-error";
const TAB_ID_PREFIX = "correo-directorio-pestana";
const PANEL_ID_PREFIX = "correo-directorio-panel";

/** Pasado este tanto por uno del límite, el contador se nota. */
const NEAR_LIMIT_RATIO = 0.9;

const SHORTCUT_FORMATS: Readonly<Record<string, EmailFormat>> = {
  b: "bold",
  i: "italic",
  k: "link",
};

const TAB_ICONS = { write: PencilSimple, preview: Eye } as const;

function shortcutFormat(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
): EmailFormat | null {
  const hasModifier = event.metaKey || event.ctrlKey;
  if (!hasModifier || event.altKey || event.shiftKey) {
    return null;
  }
  return SHORTCUT_FORMATS[event.key.toLowerCase()] ?? null;
}

/** Con dos pestañas, las flechas llevan siempre a la otra. */
function tabForKey(key: string, current: EditorTab): EditorTab | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowLeft":
      return current === "write" ? "preview" : "write";
    case "Home":
      return "write";
    case "End":
      return "preview";
    default:
      return null;
  }
}

function counterLevel(length: number): "near" | "over" | undefined {
  if (length > DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH) {
    return "over";
  }
  return length > DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH * NEAR_LIMIT_RATIO
    ? "near"
    : undefined;
}

function EditorTabs({
  translate,
  activeTab,
  onSelect,
}: {
  readonly translate: Translator;
  readonly activeTab: EditorTab;
  readonly onSelect: (tab: EditorTab) => void;
}): React.JSX.Element {
  const tabRefs = useRef<Partial<Record<EditorTab, HTMLButtonElement>>>({});

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const next = tabForKey(event.key, activeTab);
    if (next === null) {
      return;
    }
    event.preventDefault();
    onSelect(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div
      className="directory-email-tabs"
      role="tablist"
      aria-label={translate("directory.email.tabs")}
      onKeyDown={handleKeyDown}
    >
      {EDITOR_TABS.map((tab) => {
        const isActive = tab === activeTab;
        return (
          <button
            key={tab}
            ref={(element) => {
              tabRefs.current[tab] = element ?? undefined;
            }}
            type="button"
            role="tab"
            id={`${TAB_ID_PREFIX}-${tab}`}
            className="directory-email-tab"
            aria-selected={isActive}
            aria-controls={`${PANEL_ID_PREFIX}-${tab}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab)}
          >
            <Icon glyph={TAB_ICONS[tab]} />
            {translate(`directory.email.tab.${tab}`)}
          </button>
        );
      })}
    </div>
  );
}

/** Cambia el texto desde la barra y devuelve la selección al área cuando
 * React la pinte. */
function useMessageEdits(
  value: string,
  onChange: (message: string) => void,
  areaRef: React.RefObject<HTMLTextAreaElement | null>,
): (change: (edit: BodyEdit) => BodyEdit) => void {
  const pendingSelection = useRef<BodySelection | null>(null);

  useLayoutEffect(() => {
    const area = areaRef.current;
    const selection = pendingSelection.current;
    if (area === null || selection === null) {
      return;
    }
    pendingSelection.current = null;
    area.focus();
    area.setSelectionRange(selection.start, selection.end);
  }, [value, areaRef]);

  return (change) => {
    const area = areaRef.current;
    if (area === null) {
      return;
    }
    const edit = change({
      text: area.value,
      selection: { start: area.selectionStart, end: area.selectionEnd },
    });
    // Sin cambio de texto React no vuelve a pintar: una selección pendiente
    // se quedaría viva y saltaría en la tecla siguiente.
    if (edit.text === area.value) {
      area.focus();
      area.setSelectionRange(edit.selection.start, edit.selection.end);
      return;
    }
    pendingSelection.current = edit.selection;
    onChange(edit.text);
  };
}

export function DirectoryEmailMessageField({
  translate,
  areaRef,
  value,
  problem,
  activeTab,
  preview,
  onChange,
  onSelectTab,
}: {
  readonly translate: Translator;
  readonly areaRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly value: string;
  readonly problem: DraftFieldProblem | null;
  readonly activeTab: EditorTab;
  /** Lo que la Vista previa enseña además del mensaje. */
  readonly preview: {
    readonly recipients: readonly EmailRecipient[];
    readonly subject: string;
  };
  readonly onChange: (message: string) => void;
  readonly onSelectTab: (tab: EditorTab) => void;
}): React.JSX.Element {
  const applyEdit = useMessageEdits(value, onChange, areaRef);
  const isWriting = activeTab === "write";

  function format(emailFormat: EmailFormat): void {
    applyEdit((edit) =>
      applyEmailFormat(edit, emailFormat, {
        bold: translate("directory.email.placeholder.bold"),
        italic: translate("directory.email.placeholder.italic"),
        link: translate("directory.email.placeholder.link"),
      }),
    );
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    const shortcut = shortcutFormat(event);
    if (shortcut === null) {
      return;
    }
    event.preventDefault();
    format(shortcut);
  }

  return (
    <div className="directory-email-field">
      <div className="directory-email-label-row">
        <label htmlFor={MESSAGE_ID} className="directory-email-label">
          {translate("directory.email.message")}
        </label>
        <EditorTabs
          translate={translate}
          activeTab={activeTab}
          onSelect={onSelectTab}
        />
      </div>
      <div
        className="directory-email-editor"
        data-invalid={problem === null ? undefined : "true"}
      >
        <div
          className="directory-email-editor-panel"
          role="tabpanel"
          id={`${PANEL_ID_PREFIX}-write`}
          aria-labelledby={`${TAB_ID_PREFIX}-write`}
          hidden={!isWriting}
        >
          <div className="directory-email-editor-bar">
            <DirectoryEmailToolbar
              translate={translate}
              controlsId={MESSAGE_ID}
              onFormat={format}
            />
            <span className="directory-email-syntax" aria-hidden="true">
              {translate("directory.email.toolbar.syntax")}
            </span>
          </div>
          <textarea
            ref={areaRef}
            id={MESSAGE_ID}
            className="directory-email-area"
            value={value}
            placeholder={translate("directory.email.messagePlaceholder")}
            aria-invalid={problem !== null}
            aria-describedby={
              problem === null
                ? MESSAGE_HINT_ID
                : `${MESSAGE_ERROR_ID} ${MESSAGE_HINT_ID}`
            }
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <DirectoryEmailPreview
          translate={translate}
          id={`${PANEL_ID_PREFIX}-preview`}
          labelledBy={`${TAB_ID_PREFIX}-preview`}
          isHidden={isWriting}
          recipients={preview.recipients}
          subject={preview.subject}
          message={value}
        />
        <div className="directory-email-editor-foot">
          <span id={MESSAGE_HINT_ID}>
            {translate("directory.email.messageHint")}
          </span>
          <span
            className="directory-email-counter"
            data-level={counterLevel(value.length)}
          >
            {translate("directory.email.counter", {
              length: formatCharacterCount(translate.locale, value.length),
              max: formatCharacterCount(
                translate.locale,
                DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH,
              ),
            })}
          </span>
        </div>
      </div>
      {problem === null ? null : (
        <DirectoryEmailFieldError id={MESSAGE_ERROR_ID}>
          {problem === "required"
            ? translate("directory.email.error.messageRequired")
            : translate("directory.email.error.messageTooLong", {
                count: value.length - DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH,
                max: formatCharacterCount(
                  translate.locale,
                  DIRECTORY_EMAIL_MESSAGE_MAX_LENGTH,
                ),
              })}
        </DirectoryEmailFieldError>
      )}
    </div>
  );
}
