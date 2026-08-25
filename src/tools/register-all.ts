// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { ToolRegistry } from "./registry.js";
import * as fsTools from "./filesystem.js";
import * as shellTools from "./shell.js";
import * as gitTools from "./git.js";
import * as projectTools from "./project.js";

/** Registers every native (non-MCP) tool. MCP tools are registered separately by McpManager once servers connect. */
export function registerAllTools(registry: ToolRegistry): void {
  registry.register(fsTools.readFileDef, fsTools.readFileHandler);
  registry.register(fsTools.readManyFilesDef, fsTools.readManyFilesHandler);
  registry.register(fsTools.writeFileDef, fsTools.writeFileHandler);
  registry.register(fsTools.editFileDef, fsTools.editFileHandler);
  registry.register(fsTools.createFileDef, fsTools.createFileHandler);
  registry.register(fsTools.deleteFileDef, fsTools.deleteFileHandler);
  registry.register(fsTools.createDirectoryDef, fsTools.createDirectoryHandler);
  registry.register(fsTools.listDirectoryDef, fsTools.listDirectoryHandler);
  registry.register(fsTools.fileExistsDef, fsTools.fileExistsHandler);
  registry.register(fsTools.directoryExistsDef, fsTools.directoryExistsHandler);
  registry.register(fsTools.statFileDef, fsTools.statFileHandler);
  registry.register(fsTools.searchFilesDef, fsTools.searchFilesHandler);
  registry.register(fsTools.searchContentDef, fsTools.searchContentHandler);
  registry.register(fsTools.copyFileDef, fsTools.copyFileHandler);
  registry.register(fsTools.moveFileDef, fsTools.moveFileHandler);

  registry.register(shellTools.runCommandDef, shellTools.runCommandHandler);
  registry.register(shellTools.startProcessDef, shellTools.startProcessHandler);
  registry.register(shellTools.stopProcessDef, shellTools.stopProcessHandler);
  registry.register(shellTools.getProcessStatusDef, shellTools.getProcessStatusHandler);

  registry.register(gitTools.gitStatusDef, gitTools.gitStatusHandler);
  registry.register(gitTools.gitDiffDef, gitTools.gitDiffHandler);
  registry.register(gitTools.gitLogDef, gitTools.gitLogHandler);
  registry.register(gitTools.gitBranchDef, gitTools.gitBranchHandler);
  registry.register(gitTools.gitCommitDef, gitTools.gitCommitHandler);

  registry.register(projectTools.detectProjectTypeDef, projectTools.detectProjectTypeHandler);
  registry.register(projectTools.inspectProjectDef, projectTools.inspectProjectHandler);
}
