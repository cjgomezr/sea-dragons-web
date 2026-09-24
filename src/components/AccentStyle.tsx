import { buildAccentStylesheet } from "@/lib/club/accent-stylesheet";

/** El acento del club, para el `<head>` del layout raíz. Sin hoja, la página
 * se pinta con el acento de `globals.css`. */
export function AccentStyle({
  accentColor,
}: {
  accentColor: string;
}): React.JSX.Element | null {
  const stylesheet = buildAccentStylesheet(accentColor);
  return stylesheet === null ? null : <style>{stylesheet}</style>;
}
