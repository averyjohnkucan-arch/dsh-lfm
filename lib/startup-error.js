/** Keep diagnostics before the usage manual: taking the log tail loses CLI errors. */
export function startupError(log, exitCode) {
  const plain = String(log).replace(/\x1b\[[0-9;]*m/g, "");
  const usage = plain.search(/^\s*usage:/im);
  const lines = (usage >= 0 ? plain.slice(0, usage) : plain)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const errors = lines.filter((line) =>
    /^(?:(?:llama-server|llama_model_load):|error\b|fatal\b)|\b(?:ERROR|CRITICAL|FATAL)\b/i.test(
      line,
    ),
  );
  const detail = (errors.length ? errors.slice(-3) : lines.slice(-6))
    .join("\n")
    .slice(-2000);
  return Object.assign(
    new Error(
      `Engine stopped before readiness${exitCode == null ? "" : ` (exit ${exitCode})`}.${detail ? " " + detail : ""}`,
    ),
    { exitCode },
  );
}
