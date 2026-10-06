import { createRoot } from "react-dom/client";
import { AppTheme } from "@acorn/app-theme";
import SidebarApp from "./SidebarApp";
import { ErrorBoundary } from "./ErrorBoundary";
import { AcornNoticeHost } from "./AcornNoticeHost";
import "./sidebar.css";

createRoot(document.getElementById("root")!).render(
  <AppTheme mode="light">
    <ErrorBoundary>
      <SidebarApp />
    </ErrorBoundary>
    <AcornNoticeHost />
  </AppTheme>,
);
