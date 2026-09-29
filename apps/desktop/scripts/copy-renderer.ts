import { cpSync } from "node:fs";

cpSync(new URL("../../web/dist/", import.meta.url), new URL("../renderer/", import.meta.url), {
  recursive: true,
});
