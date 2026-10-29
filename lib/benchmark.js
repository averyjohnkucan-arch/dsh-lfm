import { applySampling } from "./profiles.js";

/** Measure the saved configuration after native memory fitting; this is not a parameter-search tuner. */
export async function benchmark(runtime, id, signal, report) {
  const p = structuredClone(runtime.find(id));
  await runtime.unload(id);
  report(
    p.autoFit
      ? "Fitting GPU memory while preserving your context and KV settings…"
      : "Loading saved placement settings…",
  );
  const lease = await runtime.acquire(p, signal);
  const state = lease.state;
  if (state.active) {
    lease.release();
    throw Error("Wait for the active answer before benchmarking.");
  }
  state.benchmarking = true;
  state.active++;
  try {
    // A fixed uncached passage makes prefill more useful than timing a one-line question.
    const notes =
      "A bicycle transfers force from the pedals through the chain to the rear wheel. " +
      "Gears trade wheel speed for mechanical advantage. Brakes convert motion into heat. " +
      "Tires provide traction, spokes support the rims, and bearings reduce friction. " +
      "The frame supports the rider while steering and balance keep the bicycle stable. ";
    const body = {
      model: p.id,
      messages: [
        {
          role: "user",
          content:
            "Read these notes, then explain how a bicycle works in detail:\n" +
            notes.repeat(
              Math.max(1, Math.min(12, Math.floor(p.context / 512))),
            ),
        },
      ],
      max_tokens: Math.min(256, p.maxTokens, Math.floor(p.context / 2)),
      stream: true,
      timings_per_token: true,
    };
    applySampling(body, p);
    body.temperature = 0;
    body.cache_prompt = false;
    report("Measuring prefill and decode…");
    const response = await fetch(state.url + "/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + state.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw Error(
        "Benchmark failed: " + (await response.text()).slice(0, 2000),
      );
    let pending = "",
      timings,
      finished = false;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (!line.startsWith("data:") || line === "data: [DONE]") continue;
        const value = JSON.parse(line.slice(5));
        if (value.error)
          throw Error(value.error.message || "Native benchmark failed.");
        if (value.choices?.some((c) => c.finish_reason)) finished = true;
        if (value.timings) {
          timings = value.timings;
          const metrics = {};
          if (Number.isFinite(timings.prompt_per_second))
            metrics.prefill = timings.prompt_per_second;
          if (Number.isFinite(timings.predicted_per_second))
            metrics.decode = timings.predicted_per_second;
          report("Measuring prefill and decode…", metrics);
        }
      }
      if (pending.length > 1024 * 1024)
        throw Error("Invalid benchmark event stream.");
    }
    if (
      !finished ||
      !Number.isFinite(timings?.prompt_per_second) ||
      !Number.isFinite(timings?.predicted_per_second)
    )
      throw Error("Engine did not finish with native prefill/decode timings.");
    signal?.throwIfAborted();
    const result = {
      measuredAt: new Date().toISOString(),
      prefill: timings.prompt_per_second,
      decode: timings.predicted_per_second,
      promptTokens: timings.prompt_n,
      outputTokens: timings.predicted_n,
      settings: {
        model: p.model,
        modelPath: p.modelPath,
        projectorPath: p.projectorPath,
        context: p.context,
        kvK: p.kvK,
        kvV: p.kvV,
        thinking: p.thinking,
        autoFit: p.autoFit,
        gpu: p.gpu,
        ...(p.autoFit ? {} : { gpuLayers: p.gpuLayers }),
        threads: p.threads,
        batch: p.batch,
        ubatch: p.ubatch,
      },
      generation: {
        ...p.sampling,
        temperature: 0,
        maxTokens: body.max_tokens,
        cachePrompt: false,
      },
      note: "Short text benchmark; not a full-context speed or quality test.",
    };
    runtime.find(id).benchmark = result;
    await runtime.persist();
    report("Benchmark complete", {
      prefill: result.prefill,
      decode: result.decode,
    });
    return result;
  } finally {
    state.active--;
    state.benchmarking = false;
    lease.release();
    await runtime.unload(id);
  }
}
