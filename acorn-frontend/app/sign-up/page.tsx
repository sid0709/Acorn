import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GOOGLE_ERROR_PARAM, googleErrorMessage } from "@acorn/google-signin";
import { Heading, PageContainer, Stack, Text } from "sid-ui";
import { AuthForm } from "@/components/auth-form";
import { SiteHeader } from "@/components/site-header";
import { currentAccount } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Create your free account",
  description:
    "Create a free Acorn account and let the No. 1 auto-bid agent apply to jobs for you: AI autofill, ATS-friendly resumes, and recruiter reply tracking.",
  alternates: { canonical: ROUTES.signUp },
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ [GOOGLE_ERROR_PARAM]?: string }>;
}) {
  const params = await searchParams;
  if (await currentAccount()) redirect(ROUTES.overview);
  return (
    <PageContainer width="narrow">
      <Stack gap={8}>
        <SiteHeader />
        <Stack gap={1}>
          <Heading level={1}>Create an Acorn account</Heading>
          <Text color="secondary">The extension uses this same sign-in.</Text>
        </Stack>
        <AuthForm mode="sign-up" googleError={googleErrorMessage(params[GOOGLE_ERROR_PARAM])} />
      </Stack>
    </PageContainer>
  );
}
