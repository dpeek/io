import { core } from "../../../modules/index.js";
import { GraphIcon } from "../icon.js";

export type EntityReferenceEntity = {
  id: string;
  get(): Record<string, unknown>;
};

export function createTagKey(name: string, existingKeys: ReadonlySet<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tag";

  let candidate = base;
  let sequence = 2;
  while (existingKeys.has(candidate)) {
    candidate = `${base}-${sequence}`;
    sequence += 1;
  }

  return candidate;
}

export function getEntityReferenceLabel(entity: EntityReferenceEntity): string {
  const snapshot = entity.get();
  const name = snapshot.name;
  if (typeof name === "string" && name.length > 0) return name;
  const label = snapshot.label;
  if (typeof label === "string" && label.length > 0) return label;
  return "Untitled";
}

function getEntityReferenceIconId(entity: EntityReferenceEntity): string | undefined {
  const snapshot = entity.get();
  const typeIds = Array.isArray(snapshot.type)
    ? snapshot.type.filter((value): value is string => typeof value === "string")
    : [];
  const iconTypeId = core.icon.values.id ?? core.icon.values.key;
  if (typeIds.includes(iconTypeId)) return entity.id;

  if (typeof snapshot.icon === "string" && snapshot.icon.length > 0) {
    return snapshot.icon;
  }

  if (Array.isArray(snapshot.icon)) {
    return snapshot.icon.find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  }

  return undefined;
}

export function EntityReferenceOptionContent({
  description,
  entity,
  iconClassName = "text-foreground/70 size-4",
}: {
  description?: string;
  entity: EntityReferenceEntity;
  iconClassName?: string;
}) {
  const iconId = getEntityReferenceIconId(entity);

  return (
    <span className="flex min-w-0 items-center gap-2">
      {iconId ? <GraphIcon className={iconClassName} iconId={iconId} /> : null}
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{getEntityReferenceLabel(entity)}</span>
        {description ? (
          <span className="text-muted-foreground truncate text-xs">{description}</span>
        ) : null}
      </span>
    </span>
  );
}

export function EntityReferenceSummary({ entity }: { entity: EntityReferenceEntity }) {
  return (
    <span className="inline-flex items-center gap-2">
      <EntityReferenceOptionContent entity={entity} />
      <code>{entity.id}</code>
    </span>
  );
}
