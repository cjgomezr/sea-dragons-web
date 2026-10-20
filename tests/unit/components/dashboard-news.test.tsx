import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DashboardNews,
  DashboardRestrictedNews,
} from "@/components/dashboard/DashboardNews";
import type {
  LatestNews,
  LatestNewsItem,
  MemberLatestNewsItem,
} from "@/lib/dashboard/dashboard";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Las noticias del inicio (#751, RF-7, D2 y D7 del PRD de E27): la destacada
 * con portada y dos pequeñas con miniatura y el punto de sin leer. Quien no
 * tiene la membresía al día ve sólo los títulos, y todo lo lleva a Pagos.
 */

const NOW = new Date("2026-09-30T08:00:00.000Z");
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_IN_MS).toISOString();
}

const SHORTLIST: MemberLatestNewsItem = {
  id: "dddddddd-0000-4000-8000-00000000000d",
  category: "announcement",
  title: "Nationals squad shortlist announced",
  publishedAt: daysAgo(2),
  coverUrl: null,
  excerpt: "The selectors have picked twelve players for Nationals.",
  isPinned: false,
  isUnread: false,
};

const SCHEDULE: MemberLatestNewsItem = {
  id: "eeeeeeee-0000-4000-8000-00000000000e",
  category: "news",
  title: "Winter training schedule is live",
  publishedAt: daysAgo(4),
  coverUrl: null,
  excerpt: "Sessions move to Thursday nights from June.",
  isPinned: false,
  isUnread: true,
};

const POLICY: MemberLatestNewsItem = {
  id: "ffffffff-0000-4000-8000-00000000000f",
  category: "document",
  title: "Updated pool safety & dive policy",
  publishedAt: daysAgo(8),
  coverUrl: null,
  excerpt: "Read it before your next session.",
  isPinned: false,
  isUnread: false,
};

const COVER_URL = "https://storage.example.test/covers/launch.webp?token=abc";

function titleOnly(post: MemberLatestNewsItem): LatestNewsItem {
  return {
    id: post.id,
    category: post.category,
    title: post.title,
    publishedAt: post.publishedAt,
  };
}

function memberNews(posts: readonly MemberLatestNewsItem[]): LatestNews {
  return { kind: "news", posts };
}

function renderNews(
  news: LatestNews,
  options: {
    readonly locale?: "en" | "es";
    readonly onRetry?: () => void;
  } = {},
): void {
  render(
    <DashboardNews
      translate={createTranslator(options.locale ?? "en")}
      news={news}
      now={NOW}
      onRetry={options.onRetry ?? vi.fn()}
    />,
  );
}

function renderRestrictedNews(
  news: LatestNews<LatestNewsItem>,
  options: {
    readonly locale?: "en" | "es";
    readonly onRetry?: () => void;
  } = {},
): void {
  render(
    <DashboardRestrictedNews
      translate={createTranslator(options.locale ?? "en")}
      news={news}
      now={NOW}
      onRetry={options.onRetry ?? vi.fn()}
    />,
  );
}

function newsSection(name = "News"): HTMLElement {
  return screen.getByRole("region", { name });
}

function featuredCard(title: string): HTMLElement {
  return within(newsSection()).getByRole("article", { name: title });
}

function miniRow(title: string): HTMLElement {
  const link = within(newsSection()).getByRole("link", { name: title });
  const row = link.closest("li");
  if (row === null) {
    throw new Error(`"${title}" no va en una fila.`);
  }
  return row;
}

