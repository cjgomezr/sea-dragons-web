"use client";

import { Image as ImageGlyph } from "@phosphor-icons/react/dist/ssr/Image";
import { useRef } from "react";
import type { Translator } from "@/lib/i18n/translator";
import { Icon } from "@/components/Icon";
import { NEWS_COVER_TYPES } from "./use-news-cover";

/**
 * El botón Imagen de la barra de formato (#603): abre el selector de
 * archivos, que vive escondido a su lado. Como los demás botones, cancela el
 * `mousedown` para que el área no pierda el cursor antes de saber dónde
 * insertar.
 */
export function NewsBodyImageButton({
  translate,
  controlsId,
  onChoose,
}: {
  readonly translate: Translator;
  readonly controlsId: string;
  readonly onChoose: (file: File) => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const [file] = event.target.files ?? [];
    // Vaciarlo deja volver a elegir el mismo archivo.
    event.target.value = "";
    if (file !== undefined) {
      onChoose(file);
    }
  }

  return (
    <>
      <button
        type="button"
        className="news-body-toolbar-button"
        aria-label={translate("news.publish.editor.image")}
        aria-controls={controlsId}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        <Icon glyph={ImageGlyph} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={NEWS_COVER_TYPES.join(",")}
        aria-label={translate("news.publish.editor.chooseImage")}
        tabIndex={-1}
        hidden
        onChange={handleChange}
      />
    </>
  );
}
