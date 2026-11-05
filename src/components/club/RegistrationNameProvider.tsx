"use client";

import { createContext, useContext } from "react";
import { DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator, type Translator } from "@/lib/i18n/translator";

/**
 * El nombre del registro del club (#967, RF-7 de E37), al alcance de las
 * pantallas de cliente que escriben sus textos: el perfil, la ficha, el alta y
 * el directorio. La cáscara lo pone una vez, como el nombre del club en
 * `ClubNameProvider`, así que ninguna pantalla lo pasa de mano en mano.
 *
 * Sin proveedor (un test que monta la pantalla suelta) vale el respaldo de la
 * marca, el mismo que sale si la base no contesta.
 */

const RegistrationNameContext = createContext<string | null>(
  DEFAULT_CLUB_BRAND.registrationName,
);

export function RegistrationNameProvider({
  name,
  children,
}: {
  readonly name: string | null;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <RegistrationNameContext value={name}>{children}</RegistrationNameContext>
  );
}

export function useRegistrationName(): string | null {
  return useContext(RegistrationNameContext);
}

/** El traductor de una pantalla que escribe textos del registro: rellena
 * `{registration}` con el nombre del club. */
export function useClubTranslator(locale: Locale): Translator {
  return createTranslator(locale, { registrationName: useRegistrationName() });
}
