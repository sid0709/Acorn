import { redirect } from "next/navigation";

import { HOME_ROUTE } from "@/lib/routes";

export default function DashboardHome() {
  redirect(HOME_ROUTE);
}
