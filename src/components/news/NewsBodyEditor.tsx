"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import {
  type BodyEdit,
  type BodyFormat,
  type BodySelection,
  applyBodyFormat,
  insertBodyImage,
} from "@/lib/news/news-body-format";
import { NewsBodyToolbar } from "./NewsBodyToolbar";
import { NewsFormattingHelp } from "./NewsFormattingHelp";
import { NewsMarkdown } from "./NewsMarkdown";
import {
  describeAttachmentIssue,
  readAttachmentIssue,
} from "./news-publish-client";
import type {
  NewsInlineImageIssue,
  NewsInlineImageUploader,
} from "./use-news-inline-images";

/**
 * El cuerpo de una noticia como editor de Markdown (#598, RF-9 del PRD de
 * E22): pestañas Escribir y Vista previa, la barra de formato con sus atajos
 * y un pie con la ayuda. Las pestañas siguen el patrón de WAI-ARIA con
 * activación automática: las flechas cambian de pestaña y la enfocan.
 *
 * El área no se desmonta al pasar a Vista previa, sólo se esconde: así
 * conserva la selección al volver. Los formatos cambian el valor desde
 * React, así que el deshacer del navegador no los recoge.
 *
 * El botón Imagen (#603) sube la foto con la subida que le pasa el
 * formulario y, al acabar, la inserta donde está el cursor en ese momento.
 * Si no vale, no inserta nada y dice por qué debajo del área.
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

/** Cambia el texto desde el área (un formato, una imagen) y devuelve la
 * selección al área cuando React la pinte. */
function useBodyEdits(
  value: string,
  onChange: (body: string) => void,
): {
  readonly areaRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly applyEdit: (change: (edit: BodyEdit) => BodyEdit) => void;
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

  function applyEdit(change: (edit: BodyEdit) => BodyEdit): void {
    const area = areaRef.current;
    if (area === null) {
      return;
    }
    const edit = change({
      text: area.value,
      selection: { start: area.selectionStart, end: area.selectionEnd },
    });
    pendingSelection.current = edit.selection;
    onChange(edit.text);
  }

  return { areaRef, applyEdit };
}

function describeImageIssue(
  translate: Translator,
  issue: NewsInlineImageIssue,
): string {
  if (issue.kind === "rejected") {
    return describeAttachmentIssue(translate, issue.code);
  }
  const code = readAttachmentIssue(issue.failure);
  return code === null
    ? translate("news.publish.editor.image.issue.uploadFailed")
    : describeAttachmentIssue(translate, code);
}

/** Lo que pasa con la imagen que se sube: el estado vive siempre en la
 * página, vacío, para que el lector de pantalla anuncie cuándo empieza. */
function ImageUploadNotes({
  translate,
  isUploading,
  issue,
}: {
  readonly translate: Translator;
  readonly isUploading: boolean;
  readonly issue: NewsInlineImageIssue | null;
}): React.JSX.Element {
  return (
    <>
      <p className="news-body-image-status" role="status">
        {isUploading ? translate("news.publish.editor.imageUploading") : null}
      </p>
      {issue === null ? null : (
        <p className="news-body-image-issue" role="alert">
          {describeImageIssue(translate, issue)}
        </p>
      )}
    </>
  );
}

export function NewsBodyEditor({
  translate,
  id,
  value,
  onChange,
  issueId,
  imageUpload,
}: {
  readonly translate: Translator;
  readonly id: string;
  readonly value: string;
  readonly onChange: (body: string) => void;
  /** El aviso del campo, si lo hay: también describe al área. */
  readonly issueId: string | null;
  readonly imageUpload: NewsInlineImageUploader;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<EditorTab>("write");
  const [imageIssue, setImageIssue] = useState<NewsInlineImageIssue | null>(
    null,
  );
  const { areaRef, applyEdit } = useBodyEdits(value, onChange);
  const hintId = `${id}-pista`;
  const isWriting = activeTab === "write";

  function format(bodyFormat: BodyFormat): void {
    applyEdit((edit) => applyBodyFormat(edit, bodyFormat));
  }

  async function chooseImage(file: File): Promise<void> {
    setImageIssue(null);
    const outcome = await imageUpload.upload(file);
    if (outcome.kind === "rejected") {
      setImageIssue(outcome.issue);
      return;
    }
    applyEdit((edit) => insertBodyImage(edit, outcome.url));
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
              onChooseImage={(file) => void chooseImage(file)}
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
        <ImageUploadNotes
          translate={translate}
          isUploading={imageUpload.isUploading}
          issue={imageIssue}
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
