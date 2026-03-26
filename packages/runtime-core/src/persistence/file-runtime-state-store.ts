import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeSessionSnapshot, RuntimeStateStore } from "@neurocore/protocol";

export interface FileRuntimeStateStoreOptions {
  directory: string;
}

export class FileRuntimeStateStore implements RuntimeStateStore {
  private readonly directory: string;

  public constructor(options: FileRuntimeStateStoreOptions) {
    this.directory = options.directory;
    mkdirSync(this.directory, { recursive: true });
  }

  public getSession(sessionId: string): RuntimeSessionSnapshot | undefined {
    const target = this.sessionPath(sessionId);
    if (!existsSync(target)) {
      return undefined;
    }

    return parseSnapshot(readFileSync(target, "utf8"), target);
  }

  public listSessions(): RuntimeSessionSnapshot[] {
    return readdirSync(this.directory)
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map((entry) => {
        const target = join(this.directory, entry);
        return parseSnapshot(readFileSync(target, "utf8"), target);
      });
  }

  public saveSession(snapshot: RuntimeSessionSnapshot): void {
    const target = this.sessionPath(snapshot.session.session_id);
    const tempTarget = `${target}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tempTarget, JSON.stringify(snapshot, null, 2));
    renameSync(tempTarget, target);
  }

  public deleteSession(sessionId: string): void {
    const target = this.sessionPath(sessionId);
    if (existsSync(target)) {
      rmSync(target);
    }
  }

  private sessionPath(sessionId: string): string {
    return join(this.directory, `${sessionId}.json`);
  }
}

function parseSnapshot(raw: string, target: string): RuntimeSessionSnapshot {
  const parsed = JSON.parse(raw) as RuntimeSessionSnapshot;
  if (!parsed?.session?.session_id) {
    throw new Error(`Invalid runtime session snapshot at ${target}.`);
  }
  return parsed;
}
