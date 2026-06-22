const UNKNOWN_LANGUAGE_COLOR = "#9ca6b0";

const GITHUB_LANGUAGE_COLORS = {
  "c": "#a4a4a4",
  "c#": "#a292ff",
  "c++": "#ff6b91",
  "css": "#ba89f6",
  "dockerfile": "#92a9b1",
  "go": "#1db5e0",
  "html": "#ff7453",
  "java": "#d69645",
  "javascript": "#b8a700",
  "json": "#a4a4a4",
  "kotlin": "#b18bff",
  "makefile": "#7eb75c",
  "markdown": "#70a3ff",
  "powershell": "#7ea6e3",
  "python": "#6dabe1",
  "rust": "#ce9676",
  "shell": "#69be27",
  "swift": "#ff735b",
  "toml": "#e88765",
  "typescript": "#61a8fa",
  "vue": "#48be88",
  "yaml": "#ff7267",
} as const;

export function githubLanguageColor(language: string) {
  const normalized = language.trim().toLowerCase();
  return GITHUB_LANGUAGE_COLORS[normalized as keyof typeof GITHUB_LANGUAGE_COLORS] ?? UNKNOWN_LANGUAGE_COLOR;
}
