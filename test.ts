import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import ogPlugin from "./mod.ts";

async function makeStagingDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "plugin-og-test-" });
}

function pageHtml(title: string, extraHead = ""): string {
  return `<!DOCTYPE html>\n<html>\n<head>\n<title>${title}</title>\n${extraHead}</head>\n<body>\n<h1>${title}</h1>\n</body>\n</html>\n`;
}

Deno.test({
  name: "og: injects og:image for a page with no existing tag, writes svg",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "index.html");
      const original = pageHtml("Hello World");
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({ siteUrl: "https://example.com" });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const updated = await Deno.readTextFile(filePath);
      assertStringIncludes(updated, 'property="og:image"');
      assertStringIncludes(
        updated,
        'content="https://example.com/og/home.svg"',
      );
      assertStringIncludes(updated, 'property="og:image:width" content="1200"');
      assertStringIncludes(
        updated,
        'property="og:image:height" content="630"',
      );
      assertStringIncludes(
        updated,
        'property="og:image:type" content="image/svg+xml"',
      );

      const svgPath = join(dir, "og", "home.svg");
      const svg = await Deno.readTextFile(svgPath);
      assertStringIncludes(svg, "<svg");
      assertStringIncludes(svg, "Hello World");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "og: leaves a page with an existing og:image tag byte-for-byte untouched",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "about.html");
      const original = pageHtml(
        "About",
        `<meta property="og:image" content="/manual.png">\n`,
      );
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({ siteUrl: "https://example.com" });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const after = await Deno.readTextFile(filePath);
      assertEquals(after, original);

      // No svg should have been generated either.
      let svgExists = true;
      try {
        await Deno.stat(join(dir, "og", "about.svg"));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) svgExists = false;
        else throw error;
      }
      assert(!svgExists, "expected no og image to be generated");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "og: skip option prevents processing for a matching route",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "drafts", "secret.html");
      await Deno.mkdir(join(dir, "drafts"), { recursive: true });
      const original = pageHtml("Secret Draft");
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({
        siteUrl: "https://example.com",
        skip: (route) => route.startsWith("/drafts/"),
      });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const after = await Deno.readTextFile(filePath);
      assertEquals(after, original);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "og: derives filenames from routes (root, nested-with-slash, nested-no-slash)",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const cases: Array<{ rel: string; expectedSvg: string }> = [
        { rel: "index.html", expectedSvg: "home.svg" },
        {
          rel: join("blog", "my-post", "index.html"),
          expectedSvg: join("blog", "my-post.svg"),
        },
        { rel: "about.html", expectedSvg: "about.svg" },
      ];

      const plugin = ogPlugin({ siteUrl: "https://example.com" });
      await plugin.beforeBuild!({ output: dir } as never);

      for (const { rel, expectedSvg } of cases) {
        const filePath = join(dir, rel);
        await Deno.mkdir(join(filePath, ".."), { recursive: true });
        const original = pageHtml(`Title for ${rel}`);
        await Deno.writeTextFile(filePath, original);

        await plugin.afterPage!({
          path: filePath,
          html: original,
          finalPath: filePath,
        });

        const svgPath = join(dir, "og", expectedSvg);
        const stat = await Deno.stat(svgPath);
        assert(stat.isFile, `expected svg at ${svgPath}`);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "og: escapes special characters in the page title within the svg",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "special.html");
      const original = pageHtml("Cats & Dogs <3 Everyone");
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({ siteUrl: "https://example.com" });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const svg = await Deno.readTextFile(join(dir, "og", "special.svg"));
      assertStringIncludes(svg, "&amp;");
      assertStringIncludes(svg, "&lt;");

      // The raw special chars from the title must not appear unescaped in
      // text content (only within markup we control, which contains none).
      const bodyOnly = svg.replace(/<[^>]*>/g, "|");
      assert(!bodyOnly.includes(" & "), "raw & should not appear unescaped");
      assert(!bodyOnly.includes("<3"), "raw < should not appear unescaped");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "og: siteUrl present produces an absolute og:image URL",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "index.html");
      const original = pageHtml("Home");
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({ siteUrl: "https://example.com/" });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const updated = await Deno.readTextFile(filePath);
      assertStringIncludes(
        updated,
        'content="https://example.com/og/home.svg"',
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "og: siteUrl absent produces a root-relative og:image URL",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "index.html");
      const original = pageHtml("Home");
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({});
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const updated = await Deno.readTextFile(filePath);
      assertStringIncludes(updated, 'content="/og/home.svg"');
      assert(
        !updated.includes('content="https://'),
        "should not contain an absolute URL",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "og: non-html pages are left untouched and produce no image",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "styles.css");
      const original = "body { color: red; }";
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({ siteUrl: "https://example.com" });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const after = await Deno.readTextFile(filePath);
      assertEquals(after, original);

      let ogDirExists = true;
      try {
        await Deno.stat(join(dir, "og"));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) ogDirExists = false;
        else throw error;
      }
      assert(!ogDirExists, "expected no og directory to be created");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "og: a page with a missing <title> still generates an image with an empty title",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "untitled.html");
      const original =
        `<!DOCTYPE html>\n<html>\n<head>\n</head>\n<body>\n<h1>No title here</h1>\n</body>\n</html>\n`;
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({ siteUrl: "https://example.com" });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const updated = await Deno.readTextFile(filePath);
      assertStringIncludes(updated, 'property="og:image"');

      const svg = await Deno.readTextFile(join(dir, "og", "untitled.svg"));
      assertStringIncludes(svg, "<svg");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "og: falls back to appending meta tags when there is no closing </head>",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "headless.html");
      const original =
        `<!DOCTYPE html>\n<html>\n<title>Headless</title>\n<body>\n<h1>Headless</h1>\n</body>\n</html>\n`;
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({ siteUrl: "https://example.com" });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const updated = await Deno.readTextFile(filePath);
      assertStringIncludes(updated, 'property="og:image"');
      assert(
        updated.startsWith(original),
        "expected meta tags to be appended after the original content",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "og: custom width, height, imageDir and background are honored",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "index.html");
      const original = pageHtml("Custom Page");
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({
        siteUrl: "https://example.com",
        width: 800,
        height: 400,
        imageDir: "previews",
        background: "#000000",
      });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const updated = await Deno.readTextFile(filePath);
      assertStringIncludes(
        updated,
        'content="https://example.com/previews/home.svg"',
      );
      assertStringIncludes(updated, 'property="og:image:width" content="800"');
      assertStringIncludes(
        updated,
        'property="og:image:height" content="400"',
      );

      const svg = await Deno.readTextFile(join(dir, "previews", "home.svg"));
      assertStringIncludes(svg, 'width="800" height="400"');
      assertStringIncludes(svg, 'fill="#000000"');
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "og: skip option leaves other routes unaffected",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const keptPath = join(dir, "about.html");
      const original = pageHtml("About");
      await Deno.writeTextFile(keptPath, original);

      const plugin = ogPlugin({
        siteUrl: "https://example.com",
        skip: (route) => route.startsWith("/drafts/"),
      });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: keptPath,
        html: original,
        finalPath: keptPath,
      });

      const updated = await Deno.readTextFile(keptPath);
      assertStringIncludes(updated, 'property="og:image"');
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "og: long titles are wrapped and truncated to a bounded number of lines",
  fn: async () => {
    const dir = await makeStagingDir();
    try {
      const filePath = join(dir, "long.html");
      const longTitle = Array.from(
        { length: 40 },
        (_, i) => `word${i}`,
      ).join(" ");
      const original = pageHtml(longTitle);
      await Deno.writeTextFile(filePath, original);

      const plugin = ogPlugin({ siteUrl: "https://example.com" });
      await plugin.beforeBuild!({ output: dir } as never);
      await plugin.afterPage!({
        path: filePath,
        html: original,
        finalPath: filePath,
      });

      const svg = await Deno.readTextFile(join(dir, "og", "long.svg"));
      const tspanCount = (svg.match(/<tspan\b/g) ?? []).length;
      assert(
        tspanCount <= 6,
        "expected the number of tspans to be capped at maxLines (6)",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
