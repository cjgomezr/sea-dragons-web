import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CalendarioPage from "@/app/(app)/calendario/page";
import DashboardPage from "@/app/(app)/dashboard/page";
import DirectorioPage from "@/app/(app)/directorio/page";
import EquiposPage from "@/app/(app)/equipos/page";
import EvaluacionesPage from "@/app/(app)/evaluaciones/page";
import NoticiasPage from "@/app/(app)/noticias/page";
import PagosPage from "@/app/(app)/pagos/page";

describe("rutas de destino", () => {
  it.each([
    ["Dashboard", DashboardPage],
    ["Directorio", DirectorioPage],
    ["Calendario", CalendarioPage],
    ["Equipos", EquiposPage],
    ["Evaluaciones", EvaluacionesPage],
    ["Noticias", NoticiasPage],
    ["Pagos", PagosPage],
  ])(
    "la ruta de %s nombra su sección en un marcador de en construcción",
    (label, Page) => {
      render(<Page />);

      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
      expect(screen.getByText(/en construcción/i)).toBeInTheDocument();
    },
  );
});
