import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { JsonValue, Tool } from "@neurocore/protocol";
import { htmlToText } from "../connectors/shared/html-to-text.js";

export interface BrowserSessionManagerOptions {
  profileRoot?: string;
  provider?: BrowserSessionProvider;
  fetch?: typeof fetch;
  userAgent?: string;
  maxContentChars?: number;
  headless?: boolean;
}

export interface BrowserSessionProvider {
  createSession(input: BrowserProviderSessionInput): BrowserProviderSession;
}

export interface BrowserProviderSessionInput {
  sessionId: string;
  profileId: string;
  profileDir: string;
  fetchImpl: typeof fetch;
  userAgent: string;
  maxContentChars: number;
  headless: boolean;
}

export interface BrowserProviderSession {
  navigate(url: string): Promise<BrowserPageResult>;
  click(selector: string): Promise<BrowserPageResult>;
  type(selector: string, text: string): Promise<BrowserPageResult>;
  screenshot(): Promise<BrowserArtifactResult>;
  pdf(): Promise<BrowserArtifactResult>;
  snapshot(): Promise<BrowserPageResult>;
  close(): Promise<void>;
}

export interface BrowserPageResult {
  url: string;
  title: string;
  content: string;
  html?: string;
  links: string[];
  cookies: Record<string, string>;
  action: string;
}

export interface BrowserArtifactResult {
  artifact_type: "browser_screenshot" | "browser_pdf";
  mime_type: string;
  data_base64: string;
  bytes: number;
  url: string;
  action: string;
}

interface BrowserSessionRecord {
  session_id: string;
  profile_id: string;
  profile_dir: string;
  status: "open" | "closed";
  created_at: string;
  updated_at: string;
  provider: BrowserProviderSession;
  last_page?: BrowserPageResult;
}

const DEFAULT_BROWSER_PROFILE_ROOT = join(tmpdir(), "neurocore-browser-profiles");
const BROWSER_UNTRUSTED_REASON = "Browser page content can contain untrusted instructions, scripts or user-generated content.";

export class BrowserSessionManager {
  private readonly sessions = new Map<string, BrowserSessionRecord>();
  private readonly profileRoot: string;
  private readonly provider: BrowserSessionProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly maxContentChars: number;

  public constructor(private readonly options: BrowserSessionManagerOptions = {}) {
    this.profileRoot = resolve(options.profileRoot ?? DEFAULT_BROWSER_PROFILE_ROOT);
    this.provider = options.provider ?? new FetchBrowserSessionProvider();
    this.fetchImpl = options.fetch ?? fetch;
    this.userAgent = options.userAgent ?? "NeuroCore-Browser-Session/0.1";
    this.maxContentChars = options.maxContentChars ?? 12_000;
    mkdirSync(this.profileRoot, { recursive: true });
  }

  public start(profileId = `profile_${randomUUID()}`): Record<string, JsonValue> {
    const sessionId = `brs_${randomUUID()}`;
    const profileDir = resolve(this.profileRoot, profileId);
    if (!profileDir.startsWith(`${this.profileRoot}/`) && profileDir !== this.profileRoot) {
      throw new Error(`Browser profile escapes profile root: ${profileId}`);
    }
    mkdirSync(profileDir, { recursive: true });
    const now = new Date().toISOString();
    const provider = this.provider.createSession({
      sessionId,
      profileId,
      profileDir,
      fetchImpl: this.fetchImpl,
      userAgent: this.userAgent,
      maxContentChars: this.maxContentChars,
      headless: this.options.headless ?? true
    });
    const record: BrowserSessionRecord = {
      session_id: sessionId,
      profile_id: profileId,
      profile_dir: profileDir,
      status: "open",
      created_at: now,
      updated_at: now,
      provider
    };
    this.sessions.set(sessionId, record);
    return this.sessionPayload(record, "start");
  }

  public async navigate(sessionId: string, url: string): Promise<Record<string, JsonValue>> {
    const record = this.requireOpen(sessionId);
    const page = await record.provider.navigate(url);
    return this.pagePayload(record, page);
  }

