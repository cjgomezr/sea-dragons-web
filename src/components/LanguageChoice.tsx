"use client";

import { Translate } from "@phosphor-icons/react/dist/ssr/Translate";
import { Icon } from "@/components/Icon";
import {
  type SegmentedOption,
  SegmentedChoice,
} from "@/components/SegmentedChoice";
import { useChooseLocale } from "@/components/use-choose-locale";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";

/** Cada idioma se nombra en sí mismo y no se traduce: quien busca su idioma
 * en una pantalla que no entiende lo reconoce así. */
const LANGUAGE_OPTIONS: readonly SegmentedOption<Locale>[] = [
  {
    value: "en",
    label: "English",
    lang: "en",
    icon: <Icon glyph={Translate} />,
  },
  {
    value: "es",
    label: "Español",
    lang: "es",
    icon: <Icon glyph={Translate} />,
  },
];

/**
 * Idioma en el menú de la cuenta (#716): English · Español con el actual
 * marcado. El radio del actual ya está marcado, así que elegirlo no dispara
 * nada; elegir el otro guarda la cookie y pide la pantalla otra vez.
 */
export function LanguageChoice({
  locale,
  translate,
}: {
  readonly locale: Locale;
  readonly translate: Translator;
}): React.JSX.Element {
  const chooseLocale = useChooseLocale();
  return (
    <SegmentedChoice
      label={translate("accountMenu.language")}
      options={LANGUAGE_OPTIONS}
      selected={locale}
      onChoose={chooseLocale}
    />
  );
}
