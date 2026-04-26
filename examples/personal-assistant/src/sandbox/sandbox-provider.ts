import { spawn } from "node:child_process";
import { join } from "node:path";

export type SandboxTarget = "local" | "docker" | "ssh";
export type SandboxOperation = "exec" | "file_read" | "file_write" | "browser";

export interface SandboxCommandInput {
  target?: SandboxTarget;
  operation?: SandboxOperation;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeout_ms?: number;
  signal?: AbortSignal;
}

export interface SandboxCommandResult {
  provider_name: string;
  target: SandboxTarget;
  operation: SandboxOperation;
  command: string;
  cwd?: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  started_at: string;
  ended_at: string;
  trace: {
    provider_name: string;
    target: SandboxTarget;
    executable: string;
    args: string[];
    cwd?: string;
    timeout_ms?: number;
    operation: SandboxOperation;
  };
}

export interface SandboxProvider {
  name: string;
  target: SandboxTarget;
  execute(input: SandboxCommandInput): Promise<SandboxCommandResult>;
}

export interface SandboxProcessRunInput {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeout_ms?: number;
  signal?: AbortSignal;
}

export interface SandboxProcessRunResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

export interface SandboxProcessRunner {
  run(input: SandboxProcessRunInput): Promise<SandboxProcessRunResult>;
}

export interface LocalSandboxProviderOptions {
  shell?: string;
  runner?: SandboxProcessRunner;
  cwd?: string;
}

export interface DockerSandboxProviderOptions {
  image?: string;
  hostWorkspace?: string;
  containerWorkspace?: string;
  shell?: string;
  runner?: SandboxProcessRunner;
}

export interface SshSandboxProviderOptions {
  host: string;
  user?: string;
  port?: number;
  workspace?: string;
  runner?: SandboxProcessRunner;
}

export class NodeSandboxProcessRunner implements SandboxProcessRunner {
  public async run(input: SandboxProcessRunInput): Promise<SandboxProcessRunResult> {
    return new Promise((resolve) => {
      const child = spawn(input.executable, input.args, {
        cwd: input.cwd,
        env: {
          PATH: process.env.PATH ?? "",
          ...(input.env ?? {})
        },
        stdio: ["pipe", "pipe", "pipe"]
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: SandboxProcessRunResult) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve(result);
      };

      if (input.timeout_ms && input.timeout_ms > 0) {
        timeout = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, input.timeout_ms);
      }

      input.signal?.addEventListener("abort", () => {
        child.kill("SIGTERM");
      }, { once: true });

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error) => {
        finish({
          exit_code: -1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: `${Buffer.concat(stderr).toString("utf8")}${error.message}`,
          timed_out: timedOut
        });
      });
      child.on("close", (code) => {
        finish({
          exit_code: code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timed_out: timedOut
        });
      });

      if (input.stdin !== undefined) {
        child.stdin.end(input.stdin);
      } else {
        child.stdin.end();
      }
    });
  }
}

export class LocalSandboxProvider implements SandboxProvider {
  public readonly name = "local-sandbox-provider";
  public readonly target = "local";
  private readonly runner: SandboxProcessRunner;
  private readonly shell: string;

  public constructor(private readonly options: LocalSandboxProviderOptions = {}) {
    this.runner = options.runner ?? new NodeSandboxProcessRunner();
    this.shell = options.shell ?? "sh";
  }

  public async execute(input: SandboxCommandInput): Promise<SandboxCommandResult> {
    return runWithTrace({
      providerName: this.name,
      target: this.target,
      operation: input.operation ?? "exec",
      command: input.command,
      executable: this.shell,
      args: ["-lc", input.command],
      cwd: input.cwd ?? this.options.cwd,
      env: input.env,
      stdin: input.stdin,
      timeoutMs: input.timeout_ms,
      signal: input.signal,
      runner: this.runner
    });
  }
}

export class DockerSandboxProvider implements SandboxProvider {
  public readonly name = "docker-sandbox-provider";
  public readonly target = "docker";
  private readonly runner: SandboxProcessRunner;

  public constructor(private readonly options: DockerSandboxProviderOptions = {}) {
    this.runner = options.runner ?? new NodeSandboxProcessRunner();
  }

  public async execute(input: SandboxCommandInput): Promise<SandboxCommandResult> {
    const image = this.options.image ?? "node:22-alpine";
    const containerWorkspace = this.options.containerWorkspace ?? "/workspace";
    const args = [
      "run",
      "--rm",
      "-i",
      ...(this.options.hostWorkspace
        ? ["-v", `${this.options.hostWorkspace}:${containerWorkspace}`]
        : []),
      "-w",
      containerWorkspace,
      image,
      this.options.shell ?? "sh",
      "-lc",
      input.command
    ];

    return runWithTrace({
      providerName: this.name,
      target: this.target,
      operation: input.operation ?? "exec",
      command: input.command,
      executable: "docker",
      args,
      env: input.env,
      stdin: input.stdin,
      timeoutMs: input.timeout_ms,
      signal: input.signal,
      runner: this.runner
    });
  }
}

