import type {
  CollectionSurfaceSpec,
  ObjectViewRelatedSpec,
  ObjectViewSpec,
  RecordSurfaceSpec,
} from "@io/graph-module";

type Awaitable<T> = Promise<T> | T;

export type RecordSurfaceLookup = {
  readonly getCollectionSurface?: (
    key: string,
  ) => Awaitable<CollectionSurfaceSpec | undefined> | undefined;
  readonly getFieldValue: (path: string) => Awaitable<unknown>;
};

export type RecordSurfaceFieldBinding = {
  readonly description?: string;
  readonly label: string;
  readonly path: string;
  readonly value: unknown;
};

export type RecordSurfaceSectionBinding = {
  readonly description?: string;
  readonly fields: readonly RecordSurfaceFieldBinding[];
  readonly key: string;
  readonly title: string;
};

export type RecordSurfaceRelatedBinding = {
  readonly collection: CollectionSurfaceSpec;
  readonly description?: string;
  readonly key: string;
  readonly title: string;
};

export type RecordSurfaceBinding = {
  readonly commandSurfaces: readonly string[];
  readonly related: readonly RecordSurfaceRelatedBinding[];
  readonly sections: readonly RecordSurfaceSectionBinding[];
  readonly subtitle?: unknown;
  readonly surface: RecordSurfaceSpec;
  readonly title?: unknown;
};

export type RecordSurfaceBindingIssueCode =
  | "field-read-failed"
  | "related-collection-lookup-missing"
  | "related-collection-missing";

export type RecordSurfaceBindingIssue = {
  readonly code: RecordSurfaceBindingIssueCode;
  readonly message: string;
};

export type RecordSurfaceBindingResult =
  | {
      readonly binding: RecordSurfaceBinding;
      readonly ok: true;
    }
  | {
      readonly issue: RecordSurfaceBindingIssue;
      readonly ok: false;
    };

export type RecordSurfaceBindingOptions = {
  readonly lookup: RecordSurfaceLookup;
  readonly surface: RecordSurfaceSpec;
};

export type AdaptObjectViewToRecordSurfaceOptions = {
  readonly mapRelatedCollectionKey?: (related: ObjectViewRelatedSpec) => string | undefined;
};

function createIssue(
  code: RecordSurfaceBindingIssueCode,
  message: string,
): RecordSurfaceBindingIssue {
  return { code, message };
}

function isBindingIssue(error: unknown): error is RecordSurfaceBindingIssue {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Unknown error.";
}

async function readFieldValue(
  lookup: RecordSurfaceLookup,
  surface: RecordSurfaceSpec,
  path: string,
): Promise<unknown> {
  try {
    return await lookup.getFieldValue(path);
  } catch (error) {
    throw createIssue(
      "field-read-failed",
      `Record surface "${surface.key}" failed to read field "${path}": ${describeError(error)}`,
    );
  }
}

async function resolveFieldBinding(
  lookup: RecordSurfaceLookup,
  surface: RecordSurfaceSpec,
  field: RecordSurfaceSpec["sections"][number]["fields"][number],
): Promise<RecordSurfaceFieldBinding> {
  const value = await readFieldValue(lookup, surface, field.path);
  return {
    ...(field.description ? { description: field.description } : {}),
    label: field.label ?? field.path,
    path: field.path,
    value,
  };
}

async function resolveSectionBinding(
  lookup: RecordSurfaceLookup,
  surface: RecordSurfaceSpec,
  section: RecordSurfaceSpec["sections"][number],
): Promise<RecordSurfaceSectionBinding> {
  return {
    ...(section.description ? { description: section.description } : {}),
    fields: await Promise.all(
      section.fields.map((field) => resolveFieldBinding(lookup, surface, field)),
    ),
    key: section.key,
    title: section.title,
  };
}

async function resolveRelatedBinding(
  lookup: RecordSurfaceLookup,
  surface: RecordSurfaceSpec,
  related: NonNullable<RecordSurfaceSpec["related"]>[number],
): Promise<RecordSurfaceRelatedBinding> {
  if (!lookup.getCollectionSurface) {
    throw createIssue(
      "related-collection-lookup-missing",
      `Record surface "${surface.key}" references related collection "${related.collection}" without a collection-surface lookup.`,
    );
  }
  const collection = await lookup.getCollectionSurface(related.collection);
  if (!collection) {
    throw createIssue(
      "related-collection-missing",
      `Record surface "${surface.key}" references missing related collection surface "${related.collection}".`,
    );
  }
  return {
    collection,
    ...(related.description ? { description: related.description } : {}),
    key: related.key,
    title: related.title,
  };
}

export function adaptObjectViewToRecordSurface(
  view: ObjectViewSpec,
  options: AdaptObjectViewToRecordSurfaceOptions = {},
): RecordSurfaceSpec {
  const related =
    view.related
      ?.map((item) => {
        const collection = options.mapRelatedCollectionKey?.(item);
        if (!collection) {
          return null;
        }
        return {
          collection,
          key: item.key,
          title: item.title,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null) ?? [];

  return {
    ...(view.commands ? { commandSurfaces: view.commands } : {}),
    key: view.key,
    ...(related.length > 0 ? { related } : {}),
    sections: view.sections,
    ...(view.subtitleField ? { subtitleField: view.subtitleField } : {}),
    subject: view.entity,
    ...(view.titleField ? { titleField: view.titleField } : {}),
  };
}

export async function resolveRecordSurfaceBinding(
  input: RecordSurfaceBindingOptions,
): Promise<RecordSurfaceBindingResult> {
  const { lookup, surface } = input;

  try {
    const [sections, related, title, subtitle] = await Promise.all([
      Promise.all(
        surface.sections.map((section) => resolveSectionBinding(lookup, surface, section)),
      ),
      Promise.all(
        (surface.related ?? []).map((relatedContent) =>
          resolveRelatedBinding(lookup, surface, relatedContent),
        ),
      ),
      surface.titleField ? readFieldValue(lookup, surface, surface.titleField) : undefined,
      surface.subtitleField ? readFieldValue(lookup, surface, surface.subtitleField) : undefined,
    ]);

    return {
      binding: {
        commandSurfaces: surface.commandSurfaces ?? [],
        related,
        sections,
        ...(surface.subtitleField ? { subtitle } : {}),
        surface,
        ...(surface.titleField ? { title } : {}),
      },
      ok: true,
    };
  } catch (error) {
    if (isBindingIssue(error)) {
      return {
        issue: error,
        ok: false,
      };
    }
    throw error;
  }
}
