import { extensionDownloadUrl, extensionInstallUrl, extensionVersion } from "@/lib/config";

import type { ExtensionRelease } from "@acorn/shared/extension-release";

/** The newest Acorn extension this site was deployed with, and where to get it. */
export function GET() {
  const release: ExtensionRelease = {
    version: extensionVersion(),
    downloadUrl: extensionDownloadUrl(),
    installUrl: extensionInstallUrl(),
  };
  return Response.json(release, { headers: { "Cache-Control": "no-store" } });
}
