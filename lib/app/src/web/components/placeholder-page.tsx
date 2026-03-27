export function PlaceholderPage({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="flex flex-1 items-center">
      <div className="border-border bg-card flex w-full max-w-3xl flex-col gap-3 rounded-xl border p-6">
        <p className="text-muted-foreground text-sm font-medium">{eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-base">{description}</p>
      </div>
    </section>
  );
}
