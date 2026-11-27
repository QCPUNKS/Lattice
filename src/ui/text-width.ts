// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

// eslint-disable-next-line no-control-regex
const SGR_SEQUENCE = /\x1b\[[0-9;]*m/g;

/** Columns a string occupies once its color codes are removed. */
export function visibleLength(text: string): number {
  return text.replace(SGR_SEQUENCE, "").length;
}
