import { describe, expect, test } from "bun:test";
import { resolveApiKey, resolveBaseUrl, sanitizeBankMap, sanitizeBankValue } from "../src/config";

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

describe("configuration API endpoint resolution", () => {
  test("prefers HINDSIGHT_API_URL over legacy env and config values", () => {
    expect(
      resolveBaseUrl(
        { baseUrl: "http://config.example" },
        {
          HINDSIGHT_API_URL: " http://api.example ",
          HINDSIGHT_BASE_URL: "http://legacy.example",
        },
      ),
    ).toBe("http://api.example");
  });

  test("falls back to HINDSIGHT_BASE_URL and config baseUrl", () => {
    expect(
      resolveBaseUrl(
        { baseUrl: "http://config.example" },
        { HINDSIGHT_BASE_URL: " http://legacy.example " },
      ),
    ).toBe("http://legacy.example");

    expect(resolveBaseUrl({ baseUrl: " http://config.example " }, {})).toBe("http://config.example");
  });
});

describe("configuration API key resolution", () => {
  test("prefers HINDSIGHT_API_KEY over tenant env and config values", () => {
    expect(
      resolveApiKey(
        { apiKey: "config-key" },
        {
          HINDSIGHT_API_KEY: " env-key ",
          HINDSIGHT_API_TENANT_API_KEY: "tenant-key",
        },
      ),
    ).toBe("env-key");
  });

  test("falls back to tenant env and config apiKey env references", () => {
    expect(
      resolveApiKey(
        { apiKey: "config-key" },
        { HINDSIGHT_API_TENANT_API_KEY: " tenant-key " },
      ),
    ).toBe("tenant-key");

    expect(
      resolveApiKey(
        { apiKey: "$OPENCODE_HINDSIGHT_API_KEY" },
        { OPENCODE_HINDSIGHT_API_KEY: " referenced-key " },
      ),
    ).toBe("referenced-key");
  });

  test("treats empty API key values as unset", () => {
    expect(resolveApiKey({ apiKey: "   " }, {})).toBeUndefined();
    expect(
      resolveApiKey(
        { apiKey: "$MISSING_HINDSIGHT_API_KEY" },
        { HINDSIGHT_API_KEY: "  ", HINDSIGHT_API_TENANT_API_KEY: "  " },
      ),
    ).toBeUndefined();
  });
});
