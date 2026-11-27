import { describe, expect, it, vi } from "vitest";
import { compileModelOptionMaps } from "@zcode/model-option-map";
import { readFile } from "node:fs/promises";
import { ModelConfig, ModelConfigRules, parseZCodeBuiltinModelConfigRules } from "@zcode/provider";
import { createModelOptionMapFetch } from "../src/model/model-option-map-fetch.js";

async function loadBundledRules() {
  const release = JSON.parse(
    await readFile(
      new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
      "utf8",
    ),
  );
  return new ModelConfigRules([
    ...parseZCodeBuiltinModelConfigRules(release.config.modelConfigRules).rules(),
    ...parseZCodeBuiltinModelConfigRules(release.config.modelConfigOverrides).rules(),
  ]);
}

describe("bundled GPT reasoning reaches the final wire body", () => {
  it("preserves personal overrides, protocol ownership and unknown-model fallback", async () => {
    const rules = await loadBundledRules();
    const input = { providerId: "isolated", modelId: "gpt-6.2-sol", apiType: "openai-responses" };
    const personal = ModelConfigRules.empty().setExact(
      input.providerId,
      input.modelId,
      ModelConfig.fromData({ optionSpecs: { reasoningLevel: { values: ["custom"], map: "{}" } } }),
    );
    const effective = ModelConfigRules.composeEffective(rules, personal).resolve(input).toJSON();
    expect(effective.optionSpecs?.reasoningLevel).toEqual({ values: ["custom"], map: "{}" });
    for (const modelId of ["gpt-6.3-sol", "gpt-6.2-sol-unknown", "not-gpt-6.2-sol"]) {
      expect(
        rules.resolve({ ...input, modelId }).toJSON().optionSpecs?.reasoningLevel?.values,
      ).toEqual(["disabled", "enabled"]);
    }
    const anthropic = rules.resolve({ ...input, apiType: "anthropic-messages" }).toJSON();
    expect(anthropic.optionSpecs?.reasoningLevel?.map).toContain("output_config");
    expect(anthropic.optionSpecs?.reasoningLevel?.map).not.toContain("reasoning_effort");
    for (const templateId of [undefined, "openai"]) {
      expect(
        rules.resolve({ ...input, templateId }).toJSON().optionSpecs?.reasoningLevel?.values,
      ).toEqual(["low", "medium", "high", "xhigh", "max"]);
    }
  });
  const cases = [
    ["gpt-6.2-sol", ["low", "medium", "high", "xhigh", "max"]],
    ["openai/GPT-6.2-ASTRA", ["low", "medium", "high", "xhigh", "max"]],
    ["gpt-6.1-sol", ["low", "medium", "high", "xhigh", "max"]],
    ["gpt-6.1-terra", ["none", "low", "medium", "high", "xhigh", "max"]],
    ["gpt-6-luna", ["none", "low", "medium", "high", "xhigh", "max"]],
    ["gpt-6-sol", ["none", "low", "medium", "high", "xhigh", "max"]],
    ["gpt-6-astra", ["low", "medium", "high", "xhigh", "max"]],
    ["gpt-5.6-sol", ["none", "low", "medium", "high", "xhigh", "max"]],
    ["gpt-5.5-2026-04-23", ["none", "low", "medium", "high", "xhigh"]],
    ["gpt-5.4-pro", ["medium", "high", "xhigh"]],
    ["gpt-5.4-mini", ["none", "low", "medium", "high", "xhigh"]],
    ["gpt-5.3-codex", ["low", "medium", "high", "xhigh"]],
    ["gpt-5.2", ["none", "low", "medium", "high", "xhigh"]],
    ["gpt-5.1", ["none", "low", "medium", "high"]],
    ["gpt-5-mini", ["minimal", "low", "medium", "high"]],
  ] as const;

  for (const apiType of ["openai-responses", "openai-chat-completions"] as const) {
    it.each(cases)(`${apiType}: %s`, async (modelId, levels) => {
      const rules = await loadBundledRules();
      const config = rules.resolve({ providerId: "isolated", modelId, apiType }).toJSON();
      expect(config.optionSpecs?.reasoningLevel?.values).toEqual(levels);
      const specs = config.optionSpecs!;
      const maps = compileModelOptionMaps({
        reasoningLevel: { map: specs.reasoningLevel!.map! },
        maxOutputTokens: { map: specs.maxOutputTokens!.map! },
      });
      for (const reasoningLevel of levels) {
        let sent: unknown;
        const fetch = createModelOptionMapFetch({
          fetch: async (_input, init) => {
            sent = JSON.parse(String(init?.body));
            return new Response("{}");
          },
          maps,
          values: { reasoningLevel, maxOutputTokens: 4096 },
        });
        // 通用兼容映射曾泄漏 thinking 等字段；捕获真正 transport 边界，而非只检查 JSON 文本。
        await fetch("https://fixture.invalid", {
          method: "POST",
          body: JSON.stringify({ model: modelId }),
        });
        expect(sent).toEqual(
          apiType === "openai-responses"
            ? { model: modelId, reasoning: { effort: reasoningLevel }, max_output_tokens: 4096 }
            : { model: modelId, reasoning_effort: reasoningLevel, max_completion_tokens: 4096 },
        );
      }
    });
  }
});

