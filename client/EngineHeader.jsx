import React from "react";
import styles from "./engine-panel.css";
import manifest from "../package.json";

import steps from "./first-run.json";

export function EngineHeader({ name, status, children }) {
  return (
    <>
      <header className="dsh-engine-header">
        <style>{styles}</style>
        <div>
          <h3>
            {name} <small>{manifest.version}</small>
          </h3>
          <div className="dsh-engine-status">{status}</div>
        </div>
        {children}
      </header>
      <details className="dsh-engine-guide">
        <summary>Set up your first model</summary>
        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
    </>
  );
}