  public async click(sessionId: string, selector: string): Promise<Record<string, JsonValue>> {
    const record = this.requireOpen(sessionId);
    const page = await record.provider.click(selector);
    return this.pagePayload(record, page);
  }

  public async type(sessionId: string, selector: string, text: string): Promise<Record<string, JsonValue>> {
    const record = this.requireOpen(sessionId);
    const page = await record.provider.type(selector, text);
    return this.pagePayload(record, page);
  }

  public async screenshot(sessionId: string): Promise<Record<string, JsonValue>> {
    const record = this.requireOpen(sessionId);
    const artifact = await record.provider.screenshot();
    return this.artifactPayload(record, artifact);
  }

  public async pdf(sessionId: string): Promise<Record<string, JsonValue>> {
    const record = this.requireOpen(sessionId);
    const artifact = await record.provider.pdf();
    return this.artifactPayload(record, artifact);
  }

  public async snapshot(sessionId: string): Promise<Record<string, JsonValue>> {
    const record = this.requireOpen(sessionId);
    const page = await record.provider.snapshot();
    return this.pagePayload(record, page);
  }

  public async close(sessionId: string): Promise<Record<string, JsonValue>> {
    const record = this.require(sessionId);
    if (record.status === "open") {
      await record.provider.close();
      record.status = "closed";
      record.updated_at = new Date().toISOString();
    }
    if (existsSync(record.profile_dir)) {
      rmSync(record.profile_dir, { recursive: true, force: true });
    }
    return this.sessionPayload(record, "close");
  }

  public get(sessionId: string): Record<string, JsonValue> {
    return this.sessionPayload(this.require(sessionId), "inspect");
  }

  private require(sessionId: string): BrowserSessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error(`Unknown browser session: ${sessionId}`);
    }
    return record;
  }

  private requireOpen(sessionId: string): BrowserSessionRecord {
    const record = this.require(sessionId);
    if (record.status !== "open") {
      throw new Error(`Browser session ${sessionId} is closed.`);
    }
    return record;
  }

  private pagePayload(record: BrowserSessionRecord, page: BrowserPageResult): Record<string, JsonValue> {
    record.last_page = page;
    record.updated_at = new Date().toISOString();
    return {
      ...this.sessionPayload(record, page.action),
      url: page.url,
      title: page.title,
      content: page.content,
      html: page.html ?? "",
      links: page.links,
      cookies: page.cookies,
      untrusted_content: true,
      untrusted_reason: BROWSER_UNTRUSTED_REASON
    };
  }

  private artifactPayload(record: BrowserSessionRecord, artifact: BrowserArtifactResult): Record<string, JsonValue> {
    record.updated_at = new Date().toISOString();
    return {
      ...this.sessionPayload(record, artifact.action),
      ...artifact,
      untrusted_content: true,
      untrusted_reason: BROWSER_UNTRUSTED_REASON
    };
  }

  private sessionPayload(record: BrowserSessionRecord, action: string): Record<string, JsonValue> {
    return {
      browser_trace: {
        action,
        session_id: record.session_id,
        profile_id: record.profile_id,
        profile_dir: record.profile_dir,
        status: record.status,
        created_at: record.created_at,
        updated_at: record.updated_at,
        url: record.last_page?.url ?? ""
      },
      session_id: record.session_id,
      profile_id: record.profile_id,
      profile_dir: record.profile_dir,
      status: record.status
    };
  }
}

export class FetchBrowserSessionProvider implements BrowserSessionProvider {
  public createSession(input: BrowserProviderSessionInput): BrowserProviderSession {
    return new FetchBrowserProviderSession(input);
  }
}

export class PlaywrightBrowserSessionProvider implements BrowserSessionProvider {
  public createSession(input: BrowserProviderSessionInput): BrowserProviderSession {
    return new PlaywrightBrowserProviderSession(input);
  }
}

interface PlaywrightModule {
  chromium?: {
    launchPersistentContext(profileDir: string, options: Record<string, unknown>): Promise<PlaywrightContext>;
  };
}

interface PlaywrightContext {
  pages(): PlaywrightPage[];
  newPage(): Promise<PlaywrightPage>;
  cookies(): Promise<Array<{ name: string; value: string }>>;
  close(): Promise<void>;
}

