import { proxyRunScreenshot } from "@/lib/workspace/run-screenshot";

/** The full-page screenshot of one sent application, for the dashboard's list. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyRunScreenshot(id);
}
