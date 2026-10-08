import { Switch } from "sid-ui";

import { useStopBeforeSubmit } from "./use-stop-before-submit";

/** Turns on Stop before Submit: Run fills the last step and leaves sending it to you. */
export function StopBeforeSubmitSwitch() {
  const { enabled, setEnabled } = useStopBeforeSubmit();
  return (
    <Switch
      label="Stop before Submit"
      description="Run fills every step, then stops on the last one so you review and submit it yourself."
      value={enabled}
      onChange={setEnabled}
      labelSpacing="spread"
    />
  );
}
