import type { Page } from "@playwright/test";

/**
 * Answers the app's searches with `answer()` the way the search job API does
 * (ADR 0006): starting one returns a job id, following it streams the answer
 * as its `done` event. `answer` is called once per search, as it starts.
 */
export async function answerSearches(page: Page, answer: () => unknown): Promise<void> {
  const answers = new Map<string, unknown>();
  const cors = { "access-control-allow-origin": "*" };
  await page.route("**/recommendations/jobs", (route) => {
    const jobId = `job-${answers.size + 1}`;
    answers.set(jobId, answer());
    return route.fulfill({ status: 202, headers: cors, json: { jobId } });
  });
  await page.route("**/recommendations/jobs/*", (route) => {
    const jobId = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    if (route.request().method() === "DELETE") return route.fulfill({ status: 204, headers: cors });
    if (!answers.has(jobId)) {
      return route.fulfill({ status: 404, headers: cors, json: { error: { code: "search_job_not_found", message: "search job not found" } } });
    }
    return route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "text/event-stream; charset=utf-8" },
      body: `id: 1\ndata: ${JSON.stringify({ type: "done", response: answers.get(jobId) })}\n\n`,
    });
  });
}
