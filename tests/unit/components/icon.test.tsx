import { render } from "@testing-library/react";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { describe, expect, it } from "vitest";
import { Icon } from "@/components/Icon";

function renderIcon(
  props: Partial<React.ComponentProps<typeof Icon>> = {},
): SVGSVGElement {
  const { container } = render(
    <p>
      Search
      <Icon glyph={MagnifyingGlass} {...props} />
    </p>,
  );
  const svg = container.querySelector("svg");
  if (svg === null) {
    throw new Error("Icon rendered no <svg>");
  }
  return svg;
}

describe("Icon", () => {
  it("is decorative: hidden from assistive technology and not focusable", () => {
    const svg = renderIcon();

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("takes the size of the surrounding text", () => {
    const svg = renderIcon();

    expect(svg).toHaveAttribute("width", "1em");
    expect(svg).toHaveAttribute("height", "1em");
  });

  it("paints with the colour of the surrounding text", () => {
    const svg = renderIcon();

    expect(svg).toHaveAttribute("fill", "currentColor");
  });

  it("draws a different shape for the fill weight", () => {
    const regular = renderIcon().innerHTML;
    const filled = renderIcon({ weight: "fill" }).innerHTML;

    expect(filled).not.toBe(regular);
  });
});
