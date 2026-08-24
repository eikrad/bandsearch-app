// The slice of a libSQL-shaped client the Turso repositories actually use.
//
// They only ever call `execute` and `batch`, so naming that surface here keeps
// them independent of which client implements it: the remote `@libsql/client`
// for a plain cloud database, or the local-first sync client for an offline
// -capable one. Both satisfy this structurally.

export type TursoRow = Record<string, unknown>;

/** What SQLite can bind. Kept in step with libSQL's `InValue` so its client fits. */
export type TursoValue = string | number | bigint | boolean | null | Uint8Array | Date;

export type TursoStatement = { sql: string; args?: TursoValue[] };

export type TursoResult = { rows: TursoRow[]; rowsAffected: number };

export type TursoClient = {
  execute(statement: TursoStatement | string): Promise<TursoResult>;
  batch(statements: TursoStatement[], mode?: string): Promise<TursoResult[]>;
};
