import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { filterSecretEnv } from "../security/credential-vault.js";

export type SandboxTarget = "local" | "docker" | "ssh" | "serverless";
export type SandboxOperation = "exec" | "file_read" | "file_write" | "browser";
export type SandboxEnvironmentLifecycle = "cold" | "active" | "hibernated" | "resumed" | "terminated";

export interface SandboxEnvironmentMetadata {
  environment_id: string;
  target: SandboxTarget;
  backend: string;
  lifecycle: SandboxEnvironmentLifecycle;
  workspace?: string;
  created_at: string;
  updated_at: string;
  hibernated_at?: string;
  resumed_at?: string;
  checkpoint_id?: string;
  restore_count: number;
  estimated_cost_usd: number;
  cost_limit_usd?: number;
  secrets_injected: boolean;
  metadata: Record<string, unknown>;
}

export interface SandboxCostMetadata {
  elapsed_ms: number;
  estimated_cost_usd: number;
  cost_limit_usd?: number;
}

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
  environment?: SandboxEnvironmentMetadata;
  cost?: SandboxCostMetadata;
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

export interface SandboxEnvironmentProvider extends SandboxProvider {
  getEnvironmentStatus(): SandboxEnvironmentMetadata;
  hibernate(): SandboxEnvironmentMetadata;
  resume(): SandboxEnvironmentMetadata;
}

export interface SandboxEnvironmentStateStore {
  get(target: SandboxTarget, backend: string): SandboxEnvironmentMetadata | undefined;
  upsert(environment: SandboxEnvironmentMetadata): void;
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

export interface ServerlessSandboxProviderOptions {
  backend?: string;
  workspace?: string;
  shell?: string;
  runner?: SandboxProcessRunner;
  stateStore?: SandboxEnvironmentStateStore;
  statePath?: string;
  costPerSecondUsd?: number;
  costLimitUsd?: number;
  metadata?: Record<string, unknown>;
}

interface SandboxEnvironmentStateFile {
  environments: Record<string, SandboxEnvironmentMetadata>;
}

export class InMemorySandboxEnvironmentStateStore implements SandboxEnvironmentStateStore {
  private readonly environments = new Map<string, SandboxEnvironmentMetadata>();

  public get(target: SandboxTarget, backend: string): SandboxEnvironmentMetadata | undefined {
    const environment = this.environments.get(environmentKey(target, backend));
    return environment ? cloneEnvironment(environment) : undefined;
  }

  public upsert(environment: SandboxEnvironmentMetadata): void {
    this.environments.set(environmentKey(environment.target, environment.backend), cloneEnvironment(environment));
  }
}

export class JsonSandboxEnvironmentStateStore implements SandboxEnvironmentStateStore {
  public constructor(private readonly filename: string) {}

  public get(target: SandboxTarget, backend: string): SandboxEnvironmentMetadata | undefined {
    const environment = this.read().environments[environmentKey(target, backend)];
    return environment ? cloneEnvironment(environment) : undefined;
  }

  public upsert(environment: SandboxEnvironmentMetadata): void {
    const state = this.read();
    state.environments[environmentKey(environment.target, environment.backend)] = cloneEnvironment(environment);
    mkdirSync(dirname(this.filename), { recursive: true });
    writeFileSync(this.filename, `${JSON.stringify(state, null, 2)}\n`);
  }

  private read(): SandboxEnvironmentStateFile {
    if (!existsSync(this.filename)) {
      return { environments: {} };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filename, "utf8")) as Partial<SandboxEnvironmentStateFile>;
      return {
        environments: parsed.environments ?? {}
      };
    } catch {
      return { environments: {} };
    }
  }
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

export class ServerlessSandboxProvider implements SandboxEnvironmentProvider {
  public readonly target = "serverless";
  public readonly name: string;
  private readonly runner: SandboxProcessRunner;
  private readonly shell: string;
  private readonly backend: string;
  private readonly stateStore: SandboxEnvironmentStateStore;
  private readonly costPerSecondUsd: number;

  public constructor(private readonly options: ServerlessSandboxProviderOptions = {}) {
    this.backend = options.backend ?? "modal-fixture";
    this.name = `${this.backend}-serverless-sandbox-provider`;
    this.runner = options.runner ?? new NodeSandboxProcessRunner();
    this.shell = options.shell ?? "sh";
    this.stateStore = options.stateStore ?? (options.statePath
      ? new JsonSandboxEnvironmentStateStore(options.statePath)
      : new InMemorySandboxEnvironmentStateStore());
    this.costPerSecondUsd = options.costPerSecondUsd ?? 0.0001;
    if (options.workspace) {
      mkdirSync(options.workspace, { recursive: true });
    }
  }

  public getEnvironmentStatus(): SandboxEnvironmentMetadata {
    return this.readEnvironment() ?? this.createEnvironment("cold");
  }

  public hibernate(): SandboxEnvironmentMetadata {
    const current = this.getEnvironmentStatus();
    const now = new Date().toISOString();
    const next: SandboxEnvironmentMetadata = {
      ...current,
      lifecycle: "hibernated",
      updated_at: now,
      hibernated_at: now,
      checkpoint_id: current.checkpoint_id ?? `ckpt_${randomUUID()}`
    };
    this.stateStore.upsert(next);
    return cloneEnvironment(next);
  }

