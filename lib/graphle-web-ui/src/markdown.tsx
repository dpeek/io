import ReactMarkdown from "react-markdown";

type BunMarkdownApi = typeof Bun.markdown;

type GlobalWithOptionalBun = typeof globalThis & {
  Bun?: {
    markdown?: BunMarkdownApi;
  };
};

function getBunMarkdown(): BunMarkdownApi | null {
  return (globalThis as GlobalWithOptionalBun).Bun?.markdown ?? null;
}

export function MarkdownRenderer({ className, content }: { className?: string; content: string }) {
  const bunMarkdown = getBunMarkdown();

  return (
    <div className={className} data-web-markdown-renderer={bunMarkdown ? "bun" : "react-markdown"}>
      {bunMarkdown ? (
        bunMarkdown.react(content, undefined, {
          autolinks: true,
          headings: { ids: true },
          reactVersion: 19,
          tagFilter: true,
        })
      ) : (
        <ReactMarkdown>{content}</ReactMarkdown>
      )}
    </div>
  );
}
