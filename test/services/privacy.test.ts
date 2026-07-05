import { describe, expect, test } from "bun:test";
import { containsPrivateTag, isFullyPrivate, stripPrivateContent } from "../../src/services/privacy";

describe("stripPrivateContent", () => {
  test("strips attribute-bearing private tags", () => {
    const input = '<private attr="x">secret</private> visible';
    expect(stripPrivateContent(input)).toBe("[REDACTED] visible");
  });

  test("strips whitespace in opening tag", () => {
    const input = "<private   >secret</private> visible";
    expect(stripPrivateContent(input)).toBe("[REDACTED] visible");
  });

  test("strips newline/attribute in opening tag", () => {
    const input = "<private\n data-x=\"y\">secret</private> visible";
    expect(stripPrivateContent(input)).toBe("[REDACTED] visible");
  });

  test("multi-block redaction remains non-greedy", () => {
    const input = "<private>a</private> public <private>b</private>";
    expect(stripPrivateContent(input)).toBe("[REDACTED] public [REDACTED]");
  });

  test("does not match <privatesomething>", () => {
    const input = "<privatesomething>leak</privatesomething>";
    expect(stripPrivateContent(input)).toBe(input);
  });
});

describe("isFullyPrivate", () => {
  test("returns true for attribute-bearing private content", () => {
    const input = '<private attr="x">secret</private>';
    expect(isFullyPrivate(input)).toBe(true);
  });

  test("returns true for multiple private blocks separated only by whitespace", () => {
    const input = "<private>a</private>  <private>b</private>";
    expect(isFullyPrivate(input)).toBe(true);
  });

  test("returns false when public content remains", () => {
    const input = "<private>a</private> public";
    expect(isFullyPrivate(input)).toBe(false);
  });
});

describe("containsPrivateTag", () => {
  test("detects attribute-bearing private tags", () => {
    expect(containsPrivateTag('<private attr="x">secret</private>')).toBe(true);
  });

  test("does not match <privatesomething>", () => {
    expect(containsPrivateTag("<privatesomething>leak</privatesomething>")).toBe(false);
  });

  test("detects whitespace in opening tag", () => {
    expect(containsPrivateTag("<private   >secret</private>")).toBe(true);
  });

  test("does not have global regex state issues on repeated calls", () => {
    const input = '<private attr="x">secret</private>';
    expect(containsPrivateTag(input)).toBe(true);
    expect(containsPrivateTag(input)).toBe(true);
    expect(containsPrivateTag(input)).toBe(true);
  });
});