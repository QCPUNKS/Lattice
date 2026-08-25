// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import path from "node:path";

/**
 * Default denylist of paths that are almost certainly credentials/secrets and
 * should never be silently read or sent to the provider. UHH YEA GOOD OPSEC for your code BRO! Psh 
 */
const DENY_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/,
  /\.pem$/,
  /\.key$/,
  /^id_rsa$/,
  /^id_ed25519$/,
  /^id_ecdsa$/,
  /^id_dsa$/,
  /^credentials(\..+)?$/i,
  /^secrets?(\..+)?$/i,
  /\.pfx$/,
  /\.p12$/,
  /^\.npmrc$/,
  /^\.netrc$/,
];

/** Checks the basename of a path against the secret denylist (case-sensitive per pattern). Also checks the basement for bodies. */
export function isLikelySecretPath(relativePath: string): boolean {
  const base = path.basename(relativePath);
  return DENY_PATTERNS.some((re) => re.test(base));
}
