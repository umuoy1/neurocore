import type { SessionReplay, TraceStore } from "@neurocore/protocol";
import { debugLog } from "../utils/debug.js";

export class ReplayRunner {
  public constructor(private readonly traceStore: TraceStore) {}

  public replaySession(sessionId: string): SessionReplay {
    const traces = this.traceStore.list(sessionId);
    const finalRecord = traces.at(-1);
    const finalOutput =
      finalRecord?.observation?.summary ??
      finalRecord?.selected_action?.description ??
      finalRecord?.selected_action?.title;

    debugLog("replay", "Replayed session from trace store", {
      sessionId,
      cycleCount: traces.length,
      finalOutputPreview: finalOutput?.slice(0, 160)
    });

    return {
      session_id: sessionId,
      cycle_count: traces.length,
      traces,
      final_output: finalOutput
    };
  }

  public replayCycle(sessionId: string, cycleId: string) {
    const record = this.traceStore.getCycleRecord(sessionId, cycleId);
    debugLog("replay", "Loaded replay cycle record", {
      sessionId,
      cycleId,
      found: Boolean(record)
    });
    return record;
  }
}
