import { defineToolsProfile } from "@lilia/tools";

export default defineToolsProfile({
  packageManager: "yarn@4.17.1+sha512.ccbfabf7d7b6b32075088be9386fb9a2e00bb6887ef07fa56effabc890a56d53da1ccc4128d62db245fcbd3961b236d75335bdf7d5320ed6eafb7588b7ad4697",
  requireSingleAppRoot: true,
  expectedDependencies: [
    "@lilia/build",
    "@lilia/config",
    "@lilia/tools",
    "@lilia/ui",
  ],
  importantFiles: [
    ["src/createLiliaGithubApp.ts", "application composition root"],
    ["src/config/appShell.ts", "application shell configuration"],
    ["src/router.ts", "business route boundary"],
    ["src/agentDebug/compat.ts", "application Agent Debug compatibility adapter"],
    ["agent-debug/verify-agent-debug.mjs", "application desktop replay scenarios"],
  ],
  agentTargetFiles: {
    "src/pages/Home.vue": [["home.page"], ["home.overview.header"]],
    "src/layouts/SecondaryPanel.vue": [["sidebar.group.sort"], ["sidebar.group.create"]],
  },
  entrypoints: [
    { id: "agent-debug", command: "yarn agent:debug", purpose: "report Agent Debug readiness" },
    { id: "agent-debug-replay", command: "yarn verify:agent-debug", purpose: "run the application desktop replay" },
    { id: "verify", command: "yarn verify", purpose: "run frontend and Rust validation" },
  ],
  requiredScripts: ["agent:debug", "verify:agent-debug", "verify"],
  boundaries: {
    includes: ["GitHub workspace routes, workflows, commands, persistence, and app-owned Agent scenarios"],
    excludes: ["shared shell components, design tokens, app checks, and desktop replay orchestration"],
  },
});
