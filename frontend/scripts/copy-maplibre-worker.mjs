// MapLibre GL 6 runs its tile work in a separate worker file. Copy it from the installed package into
// public/ so it is served next to the app (matches the installed version; not committed).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const out = new URL("../public/maplibre/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
copyFileSync(`${dist}/maplibre-gl-worker.mjs`, `${out}/maplibre-gl-worker.mjs`);
console.log("copied maplibre-gl-worker.mjs to public/maplibre/");
