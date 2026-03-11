import { describe, expect, it } from "bun:test";
import { Fragment, Profiler } from "react";
import { act, create } from "react-test-renderer";

import { app } from "../graph/app.js";
import { bootstrap } from "../graph/bootstrap.js";
import {
  GraphValidationError,
  createTypeClient,
  fieldGroupPath,
  type FieldGroupRef,
} from "../graph/client.js";
import { core } from "../graph/core.js";
import { createStore } from "../graph/store.js";
import {
  PredicateFieldEditor,
  PredicateFieldView,
  createWebFieldResolver,
  usePredicateField,
} from "./bindings.js";
import type {
  PredicateFieldEditorCapability,
  PredicateFieldProps,
  PredicateFieldViewCapability,
} from "./resolver.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
        } satisfies PredicateFieldViewCapability<typeof app.company.fields.name, typeof app & typeof core>,
      ],
    });

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<PredicateFieldView predicate={nameRef} resolver={resolver} />);
    });

    expect(renderer?.toJSON()).toEqual({
      type: "span",
      props: {},
      children: ["Acme"],
    });

    act(() => {
      renderer?.unmount();
    });
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
        } satisfies PredicateFieldEditorCapability<typeof app.company.fields.name, typeof app & typeof core>,
      ],
    });

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<PredicateFieldEditor predicate={nameRef} resolver={resolver} />);
    });

    const button = renderer?.root.findByType("button");
    expect(button?.children).toEqual(["Acme"]);

    act(() => {
      button?.props.onClick();
    });

    expect(nameRef.get()).toBe("Acme!");
    expect(renderer?.root.findByType("button").children).toEqual(["Acme!"]);

    act(() => {
      renderer?.unmount();
    });
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

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <PredicateFieldEditor
          onMutationError={(error) => {
            reportedError = error;
          }}
          predicate={instrumented}
        />,
      );
    });

    const input = renderer?.root.findByProps({ "data-web-field-kind": "text" });

    act(() => {
      input?.props.onChange({ target: { value: "   " } });
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

    act(() => {
      renderer?.unmount();
    });
  });

  it("surfaces shared validation errors when required generic editors are cleared", () => {
    const { graph, companyId } = setupGraph();
    const websiteRef = graph.company.ref(companyId).fields.website;
    const initialWebsite = websiteRef.get().toString();
    let reportedError: unknown;

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <PredicateFieldEditor
          onMutationError={(error) => {
            reportedError = error;
          }}
          predicate={websiteRef}
        />,
      );
    });

    const input = renderer?.root.findByProps({ "data-web-field-kind": "url" });

    act(() => {
      input?.props.onChange({ target: { value: "" } });
    });

    expect(websiteRef.get().toString()).toBe(initialWebsite);
    expect(renderer?.root.findByProps({ "data-web-field-kind": "url" }).props["aria-invalid"]).toBe(
      true,
    );
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

    act(() => {
      renderer?.unmount();
    });
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
        } satisfies PredicateFieldViewCapability<typeof app.company.fields.name, typeof app & typeof core>,
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

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<CompanyFields />);
    });

    expect(renders).toEqual({ container: 1, name: 1, website: 1 });

    act(() => {
      companyRef.fields.name.set("Acme 2");
    });

    expect(renders).toEqual({ container: 1, name: 2, website: 1 });

    act(() => {
      companyRef.fields.website.set(new URL("https://acme-2.com"));
    });

    expect(renders).toEqual({ container: 1, name: 2, website: 2 });
    expect(renderer?.root.findAllByType("span").map((node) => node.children.join(""))).toEqual([
      "Acme 2",
      "https://acme-2.com/",
    ]);

    act(() => {
      renderer?.unmount();
    });
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

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<AddressSection group={addressRef} />);
    });

    expect(renders).toEqual({ section: 1, line1: 1, postalCode: 1 });

    act(() => {
      companyRef.fields.address.locality.set("Melbourne");
    });

    expect(renders).toEqual({ section: 1, line1: 1, postalCode: 1 });

    act(() => {
      companyRef.fields.address.postal_code.set("3000");
    });

    expect(renders).toEqual({ section: 1, line1: 1, postalCode: 2 });
    expect(renderer?.root.findAllByType("span").map((node) => node.children.join(""))).toContain(
      "3000",
    );

    act(() => {
      renderer?.unmount();
    });
  });

  it("renders the company proof surface through the default generic resolver", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Fragment>
          <PredicateFieldView predicate={companyRef.fields.name} />
          <PredicateFieldView predicate={companyRef.fields.foundedYear} />
          <PredicateFieldView predicate={companyRef.fields.website} />
          <PredicateFieldView predicate={companyRef.fields.status} />
        </Fragment>,
      );
    });

    const spans = renderer?.root.findAllByType("span") ?? [];
    const links = renderer?.root.findAllByType("a") ?? [];

    expect(spans.map((node) => [node.props["data-web-field-kind"], node.children.join("")])).toEqual([
      ["text", "Acme"],
      ["number", ""],
      ["badge", "Active"],
    ]);
    expect(
      links.map((node) => ({
        "data-web-field-kind": node.props["data-web-field-kind"],
        href: node.props.href,
        rel: node.props.rel,
        target: node.props.target,
      })),
    ).toEqual([
      {
        "data-web-field-kind": "external-link",
        href: "https://acme.com/",
        rel: "noreferrer",
        target: "_blank",
      },
    ]);
    expect(links[0]?.children).toEqual(["https://acme.com/"]);

    act(() => {
      renderer?.unmount();
    });
  });

  it("renders generic editors and mutates proof-surface fields through predicate refs", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Fragment>
          <PredicateFieldEditor predicate={companyRef.fields.name} />
          <PredicateFieldEditor predicate={companyRef.fields.foundedYear} />
          <PredicateFieldEditor predicate={companyRef.fields.website} />
          <PredicateFieldEditor predicate={companyRef.fields.status} />
          <PredicateFieldEditor predicate={companyRef.fields.tags} />
        </Fragment>,
      );
    });

    const inputs = renderer?.root.findAllByType("input") ?? [];
    const select = renderer?.root.findByType("select");
    const tagsInput = renderer?.root.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "token-list-input",
    );
    const addTagButton = renderer?.root.find(
      (node) => node.type === "button" && node.props["data-web-field-action"] === "add-token",
    );
    const removeTagButton = renderer?.root.find(
      (node) =>
        node.type === "button" &&
        node.props["data-web-field-action"] === "remove-token" &&
        node.props["data-web-token-value"] === "saas",
    );

    act(() => {
      inputs[0]?.props.onChange({ target: { value: "Acme Labs" } });
      inputs[1]?.props.onChange({ target: { value: "1999" } });
      inputs[2]?.props.onChange({ target: { value: "https://labs.acme.com" } });
      select?.props.onChange({ target: { value: app.status.values.paused.id } });
      tagsInput?.props.onChange({ target: { value: "ai" } });
    });

    act(() => {
      addTagButton?.props.onClick();
      removeTagButton?.props.onClick();
    });

    expect(companyRef.fields.name.get()).toBe("Acme Labs");
    expect(companyRef.fields.foundedYear.get()).toBe(1999);
    expect(companyRef.fields.website.get().toString()).toBe("https://labs.acme.com/");
    expect(companyRef.fields.status.get()).toBe(app.status.values.paused.id);
    expect(companyRef.fields.tags.get()).toEqual(["enterprise", "ai"]);
    expect(select?.props.value).toBe(app.status.values.paused.id);

    act(() => {
      renderer?.unmount();
    });
  });

  it("uses editor parse metadata for validated text scalars without bespoke components", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<PredicateFieldEditor predicate={companyRef.fields.contactEmail} />);
    });

    const input = renderer?.root.findByType("input");
    expect(input?.props.type).toBe("email");

    act(() => {
      input?.props.onChange({ target: { value: "not-an-email" } });
    });

    expect(renderer?.root.findByType("input").props["aria-invalid"]).toBe(true);
    expect(companyRef.fields.contactEmail.get()).toBeUndefined();

    act(() => {
      renderer?.root.findByType("input").props.onChange({ target: { value: "Team@Acme.com" } });
    });

    expect(companyRef.fields.contactEmail.get()).toBe("team@acme.com");
    expect(renderer?.root.findByType("input").props.value).toBe("team@acme.com");

    act(() => {
      renderer?.root.findByType("input").props.onChange({ target: { value: "" } });
    });

    expect(companyRef.fields.contactEmail.get()).toBeUndefined();
    expect(renderer?.root.findByType("input").props["aria-invalid"]).toBeUndefined();

    act(() => {
      renderer?.unmount();
    });
  });

  it("renders migrated boolean fields through the default generic resolver", () => {
    const { blockId, graph } = setupBlockGraph();
    const blockRef = graph.block.ref(blockId);

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Fragment>
          <PredicateFieldView predicate={blockRef.fields.collapsed} />
          <PredicateFieldEditor predicate={blockRef.fields.collapsed} />
        </Fragment>,
      );
    });

    const booleanView = renderer?.root.findByProps({ "data-web-field-kind": "boolean" });
    const checkbox = renderer?.root.findByProps({ "data-web-field-kind": "checkbox" });

    expect(booleanView?.props.type).toBe("checkbox");
    expect(booleanView?.props.checked).toBe(true);
    expect(booleanView?.props.disabled).toBe(true);
    expect(booleanView?.props["aria-label"]).toBe("True");
    expect(checkbox?.props.checked).toBe(true);

    act(() => {
      checkbox?.props.onChange({ target: { checked: false } });
    });

    expect(blockRef.fields.collapsed.get()).toBe(false);
    expect(renderer?.root.findByProps({ "data-web-field-kind": "boolean" }).props.checked).toBe(false);
    expect(renderer?.root.findByProps({ "data-web-field-kind": "boolean" }).props["aria-label"]).toBe(
      "False",
    );
    expect(renderer?.root.findByProps({ "data-web-field-kind": "checkbox" }).props.checked).toBe(false);

    act(() => {
      renderer?.unmount();
    });
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

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<CompanyFields />);
    });

    expect(renders).toEqual({ container: 1, name: 1, tags: 1 });

    const tagsInput = renderer?.root.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "token-list-input",
    );
    const addTagButton = renderer?.root.find(
      (node) => node.type === "button" && node.props["data-web-field-action"] === "add-token",
    );

    act(() => {
      tagsInput?.props.onChange({ target: { value: "ai" } });
    });

    act(() => {
      addTagButton?.props.onClick();
    });

    expect(renders.container).toBe(1);
    expect(renders.name).toBe(1);
    expect(renders.tags).toBeGreaterThan(1);
    expect(companyRef.fields.tags.get()).toEqual(["enterprise", "saas", "ai"]);

    act(() => {
      renderer?.unmount();
    });
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

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Fragment>
          <PredicateFieldView predicate={worksAtRef} />
          <PredicateFieldEditor predicate={worksAtRef} />
        </Fragment>,
      );
    });

    expect(
      renderer?.root
        .findAll(
          (node) =>
            !!node.props && typeof node.props["data-web-reference-id"] === "string",
        )
        .map((node) => node.props["data-web-reference-id"] as string),
    ).toEqual([companyId]);
    expect(
      renderer?.root.findAllByType("code").map((node) => node.children.join("")),
    ).toContain(companyId);
    expect(
      renderer?.root.findAllByType("span").some((node) => node.children.join("") === "Acme"),
    ).toBe(true);

    const secondCompanyToggle = renderer?.root.find(
      (node) =>
        node.type === "label" &&
        node.props["data-web-reference-option-id"] === secondCompanyId,
    );

    act(() => {
      secondCompanyToggle?.findByType("input").props.onChange({ target: { checked: true } });
    });

    expect(worksAtRef.get()).toEqual([companyId, secondCompanyId]);
    expect(
      renderer?.root
        .findAll(
          (node) =>
            !!node.props && typeof node.props["data-web-reference-selected-id"] === "string",
        )
        .map((node) => node.props["data-web-reference-selected-id"] as string),
    ).toEqual([companyId, secondCompanyId]);

    const removeCurrentEmployer = renderer?.root.find(
      (node) =>
        node.type === "li" &&
        node.props["data-web-reference-selected-id"] === companyId,
    );

    act(() => {
      removeCurrentEmployer?.findByType("button").props.onClick();
    });

    expect(worksAtRef.get()).toEqual([secondCompanyId]);

    act(() => {
      renderer?.unmount();
    });
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

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<BlockFields />);
    });

    expect(renders).toEqual({ collapsedEditor: 1, collapsedView: 1, container: 1, text: 1 });

    const checkbox = renderer?.root.findByProps({ "data-web-field-kind": "checkbox" });

    act(() => {
      checkbox?.props.onChange({ target: { checked: false } });
    });

    expect(blockRef.fields.collapsed.get()).toBe(false);
    expect(renders.container).toBe(1);
    expect(renders.text).toBe(1);
    expect(renders.collapsedView).toBeGreaterThan(1);
    expect(renders.collapsedEditor).toBeGreaterThan(1);
    expect(renderer?.root.findByProps({ "data-web-field-kind": "boolean" }).props.checked).toBe(false);
    expect(renderer?.root.findByProps({ "data-web-field-kind": "boolean" }).props["aria-label"]).toBe(
      "False",
    );

    act(() => {
      renderer?.unmount();
    });
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

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<CompanyFields />);
    });

    expect(renders).toEqual({ container: 1, name: 1, website: 1 });

    act(() => {
      companyRef.fields.name.set("Acme 2");
    });

    expect(renders).toEqual({ container: 1, name: 2, website: 1 });

    act(() => {
      companyRef.fields.website.set(new URL("https://acme-2.com"));
    });

    expect(renders).toEqual({ container: 1, name: 2, website: 2 });
    expect(renderer?.root.findAllByType("a")[0]?.children).toEqual(["https://acme-2.com/"]);

    act(() => {
      renderer?.unmount();
    });
  });
});
