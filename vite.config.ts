import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import path from "node:path";
const host = process.env.TAURI_DEV_HOST;

/**
 * pdf.js's data files, served at `/pdfjs/<dir>/`: the wasm image decoders (JPEG 2000, JBIG2 —
 * most scanned PDFs), the CMaps for CJK fonts that aren't embedded, the standard fonts and the
 * ICC profiles. Without them such images and text are not drawn.
 */
function pdfjsAssets(): Plugin {
    const root = path.resolve("node_modules/pdfjs-dist");
    const dirs = ["wasm", "cmaps", "standard_fonts", "iccs"];
    const types: Record<string, string> = { ".wasm": "application/wasm", ".js": "text/javascript", ".bcmap": "application/octet-stream" };
    return {
        name: "pdfjs-assets",
        configureServer(server) {
            server.middlewares.use("/pdfjs/", (req, res, next) => {
                const rel = decodeURIComponent(((req as { url?: string }).url ?? "").split("?")[0]).replace(/^\/+/, "");
                const file = path.resolve(root, rel);
                if (!dirs.some((d: string) => file.startsWith(path.join(root, d) + path.sep)) || !fs.existsSync(file)) return next();
                res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
                fs.createReadStream(file).pipe(res);
            });
        },
        generateBundle() {
            for (const d of dirs) {
                for (const name of fs.readdirSync(path.join(root, d)) as string[]) {
                    const file = path.join(root, d, name);
                    if (!fs.statSync(file).isFile() || name.startsWith("LICENSE")) continue;
                    this.emitFile({ type: "asset", fileName: `pdfjs/${d}/${name}`, source: fs.readFileSync(file) });
                }
            }
        },
    };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), pdfjsAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
