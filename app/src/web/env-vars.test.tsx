import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { act } from "react";

import { bootstrap, createStore, createTypeClient, core } from "@io/graph";

import { app } from "../graph/app.js";
import { getByData, getReactProps, getRequiredElement, textContent } from "../test-dom.js";
import { EnvVarSettingsSurface } from "./env-vars.js";

function createRuntime() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);
  const graph = createTypeClient(store, app);
  return {
    graph,
    sync: {
      async sync() {},
    },
  };
}

describe("env-var settings surface", () => {
  it("creates a new env var through the mutation flow and refreshes the list without rendering plaintext metadata", async () => {
    const runtime = createRuntime();
    const submitted: Array<{
      readonly id?: string;
      readonly name: string;
      readonly description?: string;
      readonly secretValue?: string;
    }> = [];

    const { container, unmount } = render(
      <EnvVarSettingsSurface
        runtime={runtime}
        submitEnvVar={async (input) => {
          submitted.push(input);
          const secretId = runtime.graph.secretRef.create({
            name: `${input.name} secret`,
            version: 1,
            lastRotatedAt: new Date("2026-03-13T00:00:00.000Z"),
          });
          const envVarId = runtime.graph.envVar.create({
            name: input.name,
            description: input.description,
            secret: secretId,
          });
          return {
            envVarId,
            created: true,
            rotated: true,
            secretVersion: 1,
          };
        }}
      />,
    );

    const newButton = getByData(container, "data-env-var-new", "button");
    const nameInput = getByData(container, "data-env-var-input", "name");
    const descriptionInput = getByData(container, "data-env-var-input", "description");
    const secretInput = getByData(container, "data-env-var-input", "secret");
    const form = getRequiredElement(container.querySelector("form"), "Expected env-var form.");

    await act(async () => {
      fireEvent.click(newButton);
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(nameInput).onChange({
        target: { value: "OPENAI_API_KEY" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(descriptionInput).onChange({
        target: { value: "Primary model credential" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(secretInput).onChange({
        target: { value: "sk-test-secret" },
      });
      await Promise.resolve();
    });

    await act(async () => {
      getReactProps<{ onSubmit(event: { preventDefault(): void }): void | Promise<void> }>(form).onSubmit({
        preventDefault() {},
      });
      await Promise.resolve();
    });

    expect(submitted).toEqual([
      {
        name: "OPENAI_API_KEY",
        description: "Primary model credential",
        secretValue: "sk-test-secret",
      },
    ]);
    expect(textContent(container)).toContain("OPENAI_API_KEY");
    expect(textContent(container)).toContain("Created OPENAI_API_KEY.");
    expect(textContent(container)).not.toContain("sk-test-secret");

    unmount();
  });

  it("keeps the secret field blank while editing and omits empty rotations from the mutation payload", async () => {
    const runtime = createRuntime();
    const secretId = runtime.graph.secretRef.create({
      name: "SLACK_BOT_TOKEN secret",
      version: 3,
      lastRotatedAt: new Date("2026-03-10T10:00:00.000Z"),
    });
    const envVarId = runtime.graph.envVar.create({
      name: "SLACK_BOT_TOKEN",
      description: "Workspace notifications",
      secret: secretId,
    });
    runtime.sync.sync = async () => {
      runtime.graph.envVar.update(envVarId, {
        name: "SLACK_BOT_TOKEN",
        description: "Updated notifications integration",
      });
    };

    const submitted: Array<{
      readonly id?: string;
      readonly name: string;
      readonly description?: string;
      readonly secretValue?: string;
    }> = [];

    const { container, unmount } = render(
      <EnvVarSettingsSurface
        runtime={runtime}
        submitEnvVar={async (input) => {
          submitted.push(input);
          return {
            envVarId,
            created: false,
            rotated: false,
            secretVersion: 3,
          };
        }}
      />,
    );

    const secretInput = getByData(container, "data-env-var-input", "secret") as HTMLInputElement;
    const descriptionInput = getByData(container, "data-env-var-input", "description");
    const form = getRequiredElement(container.querySelector("form"), "Expected env-var form.");

    expect(secretInput.value).toBe("");

    await act(async () => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(
        descriptionInput,
      ).onChange({
        target: { value: "Updated notifications integration" },
      });
      await Promise.resolve();
    });

    await act(async () => {
      getReactProps<{ onSubmit(event: { preventDefault(): void }): void | Promise<void> }>(form).onSubmit({
        preventDefault() {},
      });
      await Promise.resolve();
    });

    expect(submitted).toEqual([
      {
        id: envVarId,
        name: "SLACK_BOT_TOKEN",
        description: "Updated notifications integration",
        secretValue: undefined,
      },
    ]);
    expect(textContent(container)).toContain("Saved SLACK_BOT_TOKEN.");
    expect(textContent(container)).toContain("v3");

    unmount();
  });
});
