// Generated from client/ by npm run build. Edit the source modules.
window.__ModuleLoader__.load({id:'dsh-lfm',factory(require){
const module={exports:{}};const exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/main.jsx
var main_exports = {};
__export(main_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(main_exports);

// client/ReasoningModes.jsx
var import_react = __toESM(require("react"), 1);

// lib/reasoning.js
var defaultSampling = Object.freeze({
  temperature: 0.1,
  top_p: 1,
  top_k: 50,
  min_p: 0,
  repeat_penalty: 1.1
});
var mathSampling = Object.freeze({
  temperature: 1,
  top_p: 0.95,
  top_k: 20,
  min_p: 0,
  repeat_penalty: 1
});
function thinkingSampling(profile) {
  if (profile.vision) return profile.sampling;
  const modes = profile.reasoningModes;
  const creative = modes.find((m) => m.id === "mode-math")?.sampling ?? mathSampling;
  const rigid = modes.find((m) => m.id === "mode-code")?.sampling ?? defaultSampling;
  const midpoint = {};
  for (const key of Object.keys(defaultSampling)) {
    const mean = (Number(creative[key]) + Number(rigid[key])) / 2;
    midpoint[key] = key === "top_k" ? Math.round(mean) : Number(mean.toPrecision(15));
  }
  return midpoint;
}
function reasoningOptions(profile) {
  return [
    { id: "on", name: "Thinking" },
    { id: "off", name: "Off" },
    ...profile.reasoningModes.map(({ id, name }) => ({ id, name }))
  ];
}
function defaultEffort(profile) {
  return profile.defaultMode || (profile.thinking ? "on" : "off");
}

// client/ReasoningModes.jsx
var controls = [
  ["temperature", "Temperature", 0, 5],
  ["top_p", "Top p", 1e-6, 1],
  ["top_k", "Top k", 0, 128e3],
  ["min_p", "Min p", 0, 1],
  ["repeat_penalty", "Repeat penalty", 1e-6, 5]
];
function ReasoningModes({ draft, setDraft, busy }) {
  const [editing, setEditing] = (0, import_react.useState)("");
  const modes = draft.reasoningModes;
  const mode = modes.find((m) => m.id === editing);
  const midpoint = !draft.vision && thinkingSampling(draft);
  function edit(patch) {
    setDraft((p) => ({
      ...p,
      reasoningModes: p.reasoningModes.map(
        (m) => m.id === editing ? { ...m, ...patch } : m
      )
    }));
  }
  function add() {
    const bytes = new Uint32Array(4);
    window.crypto.getRandomValues(bytes);
    const id = "mode-" + Array.from(bytes, (n) => n.toString(16).padStart(8, "0")).join("");
    setDraft((p) => ({
      ...p,
      reasoningModes: [
        ...p.reasoningModes,
        {
          id,
          name: "",
          thinking: p.thinking,
          sampling: { ...p.sampling },
          maxTokens: p.maxTokens
        }
      ]
    }));
    setEditing(id);
  }
  function remove() {
    setDraft((p) => ({
      ...p,
      defaultMode: p.defaultMode === editing ? void 0 : p.defaultMode,
      reasoningModes: p.reasoningModes.filter((m) => m.id !== editing)
    }));
    setEditing("");
  }
  return /* @__PURE__ */ import_react.default.createElement("section", { "aria-label": "Reasoning modes" }, /* @__PURE__ */ import_react.default.createElement("h4", null, "Reasoning modes"), /* @__PURE__ */ import_react.default.createElement("label", { className: "lfm-field" }, "Default reasoning mode", /* @__PURE__ */ import_react.default.createElement(
    "select",
    {
      value: defaultEffort(draft),
      onChange: (e) => {
        const id = e.target.value;
        setDraft((p) => ({
          ...p,
          defaultMode: id.startsWith("mode-") ? id : void 0,
          thinking: id === "off" ? false : id === "on" ? true : p.thinking
        }));
      }
    },
    reasoningOptions(draft).map((option) => /* @__PURE__ */ import_react.default.createElement("option", { key: option.id, value: option.id }, option.name || "New mode"))
  )), midpoint && /* @__PURE__ */ import_react.default.createElement("p", null, "Thinking uses the midpoint of the Creative and Rigid presets.", " ", controls.map(([key, label]) => label + " " + midpoint[key]).join(" \xB7 ")), /* @__PURE__ */ import_react.default.createElement("div", { className: "lfm-actions" }, modes.map((m) => /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      key: m.id,
      type: "button",
      "aria-pressed": editing === m.id,
      onClick: () => setEditing(m.id)
    },
    m.name || "New mode"
  )), /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      type: "button",
      onClick: add,
      disabled: modes.some((m) => !m.name.trim())
    },
    "Add reasoning mode"
  )), mode && /* @__PURE__ */ import_react.default.createElement("fieldset", null, /* @__PURE__ */ import_react.default.createElement("legend", null, "Chat reasoning option"), /* @__PURE__ */ import_react.default.createElement("label", { className: "lfm-field" }, "Mode name", /* @__PURE__ */ import_react.default.createElement(
    "input",
    {
      required: true,
      maxLength: 100,
      placeholder: "Name shown in chat",
      value: mode.name,
      onChange: (e) => edit({ name: e.target.value })
    }
  )), /* @__PURE__ */ import_react.default.createElement("label", { className: "lfm-check" }, /* @__PURE__ */ import_react.default.createElement(
    "input",
    {
      type: "checkbox",
      checked: mode.thinking,
      onChange: (e) => edit({ thinking: e.target.checked })
    }
  ), "Enable thinking"), /* @__PURE__ */ import_react.default.createElement("div", { className: "lfm-grid" }, controls.map(([key, label, min, max]) => /* @__PURE__ */ import_react.default.createElement("label", { key, className: "lfm-field" }, label, /* @__PURE__ */ import_react.default.createElement(
    "input",
    {
      type: "number",
      required: true,
      min,
      max,
      step: key === "top_k" ? 1 : "any",
      value: mode.sampling[key],
      onChange: (e) => edit({
        sampling: {
          ...mode.sampling,
          [key]: e.target.value === "" ? "" : Number(e.target.value)
        }
      })
    }
  ))), /* @__PURE__ */ import_react.default.createElement("label", { className: "lfm-field" }, "Maximum output tokens", /* @__PURE__ */ import_react.default.createElement(
    "input",
    {
      type: "number",
      required: true,
      min: 1,
      max: draft.context,
      step: 1,
      value: mode.maxTokens,
      onChange: (e) => edit({
        maxTokens: e.target.value === "" ? "" : Number(e.target.value)
      })
    }
  ))), /* @__PURE__ */ import_react.default.createElement("div", { className: "lfm-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { type: "submit", disabled: busy }, "Save reasoning mode"), /* @__PURE__ */ import_react.default.createElement("button", { type: "button", onClick: remove }, "Remove mode"))));
}

// client/ProfileTransfer.jsx
var import_react2 = __toESM(require("react"), 1);
function ImportConfig({ run, busy }) {
  const [file, setFile] = (0, import_react2.useState)(null);
  const [root, setRoot] = (0, import_react2.useState)("");
  const [error, setError] = (0, import_react2.useState)("");
  const [reading, setReading] = (0, import_react2.useState)(false);
  async function submit(event) {
    event.preventDefault();
    setError("");
    setReading(true);
    try {
      if (!file || file.size > 1024 * 1024)
        throw Error("Choose a config JSON file smaller than 1 MiB.");
      const config = JSON.parse(await file.text());
      await run("import-config", { config, root: root.trim() });
    } catch (error2) {
      setError(
        error2 instanceof SyntaxError ? "This file does not contain valid JSON." : error2.message
      );
    } finally {
      setReading(false);
    }
  }
  return /* @__PURE__ */ import_react2.default.createElement("details", null, /* @__PURE__ */ import_react2.default.createElement("summary", null, "Import config"), /* @__PURE__ */ import_react2.default.createElement("form", { onSubmit: submit }, /* @__PURE__ */ import_react2.default.createElement("fieldset", { disabled: busy || reading }, /* @__PURE__ */ import_react2.default.createElement("label", null, "Profile JSON", " ", /* @__PURE__ */ import_react2.default.createElement(
    "input",
    {
      required: true,
      type: "file",
      accept: ".json,application/json",
      onChange: (e) => setFile(e.target.files[0])
    }
  )), /* @__PURE__ */ import_react2.default.createElement("label", null, "Model folder on the DSH computer", " ", /* @__PURE__ */ import_react2.default.createElement(
    "input",
    {
      required: true,
      value: root,
      placeholder: "/path/to/models",
      onChange: (e) => setRoot(e.target.value)
    }
  )), /* @__PURE__ */ import_react2.default.createElement("button", { disabled: !file || !root.trim(), type: "submit" }, "Find files and import profile"))), error && /* @__PURE__ */ import_react2.default.createElement("p", { role: "alert" }, error));
}
function DownloadConfig({ config }) {
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(config, null, 2) + "\n"], {
        type: "application/json"
      })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = (config.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "profile") + ".dsh-model.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  return /* @__PURE__ */ import_react2.default.createElement("button", { type: "button", onClick: download }, "Download config JSON");
}

// client/EngineHeader.jsx
var import_react3 = __toESM(require("react"), 1);

// client/engine-panel.css
var engine_panel_default = '.dsh-engine-panel[class] {\n  box-sizing: border-box;\n  margin-top: 16px;\n  padding: 18px;\n  min-width: 0;\n  border: 1px solid var(--dsw-alias-border-l3, currentColor);\n  border-radius: 12px;\n  background: var(--dsw-alias-settings-card-fill, transparent);\n  color: var(--dsw-alias-label-primary, inherit);\n  font: inherit;\n}\n.dsh-engine-panel .dsh-engine-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: 12px;\n  padding-bottom: 12px;\n  margin-bottom: 14px;\n  border-bottom: 1px solid var(--dsw-alias-border-l3, currentColor);\n}\n.dsh-engine-header h3 {\n  margin: 0;\n  font-size: 1.1rem;\n  font-weight: 650;\n}\n.dsh-engine-panel .dsh-engine-header h3 small {\n  display: inline;\n  font-size: 0.8rem;\n  font-weight: 400;\n  color: var(--dsw-alias-label-secondary, inherit);\n}\n.dsh-engine-status {\n  margin-top: 4px;\n  font-size: 0.875rem;\n  color: var(--dsw-alias-label-secondary, inherit);\n}\n.dsh-engine-panel[class] button,\n.dsh-engine-panel[class] select,\n.dsh-engine-panel[class]\n  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]) {\n  border-radius: 7px;\n  padding: 7px 10px;\n  font: inherit;\n  border: 1px solid var(--dsw-alias-border-l3, currentColor);\n}\n.dsh-engine-panel button:focus-visible,\n.dsh-engine-panel input:focus-visible,\n.dsh-engine-panel select:focus-visible {\n  outline: 2px solid currentColor;\n  outline-offset: 2px;\n}\n/* First model */\n.dsh-engine-panel .dsh-engine-guide {\n  margin: 0 0 12px;\n}\n.dsh-engine-guide summary {\n  cursor: pointer;\n}\n.dsh-engine-guide li {\n  margin: 5px 0;\n}\n';

// package.json
var package_default = {
  name: "dsh-lfm",
  version: "0.1.5",
  description: "Local LFM3-1.7B and LFM3-VL-2B models for DeepSeek Harness.",
  type: "module",
  license: "MIT",
  engines: {
    node: ">=24.9.0",
    dsh: "0.2.2-rc.4"
  },
  exports: {
    ".": "./index.js",
    "./client": "./client.js"
  },
  files: [
    "index.js",
    "client.js",
    "lib",
    "cordis.patch.yml",
    "README.md",
    "LICENSE",
    "docs",
    "COMPATIBILITY.md"
  ],
  scripts: {
    test: "node --test test/*.test.js",
    check: "node --check index.js && node --check client.js && node --check lib/runtime.js",
    build: "node build.mjs"
  },
  peerDependencies: {
    "@deepseek-ai/cordis": "~4.1.0",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.4",
    "@deepseek-ai/dsh-llm-pi-ai": "0.2.2-rc.4",
    "@deepseek-ai/schemastery": "~3.19.0",
    "@earendil-works/pi-ai": "1.3.0"
  },
  dsh: {
    bundle: {
      patch: "./cordis.patch.yml"
    },
    client: {
      platform: "web",
      immediately: true,
      inject: [
        "@deepseek-ai/dsh-client-ui-settings-models"
      ]
    }
  },
  devDependencies: {
    "@deepseek-ai/cordis": "~4.1.0",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.4",
    "@deepseek-ai/dsh-llm-pi-ai": "0.2.2-rc.4",
    "@deepseek-ai/schemastery": "~3.19.0",
    "@earendil-works/pi-ai": "1.3.0",
    react: "19.2.0",
    "react-dom": "19.2.0",
    jsdom: "26.1.0",
    esbuild: "0.28.2"
  },
  repository: {
    type: "git",
    url: "git+https://github.com/averyjohnkucan-arch/dsh-lfm.git"
  }
};

// client/first-run.json
var first_run_default = [
  "Choose Select model file and open an LFM3 GGUF.",
  "For vision, select the matching projector if prompted.",
  "Once the profile loads, select it in chat."
];

// client/EngineHeader.jsx
function EngineHeader({ name, status, children }) {
  return /* @__PURE__ */ import_react3.default.createElement(import_react3.default.Fragment, null, /* @__PURE__ */ import_react3.default.createElement("header", { className: "dsh-engine-header" }, /* @__PURE__ */ import_react3.default.createElement("style", null, engine_panel_default), /* @__PURE__ */ import_react3.default.createElement("div", null, /* @__PURE__ */ import_react3.default.createElement("h3", null, name, " ", /* @__PURE__ */ import_react3.default.createElement("small", null, package_default.version)), /* @__PURE__ */ import_react3.default.createElement("div", { className: "dsh-engine-status" }, status)), children), /* @__PURE__ */ import_react3.default.createElement("details", { className: "dsh-engine-guide" }, /* @__PURE__ */ import_react3.default.createElement("summary", null, "Set up your first model"), /* @__PURE__ */ import_react3.default.createElement("ol", null, first_run_default.map((step) => /* @__PURE__ */ import_react3.default.createElement("li", { key: step }, step)))));
}

// client/main.jsx
var import_react4 = __toESM(require("react"), 1);
var h = import_react4.default.createElement;
var { useState: useState3, useEffect, useRef } = import_react4.default;
var cacheTypes = [
  "f16",
  "bf16",
  "f32",
  "q8_0",
  "q5_0",
  "q5_1",
  "q4_0",
  "q4_1",
  "iq4_nl"
];
var labels = {
  f16: "FP16",
  bf16: "BF16",
  f32: "FP32",
  q8_0: "Q8_0",
  q5_0: "Q5_0",
  q5_1: "Q5_1",
  q4_0: "Q4_0",
  q4_1: "Q4_1",
  iq4_nl: "IQ4_NL"
};
var button = (text, onClick, disabled = false) => h("button", { type: "button", onClick, disabled }, text);
var rates = (value) => value && h(
  "div",
  { className: "lfm-rates", role: "status" },
  h(
    "span",
    null,
    "Prefill ",
    Number.isFinite(value.prefill) ? value.prefill.toFixed(1) + " tok/s" : "measuring\u2026"
  ),
  h(
    "span",
    null,
    "Decode ",
    Number.isFinite(value.decode) ? value.decode.toFixed(1) + " tok/s" : "measuring\u2026"
  )
);
async function request(action, payload = {}) {
  const owner = window.__DSH_LFM__;
  if (!owner?.token) throw Error("Reload DSH to connect LFM settings.");
  const response = await fetch(owner.path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + owner.token
    },
    body: JSON.stringify({ action, payload })
  });
  const body = await response.json();
  if (!response.ok || body.error)
    throw Error(body.error || "LFM request failed.");
  return body.result;
}
function FilePicker({ title, start, onChoose, onCancel, run }) {
  const [path, setPath] = useState3(start || ""), [listing, setListing] = useState3(null);
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
      button("Cancel", onCancel)
    ),
    h(
      "p",
      null,
      "Choose a GGUF on the computer running DSH. Files stay where they are."
    ),
    h(
      "form",
      {
        className: "lfm-path",
        onSubmit: (e) => {
          e.preventDefault();
          open(path);
        }
      },
      h("input", {
        "aria-label": "File or folder path",
        placeholder: "Paste a file or folder path",
        value: path,
        onChange: (e) => setPath(e.target.value)
      }),
      h("button", { type: "submit" }, "Open")
    ),
    listing && h(
      "div",
      { className: "lfm-browser" },
      button("\u2191 Parent folder", () => open(listing.parent)),
      listing.entries.map(
        (entry) => h(
          "button",
          {
            type: "button",
            key: entry.path,
            onClick: () => entry.directory ? open(entry.path) : onChoose(entry.path)
          },
          (entry.directory ? "\u{1F4C1} " : "") + entry.name
        )
      ),
      !listing.entries.length && h("p", null, "No GGUF files or subfolders here."),
      listing.truncated && h(
        "p",
        null,
        "Showing the first 1,000 entries; open a subfolder or paste the full file path."
      )
    )
  );
}
function Card() {
  const [data, setData] = useState3({ profiles: [], jobs: [] });
  const [error, setError] = useState3(""), [busy, setBusy] = useState3(false);
  const [connectionError, setConnectionError] = useState3("");
  const [draft, setDraft] = useState3(null), [picker, setPicker] = useState3(null);
  const seen = useRef(/* @__PURE__ */ new Set());
  const mounted = useRef(true);
  const refresh = async () => {
    const result = await request("list");
    if (!mounted.current) return;
    setData(result);
    setConnectionError("");
    for (const job of result.jobs)
      if (!seen.current.has(job.id) && ["complete", "failed", "cancelled"].includes(job.status)) {
        seen.current.add(job.id);
        if (job.result?.needsProjector) setDraft(job.result.profile);
      }
  };
  useEffect(() => {
    mounted.current = true;
    const poll = () => refresh().catch((e) => {
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
      return void 0;
    } finally {
      setBusy(false);
    }
  }
  const action = (name, payload) => run(() => request(name, payload));
  const update = (key, value) => setDraft((p) => ({ ...p, [key]: value }));
  const field = (label, control) => h("label", { key: label, className: "lfm-field" }, label, control);
  const numeric = (label, key, min, max) => field(
    label,
    h("input", {
      type: "number",
      "aria-label": label,
      required: true,
      min,
      max,
      value: draft[key],
      onChange: (e) => update(key, Number(e.target.value))
    })
  );
  const checkbox = (label, key) => h(
    "label",
    { className: "lfm-check" },
    h("input", {
      type: "checkbox",
      checked: draft[key],
      onChange: (e) => update(key, e.target.checked)
    }),
    label
  );
  const select = (label, key, values) => field(
    label,
    h(
      "select",
      {
        "aria-label": label,
        value: draft[key],
        onChange: (e) => update(key, e.target.value)
      },
      values.map(
        ([value, text]) => h("option", { key: value, value }, text)
      )
    )
  );
  async function save(nextAction) {
    await run(async () => {
      const saved = await request("save", draft);
      if (nextAction) await request(nextAction, { id: saved.id });
      setDraft(null);
      return saved;
    });
  }
  const jobPending = data.jobs.some((job) => ["queued", "running"].includes(job.status));
  const latest = data.jobs.find((j) => j.status === "running") || data.jobs.at(-1);
  const installing = data.jobs.some(
    (j) => j.kind === "Install LFM runtime" && ["running", "queued"].includes(j.status)
  );
  let contents;
  if (picker)
    contents = h(FilePicker, {
      title: picker === "model" ? "Choose LFM model" : "Choose vision projector",
      start: picker === "projector" ? draft.modelPath.replace(/[^/\\]+$/, "") : "",
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
      }
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
        }
      },
      h(
        "div",
        { className: "lfm-toolbar" },
        h("h3", null, draft.model),
        button("Back", () => setDraft(null))
      ),
      field(
        "Model name",
        h("input", {
          "aria-label": "Model name",
          required: true,
          value: draft.name,
          onChange: (e) => update("name", e.target.value)
        })
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
                reasoningModes: p.reasoningModes.map((m) => ({ ...m, maxTokens: Math.min(context, m.maxTokens) }))
              }));
            }
          },
          contexts.map(
            (n) => h(
              "option",
              { key: n, value: n },
              n === draft.nativeContext ? `Native (${n.toLocaleString()} tokens)` : n.toLocaleString() + " tokens"
            )
          )
        )
      ),
      h(
        "div",
        { className: "lfm-grid" },
        select(
          "K cache precision",
          "kvK",
          cacheTypes.map((v) => [v, labels[v]])
        ),
        select(
          "V cache precision",
          "kvV",
          cacheTypes.map((v) => [v, labels[v]])
        )
      ),
      h(ReasoningModes, { key: draft.id, draft, setDraft, busy }),
      draft.vision && h(
        "section",
        { className: "lfm-projector" },
        h("strong", null, "Vision projector"),
        h(
          "p",
          { className: "lfm-file" },
          draft.projectorPath || "Required \u2014 select the LFM3-VL-2B mmproj GGUF."
        ),
        button(
          draft.projectorPath ? "Change projector" : "Select projector",
          () => setPicker("projector")
        )
      ),
      h(
        "details",
        null,
        h("summary", null, "Advanced"),
        checkbox("Fit GPU memory automatically", "autoFit"),
        h(
          "p",
          null,
          "Native memory fitting preserves your selected context and KV precision. Benchmark measures the result; it does not search tuning presets."
        ),
        h(
          "div",
          { className: "lfm-grid" },
          !draft.autoFit && numeric("GPU layers (0 = CPU)", "gpuLayers", 0, 999),
          numeric("GPU index", "gpu", 0, 64),
          numeric("CPU threads", "threads", 1, 256),
          numeric("Batch size", "batch", 1, 32768),
          numeric("Microbatch size", "ubatch", 1, draft.batch),
          numeric("Maximum output tokens", "maxTokens", 1, draft.context),
          numeric("Local port", "port", 1024, 65535)
        ),
        h("h4", null, draft.vision ? "Sampling" : "Sampling for Off and new modes"),
        h(
          "div",
          { className: "lfm-grid" },
          Object.entries(draft.sampling).map(
            ([key, value]) => field(
              key.replaceAll("_", " "),
              h("input", {
                key,
                type: "number",
                step: key === "top_k" ? 1 : 0.01,
                required: true,
                value,
                "aria-label": key,
                onChange: (e) => setDraft((p) => ({
                  ...p,
                  sampling: {
                    ...p.sampling,
                    [key]: Number(e.target.value)
                  }
                }))
              })
            )
          )
        ),
        button(
          "Restore Liquid sampling defaults",
          () => update("sampling", {
            temperature: 0.1,
            top_p: 1,
            top_k: 50,
            min_p: 0,
            repeat_penalty: 1.1
          })
        ),
        field(
          "Custom llama-server executable",
          h("input", {
            "aria-label": "Custom llama-server executable",
            placeholder: "Use the downloaded runtime",
            value: draft.executable,
            onChange: (e) => update("executable", e.target.value)
          })
        ),
        button(
          "Remove profile",
          async () => {
            if (await action("remove", { id: draft.id })) setDraft(null);
          },
          busy
        )
      ),
      h(
        "div",
        { className: "lfm-actions" },
        h("button", { type: "submit", disabled: busy }, "Save"),
        button(
          "Save and load",
          () => save("start"),
          busy || draft.vision && !draft.projectorPath
        ),
        button(
          "Save and benchmark",
          () => save("benchmark"),
          busy || draft.vision && !draft.projectorPath
        )
      ),
      draft.benchmark && rates(draft.benchmark)
    );
  } else
    contents = h(
      "div",
      null,
      !data.profiles.length && h(
        "p",
        null,
        "Select an LFM3-1.7B or LFM3-VL-2B GGUF. Any weight quantization supported by llama.cpp can be used."
      ),
      data.profiles.map(
        (p) => h(
          "section",
          { key: p.id, className: "lfm-model" },
          h(
            "div",
            null,
            h("strong", null, p.name),
            h(
              "small",
              null,
              `${p.vision ? "Vision" : "Text"} \xB7 ${p.context.toLocaleString()} context \xB7 ${p.status}`
            ),
            p.vision && !p.projectorPath && h(
              "small",
              { className: "lfm-warning" },
              "Vision projector required"
            )
          ),
          h(
            "div",
            { className: "lfm-actions" },
            button("Settings", () => setDraft(structuredClone(p))),
            button(
              "Export config",
              () => action("export-config", { id: p.id }),
              busy || jobPending
            ),
            button(
              p.status === "running" ? "Unload" : "Load",
              () => action(p.status === "running" ? "stop" : "start", {
                id: p.id
              }),
              busy || p.status === "loading" || !!p.active || p.vision && !p.projectorPath
            )
          ),
          p.benchmark && rates(p.benchmark)
        )
      )
    );
  return h(
    "section",
    { className: "lfm-card dsh-engine-panel", "aria-label": "LFM local models" },
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
        `
    ),
    h(
      EngineHeader,
      { name: "LFM", status: "LFM3-1.7B \xB7 LFM3-VL-2B" },
      !draft && !picker && button("Select model file", () => setPicker("model"), busy)
    ),
    (error || connectionError) && h(
      "p",
      { role: "alert", className: "lfm-error" },
      error || connectionError
    ),
    !draft && !picker && h(ImportConfig, { run: action, busy: busy || jobPending }),
    contents,
    latest && h(
      "section",
      { className: "lfm-job", "aria-label": "LFM activity" },
      h("strong", null, latest.kind + " \xB7 " + latest.status),
      h("p", { role: "status" }, latest.progress),
      latest.kind === "Export config" && latest.status === "complete" && h(DownloadConfig, { config: latest.result }),
      rates(latest.metrics),
      latest.result?.prefill !== void 0 && !latest.metrics && rates(latest.result),
      ["queued", "running"].includes(latest.status) && button(
        "Cancel task",
        () => action("cancel", { id: latest.id }),
        busy
      ),
      latest.status === "failed" && latest.kind === "Install LFM runtime" && button(
        "Retry runtime installation",
        () => action("installEngine"),
        busy || installing
      ),
      latest.log && h(
        "details",
        null,
        h("summary", null, "Task log"),
        h("pre", null, latest.log)
      )
    )
  );
}
var plugin = {
  inject: ["slots"],
  apply(ctx) {
    ctx.slots.inject(
      "settings.models.footer",
      () => ctx.slots.register(
        { name: "settings.models.footer", id: "dsh-lfm", order: 35 },
        Card
      )
    );
  }
};
var { inject, apply } = plugin;

return module.exports;
}});
