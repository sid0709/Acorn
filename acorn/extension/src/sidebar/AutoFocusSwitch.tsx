import { Switch } from "sid-ui";

import { autoFocusSeconds } from "../auto-focus-settings";

import { useAutoFocus } from "./use-auto-focus";

/** Turns on Auto-Focus: run tabs take turns in front while Run works in several tabs. */
export function AutoFocusSwitch() {
  const { enabled, setEnabled } = useAutoFocus();
  return (
    <Switch
      label="Auto-Focus"
      description={`While Run works in several tabs, bring each one to the front in turn, every ${autoFocusSeconds()} s.`}
      value={enabled}
      onChange={setEnabled}
      labelSpacing="spread"
    />
  );
}
