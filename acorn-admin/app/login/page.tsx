import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { currentAdminEmail } from "@/lib/auth/session";

export default async function LoginPage() {
  const email = await currentAdminEmail();
  if (email) redirect("/claims");
  return (
    <main className="acorn-admin-main">
      <LoginForm />
    </main>
  );
}
