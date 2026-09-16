/**
 * Una frase traducida con un dato resaltado dentro, como el correo en "Te
 * mandamos un enlace a <strong>…</strong>". El traductor devuelve texto, y
 * dónde cae el dato lo decide cada idioma, así que se busca en la frase ya
 * traducida en vez de partirla a mano en trozos que sólo encajan en uno.
 */
export function EmphasizedValue({
  text,
  value,
}: {
  text: string;
  value: string;
}): React.JSX.Element {
  const start = text.indexOf(value);
  if (value === "" || start === -1) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, start)}
      <strong>{value}</strong>
      {text.slice(start + value.length)}
    </>
  );
}
