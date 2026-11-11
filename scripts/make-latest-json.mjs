#!/usr/bin/env node
/**
 * Writes `latest.json` for the updater after a signed release build.
 *
 *   1. Build with the signing key set (PowerShell):
 *        $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$env:USERPROFILE\.tauri\banyan.key"
 *        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
 *        npm run tauri build
 *   2. node scripts/make-latest-json.mjs OWNER/REPO ["release notes"]
 *   3. Upload latest.json and the installer listed below to a GitHub release tagged v<version>.
 *
 * Only the Windows NSIS installer is handled for now (the app is developed on Windows).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [repo, notes = ""] = process.argv.slice(2);
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error("Usage: node scripts/make-latest-json.mjs OWNER/REPO [\"release notes\"]");
    process.exit(1);
}

const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = conf.version;
const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
if (!existsSync(nsisDir)) {
    console.error(`No NSIS bundle at ${nsisDir}. Run a signed "npm run tauri build" first.`);
    process.exit(1);
}

const installer = readdirSync(nsisDir).find((f) => f.endsWith(".exe") && f.includes(version));
if (!installer || !existsSync(join(nsisDir, `${installer}.sig`))) {
    console.error(`No signed installer for version ${version} in ${nsisDir} (need the .exe and its .sig).`);
    console.error("Was TAURI_SIGNING_PRIVATE_KEY set during the build?");
    process.exit(1);
}

const signature = readFileSync(join(nsisDir, `${installer}.sig`), "utf8").trim();
// GitHub serves release assets with spaces as dots.
const assetName = installer.replace(/ /g, ".");
const latest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
        "windows-x86_64": {
            signature,
            url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(assetName)}`,
        },
    },
};

const out = join(nsisDir, "latest.json");
writeFileSync(out, JSON.stringify(latest, null, 2) + "\n");
console.log(`Wrote ${out}`);
console.log(`Upload to the v${version} release: ${installer} and latest.json`);
