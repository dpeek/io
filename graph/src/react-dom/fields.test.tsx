import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

import {
  GraphValidationError,
  bootstrap,
  createStore,
  createTypeClient,
  core,
  fieldGroupPath,
  type FieldGroupRef,
} from "../index.js";
import {
  GraphMutationRuntimeProvider,
  createWebFieldResolver,
  usePredicateField,
  type PredicateFieldEditorCapability,
  type PredicateFieldProps,
  type PredicateFieldViewCapability,
} from "../react/index.js";
import { Fragment, Profiler, act } from "react";

import { app } from "../../../app/src/graph/app.js";
import { getAllByData, getReactProps, getRequiredElement } from "../test-dom.js";
import { PredicateFieldEditor, PredicateFieldView } from "./index.js";

function setupGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);
  const graph = createTypeClient(store, app);

  const companyId = graph.company.create({
    name: "Acme",
    website: new URL("https://acme.com"),
    status: app.status.values.active.id,
    tags: ["enterprise", "saas"],
    address: {
      address_line1: "1 Graph Way",
      locality: "Sydney",
    },
  });

  return { graph, companyId };
}

function setupBlockGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);
  const graph = createTypeClient(store, app);

  const blockId = graph.block.create({
    name: "Parent node",
    text: "Parent node",
    order: 0,
    collapsed: true,
  });

  return { blockId, graph };
}

function formatValue(value: unknown): string {
  if (value instanceof URL) return value.toString();
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined) return "";
  return String(value);
}

function getInputByKind(container: ParentNode, kind: string) {
  return getRequiredElement(
    container.querySelector<HTMLInputElement>(`input[data-web-field-kind="${kind}"]`),
    `Expected input for field kind "${kind}".`,
  );
}

function getSelectByKind(container: ParentNode, kind: string) {
  return getRequiredElement(
    container.querySelector<HTMLSelectElement>(`select[data-web-field-kind="${kind}"]`),
    `Expected select for field kind "${kind}".`,
  );
}

