export type Platform = "web" | "mobile";
export type Theme = "light" | "dark";

export type ScreenAction =
  | { readonly type: "web-nav"; readonly label: string }
  | { readonly type: "web-sign-out" }
  | { readonly type: "mobile-tab"; readonly label: string };

export interface MockupScreen {
  readonly screen: string;
  readonly platform: Platform;
  readonly action: ScreenAction;
}

export const THEMES: readonly Theme[] = ["light", "dark"];

// El prototipo (docs/Seadragons Platform.dc.html) no tiene una pantalla de
// "payments" en móvil, solo Home/Calendar/Team/News/Profile en su tab bar.
// El ticket pedía "payments" ahí; se documenta y se usa "profile", la
// pantalla real que existe. Ver comentario en el issue #18.
export const MOCKUP_SCREENS: readonly MockupScreen[] = [
  {
    screen: "dashboard",
    platform: "web",
    action: { type: "web-nav", label: "Dashboard" },
  },
  {
    screen: "directory",
    platform: "web",
    action: { type: "web-nav", label: "Directory" },
  },
  {
    screen: "calendar",
    platform: "web",
    action: { type: "web-nav", label: "Calendar" },
  },
  {
    screen: "attendance",
    platform: "web",
    action: { type: "web-nav", label: "Attendance" },
  },
  {
    screen: "team",
    platform: "web",
    action: { type: "web-nav", label: "Team Builder" },
  },
  {
    screen: "evaluations",
    platform: "web",
    action: { type: "web-nav", label: "Evaluations" },
  },
  {
    screen: "news",
    platform: "web",
    action: { type: "web-nav", label: "News & Docs" },
  },
  {
    screen: "payments",
    platform: "web",
    action: { type: "web-nav", label: "Payments" },
  },
  { screen: "auth", platform: "web", action: { type: "web-sign-out" } },
  {
    screen: "home",
    platform: "mobile",
    action: { type: "mobile-tab", label: "Home" },
  },
  {
    screen: "calendar",
    platform: "mobile",
    action: { type: "mobile-tab", label: "Calendar" },
  },
  {
    screen: "team",
    platform: "mobile",
    action: { type: "mobile-tab", label: "Team" },
  },
  {
    screen: "news",
    platform: "mobile",
    action: { type: "mobile-tab", label: "News" },
  },
  {
    screen: "profile",
    platform: "mobile",
    action: { type: "mobile-tab", label: "Profile" },
  },
];
