import { describe, expect, test } from "bun:test";
import { channelForm } from "../src/channel-form";

const defaults = { kind: "text", categoryId: "" };

describe("channel form", () => {
  test("trims a name and accepts both channel kinds and category choices", () => {
    expect(channelForm.parse({ ...defaults, name: "  ogólny  " })).toEqual({
      ...defaults,
      name: "ogólny",
    });
    const voice = {
      name: "Lounge",
      kind: "voice",
      categoryId: "79dcf48a-0507-4355-a229-0d2f4e43beee",
    };
    expect(channelForm.parse(voice)).toEqual(voice);
  });

  test("counts Unicode code points and rejects blank names and control characters", () => {
    expect(channelForm.safeParse({ ...defaults, name: "🎙".repeat(64) }).success).toBe(true);
    for (const name of ["  ", "🎙".repeat(65), "a\tb", "a\nb"]) {
      expect(channelForm.safeParse({ ...defaults, name }).success).toBe(false);
    }
  });

  test("rejects unsupported kinds and malformed category IDs", () => {
    expect(channelForm.safeParse({ ...defaults, name: "news", kind: "video" }).success).toBe(false);
    expect(
      channelForm.safeParse({ ...defaults, name: "news", categoryId: "general" }).success,
    ).toBe(false);
  });
});