export class SshSandboxProvider implements SandboxProvider {
  public readonly name = "ssh-sandbox-provider";
  public readonly target = "ssh";
  private readonly runner: SandboxProcessRunner;

  public constructor(private readonly options: SshSandboxProviderOptions) {
    this.runner = options.runner ?? new NodeSandboxProcessRunner();
  }

  public async execute(input: SandboxCommandInput): Promise<SandboxCommandResult> {
    const destination = this.options.user
      ? `${this.options.user}@${this.options.host}`
      : this.options.host;
    const workspace = input.cwd ?? this.options.workspace;
    const remoteCommand = workspace
      ? `cd ${quoteShell(workspace)} && ${input.command}`
      : input.command;
    const args = [
      ...(this.options.port ? ["-p", String(this.options.port)] : []),
      destination,
      remoteCommand
    ];

    return runWithTrace({
      providerName: this.name,
      target: this.target,
      operation: input.operation ?? "exec",
      command: input.command,
      executable: "ssh",
      args,
      env: input.env,
      stdin: input.stdin,
      timeoutMs: input.timeout_ms,
      signal: input.signal,
      runner: this.runner
    });
  }
}

export class SandboxManager {
  private readonly providers = new Map<SandboxTarget, SandboxProvider>();

  public constructor(
    providers: SandboxProvider[],
    private readonly defaultTarget: SandboxTarget = "local"
  ) {
    for (const provider of providers) {
      this.providers.set(provider.target, provider);
    }
  }

  public listProviders(): Array<{ name: string; target: SandboxTarget }> {
    return [...this.providers.values()].map((provider) => ({
      name: provider.name,
      target: provider.target
    }));
  }

  public async execute(input: SandboxCommandInput): Promise<SandboxCommandResult> {
    const target = input.target ?? this.defaultTarget;
    const provider = this.providers.get(target);
    if (!provider) {
      throw new Error(`Sandbox provider for target "${target}" is not configured.`);
    }
    return provider.execute({ ...input, target });
  }
}

export interface PersonalAssistantSandboxConfig {
  enabled?: boolean;
  default_target?: SandboxTarget;
  force_tools?: string[];
  local?: {
    cwd?: string;
    shell?: string;
  };
  docker?: {
    image?: string;
    host_workspace?: string;
    container_workspace?: string;
    shell?: string;
  };
  ssh?: {
    host?: string;
    user?: string;
    port?: number;
    workspace?: string;
  };
}

export function createSandboxManagerFromConfig(
  config: PersonalAssistantSandboxConfig | undefined
): SandboxManager | undefined {
  if (!config?.enabled) {
    return undefined;
  }

  const providers: SandboxProvider[] = [
    new LocalSandboxProvider({
      cwd: config.local?.cwd,
      shell: config.local?.shell
    })
  ];

  providers.push(new DockerSandboxProvider({
    image: config.docker?.image,
    hostWorkspace: config.docker?.host_workspace,
    containerWorkspace: config.docker?.container_workspace,
    shell: config.docker?.shell
  }));

  if (config.ssh?.host) {
    providers.push(new SshSandboxProvider({
      host: config.ssh.host,
      user: config.ssh.user,
      port: config.ssh.port,
      workspace: config.ssh.workspace
    }));
  }

  return new SandboxManager(providers, config.default_target ?? "local");
}

export function defaultSandboxForceTools(): string[] {
  return ["bash", "exec", "file_edit", "file_write", "shell", "sh", "terminal", "write_file", "zsh"];
}

export function defaultSandboxedTools(): string[] {
  return ["sandbox_file_read", "sandbox_file_write", "sandbox_shell"];
}

export function resolveWorkspacePath(root: string, requestedPath: string): string {
  return join(root, requestedPath);
}

function runWithTrace(input: {
  providerName: string;
  target: SandboxTarget;
  operation: SandboxOperation;
  command: string;
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  runner: SandboxProcessRunner;
}): Promise<SandboxCommandResult> {
  const startedAt = new Date().toISOString();
  return input.runner.run({
    executable: input.executable,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    stdin: input.stdin,
    timeout_ms: input.timeoutMs,
    signal: input.signal
  }).then((result) => {
    const endedAt = new Date().toISOString();
    return {
      provider_name: input.providerName,
      target: input.target,
      operation: input.operation,
      command: input.command,
      cwd: input.cwd,
      exit_code: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr,
      timed_out: result.timed_out,
      started_at: startedAt,
      ended_at: endedAt,
      trace: {
        provider_name: input.providerName,
        target: input.target,
        executable: input.executable,
        args: input.args,
        cwd: input.cwd,
        timeout_ms: input.timeoutMs,
        operation: input.operation
      }
    };
  });
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
