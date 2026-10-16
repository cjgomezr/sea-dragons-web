import { render, screen } from "@testing-library/react";
import { Confetti } from "@phosphor-icons/react/dist/ssr/Confetti";
import { Timer } from "@phosphor-icons/react/dist/ssr/Timer";
import { Trophy } from "@phosphor-icons/react/dist/ssr/Trophy";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { describe, expect, it } from "vitest";
import { EventCoverFallback } from "@/components/calendar/EventCoverFallback";
import { EventTypeTag } from "@/components/calendar/EventTypeTag";
import type { EventType } from "@/lib/events/event-creation";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Las piezas visuales de cada tipo de evento (#641, RF-1 y D4 del PRD de
 * E24): la etiqueta y el fondo de lo que no tiene imagen. Los colores los
 * pone la hoja de estilos por la clase del tipo (`event-type-css.test.ts`).
 */

const TYPE_NAMES = [
  ["training", "Training", "Entrenamiento"],
  ["competition", "Competition", "Competición"],
  ["social", "Social", "Social"],
  ["meeting", "Meeting", "Reunión"],
] as const satisfies readonly (readonly [EventType, string, string])[];

const TYPE_GLYPHS = [
  ["training", Timer],
  ["competition", Trophy],
  ["social", Confetti],
  ["meeting", UsersThree],
] as const satisfies readonly (readonly [EventType, PhosphorGlyph])[];

function renderFallback(
  props: React.ComponentProps<typeof EventCoverFallback>,
): HTMLElement {
  const { container } = render(<EventCoverFallback {...props} />);
  const fallback = container.firstElementChild;
  if (!(fallback instanceof HTMLElement)) {
    throw new Error("EventCoverFallback rendered nothing");
  }
  return fallback;
}

function iconOf(fallback: HTMLElement): SVGSVGElement {
  const svg = fallback.querySelector("svg");
  if (svg === null) {
    throw new Error("The fallback has no icon");
  }
  return svg;
}

function referenceShape(Glyph: PhosphorGlyph): string {
  const { container } = render(<Glyph />);
  const svg = container.querySelector("svg");
  if (svg === null) {
    throw new Error("Reference glyph rendered no <svg>");
  }
  return svg.innerHTML;
}

describe("EventTypeTag", () => {
  it.each(TYPE_NAMES)("names %s in English", (eventType, english) => {
    render(
      <EventTypeTag translate={createTranslator("en")} eventType={eventType} />,
    );

    expect(screen.getByText(english)).toBeInTheDocument();
  });

  it.each(TYPE_NAMES)("names %s in Spanish", (eventType, _english, spanish) => {
    render(
      <EventTypeTag translate={createTranslator("es")} eventType={eventType} />,
    );

    expect(screen.getByText(spanish)).toBeInTheDocument();
  });

  it.each(TYPE_NAMES)("%s carries its type class", (eventType, english) => {
    render(
      <EventTypeTag translate={createTranslator("en")} eventType={eventType} />,
    );

    expect(screen.getByText(english)).toHaveClass(
      "event-type-tag",
      `event-type-tag-${eventType}`,
    );
  });
});

describe("EventCoverFallback", () => {
  it.each(TYPE_GLYPHS)("%s draws its own icon", (eventType, glyph) => {
    const fallback = renderFallback({ eventType, iconSize: 24 });

    expect(iconOf(fallback).innerHTML).toBe(referenceShape(glyph));
  });

  it.each(TYPE_GLYPHS)("%s carries its type class", (eventType) => {
    const fallback = renderFallback({ eventType, iconSize: 24 });

    expect(fallback).toHaveClass(
      "event-cover-fallback",
      `event-cover-fallback-${eventType}`,
    );
  });

  it.each([24, 76] as const)("draws the icon at %i px", (iconSize) => {
    const icon = iconOf(renderFallback({ eventType: "training", iconSize }));

    expect(icon).toHaveAttribute("width", String(iconSize));
    expect(icon).toHaveAttribute("height", String(iconSize));
  });

  it("hides the icon from assistive technology", () => {
    const icon = iconOf(renderFallback({ eventType: "social", iconSize: 24 }));

    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("focusable", "false");
  });
});