describe("createModelOptionMapFetch", () => {
  it.each([
    {
      name: "Anthropic Messages",
      reasoningMap:
        "reasoningLevel == 'off' ? {'thinking': {'type': 'disabled'}} : {'thinking': {'type': 'enabled'}}",
      maxMap: "{'max_tokens': maxOutputTokens}",
      expected: { thinking: { type: "enabled" }, max_tokens: 32000 },
    },
    {
      name: "OpenAI Chat Completions",
      reasoningMap: "{'reasoning_effort': reasoningLevel}",
      maxMap: "{'max_completion_tokens': maxOutputTokens}",
      expected: { reasoning_effort: "high", max_completion_tokens: 32000 },
    },
    {
      name: "OpenAI Responses",
      reasoningMap: "{'reasoning': {'effort': reasoningLevel}}",
      maxMap: "{'max_output_tokens': maxOutputTokens}",
      expected: { reasoning: { effort: "high" }, max_output_tokens: 32000 },
    },
  ])("patches the final $name raw JSON body", async ({ reasoningMap, maxMap, expected }) => {
    let sentBody: unknown;
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    });
    const capture: { body?: Record<string, unknown> } = {};
    const fetch = createModelOptionMapFetch({
      capture,
      fetch: transport,
      maps: compileModelOptionMaps({
        reasoningLevel: { map: reasoningMap },
        maxOutputTokens: { map: maxMap },
      }),
      values: { reasoningLevel: "high", maxOutputTokens: 32000 },
    });

    await fetch("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "example", untouched: true }),
    });

    expect(sentBody).toEqual({ model: "example", untouched: true, ...expected });
    expect(capture.body).toEqual(sentBody);
  });

  it.each([256, 20_000, 64_000])(
    "preserves the final request budget %s without subtracting thinking",
    async (budget) => {
      const send = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}"),
      );
      const fetch = createModelOptionMapFetch({
        fetch: send,
        maps: compileModelOptionMaps({
          reasoningLevel: { map: "{}" },
          maxOutputTokens: { map: "{'max_tokens': maxOutputTokens}" },
        }),
        values: { reasoningLevel: "high", maxOutputTokens: budget },
      });
      await fetch("https://example.com", {
        method: "POST",
        body: JSON.stringify({ max_tokens: 1, thinking: { type: "enabled", budget_tokens: 8000 } }),
      });
      expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toEqual({
        max_tokens: budget,
        thinking: { type: "enabled", budget_tokens: 8000 },
      });
    },
  );

  it("does not mutate or reuse a previous request body", async () => {
    const bodies: unknown[] = [];
    const fetch = createModelOptionMapFetch({
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response("{}");
      },
      maps: compileModelOptionMaps({
        reasoningLevel: { map: "{}" },
        maxOutputTokens: { map: "{'max_tokens': maxOutputTokens}" },
      }),
      values: { reasoningLevel: "disabled", maxOutputTokens: 7 },
    });

    await fetch("https://example.com", { method: "POST", body: '{"model":"a"}' });
    await fetch("https://example.com", { method: "POST", body: '{"model":"b"}' });

    expect(bodies).toEqual([
      { model: "a", max_tokens: 7 },
      { model: "b", max_tokens: 7 },
    ]);
  });

  it("makes the option map authoritative over SDK-produced option fields", async () => {
    let sentBody: unknown;
    const fetch = createModelOptionMapFetch({
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body));
        return new Response("{}");
      },
      maps: compileModelOptionMaps({
        reasoningLevel: { map: "{'reasoning_effort': reasoningLevel}" },
        maxOutputTokens: { map: "{'max_completion_tokens': maxOutputTokens}" },
      }),
      values: { reasoningLevel: "low", maxOutputTokens: 32000 },
    });

    await fetch("https://example.com", {
      method: "POST",
      body: JSON.stringify({
        model: "example",
        reasoning_effort: "high",
        max_completion_tokens: 1,
      }),
    });

    expect(sentBody).toEqual({
      model: "example",
      reasoning_effort: "low",
      max_completion_tokens: 32000,
    });
  });

  it("fails closed when a model request body is not JSON text", async () => {
    const transport = vi.fn(async () => new Response("{}"));
    const fetch = createModelOptionMapFetch({
      fetch: transport,
      maps: compileModelOptionMaps({
        reasoningLevel: { map: "{}" },
        maxOutputTokens: { map: "{'max_tokens': maxOutputTokens}" },
      }),
      values: { reasoningLevel: "disabled", maxOutputTokens: 7 },
    });

    await expect(
      fetch("https://example.com", {
        method: "POST",
        body: new Uint8Array([123, 125]),
      }),
    ).rejects.toThrow("JSON text request body");
    expect(transport).not.toHaveBeenCalled();
  });
});
