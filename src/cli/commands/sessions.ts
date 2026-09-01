// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { promises as fs } from "node:fs";
import path from "node:path";
import { theme } from "../../ui/theme.js";
import type { LatticeConfig } from "../../config/index.js";
import * as sessions from "../../sessions/index.js";
import { ExitCode } from "../exit-codes.js";

export async function runSessionsCommand(cfg: LatticeConfig, subcommand: string | undefined, arg: string | undefined, format: string | undefined): Promise<number> {
  if (subcommand === undefined || subcommand === "list") {
    const list = await sessions.listSessions(cfg.sessionsDir);
    if (list.length === 0) {
      console.log(theme.dim("No saved sessions."));
      return ExitCode.SUCCESS;
    }
    for (const s of list) {
      console.log(`${theme.bold(s.id)}  ${s.updatedAt}  ${s.workspace}  ${s.messageCount}msg  ${s.preview}`);
    }
    return ExitCode.SUCCESS;
  }

  if (subcommand === "delete") {
    if (!arg) {
      console.error(theme.error("Usage: lattice sessions delete <id>"));
      return ExitCode.INVALID_USAGE;
    }
    await sessions.deleteSession(cfg.sessionsDir, arg);
    console.log(theme.success(`Deleted session ${arg}`));
    return ExitCode.SUCCESS;
  }

  if (subcommand === "export") {
    if (!arg) {
      console.error(theme.error("Usage: lattice sessions export <id> [--format md|json]"));
      return ExitCode.INVALID_USAGE;
    }
    const session = await sessions.loadSession(cfg.sessionsDir, arg);
    const useJson = format === "json";
    const content = useJson ? sessions.exportSessionJson(session) : sessions.exportSessionMarkdown(session);
    const outPath = path.resolve(`lattice-session-${arg}.${useJson ? "json" : "md"}`);
    await fs.writeFile(outPath, content, "utf-8");
    console.log(theme.success(`Exported to ${outPath}`));
    return ExitCode.SUCCESS;
  }

  console.error(theme.error(`Unknown sessions subcommand: ${subcommand}`));
  return ExitCode.INVALID_USAGE;
}
// The session //
