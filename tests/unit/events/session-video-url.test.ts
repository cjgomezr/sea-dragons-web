import { describe, expect, it } from "vitest";
import {
  SESSION_VIDEO_URL_MAX_LENGTH,
  parseSessionVideoUrl,
} from "@/lib/events/session-video-url";

/**
 * Qué enlace vale como vídeo de una sesión (#965, RF-4 y D7 del PRD de E37):
 * sólo un vídeo de YouTube, por https. Un canal o una lista no son el vídeo
 * de una sesión.
 */

const VIDEO_LINKS = [
  "https://www.youtube.com/watch?v=abc123",
  "https://youtube.com/watch?v=abc123",
  "https://m.youtube.com/watch?v=abc123",
  "https://www.youtube.com/watch?v=abc123&t=42s",
  "https://youtu.be/abc123",
  "https://www.youtu.be/abc123",
  "https://youtu.be/abc123?si=xyz",
  "https://www.youtube.com/live/abc123",
  "https://youtube.com/live/abc123?feature=share",
  "https://m.youtube.com/live/abc123",
  "https://www.youtube.com/shorts/abc-1_2",
  "https://youtube.com/shorts/abc123",
  "https://m.youtube.com/shorts/abc123",
];

const NOT_VIDEO_LINKS = [
  "https://vimeo.com/abc123",
  "https://instagram.com/youtube.com",
  "https://youtube.com.evil.example/watch?v=abc123",
  "https://www.youtube.com/@club",
  "https://www.youtube.com/channel/UC123",
  "https://www.youtube.com/playlist?list=PL123",
  "https://www.youtube.com/watch?list=PL123",
  "https://www.youtube.com/watch?v=",
  "https://youtu.be/",
  "https://www.youtube.com/shorts/",
  "http://www.youtube.com/watch?v=abc123",
  "http://youtu.be/abc123",
  "youtube.com/watch?v=abc123",
  "javascript:alert(1)//youtu.be/abc",
  "https://user@youtu.be/abc123",
  "https://youtu.be:8443/abc123",
  "not a link",
  "",
  "   ",
];

describe("parseSessionVideoUrl", () => {
  it.each(VIDEO_LINKS)("acepta %s", (url) => {
    expect(parseSessionVideoUrl(url)).toEqual({ kind: "valid", url });
  });

  it("recorta los espacios de los extremos", () => {
    expect(parseSessionVideoUrl("  https://youtu.be/abc123 \n")).toEqual({
      kind: "valid",
      url: "https://youtu.be/abc123",
    });
  });

  it.each(NOT_VIDEO_LINKS)("rechaza %j", (url) => {
    expect(parseSessionVideoUrl(url)).toEqual({
      kind: "invalid",
      issue: "not_youtube_video",
    });
  });

  it(`acepta un enlace de ${SESSION_VIDEO_URL_MAX_LENGTH} caracteres`, () => {
    const url = `https://www.youtube.com/watch?v=abc123&t=${"1".repeat(
      SESSION_VIDEO_URL_MAX_LENGTH - 41,
    )}`;

    expect(url).toHaveLength(SESSION_VIDEO_URL_MAX_LENGTH);
    expect(parseSessionVideoUrl(url)).toEqual({ kind: "valid", url });
  });

  it(`rechaza un enlace de más de ${SESSION_VIDEO_URL_MAX_LENGTH} caracteres`, () => {
    const url = `https://www.youtube.com/watch?v=abc123&t=${"1".repeat(
      SESSION_VIDEO_URL_MAX_LENGTH - 40,
    )}`;

    expect(parseSessionVideoUrl(url)).toEqual({
      kind: "invalid",
      issue: "too_long",
    });
  });
});
