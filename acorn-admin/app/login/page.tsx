import { redirect } from "next/navigation";
import { PageContainer } from "sid-ui";

import { LoginForm } from "@/components/login-form";
import { currentAdminEmail } from "@/lib/auth/session";
import { HOME_ROUTE } from "@/lib/routes";

export default async function LoginPage() {
  const email = await currentAdminEmail();
  if (email) redirect(HOME_ROUTE);
  return (
    <main className="admin-login">
      <PageContainer width="narrow">
        <LoginForm />
      </PageContainer>
    </main>
  );
}
