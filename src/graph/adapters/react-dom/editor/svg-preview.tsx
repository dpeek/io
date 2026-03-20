import { EmptyPreview, sourcePreviewPanelClassName } from "@io/web/source-preview";
import { cn } from "@io/web/utils";

import { sanitizeSvgMarkup } from "../../../index.js";
import { SvgMarkup } from "../icon.js";

export function SvgPreview({ content }: { content: string }) {
  if (content.trim().length === 0) {
    return <EmptyPreview attribute="svg">Paste SVG markup to preview it.</EmptyPreview>;
  }

  const preview = sanitizeSvgMarkup(content);
  if (!preview.ok) {
    return (
      <EmptyPreview attribute="svg">
        {preview.issues[0]?.message ?? "SVG preview is unavailable because the markup is invalid."}
      </EmptyPreview>
    );
  }

  return (
    <div
      className={cn(sourcePreviewPanelClassName, "flex items-center justify-center")}
      data-web-svg-preview="ready"
    >
      <SvgMarkup
        className="text-foreground inline-flex max-w-full items-center justify-center [&>svg]:max-h-48 [&>svg]:max-w-full"
        svg={content}
      />
    </div>
  );
}
