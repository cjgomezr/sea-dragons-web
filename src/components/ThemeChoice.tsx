"use client";

import { Desktop } from "@phosphor-icons/react/dist/ssr/Desktop";
import { Moon } from "@phosphor-icons/react/dist/ssr/Moon";
import { Sun } from "@phosphor-icons/react/dist/ssr/Sun";
import { useSyncExternalStore } from "react";
import { Icon } from "@/components/Icon";
import {
  type SegmentedOption,
  SegmentedChoice,
} from "@/components/SegmentedChoice";
import type { Translator } from "@/lib/i18n/translator";
import type { ThemePreference } from "@/lib/theme";
import {
  chooseThemePreference,
  readStoredThemePreference,
  subscribeToThemeChanges,
} from "@/lib/theme-preference";

// The server cannot read the visitor's storage. The menu only renders once it
// is opened, after hydration, so this value is never actually painted.
function readServerPreference(): ThemePreference {
  return "system";
}

/**
 * Apariencia en el menú de la cuenta (#716): Claro · Oscuro · Sistema. Marca
 * lo que se eligió, no el tema pintado: con Sistema en un equipo oscuro el
 * marcado es Sistema, no Oscuro.
 */
export function ThemeChoice({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  const preference = useSyncExternalStore(
    subscribeToThemeChanges,
    readStoredThemePreference,
    readServerPreference,
  );
  const options: readonly SegmentedOption<ThemePreference>[] = [
    {
      value: "light",
      label: translate("accountMenu.themeLight"),
      icon: <Icon glyph={Sun} />,
    },
    {
      value: "dark",
      label: translate("accountMenu.themeDark"),
      icon: <Icon glyph={Moon} />,
    },
    {
      value: "system",
      label: translate("accountMenu.themeSystem"),
      icon: <Icon glyph={Desktop} />,
    },
  ];
  return (
    <SegmentedChoice
      label={translate("accountMenu.appearance")}
      options={options}
      selected={preference}
      onChoose={chooseThemePreference}
    />
  );
}
