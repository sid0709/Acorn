import { AppTheme } from "@acorn/app-theme";
import { createRoot } from "react-dom/client";

import { AcornNoticeHost } from "./AcornNoticeHost";
import { ErrorBoundary } from "./ErrorBoundary";
import SidebarApp from "./SidebarApp";
import "./sidebar.css";

createRoot(document.getElementById("root")!).render(
  <AppTheme mode="light">
    <ErrorBoundary>
      <SidebarApp />
    </ErrorBoundary>
    <AcornNoticeHost />
  </AppTheme>,
);
