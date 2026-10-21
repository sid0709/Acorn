import { GOOGLE_AUTH_ROUTE } from "@acorn/google-signin";
import { Banner, GoogleSignInButton, Link, Stack, Text } from "sid-ui";
import { LegalLinks } from "@/components/legal/legal-links";
import { ROUTES } from "@/lib/routes";

export function AuthForm({
  mode,
  googleError = "",
}: {
  mode: "sign-in" | "sign-up";
  googleError?: string;
}) {
  const creating = mode === "sign-up";

  return (
    <Stack gap={6}>
      {googleError ? <Banner status="error" title={googleError} /> : null}
      <GoogleSignInButton
        action={GOOGLE_AUTH_ROUTE}
        next={ROUTES.overview}
        label={creating ? "Sign up with Google" : "Continue with Google"}
      />
      <Text color="secondary">
        {creating ? (
          <Link href={ROUTES.signIn}>Already have an account? Sign in</Link>
        ) : (
          <Link href={ROUTES.signUp}>New here? Create an account</Link>
        )}
      </Text>
      <LegalLinks action={creating ? "creating an account" : "signing in"} />
    </Stack>
  );
}
