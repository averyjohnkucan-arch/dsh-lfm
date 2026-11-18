import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { LfmAdapter } from "../lib/adapter.js";
import { freshProfile } from "../lib/profiles.js";

test("DSH wire preserves images/tools, applies per-turn thinking and balances leases", async (t) => {
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer local-fixture");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks)));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choice of [
      {
        index: 0,
        delta: { role: "assistant", content: "OK" },
        finish_reason: null,
      },
      { index: 0, delta: {}, finish_reason: "stop" },
    ])
      res.write(
        "data: " +
          JSON.stringify({
            id: "fixture",
            object: "chat.completion.chunk",
            model: "fixture",
            created: 1,
            choices: [choice],
          }) +
          "\n\n",
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const p = freshProfile({
    group: "Vision",
    model: "LFM3-VL-2B",
    vision: true,
    path: "/model.gguf",
    nativeContext: 128000,
  });
  p.port = server.address().port;
  p.reasoningModes = [
    {
      id: "mode-test",
      name: "Custom careful",
      thinking: false,
      maxTokens: 7,
      sampling: {
        temperature: 0.7,
        top_k: 22,
        top_p: 0.9,
        min_p: 0.08,
        repeat_penalty: 1.23,
      },
    },
  ];
  let acquired = 0,
    released = 0;
  const state = { active: 0, gate: Promise.resolve(), apiKey: "local-fixture" };
  const runtime = {
    profiles: [p],
    running: new Map([[p.id, state]]),
    changed() {},
    acquire: async (_p, signal) => {
      assert.deepEqual(_p, p); // A per-turn override must never reach GPU scheduling.
      acquired++;
      return {
        state,
        signal,
        release() {
          released++;
        },
      };
    },
  };
  const image = {
    attachmentId: "a".repeat(64),
    mediaType: "image/png",
    bytes: 3,
    width: 1,
    height: 1,
  };
  const attachments = {
    imageHostPath: () => undefined,
    readImageRequest: async () => ({
      data: Buffer.from("png"),
      mediaType: "image/png",
      bytes: 3,
      width: 1,
      height: 1,
    }),
  };
  const adapter = new LfmAdapter(
    { get: (name) => (name === "attachments" ? attachments : undefined) },
    runtime,
  );
  assert.deepEqual((await adapter.listModels())[0].inputModalities, [
    "text",
    "image",
  ]);
  assert.equal(
    (await adapter.resolveModel("lfm", p.id)).reasoning.defaultEffort,
    "on",
  );
  p.defaultMode = "mode-test";
  const info = (await adapter.resolveModel("lfm", p.id)).reasoning;
  assert.equal(info.defaultEffort, "mode-test");
  assert.deepEqual(info.efforts.at(-1), {
    id: "mode-test",
    name: "Custom careful",
  });
  for (const effort of ["off", "on", "mode-test", undefined]) {
    for await (const chunk of adapter.stream({
      provider: "lfm",
      model: p.id,
      reasoningEffort: effort,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "See this" },
            { type: "image", attachment: image },
          ],
        },
      ],
      tools: [
        {
          name: "inspect_layout",
          description: "Inspect layout",
          parameters: { type: "object", properties: {} },
        },
      ],
      maxTokens: 16,
    }))
      if (chunk.type === "finish") assert.equal(chunk.reason.kind, "stop");
  }
  assert.equal(bodies[0].chat_template_kwargs.enable_thinking, false);
  assert.equal(bodies[1].chat_template_kwargs.enable_thinking, true);
  assert.equal(bodies[0].reasoning_effort, undefined);
  assert.equal(bodies[0].temperature, 0.1);
  assert.equal(
    bodies[0].messages[0].content.find((b) => b.type === "image_url").image_url
      .url,
    "data:image/png;base64,cG5n",
  );
  assert.equal(bodies[0].tools[0].function.name, "inspect_layout");
  for (const body of bodies.slice(2)) {
    assert.equal(body.chat_template_kwargs.enable_thinking, false);
    assert.equal(body.max_tokens ?? body.max_completion_tokens, 7);
    for (const [key, value] of Object.entries(p.reasoningModes[0].sampling))
      assert.equal(body[key], value, key);
    assert.equal(body.reasoning_effort, undefined);
  }
  assert.equal(acquired, 4);
  assert.equal(released, 4);
  assert.equal(state.active, 0);
  state.benchmarking = true;
  await assert.rejects(async () => {
    for await (const _ of adapter.stream({
      provider: "lfm",
      model: p.id,
      messages: [],
    })) {
    }
  }, /benchmark/);
  assert.equal(acquired, released);
});
