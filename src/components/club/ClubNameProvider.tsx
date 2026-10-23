"use client";

import { createContext, useContext } from "react";
import { DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";

/**
 * El nombre del club que leyó el servidor, al alcance de las pantallas de
 * cliente que lo escriben en una frase: la vista previa del correo del
 * directorio (#859) dice de quién llega. La cáscara lo pone una vez, así que
 * ninguna pantalla tiene que pasarlo de mano en mano.
 *
 * Sin proveedor (un test que monta la pantalla suelta) vale el respaldo de la
 * marca, el mismo que sale si la base no contesta.
 */

const ClubNameContext = createContext(DEFAULT_CLUB_BRAND.name);

export function ClubNameProvider({
  name,
  children,
}: {
  readonly name: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <ClubNameContext value={name}>{children}</ClubNameContext>;
}

export function useClubName(): string {
  return useContext(ClubNameContext);
}