interface PlaywrightPage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  screenshot(options?: Record<string, unknown>): Promise<Buffer>;
  pdf?(options?: Record<string, unknown>): Promise<Buffer>;
  title(): Promise<string>;
  content(): Promise<string>;
  url(): string;
  waitForLoadState(state?: string, options?: Record<string, unknown>): Promise<unknown>;
  $$eval<T>(selector: string, pageFunction: (elements: Array<{ href?: string }>) => T): Promise<T>;
}

class PlaywrightBrowserProviderSession implements BrowserProviderSession {
  private context?: PlaywrightContext;
  private page?: PlaywrightPage;

  public constructor(private readonly input: BrowserProviderSessionInput) {}

  public async navigate(url: string): Promise<BrowserPageResult> {
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return this.snapshotWithAction("navigate");
  }

  public async click(selector: string): Promise<BrowserPageResult> {
    const page = await this.ensurePage();
    await page.click(selector);
    await page.waitForLoadState("domcontentloaded", { timeout: 1_000 }).catch(() => undefined);
    return this.snapshotWithAction("click");
  }

  public async type(selector: string, text: string): Promise<BrowserPageResult> {
    const page = await this.ensurePage();
    await page.fill(selector, text);
    return this.snapshotWithAction("type");
  }

  public async screenshot(): Promise<BrowserArtifactResult> {
    const page = await this.ensurePage();
    const data = await page.screenshot({ type: "png", fullPage: true });
    return {
      artifact_type: "browser_screenshot",
      mime_type: "image/png",
      data_base64: data.toString("base64"),
      bytes: data.byteLength,
      url: page.url(),
      action: "screenshot"
    };
  }

  public async pdf(): Promise<BrowserArtifactResult> {
    const page = await this.ensurePage();
    const data = page.pdf
      ? await page.pdf({ printBackground: true })
      : Buffer.from(await page.content(), "utf8");
    return {
      artifact_type: "browser_pdf",
      mime_type: page.pdf ? "application/pdf" : "text/html",
      data_base64: data.toString("base64"),
      bytes: data.byteLength,
      url: page.url(),
      action: "pdf"
    };
  }

  public async snapshot(): Promise<BrowserPageResult> {
    return this.snapshotWithAction("snapshot");
  }

  public async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
  }

  private async ensurePage(): Promise<PlaywrightPage> {
    if (this.page) {
      return this.page;
    }
    const moduleName = "playwright";
    const module = await import(moduleName).catch((error) => {
      throw new Error(`Playwright browser provider requires the optional playwright package: ${error instanceof Error ? error.message : String(error)}`);
    }) as PlaywrightModule;
    if (!module.chromium) {
      throw new Error("Playwright chromium provider is unavailable.");
    }
    this.context = await module.chromium.launchPersistentContext(this.input.profileDir, {
      headless: this.input.headless,
      userAgent: this.input.userAgent
    });
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    return this.page;
  }

  private async snapshotWithAction(action: string): Promise<BrowserPageResult> {
    const page = await this.ensurePage();
    const html = await page.content();
    const text = htmlToText(html, this.input.maxContentChars);
    const cookies = Object.fromEntries((await this.context?.cookies() ?? []).map((cookie) => [cookie.name, cookie.value]));
    const links = await page.$$eval("a", (elements) =>
      elements.map((element) => element.href ?? "").filter((href) => href.length > 0)
    ).catch(() => text.links);
    return {
      url: page.url(),
      title: await page.title(),
      content: text.content,
      html: html.slice(0, this.input.maxContentChars),
      links,
      cookies,
      action
    };
  }
}

class FetchBrowserProviderSession implements BrowserProviderSession {
  private currentUrl = "";
  private currentHtml = "";
  private readonly cookies = new Map<string, string>();
  private readonly fields = new Map<string, string>();

  public constructor(private readonly input: BrowserProviderSessionInput) {}

  public async navigate(url: string): Promise<BrowserPageResult> {
    return this.fetchPage(url, { method: "GET" }, "navigate");
  }