describe("web predicate bindings", () => {
  it("renders a field view from a typed predicate ref through the resolver", () => {
    const { graph, companyId } = setupGraph();
    const nameRef = graph.company.ref(companyId).fields.name;

    function TextView({
      predicate,
    }: PredicateFieldProps<typeof app.company.fields.name, typeof app & typeof core>) {
      const { value } = usePredicateField(predicate);
      return <span>{value}</span>;
    }

    const resolver = createWebFieldResolver({
      view: [
        {
          kind: "text",
          Component: TextView,
        } satisfies PredicateFieldViewCapability<
          typeof app.company.fields.name,
          typeof app & typeof core
        >,
      ],
    });

    const { container, unmount } = render(
      <PredicateFieldView predicate={nameRef} resolver={resolver} />,
    );

    const span = getRequiredElement(container.querySelector("span"), "Expected rendered text view.");
    expect(span.textContent).toBe("Acme");

    unmount();
  });

  it("renders a field editor from a typed predicate ref and mutates through that same ref", () => {
    const { graph, companyId } = setupGraph();
    const nameRef = graph.company.ref(companyId).fields.name;

    function TextEditor({
      predicate,
    }: PredicateFieldProps<typeof app.company.fields.name, typeof app & typeof core>) {
      const { value } = usePredicateField(predicate);
      return <button onClick={() => predicate.set(`${value}!`)}>{value}</button>;
    }

    const resolver = createWebFieldResolver({
      editor: [
        {
          kind: "text",
          Component: TextEditor,
        } satisfies PredicateFieldEditorCapability<
          typeof app.company.fields.name,
          typeof app & typeof core
        >,
      ],
    });

    const { container, unmount } = render(
      <PredicateFieldEditor predicate={nameRef} resolver={resolver} />,
    );

    const button = getRequiredElement(container.querySelector("button"), "Expected text editor button.");
    expect(button.textContent).toBe("Acme");

    fireEvent.click(button);

    expect(nameRef.get()).toBe("Acme!");
    expect(button.textContent).toBe("Acme!");

    unmount();
  });

  it("preflights generic editor mutations before calling typed predicate mutators", () => {
    const { graph, companyId } = setupGraph();
    const nameRef = graph.company.ref(companyId).fields.name;
    const instrumented = nameRef as typeof nameRef & {
      set(nextValue: string): void;
      validateSet(nextValue: string): ReturnType<typeof nameRef.validateSet>;
    };
    const originalSet = instrumented.set.bind(instrumented);
    const originalValidateSet = instrumented.validateSet.bind(instrumented);
    let setCalls = 0;
    let validateCalls = 0;
    let reportedError: unknown;

    instrumented.set = (nextValue: string) => {
      setCalls += 1;
      originalSet(nextValue);
    };
    instrumented.validateSet = (nextValue: string) => {
      validateCalls += 1;
      return originalValidateSet(nextValue);
    };

    const { container, unmount } = render(
      <PredicateFieldEditor
        onMutationError={(error) => {
          reportedError = error;
        }}
        predicate={instrumented}
      />,
    );

    const input = getInputByKind(container, "text");
    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(input).onChange({
        target: { value: "   " },
      });
    });

    expect(validateCalls).toBe(1);
    expect(setCalls).toBe(0);
    expect(nameRef.get()).toBe("Acme");
    expect(reportedError).toBeInstanceOf(GraphValidationError);
    expect((reportedError as GraphValidationError<Record<string, unknown>>).result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });

    unmount();
  });

  it("surfaces shared validation errors when required generic editors are cleared", () => {
    const { graph, companyId } = setupGraph();
    const websiteRef = graph.company.ref(companyId).fields.website;
    const initialWebsite = websiteRef.get().toString();
    let reportedError: unknown;

    const { container, unmount } = render(
      <PredicateFieldEditor
        onMutationError={(error) => {
          reportedError = error;
        }}
        predicate={websiteRef}
      />,
    );

    const input = getInputByKind(container, "url");
    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(input).onChange({
        target: { value: "" },
      });
    });

    expect(websiteRef.get().toString()).toBe(initialWebsite);
    expect(input.ariaInvalid).toBe("true");
    expect(reportedError).toBeInstanceOf(GraphValidationError);
    expect((reportedError as GraphValidationError<Record<string, unknown>>).result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
      issues: [
        expect.objectContaining({
          code: "field.required",
          predicateKey: app.company.fields.website.key,
        }),
      ],
    });

    unmount();
  });

  it("flushes pending synced mutations after default DOM editors succeed", async () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);
    let flushCalls = 0;

    const { container, unmount } = render(
      <GraphMutationRuntimeProvider
        runtime={{
          sync: {
            flush: async () => {
              flushCalls += 1;
              return [];
            },
            getPendingTransactions: () => [{}],
          },
        }}
      >
        <PredicateFieldEditor predicate={companyRef.fields.name} />
      </GraphMutationRuntimeProvider>,
    );

    const input = getInputByKind(container, "text");
    await act(async () => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(input).onChange({
        target: { value: "Acme Labs" },
      });
      await Promise.resolve();
    });

    expect(companyRef.fields.name.get()).toBe("Acme Labs");
    expect(flushCalls).toBe(1);

    unmount();
  });

  it("keeps predicate-local subscription boundaries in the common field path", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);
    const renders = { container: 0, name: 0, website: 0 };

    function NameView({
      predicate,
    }: PredicateFieldProps<typeof app.company.fields.name, typeof app & typeof core>) {
      renders.name += 1;
      const { value } = usePredicateField(predicate);
      return <span>{formatValue(value)}</span>;
    }

    function WebsiteView({
      predicate,
    }: PredicateFieldProps<typeof app.company.fields.website, typeof app & typeof core>) {
      renders.website += 1;
      const { value } = usePredicateField(predicate);
      return <span>{formatValue(value)}</span>;
    }

    const resolver = createWebFieldResolver({
      view: [
        {
          kind: "text",
          Component: NameView,
        } satisfies PredicateFieldViewCapability<
          typeof app.company.fields.name,
          typeof app & typeof core
        >,
        {
          kind: "external-link",
          Component: WebsiteView,
        } satisfies PredicateFieldViewCapability<
          typeof app.company.fields.website,
          typeof app & typeof core
        >,
      ],
    });

    function CompanyFields() {
      renders.container += 1;
      return (
        <Fragment>
          <PredicateFieldView predicate={companyRef.fields.name} resolver={resolver} />
          <PredicateFieldView predicate={companyRef.fields.website} resolver={resolver} />
        </Fragment>
      );
    }

    const { container, unmount } = render(<CompanyFields />);
    expect(renders).toEqual({ container: 1, name: 1, website: 1 });

    act(() => {
      companyRef.fields.name.set("Acme 2");
    });
    expect(renders).toEqual({ container: 1, name: 2, website: 1 });

    act(() => {
      companyRef.fields.website.set(new URL("https://acme-2.com"));
    });

    expect(renders).toEqual({ container: 1, name: 2, website: 2 });
    expect(Array.from(container.querySelectorAll("span")).map((node) => node.textContent ?? "")).toEqual([
      "Acme 2",
      "https://acme-2.com/",
    ]);

    unmount();
  });

  it("keeps nested field-group composition leaf-local in resolver-driven views", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);
    const addressRef: FieldGroupRef<typeof app.company.fields.address, typeof app & typeof core> =
      companyRef.fields.address;
    const renders = { section: 0, line1: 0, postalCode: 0 };

    expect(fieldGroupPath(addressRef)).toEqual(["address"]);

    function AddressSection({
      group,
    }: {
      group: FieldGroupRef<typeof app.company.fields.address, typeof app & typeof core>;
    }) {
      renders.section += 1;
      return (
        <Fragment>
          <Profiler
            id="address-line1"
            onRender={() => {
              renders.line1 += 1;
            }}
          >
            <PredicateFieldView predicate={group.address_line1} />
          </Profiler>
          <Profiler
            id="address-postal-code"
            onRender={() => {
              renders.postalCode += 1;
            }}
          >
            <PredicateFieldView predicate={group.postal_code} />
          </Profiler>
        </Fragment>
      );
    }

    const { container, unmount } = render(<AddressSection group={addressRef} />);
    expect(renders).toEqual({ section: 1, line1: 1, postalCode: 1 });

    act(() => {
      companyRef.fields.address.locality.set("Melbourne");
    });
    expect(renders).toEqual({ section: 1, line1: 1, postalCode: 1 });

    act(() => {
      companyRef.fields.address.postal_code.set("3000");
    });

    expect(renders).toEqual({ section: 1, line1: 1, postalCode: 2 });
    expect(Array.from(container.querySelectorAll("span")).map((node) => node.textContent ?? "")).toContain(
      "3000",
    );

    unmount();
  });

  it("renders the company proof surface through the default generic resolver", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    const { container, unmount } = render(
      <Fragment>
        <PredicateFieldView predicate={companyRef.fields.name} />
        <PredicateFieldView predicate={companyRef.fields.foundedYear} />
        <PredicateFieldView predicate={companyRef.fields.website} />
        <PredicateFieldView predicate={companyRef.fields.status} />
      </Fragment>,
    );

    const spans = Array.from(container.querySelectorAll("span"));
    const links = Array.from(container.querySelectorAll("a"));

    expect(
      spans.map((node) => [node.getAttribute("data-web-field-kind"), node.textContent ?? ""]),
    ).toEqual([
      ["text", "Acme"],
      ["number", ""],
      ["badge", "Active"],
    ]);
    expect(
      links.map((node) => ({
        "data-web-field-kind": node.getAttribute("data-web-field-kind"),
        href: node.getAttribute("href"),
        rel: node.getAttribute("rel"),
        target: node.getAttribute("target"),
      })),
    ).toEqual([
      {
        "data-web-field-kind": "external-link",
        href: "https://acme.com/",
        rel: "noreferrer",
        target: "_blank",
      },
    ]);
    expect(links[0]?.textContent).toBe("https://acme.com/");

    unmount();
  });

  it("renders generic editors and mutates proof-surface fields through predicate refs", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    const { container, unmount } = render(
      <Fragment>
        <PredicateFieldEditor predicate={companyRef.fields.name} />
        <PredicateFieldEditor predicate={companyRef.fields.foundedYear} />
        <PredicateFieldEditor predicate={companyRef.fields.website} />
        <PredicateFieldEditor predicate={companyRef.fields.status} />
        <PredicateFieldEditor predicate={companyRef.fields.tags} />
      </Fragment>,
    );

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input"));
    const select = getSelectByKind(container, "select");
    const tagsInput = getInputByKind(container, "token-list-input");
    const addTagButton = getRequiredElement(
      container.querySelector<HTMLButtonElement>('button[data-web-field-action="add-token"]'),
      "Expected add-token button.",
    );
    const removeTagButton = getRequiredElement(
      container.querySelector<HTMLButtonElement>(
        'button[data-web-field-action="remove-token"][data-web-token-value="saas"]',
      ),
      "Expected remove-token button.",
    );

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(inputs[0]!).onChange({
        target: { value: "Acme Labs" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(inputs[1]!).onChange({
        target: { value: "1999" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(inputs[2]!).onChange({
        target: { value: "https://labs.acme.com" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(select).onChange({
        target: { value: app.status.values.paused.id },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(tagsInput).onChange({
        target: { value: "ai" },
      });
      getReactProps<{ onClick(): void }>(addTagButton).onClick();
      getReactProps<{ onClick(): void }>(removeTagButton).onClick();
    });

    expect(companyRef.fields.name.get()).toBe("Acme Labs");
    expect(companyRef.fields.foundedYear.get()).toBe(1999);
    expect(companyRef.fields.website.get().toString()).toBe("https://labs.acme.com/");
    expect(companyRef.fields.status.get()).toBe(app.status.values.paused.id);
    expect(companyRef.fields.tags.get()).toEqual(["enterprise", "ai"]);
    expect(select.value).toBe(app.status.values.paused.id);

    unmount();
  });

  it("uses editor parse metadata for validated text scalars without bespoke components", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    const { container, unmount } = render(
      <PredicateFieldEditor predicate={companyRef.fields.contactEmail} />,
    );

    const input = getRequiredElement(container.querySelector<HTMLInputElement>("input"), "Expected email input.");
    expect(input.type).toBe("email");

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(input).onChange({
        target: { value: "not-an-email" },
      });
    });
    expect(input.ariaInvalid).toBe("true");
    expect(companyRef.fields.contactEmail.get()).toBeUndefined();

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(input).onChange({
        target: { value: "Team@Acme.com" },
      });
    });
    expect(companyRef.fields.contactEmail.get()).toBe("team@acme.com");
    expect(input.value).toBe("team@acme.com");

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(input).onChange({
        target: { value: "" },
      });
    });
    expect(companyRef.fields.contactEmail.get()).toBeUndefined();
    expect(input.ariaInvalid).toBeNull();

    unmount();
  });

  it("renders migrated boolean fields through the default generic resolver", () => {
    const { blockId, graph } = setupBlockGraph();
    const blockRef = graph.block.ref(blockId);

    const { container, unmount } = render(
      <Fragment>
        <PredicateFieldView predicate={blockRef.fields.collapsed} />
        <PredicateFieldEditor predicate={blockRef.fields.collapsed} />
      </Fragment>,
    );

    const booleanView = getInputByKind(container, "boolean");
    const checkbox = getInputByKind(container, "checkbox");

    expect(booleanView.type).toBe("checkbox");
    expect(booleanView.checked).toBe(true);
    expect(booleanView.disabled).toBe(true);
    expect(booleanView.getAttribute("aria-label")).toBe("True");
    expect(checkbox.checked).toBe(true);

    act(() => {
      getReactProps<{ onChange(event: { target: { checked: boolean } }): void }>(checkbox).onChange({
        target: { checked: false },
      });
    });

    expect(blockRef.fields.collapsed.get()).toBe(false);
    expect(booleanView.checked).toBe(false);
    expect(booleanView.getAttribute("aria-label")).toBe("False");
    expect(checkbox.checked).toBe(false);

    unmount();
  });

  it("keeps token-list editor rerenders scoped to its predicate slot", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);
    const renders = { container: 0, name: 0, tags: 0 };

    function onRender(id: string) {
      if (id === "name") renders.name += 1;
      if (id === "tags") renders.tags += 1;
    }

    function CompanyFields() {
      renders.container += 1;
      return (
        <Fragment>
          <Profiler id="name" onRender={onRender}>
            <PredicateFieldEditor predicate={companyRef.fields.name} />
          </Profiler>
          <Profiler id="tags" onRender={onRender}>
            <PredicateFieldEditor predicate={companyRef.fields.tags} />
          </Profiler>
        </Fragment>
      );
    }

    const { container, unmount } = render(<CompanyFields />);
    expect(renders).toEqual({ container: 1, name: 1, tags: 1 });

    const tagsInput = getInputByKind(container, "token-list-input");
    const addTagButton = getRequiredElement(
      container.querySelector<HTMLButtonElement>('button[data-web-field-action="add-token"]'),
      "Expected add-token button.",
    );

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(tagsInput).onChange({
        target: { value: "ai" },
      });
      getReactProps<{ onClick(): void }>(addTagButton).onClick();
    });

    expect(renders.container).toBe(1);
    expect(renders.name).toBe(1);
    expect(renders.tags).toBeGreaterThan(1);
    expect(companyRef.fields.tags.get()).toEqual(["enterprise", "saas", "ai"]);

    unmount();
  });

  it("renders entity-reference fields through the explicit relationship policy", () => {
    const { graph, companyId } = setupGraph();
    const secondCompanyId = graph.company.create({
      name: "Estii",
      website: new URL("https://estii.com"),
      status: app.status.values.paused.id,
    });
    const personId = graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });
    const worksAtRef = graph.person.ref(personId).fields.worksAt;

    expect(app.person.fields.worksAt.meta.reference).toEqual({
      selection: "existing-only",
      create: false,
    });

    const { container, unmount } = render(
      <Fragment>
        <PredicateFieldView predicate={worksAtRef} />
        <PredicateFieldEditor predicate={worksAtRef} />
      </Fragment>,
    );

    expect(getAllByData(container, "data-web-reference-id").map((node) => node.dataset.webReferenceId ?? "")).toEqual([
      companyId,
    ]);
    expect(Array.from(container.querySelectorAll("code")).map((node) => node.textContent ?? "")).toContain(
      companyId,
    );
    expect(Array.from(container.querySelectorAll("span")).some((node) => node.textContent === "Acme")).toBe(true);

    const secondCompanyToggle = getRequiredElement(
      container.querySelector<HTMLInputElement>(
        `label[data-web-reference-option-id="${secondCompanyId}"] input`,
      ),
      "Expected entity-reference toggle.",
    );
    act(() => {
      getReactProps<{ onChange(event: { target: { checked: boolean } }): void }>(
        secondCompanyToggle,
      ).onChange({
        target: { checked: true },
      });
    });

    expect(worksAtRef.get()).toEqual([companyId, secondCompanyId]);
    expect(
      getAllByData(container, "data-web-reference-selected-id").map(
        (node) => node.dataset.webReferenceSelectedId ?? "",
      ),
    ).toEqual([companyId, secondCompanyId]);

    const removeCurrentEmployer = getRequiredElement(
      container.querySelector<HTMLButtonElement>(
        `li[data-web-reference-selected-id="${companyId}"] button`,
      ),
      "Expected selected-reference remove button.",
    );
    act(() => {
      getReactProps<{ onClick(): void }>(removeCurrentEmployer).onClick();
    });

    expect(worksAtRef.get()).toEqual([secondCompanyId]);

    unmount();
  });

  it("keeps migrated boolean rerenders scoped to boolean subscribers", () => {
    const { blockId, graph } = setupBlockGraph();
    const blockRef = graph.block.ref(blockId);
    const renders = { collapsedEditor: 0, collapsedView: 0, container: 0, text: 0 };

    function onRender(id: string) {
      if (id === "text") renders.text += 1;
      if (id === "collapsed-view") renders.collapsedView += 1;
      if (id === "collapsed-editor") renders.collapsedEditor += 1;
    }

    function BlockFields() {
      renders.container += 1;
      return (
        <Fragment>
          <Profiler id="text" onRender={onRender}>
            <PredicateFieldView predicate={blockRef.fields.text} />
          </Profiler>
          <Profiler id="collapsed-view" onRender={onRender}>
            <PredicateFieldView predicate={blockRef.fields.collapsed} />
          </Profiler>
          <Profiler id="collapsed-editor" onRender={onRender}>
            <PredicateFieldEditor predicate={blockRef.fields.collapsed} />
          </Profiler>
        </Fragment>
      );
    }

    const { container, unmount } = render(<BlockFields />);
    expect(renders).toEqual({ collapsedEditor: 1, collapsedView: 1, container: 1, text: 1 });

    const checkbox = getInputByKind(container, "checkbox");
    act(() => {
      getReactProps<{ onChange(event: { target: { checked: boolean } }): void }>(checkbox).onChange({
        target: { checked: false },
      });
    });

    expect(blockRef.fields.collapsed.get()).toBe(false);
    expect(renders.container).toBe(1);
    expect(renders.text).toBe(1);
    expect(renders.collapsedView).toBeGreaterThan(1);
    expect(renders.collapsedEditor).toBeGreaterThan(1);
    expect(getInputByKind(container, "boolean").checked).toBe(false);
    expect(getInputByKind(container, "boolean").getAttribute("aria-label")).toBe("False");

    unmount();
  });

  it("keeps generic field rerenders scoped to each predicate slot", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);
    const renders = { container: 0, name: 0, website: 0 };

    function onRender(id: string) {
      if (id === "name") renders.name += 1;
      if (id === "website") renders.website += 1;
    }

    function CompanyFields() {
      renders.container += 1;
      return (
        <Fragment>
          <Profiler id="name" onRender={onRender}>
            <PredicateFieldView predicate={companyRef.fields.name} />
          </Profiler>
          <Profiler id="website" onRender={onRender}>
            <PredicateFieldView predicate={companyRef.fields.website} />
          </Profiler>
        </Fragment>
      );
    }

    const { container, unmount } = render(<CompanyFields />);
    expect(renders).toEqual({ container: 1, name: 1, website: 1 });

    act(() => {
      companyRef.fields.name.set("Acme 2");
    });
    expect(renders).toEqual({ container: 1, name: 2, website: 1 });

    act(() => {
      companyRef.fields.website.set(new URL("https://acme-2.com"));
    });

    expect(renders).toEqual({ container: 1, name: 2, website: 2 });
    expect((container.querySelector("a")?.textContent ?? "")).toBe("https://acme-2.com/");

    unmount();
  });
});
