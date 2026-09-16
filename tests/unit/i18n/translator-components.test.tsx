import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

// Un componente de servidor puede ser asíncrono y no usa hooks.
async function ServerTitle({
  locale,
}: {
  locale: Locale;
}): Promise<React.JSX.Element> {
  const translate = createTranslator(locale);
  return <h1>{translate("auth.passwordRecovery.checkEmailTitle")}</h1>;
}

// Uno de cliente recibe el idioma como prop (una función no cruza la frontera
// entre servidor y navegador) y usa estado.
function ClientTitle({ locale }: { locale: Locale }): React.JSX.Element {
  const [translate] = useState(() => createTranslator(locale));
  return <h2>{translate("auth.passwordRecovery.checkEmailTitle")}</h2>;
}

describe("leer un mensaje desde servidor y navegador", () => {
  it.each<Locale>(["en", "es"])(
    "los dos componentes pintan el mismo texto en %s",
    async (locale) => {
      render(
        <>
          {await ServerTitle({ locale })}
          <ClientTitle locale={locale} />
        </>,
      );

      const serverText = screen.getByRole("heading", { level: 1 }).textContent;
      const clientText = screen.getByRole("heading", { level: 2 }).textContent;
      expect(serverText).not.toBe("");
      expect(clientText).toBe(serverText);
    },
  );
});
