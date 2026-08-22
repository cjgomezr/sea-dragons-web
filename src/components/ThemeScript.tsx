import { THEME_STORAGE_KEY } from "@/lib/theme";

// Runs before React hydrates so the page never paints the wrong theme first.
// The catch is the documented fallback for browsers that deny storage access
// (Safari private mode): light is a valid theme, not a swallowed failure.
const script = `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=(s==="light"||s==="dark")?s:(d?"dark":"light");}catch(e){document.documentElement.dataset.theme="light";}})();`;

export function ThemeScript(): React.JSX.Element {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
