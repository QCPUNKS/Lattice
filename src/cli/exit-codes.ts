// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

/** Consistent process exit codes across every command. */
export const ExitCode = {
  SUCCESS: 0,
  GENERAL_FAILURE: 1,
  INVALID_USAGE: 2,
  CONFIGURATION_FAILURE: 3,
  AUTHENTICATION_FAILURE: 4,
  PROVIDER_FAILURE: 5,
  TOOL_FAILURE: 6,
  PERMISSION_DENIED: 7,
  VERIFICATION_FAILURE: 8,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
