import { afterEach, describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { parseMarkdownCodeInfo } from "./markdown-code-info.js";
import {
  decorateMarkdownPlateValue,
  deserializeMarkdownToPlateValue,
  serializePlateValueToMarkdown,
} from "./markdown-plate-value.js";
import { MarkdownRenderer } from "./markdown.js";

type BunMarkdownApi = typeof Bun.markdown;

const originalBunMarkdown = Bun.markdown;

function setBunMarkdown(markdown: BunMarkdownApi | undefined) {
  Reflect.set(Bun as Record<string, unknown>, "markdown", markdown);
}

afterEach(() => {
  setBunMarkdown(originalBunMarkdown);
});

describe("MarkdownRenderer", () => {
  it("uses the Plate renderer even when Bun markdown is available", () => {
    setBunMarkdown({
      react(content: string) {
        return <article data-bun-rendered="true">{content.toUpperCase()}</article>;
      },
    } as unknown as BunMarkdownApi);

    const markup = renderToStaticMarkup(<MarkdownRenderer content="# Heading" />);

    expect(markup).toContain("graph-markdown");
    expect(markup).toContain("prose");
    expect(markup).toContain("max-w-none");
    expect(markup).toContain("dark:prose-invert");
    expect(markup).toContain('data-web-markdown-renderer="plate"');
    expect(markup).toContain('<h1 data-slate-node="element"');
    expect(markup).toContain('id="heading"');
    expect(markup).toContain("Heading");
    expect(markup).not.toContain("data-bun-rendered");
  });

  it("renders deterministic heading IDs with duplicate suffixes", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer
        content={["# Heading", "", "## Heading", "", "### Hello, world!"].join("\n")}
      />,
    );

    expect(markup).toContain('id="heading"');
    expect(markup).toContain('id="heading-1"');
    expect(markup).toContain('id="hello-world"');
  });

  it("renders GFM tables, task lists, strikethrough, and literal autolinks", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer
        content={[
          "www.example.com",
          "",
          "- [x] shipped",
          "",
          "~~removed~~",
          "",
          "| Name | Value |",
          "| --- | --- |",
          "| a | b |",
        ].join("\n")}
      />,
    );

    expect(markup).toContain('href="http://www.example.com"');
    expect(markup).toContain("www.example.com");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("checked");
    expect(markup).toContain("<del");
    expect(markup).toContain("removed");
    expect(markup).toContain("<table");
    expect(markup).toContain("<td");
    expect(markup).toContain("b");
  });

  it("keeps inline code as prose inline code", () => {
    const markup = renderToStaticMarkup(<MarkdownRenderer content="Use `value` inline." />);

    expect(markup).toContain("<code");
    expect(markup).toContain("value");
    expect(markup).not.toContain("graph-markdown-code-block");
    expect(markup).not.toContain('data-code-block="true"');
  });

  it("renders fenced code blocks through Plate syntax leaves", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer
        content={[
          '```tsx filename="lib/graphle-web-ui/src/markdown.tsx"',
          "const value = 1;",
          "```",
        ].join("\n")}
      />,
    );

    expect(markup).toContain("graph-markdown-code-block");
    expect(markup).toContain('data-code-block="true"');
    expect(markup).toContain('data-highlight-language="tsx"');
    expect(markup).toContain('data-language="tsx"');
    expect(markup).toContain("lib/graphle-web-ui/src/markdown.tsx");
    expect(markup).toContain('aria-label="Copy code"');
    expect(markup).toContain("graph-markdown-code-line");
    expect(markup).toContain("graph-markdown-code-syntax");
    expect(markup).toContain("hljs-keyword");
    expect(markup).toContain("const");
    expect(markup).toContain("value");
  });

  it("falls back to plain code for unknown languages", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer content={["```mermaid", "graph TD;", "```"].join("\n")} />,
    );

    expect(markup).toContain("graph-markdown-code-block");
    expect(markup).toContain('data-language="mermaid"');
    expect(markup).not.toContain("data-highlight-language");
    expect(markup).not.toContain("hljs-");
    expect(markup).toContain("graph TD;");
  });

  it("disables highlighting for no-highlight aliases", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer content={["```txt", "literal <tag>", "```"].join("\n")} />,
    );

    expect(markup).toContain("graph-markdown-code-block");
    expect(markup).toContain('data-language="plaintext"');
    expect(markup).not.toContain("data-highlight-language");
    expect(markup).not.toContain("hljs-");
    expect(markup).toContain("literal");
    expect(markup).toContain("&lt;tag&gt;");
  });

  it("infers highlighting and labels from path-only fences", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer
        content={["```lib/graphle-web-ui/src/markdown.tsx", "const value = 1;", "```"].join("\n")}
      />,
    );

    expect(markup).toContain('data-highlight-language="tsx"');
    expect(markup).toContain('data-language="tsx"');
    expect(markup).toContain("lib/graphle-web-ui/src/markdown.tsx");
    expect(markup).toContain("hljs-keyword");
  });

  it("keeps caller class names for layout without replacing markdown styles", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer className="max-w-[48rem]" content="hello world" />,
    );

    expect(markup).toContain("graph-markdown");
    expect(markup).toContain("prose");
    expect(markup).toContain("max-w-[48rem]");
    expect(markup).not.toContain("max-w-none");
  });
});

