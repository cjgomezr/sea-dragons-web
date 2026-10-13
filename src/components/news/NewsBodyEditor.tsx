"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import {
  type BodyFormat,
  type BodySelection,
  applyBodyFormat,
} from "@/lib/news/news-body-format";
import { NewsBodyToolbar } from "./NewsBodyToolbar";
import { NewsFormattingHelp } from "./NewsFormattingHelp";
import { NewsMarkdown } from "./NewsMarkdown";

/**
 * El cuerpo de una noticia como editor de Markdown (#598, RF-9 del PRD de
 * E22): pestañas Escribir y Vista previa, la barra de formato con sus atajos
 * y un pie con la ayuda. Las pestañas siguen el patrón de WAI-ARIA con
 * activación automática: las flechas cambian de pestaña y la enfocan.
 *
 * El área no se desmonta al pasar a Vista previa, sólo se esconde: así
 * conserva la selección y el deshacer del navegador al volver.
 */

const TABS = ["write", "preview"] as const;

type EditorTab = (typeof TABS)[number];

const SHORTCUT_FORMATS: Readonly<Record<string, BodyFormat>> = {
  b: "bold",
  i: "italic",
};

const OTHER_TAB: Readonly<Record<EditorTab, EditorTab>> = {
  write: "preview",
  preview: "write",
};

/** La pestaña a la que lleva cada tecla. Con dos, las flechas dan la vuelta
 * siempre hacia la otra. */
function tabForKey(key: string, current: EditorTab): EditorTab | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowLeft":
      return OTHER_TAB[current];
    case "Home":
      return "write";
    case "End":
      return "preview";
    default:
      return null;
  }
}

function shortcutFormat(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
): BodyFormat | null {
  const hasModifier = event.metaKey || event.ctrlKey;
  if (!hasModifier || event.altKey || event.shiftKey) {
    return null;
  }
  return SHORTCUT_FORMATS[event.key.toLowerCase()] ?? null;
}

function EditorTabs({
  translate,
  idPrefix,
  activeTab,
  onSelect,
}: {
  readonly translate: Translator;
  readonly idPrefix: string;
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
      className="news-body-tabs"
      role="tablist"
      aria-label={translate("news.publish.editor.tabs")}
      onKeyDown={handleKeyDown}
    >
      {TABS.map((tab) => {
        const isActive = tab === activeTab;
        return (
          <button
            key={tab}
            ref={(element) => {
              tabRefs.current[tab] = element ?? undefined;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-pestana-${tab}`}
            className="news-body-tab"
            aria-selected={isActive}
            aria-controls={`${idPrefix}-panel-${tab}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab)}
          >
            {translate(`news.publish.editor.${tab}`)}
          </button>
        );
      })}
    </div>
  );
}

function PreviewPanel({
  translate,
  idPrefix,
  body,
  isActive,
}: {
  readonly translate: Translator;
  readonly idPrefix: string;
  readonly body: string;
  readonly isActive: boolean;
}): React.JSX.Element {
  return (
    <div
      className="news-body-panel news-body-preview"
      role="tabpanel"
      id={`${idPrefix}-panel-preview`}
      aria-labelledby={`${idPrefix}-pestana-preview`}
      tabIndex={0}
      hidden={!isActive}
    >
      {body.trim() === "" ? (
        <p className="news-body-preview-empty">
          {translate("news.publish.editor.previewEmpty")}
        </p>
      ) : (
        <NewsMarkdown body={body} />
      )}
    </div>
  );
}

/** Aplica un formato y devuelve la selección al área cuando React la pinte. */
function useBodyFormatting(
  value: string,
  onChange: (body: string) => void,
): {
  readonly areaRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly format: (format: BodyFormat) => void;
} {
  const areaRef = useRef<HTMLTextAreaElement>(null);
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
  }, [value]);

  function format(bodyFormat: BodyFormat): void {
    const area = areaRef.current;
    if (area === null) {
      return;
    }
    const edit = applyBodyFormat(
      {
        text: area.value,
        selection: { start: area.selectionStart, end: area.selectionEnd },
      },
      bodyFormat,
    );
    pendingSelection.current = edit.selection;
    onChange(edit.text);
  }

  return { areaRef, format };
}

export function NewsBodyEditor({
  translate,
  id,
  value,
  onChange,
  issueId,
}: {
  readonly translate: Translator;
  readonly id: string;
  readonly value: string;
  readonly onChange: (body: string) => void;
  /** El aviso del campo, si lo hay: también describe al área. */
  readonly issueId: string | null;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<EditorTab>("write");
  const { areaRef, format } = useBodyFormatting(value, onChange);
  const hintId = `${id}-pista`;
  const isWriting = activeTab === "write";

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
    <>
      <label htmlFor={id}>{translate("news.publish.body")}</label>
      <div className="news-body-editor">
        <div className="news-body-bar">
          <EditorTabs
            translate={translate}
            idPrefix={id}
            activeTab={activeTab}
            onSelect={setActiveTab}
          />
          {isWriting ? (
            <NewsBodyToolbar
              translate={translate}
              controlsId={id}
              onFormat={format}
            />
          ) : null}
        </div>
        <div
          className="news-body-panel"
          role="tabpanel"
          id={`${id}-panel-write`}
          aria-labelledby={`${id}-pestana-write`}
          hidden={!isWriting}
        >
          <textarea
            ref={areaRef}
            id={id}
            className="news-body-area"
            value={value}
            aria-invalid={issueId !== null}
            aria-describedby={
              issueId === null ? hintId : `${issueId} ${hintId}`
            }
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <PreviewPanel
          translate={translate}
          idPrefix={id}
          body={value}
          isActive={!isWriting}
        />
        <NewsFormattingHelp
          translate={translate}
          idPrefix={id}
          hintId={hintId}
        />
      </div>
    </>
  );
}
