// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { syntaxTheme } from "../theme.js";

/**
 * A small, dependency-free, line-at-a-time highlighter for fenced code in
 * model replies. It colors what reads at a glance — keywords, strings,
 * numbers, comments, calls, types — and never tries to be a parser: a line
 * it misjudges is still printed in full, just less colorful.
 */

interface CommentSyntax {
  line: string[];
  block?: [open: string, close: string];
}

const C_STYLE: CommentSyntax = { line: ["//"], block: ["/*", "*/"] };
const HASH_STYLE: CommentSyntax = { line: ["#"] };
const DASH_STYLE: CommentSyntax = { line: ["--"], block: ["/*", "*/"] };
const NO_COMMENTS: CommentSyntax = { line: [] };

const COMMENT_SYNTAX_BY_LANGUAGE: Record<string, CommentSyntax> = {};
for (const name of ["js", "jsx", "ts", "tsx", "javascript", "typescript", "c", "h", "cpp", "c++", "cc", "hpp", "cs", "csharp", "java", "kotlin", "kt", "go", "rust", "rs", "swift", "scala", "dart", "php", "css", "scss", "less", "jsonc", "groovy", "zig"]) {
  COMMENT_SYNTAX_BY_LANGUAGE[name] = C_STYLE;
}
for (const name of ["py", "python", "sh", "bash", "zsh", "fish", "shell", "rb", "ruby", "yaml", "yml", "toml", "r", "perl", "pl", "make", "makefile", "dockerfile", "ini", "conf", "nix", "elixir", "ex", "exs", "powershell", "ps1"]) {
  COMMENT_SYNTAX_BY_LANGUAGE[name] = HASH_STYLE;
}
for (const name of ["sql", "lua", "haskell", "hs", "elm"]) {
  COMMENT_SYNTAX_BY_LANGUAGE[name] = DASH_STYLE;
}
for (const name of ["json", "html", "xml", "svg", "markdown", "md"]) {
  COMMENT_SYNTAX_BY_LANGUAGE[name] = NO_COMMENTS;
}

/** Languages shown exactly as written: output, logs, prose. */
const UNHIGHLIGHTED_LANGUAGES = new Set(["text", "txt", "plain", "plaintext", "console", "output", "log", "logs", "none", "ansi"]);

const DIFF_LANGUAGES = new Set(["diff", "patch"]);

/** One shared vocabulary across languages: a keyword in one is almost never an ordinary identifier in another. */
const KEYWORDS = new Set([
  // control flow
  "if", "else", "elif", "for", "while", "do", "switch", "case", "default", "break", "continue", "return", "yield",
  "try", "catch", "except", "finally", "throw", "raise", "match", "when", "loop", "in", "of", "then", "fi", "done", "esac",
  // declarations
  "function", "func", "fn", "def", "class", "struct", "enum", "interface", "trait", "impl", "type", "module", "namespace",
  "let", "const", "var", "val", "mut", "static", "pub", "public", "private", "protected", "readonly", "abstract", "override",
  "import", "from", "export", "as", "use", "package", "require", "extends", "implements", "with", "lambda",
  // values and operators that read as words
  "true", "false", "null", "undefined", "None", "True", "False", "nil", "self", "this", "super", "new", "delete",
  "typeof", "instanceof", "and", "or", "not", "is", "async", "await", "void", "where", "select", "insert", "update",
  "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "JOIN", "ON", "AND", "OR", "NOT", "NULL", "ORDER", "BY", "GROUP", "INTO", "VALUES", "CREATE", "TABLE",
  // shell
  "echo", "export", "local", "source", "sudo",
]);

const STRING_PATTERN = String.raw`"(?:[^"\\]|\\.)*(?:"|$)|'(?:[^'\\]|\\.)*(?:'|$)|\x60(?:[^\x60\\]|\\.)*(?:\x60|$)`;
const NUMBER_PATTERN = String.raw`\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`;
const IDENTIFIER_PATTERN = String.raw`[A-Za-z_$][\w$]*`;

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const tokenPatternCache = new Map<CommentSyntax, RegExp>();

function tokenPatternFor(comments: CommentSyntax): RegExp {
  const cached = tokenPatternCache.get(comments);
  if (cached) return cached;
  const commentAlternatives = comments.line.map((marker) => `${escapeForRegex(marker)}.*$`);
  if (comments.block) {
    const [open, close] = comments.block.map(escapeForRegex);
    commentAlternatives.push(`${open}.*?(?:${close}|$)`);
  }
  const comment = commentAlternatives.length > 0 ? commentAlternatives.join("|") : "(?!)";
  const pattern = new RegExp(
    `(?<comment>${comment})|(?<string>${STRING_PATTERN})|(?<number>${NUMBER_PATTERN})|(?<identifier>${IDENTIFIER_PATTERN})|(?<other>[\\s\\S])`,
    "g",
  );
  tokenPatternCache.set(comments, pattern);
  return pattern;
}

function highlightDiffLine(line: string): string {
  if (line.startsWith("@@")) return syntaxTheme.diffHunk(line);
  if (line.startsWith("+")) return syntaxTheme.diffAdded(line);
  if (line.startsWith("-")) return syntaxTheme.diffRemoved(line);
  return syntaxTheme.plain(line);
}

/** Colors one line of code. `language` is the fence's info word ("ts", "python", ""). */
export function highlightCodeLine(line: string, language: string): string {
  const normalized = language.toLowerCase();
  if (UNHIGHLIGHTED_LANGUAGES.has(normalized)) return syntaxTheme.plain(line);
  if (DIFF_LANGUAGES.has(normalized)) return highlightDiffLine(line);

  const pattern = tokenPatternFor(COMMENT_SYNTAX_BY_LANGUAGE[normalized] ?? C_STYLE);
  pattern.lastIndex = 0;
  let output = "";
  let plainRun = "";
  const flushPlain = () => {
    if (plainRun) output += syntaxTheme.plain(plainRun);
    plainRun = "";
  };

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const groups = match.groups ?? {};
    const token = match[0];
    const following = line.slice(pattern.lastIndex);
    if (groups.comment !== undefined) {
      flushPlain();
      output += syntaxTheme.comment(token);
    } else if (groups.string !== undefined) {
      flushPlain();
      // A quoted key ("name": ...) reads as structure, not data.
      output += /^\s*:/.test(following) ? syntaxTheme.functionName(token) : syntaxTheme.string(token);
    } else if (groups.number !== undefined) {
      flushPlain();
      output += syntaxTheme.number(token);
    } else if (groups.identifier !== undefined) {
      if (KEYWORDS.has(token)) {
        flushPlain();
        output += syntaxTheme.keyword(token);
      } else if (/^\s*\(/.test(following)) {
        flushPlain();
        output += syntaxTheme.functionName(token);
      } else if (/^[A-Z][a-z0-9]/.test(token)) {
        flushPlain();
        output += syntaxTheme.typeName(token);
      } else {
        plainRun += token;
      }
    } else {
      plainRun += token;
    }
  }
  flushPlain();
  return output;
}
