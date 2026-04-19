"use client";

import { cn } from "@dpeek/graphle-web-ui/utils";
import { useMemo } from "react";
import { createStaticEditor, PlateStatic } from "platejs/static";

import { markdownPlateComponents } from "./markdown-plate-components.js";
import { createMarkdownPlatePlugins } from "./markdown-plate-kit.js";
import {
  decorateMarkdownPlateValue,
  deserializeMarkdownToPlateValue,
} from "./markdown-plate-value.js";

export function MarkdownRenderer({ className, content }: { className?: string; content: string }) {
  const value = useMemo(
    () => decorateMarkdownPlateValue(deserializeMarkdownToPlateValue(content), content),
    [content],
  );
  const editor = useMemo(
    () =>
      createStaticEditor({
        components: markdownPlateComponents,
        plugins: createMarkdownPlatePlugins(),
        value,
      }),
    [value],
  );

  return (
    <PlateStatic
      className={cn("graph-markdown prose max-w-none dark:prose-invert", className)}
      data-web-markdown-renderer="plate"
      editor={editor}
    />
  );
}
