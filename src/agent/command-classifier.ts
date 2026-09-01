// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

/**
 * Classifies a shell command's risk level so the permission gate can decide
 * whether it needs confirmation under the active autonomy mode.
 */
export type CommandRisk = "safe" | "caution" | "destructive" | "critical";

const RISK_ORDER: Record<CommandRisk, number> = {
  safe: 0,
  caution: 1,
  destructive: 2,
  critical: 3,
};

interface Rule {
  pattern: RegExp;
  risk: CommandRisk;
}

// A command boundary: start of string, or preceded by a shell separator/operator.
const B = "(?:^|[\\s;&|(])";

const RULES: Rule[] = [
  // critical: system-level, irreversible, or arbitrary remote code execution
  { pattern: new RegExp(`${B}sudo\\b`), risk: "critical" },
  { pattern: new RegExp(`${B}su\\b`), risk: "critical" },
  { pattern: new RegExp(`${B}doas\\b`), risk: "critical" },
  { pattern: new RegExp(`${B}chmod\\s+(-\\w*[rR]\\w*|--recursive)`), risk: "critical" },
  { pattern: new RegExp(`${B}chown\\s+(-\\w*[rR]\\w*|--recursive)`), risk: "critical" },
  { pattern: new RegExp(`${B}mkfs(\\.\\w+)?\\b`), risk: "critical" },
  { pattern: new RegExp(`${B}dd\\s+`), risk: "critical" },
  { pattern: new RegExp(`${B}(shutdown|reboot|halt|poweroff)\\b`), risk: "critical" },
  { pattern: new RegExp(`${B}systemctl\\s+(poweroff|reboot|halt)\\b`), risk: "critical" },
  { pattern: new RegExp(`${B}(curl|wget)\\s.*\\|\\s*(sudo\\s+)?(sh|bash|zsh)\\b`), risk: "critical" }, // pipe-to-shell
  { pattern: new RegExp(`${B}(kill|pkill|killall)\\s+.*-9\\b.*\\b1\\b`), risk: "critical" },

  // destructive: deletes data or force-rewrites history
  { pattern: new RegExp(`${B}rm\\s+`), risk: "destructive" },
  { pattern: new RegExp(`${B}git\\s+reset\\s+--hard\\b`), risk: "destructive" },
  { pattern: new RegExp(`${B}git\\s+clean\\s+-[a-zA-Z]*f`), risk: "destructive" },
  { pattern: new RegExp(`${B}git\\s+push\\s+.*(--force|-f)\\b`), risk: "destructive" },
  { pattern: new RegExp(`${B}git\\s+branch\\s+-D\\b`), risk: "destructive" },
  { pattern: new RegExp(`${B}docker\\s+system\\s+prune\\b`), risk: "destructive" },
  { pattern: new RegExp(`${B}docker\\s+(rm|rmi)\\b`), risk: "destructive" },
  { pattern: new RegExp(`${B}docker\\s+volume\\s+(rm|prune)\\b`), risk: "destructive" },
  { pattern: new RegExp(`${B}truncate\\s+`), risk: "destructive" },
  { pattern: new RegExp(`${B}(drop\\s+database|dropdb)\\b`, "i"), risk: "destructive" },
  { pattern: new RegExp(`${B}find\\s+.*-(delete|exec)\\b`), risk: "destructive" },

  // caution: network/package installs, side-effecting git, container lifecycle
  { pattern: new RegExp(`${B}(npm|pnpm|bun|yarn)\\s+(install|i|add|ci|remove|uninstall)\\b`), risk: "caution" },
  { pattern: new RegExp(`${B}(pip|pip3|uv)\\s+(install|uninstall)\\b`), risk: "caution" },
  { pattern: new RegExp(`${B}uv\\s+add\\b`), risk: "caution" },
  { pattern: new RegExp(`${B}cargo\\s+(install|add|remove)\\b`), risk: "caution" },
  { pattern: new RegExp(`${B}go\\s+(get|install)\\b`), risk: "caution" },
  { pattern: new RegExp(`${B}docker(\\s+compose)?\\s+up\\b`), risk: "caution" },
  { pattern: new RegExp(`${B}docker-compose\\s+up\\b`), risk: "caution" },
  { pattern: new RegExp(`${B}docker\\s+(build|run|exec)\\b`), risk: "caution" },
  { pattern: new RegExp(`${B}git\\s+(checkout|switch|merge|pull|fetch|rebase|push)\\b`), risk: "caution" },
  { pattern: new RegExp(`${B}npx\\b`), risk: "caution" }, // executes arbitrary published packages

  // safe: read-only inspection, project-defined build/test scripts
  { pattern: new RegExp(`${B}(pwd|ls|cat|head|tail|less|more|wc|echo|which|whoami|date|tree|file|stat|env)\\b`), risk: "safe" },
  { pattern: new RegExp(`${B}(rg|grep|ag|fd|find)\\b(?!.*-(delete|exec))`), risk: "safe" },
  { pattern: new RegExp(`${B}git\\s+(status|diff|log|show|blame|branch|remote)\\b`), risk: "safe" },
  { pattern: new RegExp(`${B}(npm|pnpm|bun|yarn)\\s+(test|run|test:\\w+)\\b`), risk: "safe" },
  { pattern: new RegExp(`${B}(pytest|jest|vitest)\\b`), risk: "safe" },
  { pattern: new RegExp(`${B}python3?\\s+-m\\s+pytest\\b`), risk: "safe" },
  { pattern: new RegExp(`${B}cargo\\s+(build|test|run|check|fmt|clippy)\\b`), risk: "safe" },
  { pattern: new RegExp(`${B}go\\s+(build|test|run|vet|fmt)\\b`), risk: "safe" },
  { pattern: new RegExp(`${B}make\\b`), risk: "safe" },
  { pattern: new RegExp(`${B}(tsc|eslint|prettier)\\b`), risk: "safe" },
  { pattern: new RegExp(`${B}docker\\s+(ps|images|logs)\\b`), risk: "safe" },
  { pattern: new RegExp(`\\s(--version|--help|-v|-h)(\\s|$)`), risk: "safe" },
];

/** Highest-risk match wins: a chained command escalates to its most dangerous segment. */
export function classifyCommand(command: string): CommandRisk {
  let matched: CommandRisk | null = null;

  for (const rule of RULES) {
    if (!rule.pattern.test(command)) continue;
    if (matched === null || RISK_ORDER[rule.risk] > RISK_ORDER[matched]) {
      matched = rule.risk;
    }
  }

  // Unrecognized commands require confirmation rather than running free.
  return matched ?? "caution";
}

export function riskLabel(risk: CommandRisk): string {
  switch (risk) {
    case "safe":
      return "safe";
    case "caution":
      return "caution (side effects / network)";
    case "destructive":
      return "DESTRUCTIVE (data loss possible)";
    case "critical":
      return "CRITICAL (system-level)";
  }
}
