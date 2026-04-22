export interface SpanEvent {
  name: string;
  attributes?: Record<string, unknown>;
  timestamp?: string;
}

export interface RuntimeSpan {
  setAttribute(key: string, value: unknown): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  recordException(error: unknown): void;
  end(): void;
}

export interface RuntimeTracer {
  startSpan(name: string, attributes?: Record<string, unknown>): RuntimeSpan;
}

export class NoopRuntimeSpan implements RuntimeSpan {
  public setAttribute(): void {}
  public addEvent(): void {}
  public recordException(): void {}
  public end(): void {}
}

export class NoopRuntimeTracer implements RuntimeTracer {
  public startSpan(): RuntimeSpan {
    return new NoopRuntimeSpan();
  }
}
