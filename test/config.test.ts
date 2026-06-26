import { describe, expect, test } from "bun:test";
import { sanitizeBankMap, sanitizeBankValue } from "../src/config";

describe("configuration bank value sanitization", () => {
  test("expands full-value env refs for bank values", () => {
    const env = { OPENCODE_REVIEW_BANK: " proj-review " };

    expect(sanitizeBankValue("$OPENCODE_REVIEW_BANK", env)).toBe("proj-review");
    expect(sanitizeBankValue("${OPENCODE_REVIEW_BANK}", env)).toBe("proj-review");
  });

  test("defaults env expansion to process.env", () => {
    const previous = process.env.OPENCODE_REVIEW_BANK;

    try {
      process.env.OPENCODE_REVIEW_BANK = " proj-review ";
      expect(sanitizeBankValue("$OPENCODE_REVIEW_BANK")).toBe("proj-review");
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_REVIEW_BANK;
      else process.env.OPENCODE_REVIEW_BANK = previous;
    }
  });

  test("treats missing and empty env refs as unset", () => {
    expect(sanitizeBankValue("$OPENCODE_REVIEW_BANK", {})).toBeUndefined();
    expect(sanitizeBankValue("${OPENCODE_REVIEW_BANK}", {})).toBeUndefined();
    expect(sanitizeBankValue("$OPENCODE_REVIEW_BANK", { OPENCODE_REVIEW_BANK: "  " })).toBeUndefined();
  });

  test("leaves literal and partial interpolation bank values unchanged after trimming", () => {
    const env = { OPENCODE_REVIEW_BANK: "review" };

    expect(sanitizeBankValue(" proj-literal ", env)).toBe("proj-literal");
    expect(sanitizeBankValue("proj-$OPENCODE_REVIEW_BANK", env)).toBe("proj-$OPENCODE_REVIEW_BANK");
    expect(sanitizeBankValue("proj-${OPENCODE_REVIEW_BANK}", env)).toBe("proj-${OPENCODE_REVIEW_BANK}");
  });
});

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

  test("expands env refs in bank maps and drops missing refs", () => {
    expect(
      sanitizeBankMap(
        {
          " review-* ": "$OPENCODE_REVIEW_BANK",
          missing: "$MISSING_BANK",
          literal: " proj-literal ",
        },
        { OPENCODE_REVIEW_BANK: " proj-review " },
      ),
    ).toEqual({
      "review-*": "proj-review",
      literal: "proj-literal",
    });
  });
});
