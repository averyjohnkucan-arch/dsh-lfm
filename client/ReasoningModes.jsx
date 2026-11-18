import React, { useState } from "react";
import {
  defaultEffort,
  reasoningOptions,
  thinkingSampling,
} from "../lib/reasoning.js";

const controls = [
  ["temperature", "Temperature", 0, 5],
  ["top_p", "Top p", 0.000001, 1],
  ["top_k", "Top k", 0, 128000],
  ["min_p", "Min p", 0, 1],
  ["repeat_penalty", "Repeat penalty", 0.000001, 5],
];

export function ReasoningModes({ draft, setDraft, busy }) {
  const [editing, setEditing] = useState("");
  const modes = draft.reasoningModes;
  const mode = modes.find((m) => m.id === editing);
  const midpoint = !draft.vision && thinkingSampling(draft);
  function edit(patch) {
    setDraft((p) => ({
      ...p,
      reasoningModes: p.reasoningModes.map((m) =>
        m.id === editing ? { ...m, ...patch } : m,
      ),
    }));
  }
  function add() {
    const bytes = new Uint32Array(4);
    window.crypto.getRandomValues(bytes);
    const id =
      "mode-" +
      Array.from(bytes, (n) => n.toString(16).padStart(8, "0")).join("");
    setDraft((p) => ({
      ...p,
      reasoningModes: [
        ...p.reasoningModes,
        {
          id,
          name: "",
          thinking: p.thinking,
          sampling: { ...p.sampling },
          maxTokens: p.maxTokens,
        },
      ],
    }));
    setEditing(id);
  }
  function remove() {
    setDraft((p) => ({
      ...p,
      defaultMode: p.defaultMode === editing ? undefined : p.defaultMode,
      reasoningModes: p.reasoningModes.filter((m) => m.id !== editing),
    }));
    setEditing("");
  }
  return (
    <section aria-label="Reasoning modes">
      <h4>Reasoning modes</h4>
      <label className="lfm-field">
        Default reasoning mode
        <select
          value={defaultEffort(draft)}
          onChange={(e) => {
            const id = e.target.value;
            setDraft((p) => ({
              ...p,
              defaultMode: id.startsWith("mode-") ? id : undefined,
              thinking: id === "off" ? false : id === "on" ? true : p.thinking,
            }));
          }}
        >
          {reasoningOptions(draft).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name || "New mode"}
            </option>
          ))}
        </select>
      </label>
      {midpoint && (
        <p>
          Thinking uses the midpoint of the Creative and Rigid presets.{" "}
          {controls
            .map(([key, label]) => label + " " + midpoint[key])
            .join(" · ")}
        </p>
      )}
      <div className="lfm-actions">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={editing === m.id}
            onClick={() => setEditing(m.id)}
          >
            {m.name || "New mode"}
          </button>
        ))}
        <button
          type="button"
          onClick={add}
          disabled={modes.some((m) => !m.name.trim())}
        >
          Add reasoning mode
        </button>
      </div>
      {mode && (
        <fieldset>
          <legend>Chat reasoning option</legend>
          <label className="lfm-field">
            Mode name
            <input
              required
              maxLength={100}
              placeholder="Name shown in chat"
              value={mode.name}
              onChange={(e) => edit({ name: e.target.value })}
            />
          </label>
          <label className="lfm-check">
            <input
              type="checkbox"
              checked={mode.thinking}
              onChange={(e) => edit({ thinking: e.target.checked })}
            />
            Enable thinking
          </label>
          <div className="lfm-grid">
            {controls.map(([key, label, min, max]) => (
              <label key={key} className="lfm-field">
                {label}
                <input
                  type="number"
                  required
                  min={min}
                  max={max}
                  step={key === "top_k" ? 1 : "any"}
                  value={mode.sampling[key]}
                  onChange={(e) =>
                    edit({
                      sampling: {
                        ...mode.sampling,
                        [key]:
                          e.target.value === "" ? "" : Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
            <label className="lfm-field">
              Maximum output tokens
              <input
                type="number"
                required
                min={1}
                max={draft.context}
                step={1}
                value={mode.maxTokens}
                onChange={(e) =>
                  edit({
                    maxTokens:
                      e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <div className="lfm-actions">
            <button type="submit" disabled={busy}>
              Save reasoning mode
            </button>
            <button type="button" onClick={remove}>
              Remove mode
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
