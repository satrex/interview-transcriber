import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(rootDir, "node_modules", "@ffmpeg", "core", "dist", "umd");
const targetDir = join(rootDir, "public", "ffmpeg");

mkdirSync(targetDir, { recursive: true });

for (const filename of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  copyFileSync(join(sourceDir, filename), join(targetDir, filename));
}
