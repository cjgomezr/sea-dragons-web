"use client";

import { useId } from "react";

export type SegmentedOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  readonly icon: React.ReactNode;
  /** El idioma del texto cuando no es el de la página: "English" en una
   * pantalla en español se pronuncia en inglés. */
  readonly lang?: string;
};

/**
 * Un control segmentado del menú de la cuenta (#716): una fila de radios
 * nativos con su etiqueta encima. Son radios y no botones porque se elige uno
 * de varios, y así las flechas se mueven entre opciones sin código propio. El
 * radio va transparente sobre su segmento: el clic y el foco son suyos, y lo
 * que se ve es la etiqueta, como en la categoría de las noticias.
 */
export function SegmentedChoice<Value extends string>({
  label,
  options,
  selected,
  onChoose,
}: {
  readonly label: string;
  readonly options: readonly SegmentedOption<Value>[];
  readonly selected: Value;
  readonly onChoose: (value: Value) => void;
}): React.JSX.Element {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div className="segmented-choice">
      <span id={labelId} className="segmented-choice-label">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="segmented-choice-options"
      >
        {options.map((option) => (
          <label key={option.value} className="segmented-choice-option">
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={option.value === selected}
              onChange={() => onChoose(option.value)}
            />
            <span lang={option.lang}>
              {option.icon}
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
