import { describe, expect, it } from "bun:test";
import { Fragment } from "react";
import { act, create } from "react-test-renderer";

import { app } from "../graph/app.js";
import { bootstrap } from "../graph/bootstrap.js";
import { createTypeClient } from "../graph/client.js";
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
  });

  return { graph, companyId };
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
});
