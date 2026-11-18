// Also used by the settings panel. IDs are stable when a label is edited.
export const defaultSampling = Object.freeze({
  temperature: 0.1,
  top_p: 1,
  top_k: 50,
  min_p: 0,
  repeat_penalty: 1.1,
});

const mathSampling = Object.freeze({
  temperature: 1,
  top_p: 0.95,
  top_k: 20,
  min_p: 0,
  repeat_penalty: 1,
});

// Use the stable preset IDs so renaming an endpoint preserves its role.
export function thinkingSampling(profile) {
  if (profile.vision) return profile.sampling;
  const modes = profile.reasoningModes;
  const creative =
    modes.find((m) => m.id === "mode-math")?.sampling ?? mathSampling;
  const rigid =
    modes.find((m) => m.id === "mode-code")?.sampling ?? defaultSampling;
  const midpoint = {};
  for (const key of Object.keys(defaultSampling)) {
    const mean = (Number(creative[key]) + Number(rigid[key])) / 2;
    midpoint[key] =
      key === "top_k" ? Math.round(mean) : Number(mean.toPrecision(15));
  }
  return midpoint;
}

export function starterModes(profile) {
  if (profile.vision) return [];
  return [
    {
      id: "mode-math",
      name: "Math/Sci - Creative",
      thinking: true,
      sampling: { ...mathSampling },
      maxTokens: profile.maxTokens,
    },
    {
      id: "mode-code",
      name: "Code/Tools - Rigid",
      thinking: true,
      sampling: { ...defaultSampling },
      maxTokens: profile.maxTokens,
    },
  ];
}

export function reasoningOptions(profile) {
  return [
    { id: "on", name: "Thinking" },
    { id: "off", name: "Off" },
    ...profile.reasoningModes.map(({ id, name }) => ({ id, name })),
  ];
}

export function defaultEffort(profile) {
  return profile.defaultMode || (profile.thinking ? "on" : "off");
}

export function requestProfile(profile, effort = defaultEffort(profile)) {
  if (effort === "on")
    return { ...profile, thinking: true, sampling: thinkingSampling(profile) };
  if (effort === "off") return { ...profile, thinking: false };
  const mode = profile.reasoningModes.find((option) => option.id === effort);
  if (mode)
    return {
      ...profile,
      thinking: mode.thinking,
      sampling: mode.sampling,
      maxTokens: mode.maxTokens,
    };
}
