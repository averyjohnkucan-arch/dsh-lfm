import {
  LlmAdapter,
  LlmError,
  resolveRetryPolicy,
  resolveImageAttachmentAccess,
} from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { applySampling } from "./profiles.js";

function waitForTurn(prior, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal?.removeEventListener("abort", abort);
      reject(signal.reason || Error("Cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    prior.then(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, reject);
  });
}

export class LfmAdapter extends LlmAdapter {
  constructor(ctx, runtime) {
    super();
    this.ctx = ctx;
    this.runtime = runtime;
  }
  providerInfo() {
    return { id: "lfm", name: "LFM" };
  }
  profile(id) {
    const p = this.runtime.profiles.find((p) => p.id === id && p.enabled);
    if (!p) throw new LlmError("LFM model not found.", "UNKNOWN_MODEL");
    return structuredClone(p);
  }
  async listModels() {
    return this.runtime.profiles
      .filter((p) => p.enabled)
      .map((p) => ({
        provider: "lfm",
        id: p.id,
        name: p.name,
        inputModalities: p.vision ? ["text", "image"] : ["text"],
      }));
  }
  imageRequestTarget(provider, id, image) {
    return this.delegate(this.profile(id)).imageRequestTarget(
      provider,
      id,
      image,
    );
  }
  delegate(p) {
    const api = openAICompletionsApi();
    const wrap =
      (method) =>
      (model, context, options = {}) =>
        api[method](model, context, {
          ...options,
          onPayload: async (payload, target) => {
            const body =
              (await options.onPayload?.(payload, target)) ?? payload;
            applySampling(body, p);
            return body;
          },
        });
    const model = {
      id: p.id,
      name: p.name,
      api: "openai-completions",
      provider: "lfm",
      baseUrl: `http://127.0.0.1:${p.port}/v1`,
      reasoning: true,
      input: p.vision ? ["text", "image"] : ["text"],
      contextWindow: p.context,
      maxTokens: p.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsReasoningEffort: false,
        supportsDeveloperRole: false,
        supportsStore: false,
      },
    };
    const provider = createProvider({
      id: "lfm",
      name: "LFM",
      baseUrl: model.baseUrl,
      auth: {
        apiKey: { name: "Local LFM", resolve: async () => ({ auth: {} }) },
      },
      models: [model],
      api: {
        ...api,
        stream: wrap("stream"),
        streamSimple: wrap("streamSimple"),
      },
    });
    const profiles = new Map([
      [
        "lfm",
        {
          provider: "lfm",
          displayName: "LFM",
          piProvider: provider,
          modelErrors: new Map(),
          configuredMaxTokens: new Map(),
          streamIdleTimeoutMs: 900000,
          maxRequestImageBytes: 20 * 1024 * 1024,
          requestImagePixelBudget: 4 * 1024 * 1024,
          requestImageMaxBytes: 1024 * 1024,
          retryPolicy: resolveRetryPolicy(),
          headers: {},
        },
      ],
    ]);
    return new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: async () =>
        this.runtime.running.get(p.id)?.apiKey || "dsh-local",
      auth: {
        credentials: {
          read: async () => undefined,
          list: async () => [],
          modify: async () => {
            throw Error("Local LFM has no external credentials.");
          },
          delete: async () => {},
        },
        authContext: {
          env: async () => undefined,
          fileExists: async () => false,
        },
      },
      resolveAttachments: () => this.ctx.get?.("attachments"),
      resolveImageAccess: (attachments, ref) =>
        resolveImageAttachmentAccess(
          attachments,
          (path) => this.ctx.get?.("fs")?.processPathFromHostPath(path),
          ref,
        ),
    });
  }
  async resolveModel(provider, id, signal) {
    const p = this.profile(id);
    return {
      ...(await this.delegate(p).resolveModel(provider, id, signal)),
      reasoning: {
        efforts: [
          { id: "on", name: "Thinking" },
          { id: "off", name: "Direct" },
        ],
        defaultEffort: p.thinking ? "on" : "off",
      },
    };
  }
  async prepareCall(provider, id, signal) {
    const p = this.profile(id),
      adapter = this;
    return {
      model: await this.resolveModel(provider, id, signal),
      async *stream(options) {
        if (
          options.reasoningEffort &&
          !["on", "off"].includes(options.reasoningEffort)
        )
          throw new LlmError(
            "LFM supports Thinking or Direct, not numeric effort levels.",
            "UNSUPPORTED_REASONING_EFFORT",
          );
        const selected = {
          ...p,
          thinking: options.reasoningEffort
            ? options.reasoningEffort === "on"
            : p.thinking,
        };
        const lease = await adapter.runtime.acquire(p, options.signal);
        const state = lease.state;
        if (state.benchmarking) {
          lease.release();
          throw new LlmError(
            "Wait for the LFM benchmark to finish.",
            "MODEL_BUSY",
          );
        }
        const prior = state.gate;
        let releaseGate;
        const own = new Promise((resolve) => {
          releaseGate = resolve;
        });
        state.gate = prior.then(() => own);
        state.active++;
        try {
          await waitForTurn(prior, lease.signal);
          const call = await adapter
            .delegate(selected)
            .prepareCall(provider, id, lease.signal);
          yield* call.stream({
            ...options,
            reasoningEffort: undefined,
            signal: lease.signal,
          });
        } finally {
          state.active--;
          releaseGate();
          lease.release();
          adapter.runtime.changed();
        }
      },
    };
  }
  async *stream(options) {
    yield* (
      await this.prepareCall(options.provider, options.model, options.signal)
    ).stream(options);
  }
}
