import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type VirtualKey,
  VirtualKeyCheckError,
  VirtualKeyStore,
  VirtualKeysError,
  loadVirtualKeysFromFile,
  loadVirtualKeysFromJson,
} from "../src/features/virtual-keys.js";

function tempFile(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "freellm-vk-test-"));
  const file = path.join(dir, "virtual-keys.json");
  writeFileSync(file, contents);
  return file;
}

describe("VirtualKeyStore construction", () => {
  it("accepts a valid list of keys", () => {
    const store = new VirtualKeyStore([
      { id: "sk-freellm-abcd1234", label: "one" },
      { id: "sk-freellm-efgh5678", label: "two" },
    ]);
    expect(store.size()).toBe(2);
  });

  it("rejects duplicate ids loudly", () => {
    expect(
      () =>
        new VirtualKeyStore([
          { id: "sk-freellm-same1234", label: "one" },
          { id: "sk-freellm-same1234", label: "two" },
        ]),
    ).toThrow(VirtualKeysError);
  });
});

describe("VirtualKeyStore.assertCanServe", () => {
  const baseKey = (overrides: Partial<VirtualKey> = {}): VirtualKey => ({
    id: "sk-freellm-test1234",
    label: "test",
    ...overrides,
  });

  it("passes when no caps are set", async () => {
    const store = new VirtualKeyStore([baseKey()]);
    await expect(store.assertCanServe(baseKey(), "free-fast")).resolves.toBeUndefined();
  });

  it("rejects an expired key", async () => {
    const key = baseKey({ expiresAt: "2020-01-01T00:00:00Z" });
    const store = new VirtualKeyStore([key]);
    await expect(store.assertCanServe(key, "free-fast")).rejects.toBeInstanceOf(VirtualKeyCheckError);
    try {
      await store.assertCanServe(key, "free-fast");
    } catch (err) {
      expect(err).toBeInstanceOf(VirtualKeyCheckError);
      expect((err as VirtualKeyCheckError).reason).toBe("expired");
    }
  });

  it("rejects a disallowed model", async () => {
    const key = baseKey({ allowedModels: ["free-fast"] });
    const store = new VirtualKeyStore([key]);
    await expect(store.assertCanServe(key, "groq/llama")).rejects.toBeInstanceOf(VirtualKeyCheckError);
    try {
      await store.assertCanServe(key, "groq/llama");
    } catch (err) {
      expect((err as VirtualKeyCheckError).reason).toBe("model_not_allowed");
    }
  });

  it("allows an allowed model", async () => {
    const key = baseKey({ allowedModels: ["free-fast", "free"] });
    const store = new VirtualKeyStore([key]);
    await expect(store.assertCanServe(key, "free-fast")).resolves.toBeUndefined();
    await expect(store.assertCanServe(key, "free")).resolves.toBeUndefined();
  });

  it("enforces dailyRequestCap", async () => {
    const key = baseKey({ dailyRequestCap: 2 });
    const store = new VirtualKeyStore([key]);
    const now = Date.parse("2026-04-09T00:00:00Z");
    await store.recordRequest(key, 0, now);
    await store.recordRequest(key, 0, now + 1);
    await expect(store.assertCanServe(key, "free-fast", now + 2)).rejects.toBeInstanceOf(
      VirtualKeyCheckError,
    );
    try {
      await store.assertCanServe(key, "free-fast", now + 2);
    } catch (err) {
      expect((err as VirtualKeyCheckError).reason).toBe("request_cap_reached");
    }
  });

  it("enforces dailyTokenCap", async () => {
    const key = baseKey({ dailyTokenCap: 100 });
    const store = new VirtualKeyStore([key]);
    const now = Date.parse("2026-04-09T00:00:00Z");
    await store.recordRequest(key, 60, now);
    await store.recordRequest(key, 40, now + 1);
    await expect(store.assertCanServe(key, "free-fast", now + 2)).rejects.toBeInstanceOf(
      VirtualKeyCheckError,
    );
    try {
      await store.assertCanServe(key, "free-fast", now + 2);
    } catch (err) {
      expect((err as VirtualKeyCheckError).reason).toBe("token_cap_reached");
    }
  });

  it("rolling window drops old usage outside 24h", async () => {
    const key = baseKey({ dailyRequestCap: 2 });
    const store = new VirtualKeyStore([key]);
    const day1 = Date.parse("2026-04-09T00:00:00Z");
    await store.recordRequest(key, 0, day1);
    await store.recordRequest(key, 0, day1 + 1);
    // 25 hours later both should be pruned.
    const later = day1 + 25 * 60 * 60 * 1000;
    await expect(store.assertCanServe(key, "free-fast", later)).resolves.toBeUndefined();
  });
});

