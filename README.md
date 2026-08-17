# @steno/plugin-og

Open Graph plugin for [Steno](https://github.com/stenopress/steno) that
automatically generates a preview image for every page and injects the matching
`og:image` meta tags.

Generated images are plain SVG, built with string templating. There is no
headless browser, no `sharp`/`satori`/`resvg`, and no new runtime dependencies
beyond `steno` and `@std/*`. See **Limitations** below before you adopt this for
a site with strict raster-only consumers.

## Installation

```yaml
# content/.steno/config.yml
plugins:
  - jsr:@steno/plugin-og
```

## Options

```yaml
plugins:
  - package: jsr:@steno/plugin-og
    options:
      siteName: "The Code Chronicles"
      siteUrl: https://myawesomeblog.com
      imageDir: og
      width: 1200
      height: 630
      background: "#111116"
      accent: "#7760a9"
      textColor: "#f5f5f7"
```

| Option       | Type                         | Default     | Description                                                                                                      |
| ------------ | ---------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `siteName`   | `string`                     | `undefined` | Small label rendered near the bottom of the image, in the accent color. Omitted if not set.                      |
| `siteUrl`    | `string`                     | `undefined` | Absolute site URL used to build an absolute `og:image` URL. If omitted, a root-relative path is written instead. |
| `imageDir`   | `string`                     | `"og"`      | Output-relative directory generated images are written into.                                                     |
| `width`      | `number`                     | `1200`      | Image width in pixels.                                                                                           |
| `height`     | `number`                     | `630`       | Image height in pixels.                                                                                          |
| `background` | `string`                     | `"#111116"` | Background fill color.                                                                                           |
| `accent`     | `string`                     | `"#7760a9"` | Color used for the decorative corner shape and the `siteName` label.                                             |
| `textColor`  | `string`                     | `"#f5f5f7"` | Color used for the page title text.                                                                              |
| `skip`       | `(route: string) => boolean` | `undefined` | Return `true` for a route (e.g. `/drafts/wip/`) to skip OG generation for that page entirely.                    |

## Usage

Once installed, the plugin runs automatically on every build. For each rendered
`.html` page it writes a companion SVG:

```text
dist/
├── index.html
├── blog/
│   └── my-post.html
├── og/
│   ├── home.svg          <-- Generated Automatically
│   └── blog/
│       └── my-post.svg   <-- Generated Automatically
```

...and injects the corresponding tags into that page's `<head>`:

```html
<meta property="og:image" content="https://myawesomeblog.com/og/blog/my-post.svg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:type" content="image/svg+xml" />
```

If a page already declares its own `og:image` meta tag, the plugin leaves it
completely untouched - it never overrides an author-supplied image.

## How it works

The plugin hooks into Steno's `afterPage` lifecycle, once per rendered page:

1. Captures the staging output directory from `beforeBuild`, then, for each page
   whose path ends in `.html`, computes its public route (e.g. `foo/index.html`
   → `/foo/`, `foo.html` → `/foo`, `index.html` → `/`).
2. Skips the page entirely if `options.skip?.(route)` returns `true`, or if the
   page's HTML already contains an `og:image` meta tag.
3. Extracts the page's `<title>` text as the image headline.
4. Builds an SVG string - background rect, a decorative accent shape, the title
   wrapped across multiple `<tspan>` lines, and an optional site-name label -
   escaping `&`, `<`, and `>` in any interpolated text.
5. Writes the SVG to `<output>/<imageDir>/<route-derived-filename>.svg`.
6. Injects `og:image`, `og:image:width`, `og:image:height`, and `og:image:type`
   meta tags just before `</head>` and writes the page back to its staging path.

## Limitations

**Generated images are SVG, not raster.** Most modern link-preview consumers

- Discord, Slack, Twitter/X, LinkedIn, Bluesky - render an SVG `og:image`
  correctly. A few older or stricter consumers (some versions of iMessage and
  WhatsApp) only support raster PNG/JPEG and will fail to render an SVG preview
  at all.

This is a deliberate scope decision for this version: raster generation needs a
rendering dependency (a headless browser, `satori` + `resvg`, `sharp`, etc.)
that this plugin intentionally does not pull in. If you need guaranteed raster
support today, run this plugin's SVG output through a rasterizing tool as a
follow-up build step, or wait for a future raster-capable version of this
plugin.

## License

MIT
