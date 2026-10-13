import { Link, Text } from "sid-ui";
import { ROUTES } from "@/lib/routes";

/** The consent line under a sign-in control: names the action and links both documents. */
export function LegalLinks({ action }: { action: string }) {
  return (
    <Text type="supporting" color="secondary" display="block">
      By {action} you agree to the <Link href={ROUTES.terms}>Terms of Service</Link> and{" "}
      <Link href={ROUTES.privacy}>Privacy Policy</Link>.
    </Text>
  );
}
