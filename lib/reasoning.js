// Also used by the settings panel. IDs are stable when a label is edited.
export const defaultSampling = Object.freeze({
  temperature: 0.1,
  top_p: 1,
  top_k: 50,
  min_p: 0,
  repeat_penalty: 1.1,
});

export function starterModes(profile) {
  if (profile.vision) return [];
  return [
    {
      id: "mode-math",
      name: "Math/Sci - Creative",
      thinking: true,
      sampling: {
        temperature: 1,
        top_p: 0.95,
        top_k: 20,
        min_p: 0,
        repeat_penalty: 1,
      },
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
  if (effort === "on" || effort === "off")
    return { ...profile, thinking: effort === "on" };
  const mode = profile.reasoningModes.find((option) => option.id === effort);
  if (mode)
    return {
      ...profile,
      thinking: mode.thinking,
      sampling: mode.sampling,
      maxTokens: mode.maxTokens,
    };
}
