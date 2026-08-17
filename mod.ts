/**
 * Steno plugin that auto-generates Open Graph preview images per page.
 *
 * Images are rendered as plain SVG strings - no headless browser, no raster
 * image library. See the README's Limitations section for what that trade-off
 * means for link-preview compatibility.
 */
import type { GeneratedPage, SiteConfig, StenoPlugin } from "steno";
import { dirname, join, relative } from "@std/path";

/** Options for the auto-generated Open Graph preview images. */
export interface OgPluginOptions {
  /** Site name shown as a small label on generated images. Optional. */
  siteName?: string;
  /**
   * Absolute site URL, used to build the absolute `og:image` URL written
   * into `<head>`. If omitted, `og:image` is written as a root-relative path.
   */
  siteUrl?: string;
  /** Output-relative directory for generated images. Default `"og"`. */
  imageDir?: string;
  /** Image width in px. Default `1200`. */
  width?: number;
  /** Image height in px. Default `630`. */
  height?: number;
  /** Background color. Default `"#111116"`. */
  background?: string;
  /** Accent color used for a decorative element and the site-name label. Default `"#7760a9"`. */
  accent?: string;
  /** Text color for the page title. Default `"#f5f5f7"`. */
  textColor?: string;
  /** Given a route (e.g. `"/blog/my-post/"`), return true to skip OG generation for that page. Optional. */
  skip?: (route: string) => boolean;
}

const OG_IMAGE_META_RE = /<meta\b[^>]*\bproperty\s*=\s*["']og:image["'][^>]*>/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

/** Escapes `&`, `<`, and `>` for safe interpolation into SVG text content. */
function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(
    />/g,
    "&gt;",
  );
}

/** Wraps text into lines of roughly `maxCharsPerLine` characters, splitting on whitespace. */
function wrapText(text: string, maxCharsPerLine = 34): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines.length > 0 ? lines : [""];
}

/** Computes the public route for a staged page path, relative to the staging output dir. */
function computeRoute(filePath: string, outputDir: string): string {
  const rel = relative(outputDir, filePath).split(/[\\/]/).join("/");

  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) {
    return "/" + rel.slice(0, -"index.html".length);
  }
  if (rel.endsWith(".html")) {
    return "/" + rel.slice(0, -".html".length);
  }
  return "/" + rel;
}

/** Derives an output-relative image filename (without directory) from a route. */
function deriveFilename(route: string): string {
  let core = route.replace(/^\//, "").replace(/\/$/, "");
  if (core === "") core = "home";
  return `${core}.svg`;
}

/** Builds the SVG document for a single page's OG image. */
function buildSvg(params: {
  width: number;
  height: number;
  background: string;
  accent: string;
  textColor: string;
  title: string;
  siteName?: string;
}): string {
  const { width, height, background, accent, textColor, title, siteName } =
    params;

  const maxLines = 6;
  const lines = wrapText(title).slice(0, maxLines);
  const fontSize = 64;
  const lineHeight = Math.round(fontSize * 1.25);
  const marginX = 80;
  const totalTextHeight = lines.length * lineHeight;
  const startY = Math.round(
    height / 2 - totalTextHeight / 2 + fontSize * 0.85,
  );

  const tspans = lines
    .map((line, i) =>
      `<tspan x="${marginX}" dy="${i === 0 ? 0 : lineHeight}">${
        escapeXml(line)
      }</tspan>`
    )
    .join("");

  let svg =
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="${width}" height="${height}" fill="${background}"/>`;
  svg += `<circle cx="${
    width - 90
  }" cy="90" r="140" fill="${accent}" opacity="0.22"/>`;
  svg += `<rect x="${marginX}" y="${
    height - 96
  }" width="140" height="10" rx="5" fill="${accent}"/>`;
  svg += `<text x="${marginX}" y="${startY}" font-family="sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" fill="${textColor}">${tspans}</text>`;

  if (siteName) {
    svg += `<text x="${marginX}" y="${
      height - 40
    }" font-family="sans-serif" font-size="28" font-weight="600" fill="${accent}">${
      escapeXml(siteName)
    }</text>`;
  }

  svg += `</svg>`;
  return svg;
}

/** Creates a Steno plugin that auto-generates Open Graph preview images. */
export default function ogPlugin(options: OgPluginOptions = {}): StenoPlugin {
  const imageDir = options.imageDir ?? "og";
  const width = options.width ?? 1200;
  const height = options.height ?? 630;
  const background = options.background ?? "#111116";
  const accent = options.accent ?? "#7760a9";
  const textColor = options.textColor ?? "#f5f5f7";

  let stagingOutput = "dist";

  return {
    name: "steno-plugin-og",

    beforeBuild(config: SiteConfig): void {
      stagingOutput = config.output ?? "dist";
    },

    async afterPage(page: GeneratedPage): Promise<void> {
      const checkPath = page.finalPath ?? page.path;
      if (!checkPath.endsWith(".html")) return;

      const route = computeRoute(page.path, stagingOutput);

      if (options.skip?.(route)) return;

      const html = await Deno.readTextFile(page.path);
      if (OG_IMAGE_META_RE.test(html)) return;

      const titleMatch = TITLE_RE.exec(html);
      const title = (titleMatch?.[1] ?? "").trim();

      const svg = buildSvg({
        width,
        height,
        background,
        accent,
        textColor,
        title,
        siteName: options.siteName,
      });

      const filename = deriveFilename(route);
      const imagePath = join(stagingOutput, imageDir, filename);

      await Deno.mkdir(dirname(imagePath), { recursive: true });
      await Deno.writeTextFile(imagePath, svg);

      const imageUrl = `${
        options.siteUrl ? options.siteUrl.replace(/\/$/, "") : ""
      }/${imageDir}/${filename}`;

      const metaTags =
        `  <meta property="og:image" content="${escapeXml(imageUrl)}">\n` +
        `  <meta property="og:image:width" content="${width}">\n` +
        `  <meta property="og:image:height" content="${height}">\n` +
        `  <meta property="og:image:type" content="image/svg+xml">\n`;

      const updatedHtml = html.includes("</head>")
        ? html.replace("</head>", `${metaTags}</head>`)
        : html + metaTags;

      await Deno.writeTextFile(page.path, updatedHtml);
    },
  };
}