describe("parseMarkdownCodeInfo", () => {
  it("reads explicit filename metadata and normalizes language aliases", () => {
    expect(parseMarkdownCodeInfo({ language: "ts", meta: 'filename="schema.ts"' })).toEqual({
      filename: "schema.ts",
      highlightLanguage: "typescript",
      label: "schema.ts",
      language: "typescript",
    });
  });

  it("infers language from path-like first tokens", () => {
    expect(parseMarkdownCodeInfo({ language: "lib/graphle-web-ui/src/markdown.tsx" })).toEqual({
      filename: "lib/graphle-web-ui/src/markdown.tsx",
      highlightLanguage: "tsx",
      label: "lib/graphle-web-ui/src/markdown.tsx",
      language: "tsx",
    });
  });

  it("renders unknown languages as plain code while preserving the visible label", () => {
    expect(parseMarkdownCodeInfo({ language: "mermaid" })).toEqual({
      filename: null,
      highlightLanguage: null,
      label: "mermaid",
      language: "mermaid",
    });
  });

  it("skips highlighting for plain-text aliases", () => {
    expect(parseMarkdownCodeInfo({ language: "nohighlight" })).toEqual({
      filename: null,
      highlightLanguage: null,
      label: "Text",
      language: "plaintext",
    });
  });

  it("keeps JSONC and MDX plain because Highlight.js does not support them cleanly", () => {
    expect(parseMarkdownCodeInfo({ language: "jsonc" })).toEqual({
      filename: null,
      highlightLanguage: null,
      label: "JSONC",
      language: "jsonc",
    });
    expect(parseMarkdownCodeInfo({ language: "mdx" })).toEqual({
      filename: null,
      highlightLanguage: null,
      label: "MDX",
      language: "mdx",
    });
  });
});

describe("markdown Plate value code blocks", () => {
  it("serializes code block language and filename metadata", () => {
    const markdown = ['```tsx filename="schema.tsx"', "const value = 1;", "```"].join("\n");
    const value = decorateMarkdownPlateValue(deserializeMarkdownToPlateValue(markdown), markdown);

    expect(serializePlateValueToMarkdown(value)).toBe(markdown);
  });

  it("serializes path-only and no-highlight fences", () => {
    for (const markdown of [
      ["```lib/graphle-web-ui/src/markdown.tsx", "const value = 1;", "```"].join("\n"),
      ["```nohighlight", "literal", "```"].join("\n"),
    ]) {
      const value = decorateMarkdownPlateValue(deserializeMarkdownToPlateValue(markdown), markdown);

      expect(serializePlateValueToMarkdown(value)).toBe(markdown);
    }
  });
});
