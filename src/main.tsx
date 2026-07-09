import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const renderApp = () => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search);
  const devDiagnostics = params.get("diagnostics") ?? import.meta.env.VITE_AUTO_PHOTO_DIAGNOSTICS;

  if (devDiagnostics === "phase5" || devDiagnostics === "phase5-process") {
    void import("./diagnostics/phase5Diagnostics").then(({ runPhase5Diagnostics }) => runPhase5Diagnostics());
  } else if (devDiagnostics === "phase5-ui") {
    void import("./diagnostics/phase5UiDiagnostics").then(({ runPhase5UiDiagnostics }) => runPhase5UiDiagnostics());
  } else if (devDiagnostics === "phase5-export") {
    void import("./diagnostics/phase5ExportDiagnostics").then(({ runPhase5ExportDiagnostics }) => runPhase5ExportDiagnostics());
  } else if (devDiagnostics === "phase5-samples") {
    void import("./diagnostics/phase5SampleDiagnostics").then(({ runPhase5SampleDiagnostics }) => runPhase5SampleDiagnostics());
  } else if (devDiagnostics === "phase5-desktop") {
    void import("./diagnostics/phase5DesktopDiagnostics").then(({ runPhase5DesktopDiagnostics }) =>
      runPhase5DesktopDiagnostics()
    );
  } else if (devDiagnostics === "phase5-exif") {
    void import("./diagnostics/phase5ExifDiagnostics").then(({ runPhase5ExifDiagnostics }) => runPhase5ExifDiagnostics());
  } else if (devDiagnostics === "phase5-raw-preview") {
    void import("./diagnostics/phase5RawPreviewDiagnostics").then(({ runPhase5RawPreviewDiagnostics }) =>
      runPhase5RawPreviewDiagnostics()
    );
  } else if (devDiagnostics === "phase5-generated-jpg") {
    void import("./diagnostics/phase5GeneratedJpgDiagnostics").then(({ runPhase5GeneratedJpgDiagnostics }) =>
      runPhase5GeneratedJpgDiagnostics()
    );
  } else if (devDiagnostics === "phase5-ai-raw") {
    void import("./diagnostics/phase5AiRawDiagnostics").then(({ runPhase5AiRawDiagnostics }) =>
      runPhase5AiRawDiagnostics()
    );
  } else if (devDiagnostics === "phase5-ai-batch-export") {
    void import("./diagnostics/phase5AiBatchExportDiagnostics").then(({ runPhase5AiBatchExportDiagnostics }) =>
      runPhase5AiBatchExportDiagnostics()
    );
  } else if (devDiagnostics === "phase5-ai-connection") {
    void import("./diagnostics/phase5AiConnectionDiagnostics").then(({ runPhase5AiConnectionDiagnostics }) =>
      runPhase5AiConnectionDiagnostics()
    );
  } else if (devDiagnostics === "phase5-ai-live") {
    void import("./diagnostics/phase5AiLiveDiagnostics").then(({ runPhase5AiLiveDiagnostics }) =>
      runPhase5AiLiveDiagnostics()
    );
  } else if (devDiagnostics === "phase5-ai-raw-live") {
    void import("./diagnostics/phase5AiRawLiveDiagnostics").then(({ runPhase5AiRawLiveDiagnostics }) =>
      runPhase5AiRawLiveDiagnostics()
    );
  } else {
    renderApp();
  }
} else {
  renderApp();
}
