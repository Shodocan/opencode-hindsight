import { describe, expect, test } from "bun:test";
import { sanitizeBankMap } from "../src/config";

describe("configuration map sanitization", () => {
  test("ignores arrays for bank maps", () => {
    expect(sanitizeBankMap(["proj-array"])).toEqual({});
  });

  test("trims string keys and values while dropping empty and non-string entries", () => {
    expect(
      sanitizeBankMap({
        " review-* ": " proj-review ",
        empty: "   ",
        number: 123,
      }),
    ).toEqual({
      "review-*": "proj-review",
    });
  });
});
