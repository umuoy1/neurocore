export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

export interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export class Logger {
  private readonly minLevel: number;

  public constructor(options?: { minLevel?: LogLevel }) {
    this.minLevel = LEVEL_ORDER[options?.minLevel ?? "info"];
  }

  public debug(message: string, fields?: Record<string, unknown>): void {
    this.log("debug", message, fields);
  }

  public info(message: string, fields?: Record<string, unknown>): void {
    this.log("info", message, fields);
  }

  public warn(message: string, fields?: Record<string, unknown>): void {
    this.log("warn", message, fields);
  }

  public error(message: string, fields?: Record<string, unknown>): void {
    this.log("error", message, fields);
  }

  private log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) {
      return;
    }

    const entry: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields
    };

    process.stdout.write(JSON.stringify(entry) + "\n");
  }
}