  public resume(): SandboxEnvironmentMetadata {
    const current = this.getEnvironmentStatus();
    const now = new Date().toISOString();
    const next: SandboxEnvironmentMetadata = {
      ...current,
      lifecycle: "resumed",
      updated_at: now,
      resumed_at: now,
      checkpoint_id: current.checkpoint_id ?? `ckpt_${randomUUID()}`,
      restore_count: current.restore_count + 1
    };
    this.stateStore.upsert(next);
    return cloneEnvironment(next);
  }

  public async execute(input: SandboxCommandInput): Promise<SandboxCommandResult> {
    const environment = this.activateEnvironment();
    const started = Date.now();
    const result = await runWithTrace({
      providerName: this.name,
      target: this.target,
      operation: input.operation ?? "exec",
      command: input.command,
      executable: this.shell,
      args: ["-lc", input.command],
      cwd: input.cwd ?? this.options.workspace,
      env: input.env,
      stdin: input.stdin,
      timeoutMs: input.timeout_ms,
      signal: input.signal,
      runner: this.runner
    });
    const elapsedMs = Math.max(0, Date.now() - started);
    const runCost = roundCost((elapsedMs / 1000) * this.costPerSecondUsd);
    const nextEnvironment: SandboxEnvironmentMetadata = {
      ...environment,
      lifecycle: "active",
      updated_at: result.ended_at,
      estimated_cost_usd: roundCost(environment.estimated_cost_usd + runCost),
      secrets_injected: false
    };
    this.stateStore.upsert(nextEnvironment);
    return {
      ...result,
      environment: cloneEnvironment(nextEnvironment),
      cost: {
        elapsed_ms: elapsedMs,
        estimated_cost_usd: runCost,
        cost_limit_usd: this.options.costLimitUsd
      }
    };
  }

  private activateEnvironment(): SandboxEnvironmentMetadata {
    const current = this.getEnvironmentStatus();
    if (current.lifecycle === "hibernated") {
      return this.resume();
    }
    const now = new Date().toISOString();
    const next: SandboxEnvironmentMetadata = {
      ...current,
      lifecycle: "active",
      updated_at: now
    };
    this.stateStore.upsert(next);
    return cloneEnvironment(next);
  }

  private readEnvironment(): SandboxEnvironmentMetadata | undefined {
    return this.stateStore.get(this.target, this.backend);
  }

  private createEnvironment(lifecycle: SandboxEnvironmentLifecycle): SandboxEnvironmentMetadata {
    const now = new Date().toISOString();
    const environment: SandboxEnvironmentMetadata = {
      environment_id: `senv_${randomUUID()}`,
      target: this.target,
      backend: this.backend,
      lifecycle,
      workspace: this.options.workspace,
      created_at: now,
      updated_at: now,
      restore_count: 0,
      estimated_cost_usd: 0,
      cost_limit_usd: this.options.costLimitUsd,
      secrets_injected: false,
      metadata: {
        backend: this.backend,
        ...(this.options.metadata ?? {})
      }
    };
    this.stateStore.upsert(environment);
    return cloneEnvironment(environment);
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

  public getEnvironmentStatus(target: SandboxTarget = this.defaultTarget): SandboxEnvironmentMetadata {
    return this.getEnvironmentProvider(target).getEnvironmentStatus();
  }

  public hibernateEnvironment(target: SandboxTarget = this.defaultTarget): SandboxEnvironmentMetadata {
    return this.getEnvironmentProvider(target).hibernate();
  }

  public resumeEnvironment(target: SandboxTarget = this.defaultTarget): SandboxEnvironmentMetadata {
    return this.getEnvironmentProvider(target).resume();
  }

  private getEnvironmentProvider(target: SandboxTarget): SandboxEnvironmentProvider {
    const provider = this.providers.get(target);
    if (!provider) {
      throw new Error(`Sandbox provider for target "${target}" is not configured.`);
    }
    if (!isEnvironmentProvider(provider)) {
      throw new Error(`Sandbox provider for target "${target}" does not support environment lifecycle.`);
    }
    return provider;
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
  serverless?: {
    enabled?: boolean;
    backend?: string;
    workspace?: string;
    shell?: string;
    state_path?: string;
    cost_per_second_usd?: number;
    cost_limit_usd?: number;
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

  if (config.serverless?.enabled || config.default_target === "serverless") {
    providers.push(new ServerlessSandboxProvider({
      backend: config.serverless?.backend,
      workspace: config.serverless?.workspace,
      shell: config.serverless?.shell,
      statePath: config.serverless?.state_path,
      costPerSecondUsd: config.serverless?.cost_per_second_usd,
      costLimitUsd: config.serverless?.cost_limit_usd
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
    env: filterSecretEnv(input.env),
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

function isEnvironmentProvider(provider: SandboxProvider): provider is SandboxEnvironmentProvider {
  return typeof (provider as Partial<SandboxEnvironmentProvider>).getEnvironmentStatus === "function" &&
    typeof (provider as Partial<SandboxEnvironmentProvider>).hibernate === "function" &&
    typeof (provider as Partial<SandboxEnvironmentProvider>).resume === "function";
}

function environmentKey(target: SandboxTarget, backend: string): string {
  return `${target}:${backend}`;
}

function cloneEnvironment(environment: SandboxEnvironmentMetadata): SandboxEnvironmentMetadata {
  return {
    ...environment,
    metadata: { ...environment.metadata }
  };
}

function roundCost(value: number): number {
  return Number(value.toFixed(6));
}
