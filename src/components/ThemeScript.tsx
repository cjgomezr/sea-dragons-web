import { DARK_SCHEME_QUERY, THEME_STORAGE_KEY } from "@/lib/theme";

// Runs before React hydrates so the page never paints the wrong theme first.
// It mirrors `readThemePreference` and `resolveTheme`: anything but a stored
// light or dark (nothing, `system`, an unknown value) follows the system. The
// catch is the documented case of a browser that denies storage access
// (Safari private mode): no readable choice means `system`, not a failure.
const script = `(function(){var s=null;try{s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});}catch(e){}document.documentElement.dataset.theme=(s==="light"||s==="dark")?s:(window.matchMedia(${JSON.stringify(DARK_SCHEME_QUERY)}).matches?"dark":"light");})();`;

export function ThemeScript(): React.JSX.Element {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
