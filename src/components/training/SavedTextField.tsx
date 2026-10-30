"use client";

import { useState } from "react";

/**
 * Un campo de texto del editor de rutinas (#908) que guarda al salir, solo
 * si cambió. Lo que se escribe es suyo hasta entonces; si quien lo usa no
 * acepta el valor, o el valor guardado cambia por fuera (un error que lo
 * devuelve), enseña otra vez el guardado.
 */

type SavedTextFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "onBlur"
> & {
  readonly value: string;
  /** Falso si no vale: el campo vuelve a `value`. */
  readonly onCommit: (text: string) => boolean;
  /** Lo que se deja escribir: las series, solo cifras. */
  readonly sanitize?: (text: string) => string;
  /** Al salir sin cambiar nada. */
  readonly onUnchanged?: () => void;
};

export function SavedTextField({
  value,
  onCommit,
  sanitize,
  onUnchanged,
  ...inputProps
}: SavedTextFieldProps): React.JSX.Element {
  const [text, setText] = useState(value);
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(value);
  }

  return (
    <input
      type="text"
      {...inputProps}
      value={text}
      onChange={(event) =>
        setText(
          sanitize === undefined
            ? event.target.value
            : sanitize(event.target.value),
        )
      }
      onBlur={() => {
        if (text.trim() === value.trim()) {
          setText(value);
          onUnchanged?.();
          return;
        }
        if (!onCommit(text)) {
          setText(value);
        }
      }}
    />
  );
}