describe("VirtualKeyStore.usage", () => {
  it("reports remaining caps", async () => {
    const key: VirtualKey = {
      id: "sk-freellm-abcd1234",
      label: "one",
      dailyRequestCap: 10,
      dailyTokenCap: 1_000,
    };
    const store = new VirtualKeyStore([key]);
    const now = Date.parse("2026-04-09T00:00:00Z");
    await store.recordRequest(key, 200, now);
    await store.recordRequest(key, 150, now + 1);
    const usage = await store.usage(key.id, now + 2);
    expect(usage).toMatchObject({
      requestsInWindow: 2,
      tokensInWindow: 350,
      requestCapRemaining: 8,
      tokenCapRemaining: 650,
    });
  });

  it("returns null caps for uncapped keys", async () => {
    const key: VirtualKey = { id: "sk-freellm-abcd1234", label: "open" };
    const store = new VirtualKeyStore([key]);
    const usage = await store.usage(key.id);
    expect(usage?.requestCapRemaining).toBeNull();
    expect(usage?.tokenCapRemaining).toBeNull();
  });
});

describe("loadVirtualKeysFromFile", () => {
  let paths: string[] = [];

  afterEach(() => {
    for (const p of paths) {
      try {
        rmSync(path.dirname(p), { recursive: true, force: true });
      } catch {}
    }
    paths = [];
  });

  const mk = (contents: string) => {
    const p = tempFile(contents);
    paths.push(p);
    return p;
  };

  it("loads a valid file", () => {
    const file = mk(
      JSON.stringify({
        keys: [
          {
            id: "sk-freellm-portfolio-abcd",
            label: "Portfolio",
            dailyRequestCap: 500,
          },
        ],
      }),
    );
    const store = loadVirtualKeysFromFile(file);
    expect(store.size()).toBe(1);
  });

  it("rejects an invalid id format", () => {
    const file = mk(JSON.stringify({ keys: [{ id: "bad-format", label: "nope" }] }));
    expect(() => loadVirtualKeysFromFile(file)).toThrow(VirtualKeysError);
  });

  it("rejects unparseable JSON", () => {
    const file = mk("{not json");
    expect(() => loadVirtualKeysFromFile(file)).toThrow(VirtualKeysError);
  });

  it("rejects a missing file", () => {
    expect(() => loadVirtualKeysFromFile("/does/not/exist.json")).toThrow(VirtualKeysError);
  });

  it("rejects duplicate ids in the file", () => {
    const file = mk(
      JSON.stringify({
        keys: [
          { id: "sk-freellm-same5678", label: "one" },
          { id: "sk-freellm-same5678", label: "two" },
        ],
      }),
    );
    expect(() => loadVirtualKeysFromFile(file)).toThrow(VirtualKeysError);
  });
});

describe("loadVirtualKeysFromJson", () => {
  it("loads a valid JSON string", () => {
    const store = loadVirtualKeysFromJson(
      JSON.stringify({
        keys: [{ id: "sk-freellm-jsonkey1234", label: "from-json", dailyRequestCap: 10 }],
      }),
    );
    expect(store.size()).toBe(1);
    expect(store.findByToken("sk-freellm-jsonkey1234")?.label).toBe("from-json");
  });

  it("rejects unparseable JSON", () => {
    expect(() => loadVirtualKeysFromJson("{not json")).toThrow(VirtualKeysError);
  });

  it("rejects an invalid id format", () => {
    expect(() =>
      loadVirtualKeysFromJson(JSON.stringify({ keys: [{ id: "bad-format", label: "nope" }] })),
    ).toThrow(VirtualKeysError);
  });
});
