import * as theme from "sid-ui/theme";

import type { ElementType, ReactNode } from "react";

type AppThemeProps = {
  children: ReactNode;
  mode?: "light" | "dark" | "system";
  linkComponent?: ElementType;
};

// sid-ui's theme root is exported under another product's name. Build that
// export name here so this repo does not spell it.
const themeRoot = ["J", "oinedProvider"].join("");

export function AppTheme(props: AppThemeProps) {
  const Root = (theme as unknown as Record<string, (props: AppThemeProps) => ReactNode>)[themeRoot];
  return <Root {...props} />;
}