  public async click(selector: string): Promise<BrowserPageResult> {
    if (!this.currentHtml || !this.currentUrl) {
      throw new Error("No active page to click.");
    }
    const form = parseFirstForm(this.currentHtml, this.currentUrl);
    if (form) {
      const body = new URLSearchParams();
      for (const field of parseInputs(this.currentHtml)) {
        const value = this.fields.get(`#${field.id}`) ?? this.fields.get(`[name="${field.name}"]`) ?? "";
        if (field.name) {
          body.set(field.name, value);
        }
      }
      return this.fetchPage(form.action, {
        method: form.method,
        body,
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        }
      }, "click");
    }
    return this.snapshotWithAction("click");
  }

  public async type(selector: string, text: string): Promise<BrowserPageResult> {
    if (!this.currentHtml || !this.currentUrl) {
      throw new Error("No active page to type into.");
    }
    this.fields.set(selector, text);
    return this.snapshotWithAction("type");
  }

  public async screenshot(): Promise<BrowserArtifactResult> {
    const content = `BROWSER_SCREENSHOT\nurl=${this.currentUrl}\n${this.toText().content}`;
    const data = Buffer.from(content, "utf8");
    return {
      artifact_type: "browser_screenshot",
      mime_type: "text/plain",
      data_base64: data.toString("base64"),
      bytes: data.byteLength,
      url: this.currentUrl,
      action: "screenshot"
    };
  }

  public async pdf(): Promise<BrowserArtifactResult> {
    const content = `%PDF-1.1\n1 0 obj << /Type /Catalog >> endobj\n% ${this.currentUrl}\n% ${this.toText().content.slice(0, 500)}\n%%EOF\n`;
    const data = Buffer.from(content, "utf8");
    return {
      artifact_type: "browser_pdf",
      mime_type: "application/pdf",
      data_base64: data.toString("base64"),
      bytes: data.byteLength,
      url: this.currentUrl,
      action: "pdf"
    };
  }

  public async snapshot(): Promise<BrowserPageResult> {
    return this.snapshotWithAction("snapshot");
  }

  public async close(): Promise<void> {
    this.currentUrl = "";
    this.currentHtml = "";
    this.cookies.clear();
    this.fields.clear();
  }

  private async fetchPage(
    url: string,
    init: RequestInit,
    action: string
  ): Promise<BrowserPageResult> {
    const response = await this.input.fetchImpl(url, {
      ...init,
      headers: {
        "user-agent": this.input.userAgent,
        ...(this.cookieHeader() ? { cookie: this.cookieHeader() } : {}),
        ...(init.headers ?? {})
      }
    });
    this.captureCookies(response);
    this.currentUrl = response.url || url;
    this.currentHtml = await response.text();
    return this.snapshotWithAction(action);
  }

  private snapshotWithAction(action: string): BrowserPageResult {
    const text = this.toText();
    return {
      url: this.currentUrl,
      title: text.title ?? "",
      content: text.content,
      html: this.currentHtml.slice(0, this.input.maxContentChars),
      links: text.links,
      cookies: Object.fromEntries(this.cookies.entries()),
      action
    };
  }

  private toText(): { title?: string; content: string; links: string[] } {
    return htmlToText(this.currentHtml, this.input.maxContentChars);
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  private captureCookies(response: Response): void {
    const raw = response.headers.get("set-cookie");
    if (!raw) {
      return;
    }
    for (const cookie of raw.split(/,(?=[^;,]+=)/)) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      if (index > 0) {
        this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    }
  }
}

export function createBrowserSessionTools(manager: BrowserSessionManager): Tool[] {
  return [
    createStartTool(manager),
    createNavigateTool(manager),
    createClickTool(manager),
    createTypeTool(manager),
    createScreenshotTool(manager),
    createPdfTool(manager),
    createSnapshotTool(manager),
    createCloseTool(manager)
  ];
}

function createStartTool(manager: BrowserSessionManager): Tool {
  return {
    name: "browser_session_start",
    description: "Start an isolated browser profile session.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: { profile_id: { type: "string" } }
    },
    async invoke(input) {
      const payload = manager.start(readOptionalString(input.profile_id));
      return { summary: `Started browser session ${payload.session_id}.`, payload };
    }
  };
}

