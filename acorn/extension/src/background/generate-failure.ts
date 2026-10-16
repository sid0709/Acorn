import { getJobGenerate, patchJobGenerate } from "../tab-job-generate-session";

export async function patchJobGenerateFailed(jobId: string, error: string): Promise<void> {
  const row = await getJobGenerate(jobId);
  if (row?.generateStatus === "failed" && row.checkpoint) {
    if (!row.generateError) {
      await patchJobGenerate(jobId, { generateError: error });
    }
    return;
  }
  await patchJobGenerate(jobId, {
    generateStatus: "failed",
    generateError: error,
  });
}