describe("las noticias de un socio al día", () => {
  it("titula la sección Noticias con Todas las noticias a Noticias", () => {
    renderNews(memberNews([SHORTLIST, SCHEDULE, POLICY]));

    expect(
      within(newsSection()).getByRole("link", { name: "All news" }),
    ).toHaveAttribute("href", "/noticias");
  });

  it("destaca la más nueva con su categoría, hace cuánto, título y extracto", () => {
    renderNews(memberNews([SHORTLIST, SCHEDULE, POLICY]));

    const featured = featuredCard(SHORTLIST.title);
    expect(
      within(featured).getByRole("heading", {
        level: 3,
        name: SHORTLIST.title,
      }),
    ).toBeInTheDocument();
    expect(within(featured).getByText("Announcement")).toBeInTheDocument();
    expect(within(featured).getByText("2 days ago")).toBeInTheDocument();
    expect(within(featured).getByText(SHORTLIST.excerpt)).toBeInTheDocument();
    expect(within(featured).queryByText("Pinned")).not.toBeInTheDocument();
  });

  it("destaca la fijada aunque no sea la más nueva, con Fijada y su categoría", () => {
    const pinned = { ...SCHEDULE, isPinned: true };
    renderNews(memberNews([SHORTLIST, pinned, POLICY]));

    const featured = featuredCard(SCHEDULE.title);
    expect(within(featured).getByText("Pinned")).toBeInTheDocument();
    expect(within(featured).getByText("News")).toBeInTheDocument();
    expect(within(featured).getByText("4 days ago")).toBeInTheDocument();
    expect(miniRow(SHORTLIST.title)).toBeInTheDocument();
    expect(miniRow(POLICY.title)).toBeInTheDocument();
  });

  it("pinta la portada de la destacada cuando la tiene", () => {
    renderNews(memberNews([{ ...SHORTLIST, coverUrl: COVER_URL }, SCHEDULE]));

    expect(
      within(featuredCard(SHORTLIST.title)).getByRole("presentation"),
    ).toHaveAttribute("src", COVER_URL);
  });

  it("sin portada pinta el fondo de su categoría, sin imagen", () => {
    renderNews(memberNews([SHORTLIST, SCHEDULE]));

    expect(
      within(featuredCard(SHORTLIST.title)).queryByRole("presentation"),
    ).not.toBeInTheDocument();
  });

  it("sin extracto no deja un párrafo vacío en la destacada", () => {
    renderNews(memberNews([{ ...SHORTLIST, excerpt: "" }]));

    const featured = featuredCard(SHORTLIST.title);
    expect(within(featured).queryAllByRole("paragraph")).toHaveLength(1);
  });

  it("pinta las otras dos en pequeño con su categoría y hace cuánto", () => {
    renderNews(memberNews([SHORTLIST, SCHEDULE, POLICY]));

    const rows = within(newsSection()).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const schedule = miniRow(SCHEDULE.title);
    expect(within(schedule).getByText("News")).toBeInTheDocument();
    expect(within(schedule).getByText("4 days ago")).toBeInTheDocument();
    expect(
      within(schedule).getByRole("heading", { level: 3, name: SCHEDULE.title }),
    ).toBeInTheDocument();
  });

  it("marca con Sin leer sólo la pequeña que está sin leer", () => {
    renderNews(memberNews([SHORTLIST, SCHEDULE, POLICY]));

    expect(within(miniRow(SCHEDULE.title)).getByText("Unread")).toHaveClass(
      "visually-hidden",
    );
    expect(
      within(miniRow(POLICY.title)).queryByText("Unread"),
    ).not.toBeInTheDocument();
  });

  it("enlaza cada noticia con su publicación", () => {
    renderNews(memberNews([SHORTLIST, SCHEDULE, POLICY]));

    const section = newsSection();
    for (const post of [SHORTLIST, SCHEDULE, POLICY]) {
      expect(
        within(section).getByRole("link", { name: post.title }),
      ).toHaveAttribute("href", `/noticias/${post.id}`);
    }
  });

  it("con una sola noticia pinta la destacada y ninguna fila", () => {
    renderNews(memberNews([SHORTLIST]));

    expect(featuredCard(SHORTLIST.title)).toBeInTheDocument();
    expect(
      within(newsSection()).queryByRole("listitem"),
    ).not.toBeInTheDocument();
  });

  it("con dos noticias pinta la destacada y una fila", () => {
    renderNews(memberNews([SHORTLIST, SCHEDULE]));

    expect(within(newsSection()).getAllByRole("listitem")).toHaveLength(1);
  });

  it("sin noticias lo dice y conserva Todas las noticias", () => {
    renderNews(memberNews([]));

    const section = newsSection();
    expect(within(section).getByText("No news yet.")).toBeInTheDocument();
    expect(
      within(section).getByRole("link", { name: "All news" }),
    ).toBeInTheDocument();
    expect(within(section).queryByRole("article")).not.toBeInTheDocument();
  });

  it("si no se pudieron cargar lo dice y Reintentar vuelve a pedir", async () => {
    const onRetry = vi.fn();
    renderNews({ kind: "unavailable" }, { onRetry });

    const section = newsSection();
    expect(
      within(section).getByText("We couldn't load the news."),
    ).toBeInTheDocument();
    await userEvent.click(
      within(section).getByRole("button", { name: "Try again" }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("lo dice en español", () => {
    renderNews(memberNews([SHORTLIST, SCHEDULE]), { locale: "es" });

    const section = newsSection("Noticias");
    expect(
      within(section).getByRole("link", { name: "Todas las noticias" }),
    ).toBeInTheDocument();
    expect(within(section).getByText("Sin leer")).toBeInTheDocument();
    expect(within(section).getByText("hace 4 días")).toBeInTheDocument();
  });
});

describe("las noticias de quien no tiene la membresía al día", () => {
  const TITLES = [SHORTLIST, SCHEDULE, POLICY].map(titleOnly);

  it("avisa con el candado y Renovar a Pagos", () => {
    renderRestrictedNews({ kind: "news", posts: TITLES });

    const section = newsSection();
    expect(
      within(section).getByText("News is for current members."),
    ).toBeInTheDocument();
    expect(
      within(section).getByRole("link", { name: "Renew" }),
    ).toHaveAttribute("href", "/pagos");
  });

  it("lista los títulos con su categoría y su fecha, cada uno a Pagos", () => {
    renderRestrictedNews({ kind: "news", posts: TITLES });

    const rows = within(newsSection()).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const schedule = miniRow(SCHEDULE.title);
    expect(within(schedule).getByText("News")).toBeInTheDocument();
    expect(within(schedule).getByText("4 days ago")).toBeInTheDocument();
    for (const post of TITLES) {
      expect(
        within(newsSection()).getByRole("link", { name: post.title }),
      ).toHaveAttribute("href", "/pagos");
    }
  });

  it("no pinta destacada, portada ni sin leer", () => {
    renderRestrictedNews({ kind: "news", posts: TITLES });

    const section = newsSection();
    expect(within(section).queryByRole("article")).not.toBeInTheDocument();
    expect(within(section).queryByRole("presentation")).not.toBeInTheDocument();
    expect(within(section).queryByText("Unread")).not.toBeInTheDocument();
  });

  it("lleva Todas las noticias a Pagos", () => {
    renderRestrictedNews({ kind: "news", posts: TITLES });

    expect(
      within(newsSection()).getByRole("link", { name: "All news" }),
    ).toHaveAttribute("href", "/pagos");
  });

  it("sin noticias deja el candado y dice que no hay", () => {
    renderRestrictedNews({ kind: "news", posts: [] });

    const section = newsSection();
    expect(
      within(section).getByText("News is for current members."),
    ).toBeInTheDocument();
    expect(within(section).getByText("No news yet.")).toBeInTheDocument();
  });

  it("si no se pudieron cargar lo dice y Reintentar vuelve a pedir", async () => {
    const onRetry = vi.fn();
    renderRestrictedNews({ kind: "unavailable" }, { onRetry });

    await userEvent.click(
      within(newsSection()).getByRole("button", { name: "Try again" }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("lo dice en español", () => {
    renderRestrictedNews({ kind: "news", posts: TITLES }, { locale: "es" });

    const section = newsSection("Noticias");
    expect(
      within(section).getByText("Las noticias son para miembros al día."),
    ).toBeInTheDocument();
    expect(
      within(section).getByRole("link", { name: "Renovar" }),
    ).toHaveAttribute("href", "/pagos");
  });
});
