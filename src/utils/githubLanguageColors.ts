const UNKNOWN_LANGUAGE_COLOR = "#6e7781";

const GITHUB_LANGUAGE_COLORS = {
  "c": "#555555",
  "c#": "#7355dd",
  "c++": "#f34b7d",
  "css": "#663399",
  "dockerfile": "#384d54",
  "go": "#00ADD8",
  "html": "#e34c26",
  "java": "#b07219",
  "javascript": "#f1e05a",
  "json": "#292929",
  "kotlin": "#A97BFF",
  "makefile": "#427819",
  "markdown": "#083fa1",
  "powershell": "#012456",
  "python": "#3572A5",
  "rust": "#dea584",
  "shell": "#89e051",
  "swift": "#F05138",
  "toml": "#9c4221",
  "typescript": "#3178c6",
  "vue": "#41b883",
  "yaml": "#cb171e",
} as const;

export function githubLanguageColor(language: string) {
  const normalized = language.trim().toLowerCase();
  return GITHUB_LANGUAGE_COLORS[normalized as keyof typeof GITHUB_LANGUAGE_COLORS] ?? UNKNOWN_LANGUAGE_COLOR;
}
