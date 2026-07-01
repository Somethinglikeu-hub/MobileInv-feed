import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const indexHtml = read("index.html");
const serviceWorker = read("sw.js");
const appJs = read("app.js");
const manifest = JSON.parse(read("manifest.webmanifest"));
const snapshotManifest = JSON.parse(read("manifest.json"));

const requiredFiles = [
  "app.js",
  "index.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/pako.min.js",
  "vendor/sql-wasm.js",
  "vendor/sql-wasm.wasm",
  "vendor/apexcharts.min.js",
  "mobile_snapshot.db.gz",
];

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) {
    throw new Error(`Missing required PWA asset: ${file}`);
  }
}

for (const localRuntime of [
  "./vendor/pako.min.js?v=10",
  "./vendor/sql-wasm.js?v=10",
  "./vendor/apexcharts.min.js?v=10",
]) {
  if (!indexHtml.includes(localRuntime)) {
    throw new Error(`index.html does not reference local runtime: ${localRuntime}`);
  }
}

if (/cdnjs\.cloudflare\.com\/ajax\/libs\/(?:pako|sql\.js)|cdn\.jsdelivr\.net\/npm\/apexcharts/.test(indexHtml)) {
  throw new Error("Core PWA runtime still depends on an external CDN.");
}

if (!serviceWorker.includes("bist-picker-shell-v10")) {
  throw new Error("Service worker cache version was not bumped to v10.");
}

if (!appJs.includes("Snapshot bütünlük kontrolü başarısız")) {
  throw new Error("Snapshot SHA-256 validation is missing.");
}

if (!appJs.includes("mixedScalePercent(company?.free_float_pct)")) {
  throw new Error("Stock detail free-float percentage scale normalization is missing.");
}

if (!appJs.includes("MobileInv-feed/live-data/live_prices.json")) {
  throw new Error("PWA near-live price feed URL is missing.");
}

if (!appJs.includes("./vendor/${filename}?v=10")) {
  throw new Error("sql.js WASM locateFile cache version was not bumped to v10.");
}

if (appJs.includes("loadSimulatedLivePrices")) {
  throw new Error("PWA still labels snapshot prices as simulated live prices.");
}

if (manifest.start_url !== "./" || manifest.scope !== "./" || manifest.display !== "standalone") {
  throw new Error("PWA manifest install scope/display configuration is invalid.");
}

const snapshotPath = resolve(root, snapshotManifest.snapshot.filename);
const snapshotBytes = readFileSync(snapshotPath);
const actualHash = createHash("sha256").update(snapshotBytes).digest("hex");
if (actualHash !== snapshotManifest.snapshot.sha256) {
  throw new Error("Published snapshot SHA-256 does not match manifest.json.");
}
if (statSync(snapshotPath).size !== snapshotManifest.snapshot.size_bytes) {
  throw new Error("Published snapshot size does not match manifest.json.");
}

console.log("PWA static checks passed.");
