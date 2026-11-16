import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

export async function withStorageDirectory(name: string, testFile: string, run: (directory: string) => Promise<void>) {
  const childDirectory = process.env.BANDSEARCH_STORAGE_TEST_DIRECTORY;
  if (childDirectory) return run(childDirectory);

  const directory = await mkdtemp(path.join(tmpdir(), "storage-consistency-"));
  try {
    // The local libSQL driver can retain native file handles until GC even after
    // client.close(). Windows cannot unlink them. Keep the real adapter tests,
    // but let process exit release every handle before the parent removes files.
    const pattern = `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, ["--import", "tsx", "--test", "--test-name-pattern", pattern, testFile], {
        env: { ...process.env, NODE_TEST_CONTEXT: undefined, BANDSEARCH_STORAGE_TEST_DIRECTORY: directory },
      }, (error, stdout, stderr) => {
        if (error) reject(new Error(`${error.message}\n${stdout}\n${stderr}`, { cause: error }));
        else resolve();
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
