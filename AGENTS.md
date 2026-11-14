# Repository Guidelines

## Project Structure

Banyan Note is a Windows-developed Tauri 2 desktop app with a React/TypeScript frontend and a Rust/SQLite backend. The app shell lives in `src/App.tsx`, feature views in `src/components/`, and typed Tauri calls in each feature's `api.ts`. The Markdown parser and editor live in `src/markdown/`. Native commands and database code live in `src-tauri/src/`. Static assets live in `public/`, desktop icons in `src-tauri/icons/`, and design references in `Design/`.

## Build, Test, and Development

- `npm ci` installs dependencies from the lockfile. Use Node.js 24 for the TypeScript test runner.
- `npm run tauri dev` launches the desktop app with Vite on port 1420. Use `npm run dev` for browser-only UI work. Tauri commands require the desktop runtime.
- `npm run build` type-checks TypeScript and bundles the frontend into `dist/`. Use `npm run tauri build` to package the desktop app.
- `npm test` runs the frontend tests. `cargo test --manifest-path src-tauri/Cargo.toml` runs the Rust tests from the repository root.

## Coding Style

Use four-space indentation, PascalCase for React components, camelCase for TypeScript functions, and snake_case for Rust functions and modules. Follow neighboring files for formatting. The project has no configured linter or frontend formatter. Use shared CSS tokens from `src/styles/tokens.css`. Write user-facing text and error messages in Traditional Chinese and code identifiers in English. Register new Tauri commands in `src-tauri/src/lib.rs` and expose camelCase fields to the frontend.

## Testing Guidelines

Name frontend tests `*.test.ts` and place them in feature-level `tests/` directories. Use `node:test` and explicit `.ts` extensions for local test imports. Keep Rust integration tests in `src-tauri/tests/`, using Tauri's mock runtime and temporary libraries for command tests. Add migration regression cases to `src-tauri/tests/upgrade.rs`. No numeric coverage threshold is configured.

## Commits and Pull Requests

Use short Traditional Chinese commit subjects. Follow the existing `v0.1.3：…` pattern for versioned changes. In pull requests, summarize behavior changes, report verification, link relevant issues, and include screenshots for visible UI changes. Update `Design/Features.md` when implemented behavior changes and record completed work in the current weekly log under `工作紀錄/`.
