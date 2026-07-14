import { access, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src-tauri", "mobile", "android", "GalleryPlugin.kt");
const generatedProject = path.join(root, "src-tauri", "gen", "android");
const destinationDirectory = path.join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "autophoto",
  "gallery"
);

try {
  await access(path.join(generatedProject, "app", "build.gradle.kts"));
} catch {
  throw new Error("Android project is not initialized. Run npm run mobile:android:init first.");
}

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, path.join(destinationDirectory, "GalleryPlugin.kt"));
console.log("Installed Android gallery plugin into the generated project.");
