import type { TursoClient, TursoResult, TursoRow, TursoStatement } from "./tursoClient.js";

// A local-first Turso client.
//
// `@libsql/client` talks to the cloud database over the network for every
// statement. This one keeps a full local copy: reads and writes hit the local
// file, and changes are exchanged with Turso Cloud through push/pull. That is
// what makes the app usable with no connection — the write lands locally and
// reaches the cloud on the next successful sync.
//
// The package is pre-1.0 (see docs/ROADMAP.md, Phase 5.5), which is why the
// dependency is confined to this one module: everything above it talks to the
// `TursoClient` interface, and the remote client still satisfies that too.

/** The slice of `@tursodatabase/sync`'s Database this client drives. */
type SyncDatabase = {
  exec(sql: string): Promise<void>;
  prepare(sql: string): Promise<{
    all(...args: unknown[]): Promise<TursoRow[]>;
    run(...args: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  }>;
  push(): Promise<void>;
  pull(): Promise<boolean>;
  close(): Promise<void>;
};

export type TursoSyncClientOptions = {
  /** Local file the replica lives in; sibling files (-wal, -info) sit next to it. */
  path: string;
  /** Remote database. Omit for a local-only database that never syncs. */
  url?: string;
  authToken?: string;
  /** Pull+push on this cadence. 0 disables the timer; writes still push. */
  syncIntervalMs?: number;
  logger?: { warn: (entry: Record<string, unknown>) => void };
  /** Test seam: supply the sync database instead of opening a real one. */
  connectImpl?: (opts: { path: string; url?: string; authToken?: string }) => Promise<SyncDatabase>;
};

export type TursoSyncClient = TursoClient & {
  /** Pull remote changes, then push local ones. Tolerates being offline. */
  sync(): Promise<void>;
  isSyncEnabled(): boolean;
  close(): Promise<void>;
};

/**
 * Whether a statement yields rows.
 *
 * `.all()` on a non-returning statement gives `[]` rather than throwing, but it
 * also gives no change count — and `rowsAffected` is what the repositories use
 * to tell "deleted" from "not found". So the two cases are dispatched here
 * instead of guessed at the call site.
 */
function returnsRows(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
}

/**
 * Whether a statement changes data, and so needs pushing.
 *
 * Deliberately a separate question from {@link returnsRows}: `INSERT … RETURNING`
 * is both — it yields a row *and* is the most common write in this codebase.
 * Conflating the two would have left every saved band unsynced.
 *
 * Misreading a read as a write only costs a redundant push, so the rule leans
 * that way: only a plain `SELECT`, or a `WITH` with no DML in it, counts as a read.
 */
function isWrite(sql: string): boolean {
  if (/^\s*select\b/i.test(sql)) return false;
  if (/^\s*with\b/i.test(sql)) return /\b(insert|update|delete|replace)\b/i.test(sql);
  return true;
}

function normalize(statement: TursoStatement | string): TursoStatement {
  return typeof statement === "string" ? { sql: statement } : statement;
}

/**
 * Loads the ESM-only `@tursodatabase/sync` from this CommonJS build.
 *
 * Its dependency `@tursodatabase/serverless` declares only an `import`
 * condition in its exports map. Node 26 can `require()` it fine, but this
 * repo runs TypeScript through tsx, whose CJS resolver hook resolves the
 * specifier itself and fails with ERR_PACKAGE_PATH_NOT_EXPORTED — in tests and
 * in production alike, since `npm start` is `tsx src/server.ts`. tsx 4.23.12 is
 * the newest release, so there is no version to upgrade to.
 *
 * `new Function` keeps this a real dynamic `import()`: esbuild would otherwise
 * rewrite a plain `await import(...)` into a `require`, landing back on the
 * broken path. The proper fix is to make this workspace an ES module — tracked
 * in docs/ROADMAP.md rather than done here, because it touches every file.
 */
const importEsm = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<{ connect: (opts: unknown) => Promise<SyncDatabase> }>;

async function openSyncDatabase(opts: { path: string; url?: string; authToken?: string }): Promise<SyncDatabase> {
  const { connect } = await importEsm("@tursodatabase/sync");
  return connect(opts);
}

export async function createTursoSyncClient({
  path,
  url,
  authToken,
  syncIntervalMs = 60_000,
  logger = console,
  connectImpl,
}: TursoSyncClientOptions): Promise<TursoSyncClient> {
  const open = connectImpl ?? openSyncDatabase;
  const db = await open({ path, url, authToken });
  const syncEnabled = Boolean(url);

  // Offline is the expected state, not an error: the write is already durable
  // locally, so a failed exchange is logged and retried on the next one.
  async function trySync(step: "push" | "pull"): Promise<void> {
    if (!syncEnabled) return;
    try {
      await (step === "push" ? db.push() : db.pull());
    } catch (error) {
      logger.warn({
        level: "warn",
        message: `turso sync ${step} failed; changes stay local until the next attempt`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function runStatement({ sql, args = [] }: TursoStatement): Promise<TursoResult> {
    const stmt = await db.prepare(sql);
    if (returnsRows(sql)) {
      const rows = await stmt.all(...args);
      return { rows, rowsAffected: 0 };
    }
    const { changes } = await stmt.run(...args);
    return { rows: [], rowsAffected: Number(changes) };
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  if (syncEnabled && syncIntervalMs > 0) {
    timer = setInterval(() => { void sync(); }, syncIntervalMs);
    // Never keep the process alive just to sync.
    timer.unref?.();
  }

  async function sync(): Promise<void> {
    await trySync("pull");
    await trySync("push");
  }

  return {
    async execute(statement) {
      const normalized = normalize(statement);
      const result = await runStatement(normalized);
      if (isWrite(normalized.sql)) await trySync("push");
      return result;
    },

    async batch(statements) {
      const results: TursoResult[] = [];
      let wrote = false;
      for (const statement of statements) {
        const normalized = normalize(statement);
        results.push(await runStatement(normalized));
        if (isWrite(normalized.sql)) wrote = true;
      }
      if (wrote) await trySync("push");
      return results;
    },

    sync,
    isSyncEnabled: () => syncEnabled,

    async close() {
      if (timer) clearInterval(timer);
      await db.close();
    },
  };
}
