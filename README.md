# AutoPhoto

AutoPhoto is a desktop photo editing app for fast local color grading, AI-assisted tuning, preset-based looks, crop/rotate adjustments, and JPG export.

It is built for photographers and image teams who want a focused workflow: import photos, adjust color, compare before/after, apply looks across a set, and export polished JPG files.

## Features

- Import JPG/JPEG photos and supported Sony/Nikon RAW files.
- Read basic camera metadata when available.
- Apply one-click automatic color correction.
- Fine-tune exposure, white balance, tone, contrast, highlights, shadows, saturation, vibrance, clarity, texture, dehaze, vignette, grain, sharpening, noise reduction, portrait controls, and HSL channels.
- Use preset collections for portrait, landscape, architecture, city, and creative looks.
- Compare original and edited versions with before/after viewing.
- Rotate photos and crop with common ratios or free crop.
- Copy, paste, undo, and redo edits.
- Use reference-style tools to bring one photo closer to another.
- Use AI color and AI style matching when you provide your own AI configuration.
- Save and reload project edits locally.
- Export the current photo or a batch as JPG with naming, quality, size, EXIF, watermark, and conflict options.

## Basic Usage

1. Launch AutoPhoto.
2. Import photos with the import button or by drag and drop.
3. Select a photo from the gallery.
4. Apply auto color, choose a preset, or adjust sliders manually.
5. Use the compare view to inspect the result.
6. Crop, rotate, copy/paste edits, or apply reference-style tools when needed.
7. Configure AI settings if you want AI color or AI style matching.
8. Choose export settings and export the current photo or selected batch.

## AI Configuration

AI features are optional. Open the AI settings area in the app and enter your own API key, base URL, and model name.

AI color and AI style matching run only after you trigger them. AutoPhoto is designed as a local-first editor, with normal editing and export workflows available without AI.

## Run From Source

Requirements:

- Node.js
- npm
- Rust stable toolchain
- Windows: Visual Studio Build Tools with MSVC C++ tools
- macOS: Xcode Command Line Tools

Install dependencies:

```bash
npm install
```

Start the browser development server:

```bash
npm run dev
```

Start the desktop app in development mode:

```bash
npm run desktop:dev
```

Run a production frontend build:

```bash
npm run build
```

Run TypeScript checking:

```bash
npm run typecheck
```

Build the desktop app:

```bash
npm run desktop:build
```

Build Windows installers:

```bash
npm run desktop:build:windows
```

Build a macOS app and DMG on macOS:

```bash
npm run desktop:build:mac
```

## Acknowledgements

AutoPhoto does not include copied source code from other applications. It is built with and thanks the following open-source projects:

- [Tauri](https://tauri.app/)
- [React](https://react.dev/)
- [Vite](https://vite.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Rust](https://www.rust-lang.org/)
- [SQLite](https://www.sqlite.org/)
- [rusqlite](https://github.com/rusqlite/rusqlite)
- [reqwest](https://github.com/seanmonstar/reqwest)
- [keyring-rs](https://github.com/open-source-cooperative/keyring-rs)
- [exifr](https://github.com/MikeKovarik/exifr)
- [kamadak-exif](https://github.com/kamadak/exif-rs)
- [lucide-react](https://lucide.dev/)

## License

See [LICENSE](LICENSE).
