import { copyFileSync, cpSync } from "node:fs";
copyFileSync(
  new URL("../src/preload.cjs", import.meta.url),
  new URL("../dist/preload.cjs", import.meta.url),
);

cpSync(new URL("../../web/dist/", import.meta.url), new URL("../renderer/", import.meta.url), {
  recursive: true,
});
