import React, { useState } from "react";

export function ImportConfig({ run, busy }) {
  const [file, setFile] = useState(null);
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError("");
    setReading(true);
    try {
      if (!file || file.size > 1024 * 1024)
        throw Error("Choose a config JSON file smaller than 1 MiB.");
      const config = JSON.parse(await file.text());
      await run("import-config", { config, root: root.trim() });
    } catch (error) {
      setError(
        error instanceof SyntaxError
          ? "This file does not contain valid JSON."
          : error.message,
      );
    } finally {
      setReading(false);
    }
  }
  return (
    <details>
      <summary>Import config</summary>
      <form onSubmit={submit}>
        <fieldset disabled={busy || reading}>
          <label>
            Profile JSON{" "}
            <input
              required
              type="file"
              accept=".json,application/json"
              onChange={(e) => setFile(e.target.files[0])}
            />
          </label>
          <label>
            Model folder on the DSH computer{" "}
            <input
              required
              value={root}
              placeholder="/path/to/models"
              onChange={(e) => setRoot(e.target.value)}
            />
          </label>
          <button disabled={!file || !root.trim()} type="submit">
            Find files and import profile
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

export function DownloadConfig({ config }) {
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(config, null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      (config.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) ||
        "profile") + ".dsh-model.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <button type="button" onClick={download}>
      Download config JSON
    </button>
  );
}