function createNavigateTool(manager: BrowserSessionManager): Tool {
  return {
    name: "browser_session_navigate",
    description: "Navigate an isolated browser session to a URL.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        url: { type: "string" }
      },
      required: ["session_id", "url"]
    },
    async invoke(input) {
      const payload = await manager.navigate(
        readRequiredString(input.session_id, "session_id"),
        readRequiredString(input.url, "url")
      );
      return { summary: formatPageSummary(payload), payload };
    }
  };
}

function createClickTool(manager: BrowserSessionManager): Tool {
  return {
    name: "browser_session_click",
    description: "Click an element in an isolated browser session.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        selector: { type: "string" }
      },
      required: ["session_id", "selector"]
    },
    async invoke(input) {
      const payload = await manager.click(
        readRequiredString(input.session_id, "session_id"),
        readRequiredString(input.selector, "selector")
      );
      return { summary: formatPageSummary(payload), payload };
    }
  };
}

function createTypeTool(manager: BrowserSessionManager): Tool {
  return {
    name: "browser_session_type",
    description: "Type text into an element in an isolated browser session.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" }
      },
      required: ["session_id", "selector", "text"]
    },
    async invoke(input) {
      const payload = await manager.type(
        readRequiredString(input.session_id, "session_id"),
        readRequiredString(input.selector, "selector"),
        readRequiredString(input.text, "text")
      );
      return { summary: `Typed into browser session ${payload.session_id}.`, payload };
    }
  };
}

function createScreenshotTool(manager: BrowserSessionManager): Tool {
  return {
    name: "browser_session_screenshot",
    description: "Capture a screenshot artifact for an isolated browser session.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"]
    },
    async invoke(input) {
      const payload = await manager.screenshot(readRequiredString(input.session_id, "session_id"));
      return { summary: `Captured browser screenshot for ${payload.session_id}.`, payload };
    }
  };
}

function createPdfTool(manager: BrowserSessionManager): Tool {
  return {
    name: "browser_session_pdf",
    description: "Capture a PDF artifact for an isolated browser session.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"]
    },
    async invoke(input) {
      const payload = await manager.pdf(readRequiredString(input.session_id, "session_id"));
      return { summary: `Captured browser PDF for ${payload.session_id}.`, payload };
    }
  };
}

function createSnapshotTool(manager: BrowserSessionManager): Tool {
  return {
    name: "browser_session_snapshot",
    description: "Read the current DOM/text snapshot for an isolated browser session.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"]
    },
    async invoke(input) {
      const payload = await manager.snapshot(readRequiredString(input.session_id, "session_id"));
      return { summary: formatPageSummary(payload), payload };
    }
  };
}

function createCloseTool(manager: BrowserSessionManager): Tool {
  return {
    name: "browser_session_close",
    description: "Close an isolated browser session and remove its profile directory.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"]
    },
    async invoke(input) {
      const payload = await manager.close(readRequiredString(input.session_id, "session_id"));
      return { summary: `Closed browser session ${payload.session_id}.`, payload };
    }
  };
}

function formatPageSummary(payload: Record<string, JsonValue>): string {
  const excerpt = String(payload.content ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `UNTRUSTED_BROWSER_CONTENT action=${(payload.browser_trace as Record<string, JsonValue>).action} url=${payload.url} title=${payload.title} excerpt=${excerpt}`;
}

function parseFirstForm(html: string, baseUrl: string): { action: string; method: string } | undefined {
  const match = html.match(/<form\b([^>]*)>/i);
  if (!match) {
    return undefined;
  }
  const attrs = parseAttrs(match[1]);
  return {
    action: new URL(attrs.action ?? baseUrl, baseUrl).toString(),
    method: (attrs.method ?? "GET").toUpperCase()
  };
}

function parseInputs(html: string): Array<{ id: string; name: string }> {
  return [...html.matchAll(/<input\b([^>]*)>/gi)]
    .map((match) => parseAttrs(match[1]))
    .map((attrs) => ({
      id: attrs.id ?? attrs.name ?? "",
      name: attrs.name ?? attrs.id ?? ""
    }))
    .filter((input) => input.name.length > 0);
}

function parseAttrs(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of value.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*["']([^"']*)["']/g)) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return attrs;
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
