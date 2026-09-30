import { SectionLoading } from "@/components/SectionLoading";

// Con él Next pinta la sección nueva al instante y precarga hasta aquí cada
// enlace del menú en cuanto se ve (#435). Por eso no lee nada de la petición.
export default function Loading(): React.JSX.Element {
  return <SectionLoading />;
}
