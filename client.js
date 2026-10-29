window.__ModuleLoader__.load({
  id: "dsh-lfm",
  factory(require) {
    const React = require("react"),
      h = React.createElement;
    const { useState, useEffect, useRef } = React;
    const cacheTypes = [
      "f16",
      "bf16",
      "f32",
      "q8_0",
      "q5_0",
      "q5_1",
      "q4_0",
      "q4_1",
      "iq4_nl",
    ];
    const labels = {
      f16: "FP16",
      bf16: "BF16",
      f32: "FP32",
      q8_0: "Q8_0",
      q5_0: "Q5_0",
      q5_1: "Q5_1",
      q4_0: "Q4_0",
      q4_1: "Q4_1",
      iq4_nl: "IQ4_NL",
    };
    const button = (text, onClick, disabled = false) =>
      h("button", { type: "button", onClick, disabled }, text);
    const rates = (value) =>
      value &&
      h(
        "div",
        { className: "lfm-rates", role: "status" },
        h(
          "span",
          null,
          "Prefill ",
          Number.isFinite(value.prefill)
            ? value.prefill.toFixed(1) + " tok/s"
            : "measuring…",
        ),
        h(
          "span",
          null,
          "Decode ",
          Number.isFinite(value.decode)
            ? value.decode.toFixed(1) + " tok/s"
            : "measuring…",
        ),
      );
    async function request(action, payload = {}) {
      const owner = window.__DSH_LFM__;
      if (!owner?.token) throw Error("Reload DSH to connect LFM settings.");
      const response = await fetch(owner.path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + owner.token,
        },
        body: JSON.stringify({ action, payload }),
      });
      const body = await response.json();
      if (!response.ok || body.error)
        throw Error(body.error || "LFM request failed.");
      return body.result;
    }

    function FilePicker({ title, start, onChoose, onCancel, run }) {
      const [path, setPath] = useState(start || ""),
        [listing, setListing] = useState(null);
      async function open(value) {
        if (/\.gguf$/i.test(value)) return onChoose(value);
        const result = await run(() => request("browse", { path: value }));
        if (result) {
          setPath(result.path);
          setListing(result);
        }
      }
      useEffect(() => {
        open(start || "");
      }, []);
      return h(
        "section",
        { "aria-label": title },
        h(
          "div",
          { className: "lfm-toolbar" },
          h("h3", null, title),
          button("Cancel", onCancel),
        ),
        h(
          "p",
          null,
          "Choose a GGUF on the computer running DSH. Files stay where they are.",
        ),
        h(
          "form",
          {
            className: "lfm-path",
            onSubmit: (e) => {
              e.preventDefault();
              open(path);
            },
          },
          h("input", {
            "aria-label": "File or folder path",
            placeholder: "Paste a file or folder path",
            value: path,
            onChange: (e) => setPath(e.target.value),
          }),
          h("button", { type: "submit" }, "Open"),
        ),
        listing &&
          h(
            "div",
            { className: "lfm-browser" },
            button("↑ Parent folder", () => open(listing.parent)),
            listing.entries.map((entry) =>
              h(
                "button",
                {
                  type: "button",
                  key: entry.path,
                  onClick: () =>
                    entry.directory ? open(entry.path) : onChoose(entry.path),
                },
                (entry.directory ? "📁 " : "") + entry.name,
              ),
            ),
            !listing.entries.length &&
              h("p", null, "No GGUF files or subfolders here."),
            listing.truncated &&
              h(
                "p",
                null,
                "Showing the first 1,000 entries; open a subfolder or paste the full file path.",
              ),
          ),
      );
    }

    function Card() {
      const [data, setData] = useState({ profiles: [], jobs: [] });
      const [error, setError] = useState(""),
        [busy, setBusy] = useState(false);
      const [connectionError, setConnectionError] = useState("");
      const [draft, setDraft] = useState(null),
        [picker, setPicker] = useState(null);
      const seen = useRef(new Set());
      const mounted = useRef(true);
      const refresh = async () => {
        const result = await request("list");
        if (!mounted.current) return;
        setData(result);
        setConnectionError("");
        for (const job of result.jobs)
          if (
            !seen.current.has(job.id) &&
            ["complete", "failed", "cancelled"].includes(job.status)
          ) {
            seen.current.add(job.id);
            if (job.result?.needsProjector) setDraft(job.result.profile);
          }
      };
      useEffect(() => {
        mounted.current = true;
        const poll = () =>
          refresh().catch((e) => {
            if (mounted.current) setConnectionError(e.message);
          });
        poll();
        const timer = setInterval(poll, 1500);
        return () => {
          mounted.current = false;
          clearInterval(timer);
        };
      }, []);
      async function run(operation) {
        setBusy(true);
        setError("");
        try {
          const result = await operation();
          await refresh();
          return result;
        } catch (e) {
          setError(e.message);
          return undefined;
        } finally {
          setBusy(false);
        }
      }
      const action = (name, payload) => run(() => request(name, payload));
      const update = (key, value) => setDraft((p) => ({ ...p, [key]: value }));
      const field = (label, control) =>
        h("label", { key: label, className: "lfm-field" }, label, control);
      const numeric = (label, key, min, max) =>
        field(
          label,
          h("input", {
            type: "number",
            "aria-label": label,
            required: true,
            min,
            max,
            value: draft[key],
            onChange: (e) => update(key, Number(e.target.value)),
          }),
        );
      const checkbox = (label, key) =>
        h(
          "label",
          { className: "lfm-check" },
          h("input", {
            type: "checkbox",
            checked: draft[key],
            onChange: (e) => update(key, e.target.checked),
          }),
          label,
        );
      const select = (label, key, values) =>
        field(
          label,
          h(
            "select",
            {
              "aria-label": label,
              value: draft[key],
              onChange: (e) => update(key, e.target.value),
            },
            values.map(([value, text]) =>
              h("option", { key: value, value }, text),
            ),
          ),
        );
      async function save(nextAction) {
        await run(async () => {
          const saved = await request("save", draft);
          if (nextAction) await request(nextAction, { id: saved.id });
          setDraft(null);
          return saved;
        });
      }
      const latest =
        data.jobs.find((j) => j.status === "running") || data.jobs.at(-1);
      const installing = data.jobs.some(
        (j) =>
          j.kind === "Install LFM runtime" &&
          ["running", "queued"].includes(j.status),
      );
      let contents;
      if (picker)
        contents = h(FilePicker, {
          title:
            picker === "model" ? "Choose LFM model" : "Choose vision projector",
          start:
            picker === "projector"
              ? draft.modelPath.replace(/[^/\\]+$/, "")
              : "",
          run,
          onCancel: () => setPicker(null),
          onChoose: async (path) => {
            if (picker === "model") {
              const job = await action("importModel", { path });
              if (job) setPicker(null);
            } else {
              update("projectorPath", path);
              setPicker(null);
            }
          },
        });
      else if (draft) {
        const contexts = [];
        for (let n = 32768; n < draft.nativeContext; n += 32768)
          contexts.push(n);
        contexts.push(draft.nativeContext);
        if (!contexts.includes(draft.context)) contexts.push(draft.context);
        contexts.sort((a, b) => a - b);
        contents = h(
          "form",
          {
            "aria-label": "LFM model settings",
            onSubmit: (e) => {
              e.preventDefault();
              save();
            },
          },
          h(
            "div",
            { className: "lfm-toolbar" },
            h("h3", null, draft.model),
            button("Back", () => setDraft(null)),
          ),
          field(
            "Model name",
            h("input", {
              "aria-label": "Model name",
              required: true,
              value: draft.name,
              onChange: (e) => update("name", e.target.value),
            }),
          ),
          h("p", { className: "lfm-file" }, draft.modelPath),
          field(
            "Context",
            h(
              "select",
              {
                "aria-label": "Context",
                value: draft.context,
                onChange: (e) => {
                  const context = Number(e.target.value);
                  setDraft((p) => ({
                    ...p,
                    context,
                    maxTokens: Math.min(context, p.maxTokens),
                  }));
                },
              },
              contexts.map((n) =>
                h(
                  "option",
                  { key: n, value: n },
                  n === draft.nativeContext
                    ? `Native (${n.toLocaleString()} tokens)`
                    : n.toLocaleString() + " tokens",
                ),
              ),
            ),
          ),
          h(
            "div",
            { className: "lfm-grid" },
            select(
              "K cache precision",
              "kvK",
              cacheTypes.map((v) => [v, labels[v]]),
            ),
            select(
              "V cache precision",
              "kvV",
              cacheTypes.map((v) => [v, labels[v]]),
            ),
          ),
          checkbox("Thinking by default", "thinking"),
          h(
            "small",
            null,
            "Direct mode requests no thinking. Liquid notes that this can be inconsistent.",
          ),
          draft.vision &&
            h(
              "section",
              { className: "lfm-projector" },
              h("strong", null, "Vision projector"),
              h(
                "p",
                { className: "lfm-file" },
                draft.projectorPath ||
                  "Required — select the LFM3-VL-2B mmproj GGUF.",
              ),
              button(
                draft.projectorPath ? "Change projector" : "Select projector",
                () => setPicker("projector"),
              ),
            ),
          h(
            "details",
            null,
            h("summary", null, "Advanced"),
            checkbox("Fit GPU memory automatically", "autoFit"),
            h(
              "p",
              null,
              "Native memory fitting preserves your selected context and KV precision. Benchmark measures the result; it does not search tuning presets.",
            ),
            h(
              "div",
              { className: "lfm-grid" },
              !draft.autoFit &&
                numeric("GPU layers (0 = CPU)", "gpuLayers", 0, 999),
              numeric("GPU index", "gpu", 0, 64),
              numeric("CPU threads", "threads", 1, 256),
              numeric("Batch size", "batch", 1, 32768),
              numeric("Microbatch size", "ubatch", 1, draft.batch),
              numeric("Maximum output tokens", "maxTokens", 1, draft.context),
              numeric("Local port", "port", 1024, 65535),
            ),
            h("h4", null, "Sampling"),
            h(
              "div",
              { className: "lfm-grid" },
              Object.entries(draft.sampling).map(([key, value]) =>
                field(
                  key.replaceAll("_", " "),
                  h("input", {
                    key,
                    type: "number",
                    step: key === "top_k" ? 1 : 0.01,
                    required: true,
                    value,
                    "aria-label": key,
                    onChange: (e) =>
                      setDraft((p) => ({
                        ...p,
                        sampling: {
                          ...p.sampling,
                          [key]: Number(e.target.value),
                        },
                      })),
                  }),
                ),
              ),
            ),
            button("Restore Liquid sampling defaults", () =>
              update("sampling", {
                temperature: 0.1,
                top_p: 1,
                top_k: 50,
                min_p: 0,
                repeat_penalty: 1.1,
              }),
            ),
            field(
              "Custom llama-server executable",
              h("input", {
                "aria-label": "Custom llama-server executable",
                placeholder: "Use the downloaded runtime",
                value: draft.executable,
                onChange: (e) => update("executable", e.target.value),
              }),
            ),
            button(
              "Remove profile",
              async () => {
                if (await action("remove", { id: draft.id })) setDraft(null);
              },
              busy,
            ),
          ),
          h(
            "div",
            { className: "lfm-actions" },
            h("button", { type: "submit", disabled: busy }, "Save"),
            button(
              "Save and load",
              () => save("start"),
              busy || (draft.vision && !draft.projectorPath),
            ),
            button(
              "Save and benchmark",
              () => save("benchmark"),
              busy || (draft.vision && !draft.projectorPath),
            ),
          ),
          draft.benchmark && rates(draft.benchmark),
        );
      } else
        contents = h(
          "div",
          null,
          !data.profiles.length &&
            h(
              "p",
              null,
              "Select an LFM3-1.7B or LFM3-VL-2B GGUF. Any weight quantization supported by llama.cpp can be used.",
            ),
          data.profiles.map((p) =>
            h(
              "section",
              { key: p.id, className: "lfm-model" },
              h(
                "div",
                null,
                h("strong", null, p.name),
                h(
                  "small",
                  null,
                  `${p.vision ? "Vision" : "Text"} · ${p.context.toLocaleString()} context · ${p.status}`,
                ),
                p.vision &&
                  !p.projectorPath &&
                  h(
                    "small",
                    { className: "lfm-warning" },
                    "Vision projector required",
                  ),
              ),
              h(
                "div",
                { className: "lfm-actions" },
                button("Settings", () => setDraft(structuredClone(p))),
                button(
                  p.status === "running" ? "Unload" : "Load",
                  () =>
                    action(p.status === "running" ? "stop" : "start", {
                      id: p.id,
                    }),
                  busy ||
                    p.status === "loading" ||
                    !!p.active ||
                    (p.vision && !p.projectorPath),
                ),
              ),
              p.benchmark && rates(p.benchmark),
            ),
          ),
        );
      return h(
        "section",
        { className: "lfm-card", "aria-label": "LFM local models" },
        h(
          "style",
          null,
          `
          .lfm-card{border:1px solid var(--dsw-alias-border-l3,#555);border-radius:16px;padding:18px;margin-top:24px;min-width:0}
          .lfm-card h3,.lfm-card h4{margin:0}.lfm-card h4{margin-top:16px}.lfm-card p{margin:10px 0}
          .lfm-toolbar,.lfm-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.lfm-toolbar{justify-content:space-between;margin-bottom:14px}
          .lfm-card button,.lfm-card input,.lfm-card select{font:inherit;border:1px solid var(--dsw-alias-border-l3,#555);border-radius:7px;padding:8px 10px;background:transparent;color:inherit;max-width:100%;box-sizing:border-box}
          .lfm-card button{cursor:pointer}.lfm-card button:disabled{opacity:.45;cursor:default}.lfm-card input,.lfm-card select{width:100%;min-width:0}
          .lfm-field{display:flex;flex-direction:column;gap:5px;margin:12px 0;min-width:0}.lfm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:0 12px}
          .lfm-check{display:flex;gap:8px;align-items:center;margin:12px 0}.lfm-check input{width:auto}.lfm-card small{display:block;opacity:.75}
          .lfm-model{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l3,#555)}
          .lfm-model strong,.lfm-file{overflow-wrap:anywhere}.lfm-rates{display:flex;gap:18px;flex-wrap:wrap;font-size:.9em;margin-top:10px;width:100%}
          .lfm-card details{margin:16px 0}.lfm-card summary{cursor:pointer}.lfm-projector{margin:16px 0;padding:12px;border:1px solid var(--dsw-alias-border-l3,#555);border-radius:8px}
          .lfm-error,.lfm-warning{color:#ed8d72}.lfm-path{display:flex;gap:8px;margin-bottom:12px}.lfm-browser{display:grid;gap:6px;max-height:300px;overflow:auto}
          .lfm-browser button{text-align:left;overflow-wrap:anywhere}.lfm-job{border-top:1px solid var(--dsw-alias-border-l3,#555);margin-top:12px;padding-top:12px;overflow-wrap:anywhere}.lfm-job pre{white-space:pre-wrap;max-height:220px;overflow:auto}
        `,
        ),
        h(
          "header",
          { className: "lfm-toolbar" },
          h(
            "div",
            null,
            h("strong", null, "LFM"),
            h("small", null, "LFM3-1.7B · LFM3-VL-2B"),
          ),
          !draft &&
            !picker &&
            button("Select model file", () => setPicker("model"), busy),
        ),
        (error || connectionError) &&
          h(
            "p",
            { role: "alert", className: "lfm-error" },
            error || connectionError,
          ),
        contents,
        latest &&
          h(
            "section",
            { className: "lfm-job", "aria-label": "LFM activity" },
            h("strong", null, latest.kind + " · " + latest.status),
            h("p", { role: "status" }, latest.progress),
            rates(latest.metrics),
            latest.result?.prefill !== undefined &&
              !latest.metrics &&
              rates(latest.result),
            ["queued", "running"].includes(latest.status) &&
              button(
                "Cancel task",
                () => action("cancel", { id: latest.id }),
                busy,
              ),
            latest.status === "failed" &&
              latest.kind === "Install LFM runtime" &&
              button(
                "Retry runtime installation",
                () => action("installEngine"),
                busy || installing,
              ),
            latest.log &&
              h(
                "details",
                null,
                h("summary", null, "Task log"),
                h("pre", null, latest.log),
              ),
          ),
      );
    }
    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("settings.models.footer", () =>
          ctx.slots.register(
            { name: "settings.models.footer", id: "dsh-lfm", order: 35 },
            Card,
          ),
        );
      },
    };
  },
});
