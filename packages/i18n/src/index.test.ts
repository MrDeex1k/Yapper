import { expect, test } from "bun:test";
import { en, pl } from "./index";
test("English and Polish expose the same nonempty translation keys", () => {
  expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
  for (const value of [...Object.values(en), ...Object.values(pl)])
    expect(value.trim().length).toBeGreaterThan(0);
});
