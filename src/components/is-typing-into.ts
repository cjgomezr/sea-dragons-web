/** Los `<input>` que no sacan el teclado del móvil. */
const INPUT_TYPES_WITHOUT_KEYBOARD: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Si el foco en `target` saca el teclado del móvil. */
export function isTypingInto(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) {
    return !INPUT_TYPES_WITHOUT_KEYBOARD.has(target.type);
  }
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
