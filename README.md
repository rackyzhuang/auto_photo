# AutoPhoto

AutoPhoto is a local-first desktop client for professional camera photo workflows. It imports Sony/Nikon JPG files and Sony/Nikon RAW files, reads basic EXIF metadata, applies non-destructive color adjustments, supports manual tuning, AI color candidates, AI style matching, batch consistency, reference style transfer, and JPG export.

The product target is a Windows and macOS desktop app built with React, TypeScript, Vite, Tauri v2, Rust, and SQLite.

## Current Status

- JPG/JPEG import, drag-and-drop import, EXIF reading, preview rendering, and duplicate detection are implemented.
- Sony/Nikon camera recognition and local automatic color adjustment are implemented.
- Manual adjustment controls, numeric inputs, HSL controls, preset series, copy/paste edits, undo/redo, and before/after comparison are implemented.
- AI settings, AI color, AI style matching, local color-science fallback candidates, batch AI color, and batch AI style matching are implemented.
- Batch auto color, batch consistency preview, reference style application, export settings, watermarking, export folder prompts, and export history are implemented.
- SQLite project snapshots and named projects are implemented.
- RAW `.ARW` and `.NEF` files can be imported. When a usable embedded JPEG preview is available, RAW assets support preview-level manual edits, HSL, presets, AI color, AI style matching, reference style use, and single-photo JPG export.
- Full RAW demosaic, RAW/TIFF output, deep RAW EXIF/XMP preservation, and RAW batch export are not implemented yet.
- Windows build has been verified in this workspace. macOS app/DMG must be built and verified on a macOS machine.

## Requirements

- Node.js
- npm
- Rust stable toolchain
- Platform build tools:
  - Windows: Visual Studio Build Tools with MSVC C++ tools
  - macOS: Xcode Command Line Tools

## Install

```bash
npm install
```

## Run In Browser Dev Mode

```bash
npm run dev
```

Open the local Vite URL shown in the terminal. Browser mode is useful for UI development, but desktop-only features such as choosing an export folder use Tauri and require desktop mode.

## Run Desktop Dev Mode

```bash
npm run desktop:dev
```

This starts the Vite dev server and launches the Tauri desktop app.

## Build

Frontend build:

```bash
npm run build
```

TypeScript check:

```bash
npm run typecheck
```

Core local regression checks:

```bash
npm run check:core
```

This runs TypeScript checking, AI safety redaction checks, AI settings UX/keychain checks, split-compare layout UX checks, RAW/JPG fixture checks, desktop import payload checks, import drag-and-drop UX checks, export target UX checks, export queue checks, built-in preset structure/render/contact-sheet checks, the frontend production build, and a post-build privacy scan. Remote AI smoke tests, Rust tests, and Tauri desktop builds are still separate validation steps.

Real desktop import path check for fixed JPG/RAW samples:

```bash
npm run check:desktop-import-paths
```

This wraps the targeted Rust desktop import test with real Nikon/Sony fixture paths, confirming the app can read JPG, Nikon NEF, and Sony ARW payloads and safe camera metadata from local filesystem paths. It is separate from `check:core` because it runs Cargo.

Generate preset visual review contact sheets:

```bash
npm run generate:preset-contact-sheets
```

This writes fixed-sample JPG sheets and a cell manifest under `remark-V2/artifacts/preset-contact-sheets/` for manual review of built-in preset direction.

Rust backend check:

```bash
cd src-tauri
cargo check
```

Desktop executable without installer:

```bash
npm run desktop:build:no-bundle
```

Windows installers:

```bash
npm run desktop:build:windows
```

macOS app and DMG:

```bash
npm run desktop:build:mac
```

macOS builds must be run on macOS. Before distributing to real users, add Apple Developer signing, notarization, and Gatekeeper verification.

## Basic Usage

1. Launch the app.
2. Import JPG/JPEG photos or supported Sony/Nikon RAW files with the import button or drag-and-drop.
3. Select a photo from the gallery or filmstrip.
4. Use one-click auto color for an initial edit.
5. Fine-tune exposure, white balance, contrast, highlights, shadows, saturation, vibrance, clarity, texture, dehaze, vignette, grain, sharpening, noise reduction, portrait parameters, or HSL channels.
6. Use before/after comparison to inspect the result.
7. Configure AI settings if you want remote AI suggestions. AI runs only when you click AI color or AI style matching.
8. Save presets or copy/paste edits to other photos.
9. Use batch auto color, batch AI, batch consistency, or reference style tools for groups of photos.
10. Configure export quality, max edge, naming, conflict strategy, EXIF preservation, and watermark settings.
11. Export the current photo or a selected batch.

## Project Storage

The desktop app stores project snapshots in a local SQLite database under the Tauri app data directory. Project snapshots store parameters, settings, presets, reference style data, and asset identity. They do not store original photo binaries.

Named projects can be saved and loaded from the project library. Loading a named project restores edits only for matching photos that have been imported again.

## Export Notes

- Original photos are never overwritten.
- Desktop mode can write JPG files to a selected export folder.
- Browser mode falls back to browser downloads and cannot fully control duplicate download names.
- Desktop export supports rename, skip, and overwrite conflict strategies for exported files.
- Export history records per-photo details including written, skipped, and failed items.
- RAW exports are preview-level JPG exports from embedded RAW JPEG previews, not full RAW demosaic output.

## Privacy And Local Files

- Image processing is local-first.
- The app must not upload user photos by default.
- AI calls are user-triggered. They send compressed preview images and metadata only for the current operation.
- AI API keys are saved through the system keychain in the desktop app; they must not be written to SQLite, project snapshots, logs, documents, or app bundles.
- `openAi.json` is private local test configuration. Do not commit, print, log, document, store in SQLite, or bundle it.
- `.gitignore` already excludes `openAi.json`, generated caches, exports, build output, and SQLite files.

## Validation Checklist

For both Windows and macOS:

- App launches successfully.
- JPG import works with normal paths and non-ASCII paths.
- EXIF metadata appears when available.
- Auto color and manual edits update the preview.
- RAW files with embedded JPEG previews can be previewed, adjusted at preview level, and exported as JPG.
- AI settings can be saved, restored after restart, and used without leaking API keys into project data or bundles.
- AI failure displays a safe, categorized reason with a suggested fix and falls back to local color-science candidates; OpenAI-compatible gateways are tried with both the saved base URL and the `/v1` candidate when needed.
- Project snapshot save/load works.
- Named projects can be saved and loaded.
- Desktop export folder selection works.
- Exported JPG files respect naming, quality, max edge, watermark, EXIF setting, and conflict strategy.
- Built-in presets cover the portrait, landscape, architecture, city, and creative series with valid parameter ranges and render successfully on fixed JPG fixtures.
- `npm run check:desktop-import-paths` passes for fixed Nikon/Sony JPG/RAW filesystem paths before desktop release candidates.
- `openAi.json` is not included in any installer or app bundle.
- `npm run check:core` passes before release candidate builds.

## Known Limitations

- RAW support is currently embedded-preview-level only. Full RAW demosaic, RAW/TIFF output, deep RAW metadata preservation, and RAW batch export remain future work.
- Batch image processing still runs mostly in the frontend flow and should move to Web Worker or Rust backend for very large jobs.
- Precise EXIF rewriting is not complete; the current JPG export can preserve safe EXIF APP1 data and normalize Orientation when possible.
- macOS packaging has to be verified on a real macOS host.
