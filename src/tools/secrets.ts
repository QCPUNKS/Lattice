// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import path from "node:path";

/**
 * Default denylist of paths that are almost certainly credentials/secrets and
 * should never be silently read or sent to Venice. See spec §52. I Will be adding more deny paths to this list as I continue my journey about learning of all the secrets in life. 
 * You know the world runs on secrets and lies. its actually crazy how so many just fake it til you make it.
 *  While those who are the real ones get overlooked for those who are more verbose. 
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

/** Checks the basename of a path against the secret denylist (case-sensitive per pattern). */
export function isLikelySecretPath(relativePath: string): boolean {
  const base = path.basename(relativePath);
  return DENY_PATTERNS.some((re) => re.test(base));
}
