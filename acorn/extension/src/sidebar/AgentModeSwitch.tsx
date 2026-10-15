import { Switch } from "sid-ui";

import { useAgentMode } from "./use-agent-mode";

/** Run with the agent: it works from screenshots, like a person at the keyboard. */
export function AgentModeSwitch() {
  const { enabled, setEnabled } = useAgentMode();
  return (
    <Switch
      label="Agent Run"
      description="Run looks at the page and clicks and types like a person, planned by the Acorn agent on this computer. Turn off to use the page-reading Run."
      value={enabled}
      onChange={setEnabled}
      labelSpacing="spread"
    />
  );
}
