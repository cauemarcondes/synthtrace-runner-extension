import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { ChildProcess, spawn } from "child_process";

const SCENARIOS_RELATIVE_PATH =
  "src/platform/packages/shared/kbn-synthtrace/src/scenarios";
const SYNTHTRACE_SCRIPT_RELATIVE_PATH = "scripts/synthtrace.js";

type ConnectionStatus = "unknown" | "loading" | "ok" | "error";
type RunStatus = "idle" | "loading" | "done" | "error";

interface SidebarFormState {
  esEndpoint: string;
  kibanaEndpoint: string;
  username: string;
  password: string;
  apiKey: string;
  from: string;
  to: string;
  scenario: string;
  versionOverride: string;
  live: boolean;
  clean: boolean;
  logLevel: string;
  dataType: string;
  concurrency: string;
  uniqueIds: boolean;
  liveBucketSize: string;
  insecure: boolean;
  workers: string;
}

interface SidebarViewState extends SidebarFormState {
  esStatus: ConnectionStatus;
  kibanaStatus: ConnectionStatus;
  runStatus: RunStatus;
  runMessage: string;
  isRunning: boolean;
  progressValue: number | null;
  progressLabel: string;
  scenarios: string[];
}

type WebviewMessage =
  | { type: "ready" }
  | { type: "refreshScenarios" }
  | { type: "openScenario"; payload: { scenario: string } }
  | { type: "openKibana" }
  | { type: "connect"; payload: SidebarFormState }
  | { type: "run"; payload: SidebarFormState }
  | { type: "stop" };

const DEFAULT_STATE: SidebarViewState = {
  esEndpoint: "http://localhost:9200",
  kibanaEndpoint: "http://localhost:5601",
  username: "elastic",
  password: "changeme",
  apiKey: "",
  from: "now-15m",
  to: "now",
  scenario: "",
  versionOverride: "",
  live: false,
  clean: false,
  logLevel: "",
  dataType: "",
  concurrency: "",
  uniqueIds: false,
  liveBucketSize: "",
  insecure: false,
  workers: "",
  esStatus: "unknown",
  kibanaStatus: "unknown",
  runStatus: "idle",
  runMessage: "",
  isRunning: false,
  progressValue: null,
  progressLabel: "",
  scenarios: [],
};

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Synthtrace Runner");
  const provider = new SynthtraceSidebarProvider(context, outputChannel);

  context.subscriptions.push(
    outputChannel,
    vscode.window.registerWebviewViewProvider(
      "synthtraceRunner.sidebarView",
      provider,
    ),
    vscode.commands.registerCommand("synthtraceRunner.refreshScenarios", () => {
      provider.loadScenariosAndPublish();
    }),
  );
}

export function deactivate() {
  return;
}

class SynthtraceSidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private state: SidebarViewState;
  private readonly stateKey = "synthtraceRunner.state";
  private readonly outputChannel: vscode.OutputChannel;
  private readonly context: vscode.ExtensionContext;
  private activeProcess?: ChildProcess;
  private stopRequested = false;
  private readonly workerProgress = new Map<number, number>();

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
  ) {
    this.context = context;
    this.outputChannel = outputChannel;
    this.state = {
      ...DEFAULT_STATE,
      ...(context.globalState.get<Partial<SidebarViewState>>(this.stateKey) ??
        {}),
      scenarios: [],
      esStatus: "unknown",
      kibanaStatus: "unknown",
      runStatus: "idle",
      runMessage: "",
      isRunning: false,
      progressValue: null,
      progressLabel: "",
    };

    if (!this.state.from.trim()) {
      this.state.from = "now-15m";
    }
    if (!this.state.to.trim()) {
      this.state.to = "now";
    }
    if (!this.state.esEndpoint.trim()) {
      this.state.esEndpoint = "http://localhost:9200";
    }
    if (!this.state.kibanaEndpoint.trim()) {
      this.state.kibanaEndpoint = "http://localhost:5601";
    }
    if (!this.state.username.trim()) {
      this.state.username = "elastic";
    }
    if (!this.state.password) {
      this.state.password = "changeme";
    }
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
  ): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case "ready":
          await this.loadScenariosAndPublish();
          this.publishState();
          break;
        case "refreshScenarios":
          await this.loadScenariosAndPublish();
          break;
        case "openScenario":
          await this.handleOpenScenario(message.payload.scenario);
          break;
        case "openKibana":
          await this.handleOpenKibana();
          break;
        case "connect":
          await this.handleConnect(message.payload);
          break;
        case "run":
          await this.handleRun(message.payload);
          break;
        case "stop":
          this.handleStop();
          break;
      }
    });
  }

  public async loadScenariosAndPublish() {
    let scenarios: string[];
    try {
      const { scenariosRoot } = await this.getKibanaPaths();
      scenarios = await getSynthtraceScenarios(scenariosRoot);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load scenarios";
      this.state = {
        ...this.state,
        scenarios: [],
        scenario: "",
      };
      await this.persistState();
      this.publishState();
      vscode.window.showErrorMessage(`Failed to load scenarios: ${message}`);
      return;
    }

    const selected =
      this.state.scenario && scenarios.includes(this.state.scenario)
        ? this.state.scenario
        : "";
    this.state = {
      ...this.state,
      scenarios,
      scenario: selected || scenarios[0] || "",
    };
    await this.persistState();
    this.publishState();
  }

  private async handleConnect(form: SidebarFormState) {
    this.state = {
      ...this.state,
      ...form,
      esStatus: "loading",
      kibanaStatus: "loading",
      runStatus: "idle",
      runMessage: "",
      progressValue: null,
      progressLabel: "",
    };
    await this.persistState();
    this.publishState();

    const authHeader = createAuthHeader(form);
    const [esOk, kbOk] = await Promise.all([
      checkEndpoint(form.esEndpoint, "/", authHeader),
      checkEndpoint(form.kibanaEndpoint, "/api/status", authHeader),
    ]);

    this.state = {
      ...this.state,
      esStatus: esOk ? "ok" : "error",
      kibanaStatus: kbOk ? "ok" : "error",
    };
    this.publishState();
  }

  private async handleOpenScenario(selectedScenario: string) {
    const scenario = selectedScenario?.trim();
    if (!scenario) {
      vscode.window.showInformationMessage("Please select a scenario first.");
      return;
    }

    let scenariosRoot: string;
    try {
      ({ scenariosRoot } = await this.getKibanaPaths());
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to determine Kibana workspace path";
      vscode.window.showErrorMessage(`Could not open scenario: ${message}`);
      return;
    }

    const scenarioPath = path
      .join(scenariosRoot, ...scenario.split("/"))
      .replace(/\.ts$/, "");
    const scenarioFile = `${scenarioPath}.ts`;

    try {
      const document = await vscode.workspace.openTextDocument(scenarioFile);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to open scenario file";
      vscode.window.showErrorMessage(`Could not open scenario: ${message}`);
    }
  }

  private async handleOpenKibana() {
    const rawTarget = this.state.kibanaEndpoint.trim() || "http://localhost:5601";
    let targetUrl: URL;
    try {
      targetUrl = new URL(rawTarget);
    } catch {
      vscode.window.showErrorMessage(
        `Invalid Kibana URL: ${rawTarget}. Please check Connection settings.`,
      );
      return;
    }

    await vscode.env.openExternal(vscode.Uri.parse(targetUrl.toString()));
  }

  private async handleRun(form: SidebarFormState) {
    if (this.state.isRunning) {
      return;
    }

    this.state = {
      ...this.state,
      ...form,
      runStatus: "loading",
      runMessage: "loading...",
      isRunning: true,
      progressValue: null,
      progressLabel: form.live
        ? "Live mode active - ingestion running continuously..."
        : "Starting ingestion...",
    };
    this.workerProgress.clear();
    await this.persistState();
    this.publishState();

    try {
      if (!form.scenario) {
        throw new Error("Please select a scenario");
      }

      const { kibanaRoot, synthtraceScript } = await this.getKibanaPaths();
      const args = this.buildSynthtraceArgs(form, synthtraceScript);
      this.outputChannel.appendLine(`Running: node ${args.join(" ")}`);
      this.outputChannel.show(true);

      this.stopRequested = false;
      this.activeProcess = spawnSynthtraceProcess(
        "node",
        args,
        kibanaRoot,
        this.outputChannel,
        (chunk) => this.handleProcessOutput(chunk),
      );
      await waitForProcess(this.activeProcess);
      this.activeProcess = undefined;

      this.state = {
        ...this.state,
        runStatus: "done",
        runMessage: "Done",
        isRunning: false,
        progressValue: 100,
        progressLabel: "Ingestion completed",
      };
    } catch (error) {
      const defaultMessage =
        error instanceof Error ? error.message : "Unknown error";
      const message = this.stopRequested ? "Stopped" : defaultMessage;
      this.state = {
        ...this.state,
        runStatus: this.stopRequested ? "idle" : "error",
        runMessage: message,
        isRunning: false,
        progressValue: this.stopRequested ? null : this.state.progressValue,
        progressLabel: this.stopRequested
          ? "Stopped"
          : this.state.progressLabel || "Ingestion failed",
      };
      this.activeProcess = undefined;
      if (!this.stopRequested) {
        vscode.window.showErrorMessage(`Synthtrace failed: ${message}`);
      }
    }

    await this.persistState();
    this.publishState();
  }

  private handleStop() {
    if (!this.activeProcess || !this.state.isRunning) {
      return;
    }
    this.stopRequested = true;
    this.outputChannel.appendLine("Stopping synthtrace process...");
    this.activeProcess.kill("SIGTERM");
  }

  private handleProcessOutput(chunk: string) {
    if (this.state.isRunning && this.state.live) {
      this.state = {
        ...this.state,
        progressValue: null,
        progressLabel: "Live mode active - ingestion running continuously...",
      };
      this.publishState();
      return;
    }

    const progressMatches = Array.from(
      chunk.matchAll(/\[(\d+)\]\s+progress=([\d.]+)%/gi),
    );
    if (progressMatches.length > 0) {
      for (const match of progressMatches) {
        const workerId = Number(match[1]);
        const progress = Number(match[2]);
        if (!Number.isNaN(workerId) && !Number.isNaN(progress)) {
          this.workerProgress.set(
            workerId,
            Math.max(0, Math.min(100, progress)),
          );
        }
      }

      const values = Array.from(this.workerProgress.values());
      if (values.length > 0) {
        const sum = values.reduce((acc, value) => acc + value, 0);
        const overallProgress = sum / values.length;
        this.state = {
          ...this.state,
          progressValue: overallProgress,
          progressLabel: `Ingestion progress ${overallProgress.toFixed(
            1,
          )}% (${values.length} worker${values.length === 1 ? "" : "s"})`,
        };
        this.publishState();
      }
    }

    const indexedMatch = chunk.match(/Indexed\s+(\d+)\s+documents/i);
    if (indexedMatch) {
      const indexed = Number(indexedMatch[1]);
      if (!Number.isNaN(indexed)) {
        this.state = {
          ...this.state,
          progressValue: null,
          progressLabel: `Indexed ${indexed.toLocaleString()} documents...`,
        };
        this.publishState();
      }
    }

    const producedMatch = chunk.match(/Produced\s+(\d+)\s+events/i);
    if (producedMatch) {
      const produced = Number(producedMatch[1]);
      if (!Number.isNaN(produced)) {
        this.state = {
          ...this.state,
          progressValue: 100,
          progressLabel: `Produced ${produced.toLocaleString()} events`,
        };
        this.publishState();
      }
    }
  }

  private buildSynthtraceArgs(
    form: SidebarFormState,
    synthtraceScript: string,
  ): string[] {
    const args = [synthtraceScript, form.scenario];
    const from = form.from.trim() || "now-15m";
    const to = form.to.trim() || "now";

    const shouldEmbedBasicAuth = !form.apiKey.trim();
    const target = attachAuthToUrl(
      form.esEndpoint,
      shouldEmbedBasicAuth ? form.username : "",
      shouldEmbedBasicAuth ? form.password : "",
    );
    const kibana = attachAuthToUrl(
      form.kibanaEndpoint,
      shouldEmbedBasicAuth ? form.username : "",
      shouldEmbedBasicAuth ? form.password : "",
    );

    if (target) {
      args.push(`--target=${target}`);
    }
    if (kibana) {
      args.push(`--kibana=${kibana}`);
    }
    if (form.apiKey.trim()) {
      args.push(`--apiKey=${form.apiKey.trim()}`);
    }
    args.push(`--from=${from}`);
    args.push(`--to=${to}`);
    if (form.versionOverride.trim()) {
      args.push(`--versionOverride=${form.versionOverride.trim()}`);
    }
    if (form.live) {
      args.push("--live");
    }
    if (form.clean) {
      args.push("--clean");
    }
    if (form.logLevel.trim()) {
      args.push(`--logLevel=${form.logLevel.trim()}`);
    }
    if (form.dataType.trim()) {
      args.push(`--type=${form.dataType.trim()}`);
    }
    if (form.concurrency.trim()) {
      const concurrency = Number(form.concurrency);
      if (!Number.isInteger(concurrency) || concurrency <= 0) {
        throw new Error("Concurrency must be a positive integer");
      }
      args.push(`--concurrency=${concurrency}`);
    }
    if (form.uniqueIds) {
      args.push("--uniqueIds");
    }
    if (form.liveBucketSize.trim()) {
      const liveBucketSize = Number(form.liveBucketSize);
      if (!Number.isInteger(liveBucketSize) || liveBucketSize <= 0) {
        throw new Error("Live bucket size must be a positive integer");
      }
      args.push(`--liveBucketSize=${liveBucketSize}`);
    }
    if (form.insecure) {
      args.push("--insecure");
    }
    if (form.workers.trim()) {
      const workers = Number(form.workers);
      if (!Number.isInteger(workers) || workers <= 0) {
        throw new Error("Workers must be a positive integer");
      }
      args.push(`--workers=${workers}`);
    }

    return args;
  }

  private async getKibanaPaths(): Promise<{
    kibanaRoot: string;
    scenariosRoot: string;
    synthtraceScript: string;
  }> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
      throw new Error(
        "Open the Kibana repository as your active workspace to use this extension.",
      );
    }

    for (const workspaceFolder of workspaceFolders) {
      const kibanaRoot = workspaceFolder.uri.fsPath;
      const scenariosRoot = path.join(kibanaRoot, SCENARIOS_RELATIVE_PATH);
      const synthtraceScript = path.join(
        kibanaRoot,
        SYNTHTRACE_SCRIPT_RELATIVE_PATH,
      );

      const [hasScenariosRoot, hasSynthtraceScript] = await Promise.all([
        pathExists(scenariosRoot),
        pathExists(synthtraceScript),
      ]);

      if (hasScenariosRoot && hasSynthtraceScript) {
        return { kibanaRoot, scenariosRoot, synthtraceScript };
      }
    }

    const checkedFolders = workspaceFolders
      .map((folder) => folder.uri.fsPath)
      .join(", ");
    throw new Error(
      `Kibana paths not found. Checked workspace folders: ${checkedFolders}`,
    );
  }

  private publishState() {
    this.view?.webview.postMessage({ type: "state", payload: this.state });
  }

  private async persistState() {
    await this.context.globalState.update(this.stateKey, {
      esEndpoint: this.state.esEndpoint,
      kibanaEndpoint: this.state.kibanaEndpoint,
      username: this.state.username,
      password: this.state.password,
      apiKey: this.state.apiKey,
      from: this.state.from,
      to: this.state.to,
      scenario: this.state.scenario,
      versionOverride: this.state.versionOverride,
      live: this.state.live,
      clean: this.state.clean,
      logLevel: this.state.logLevel,
      dataType: this.state.dataType,
      concurrency: this.state.concurrency,
      uniqueIds: this.state.uniqueIds,
      liveBucketSize: this.state.liveBucketSize,
      insecure: this.state.insecure,
      workers: this.state.workers,
    });
  }

  private getWebviewHtml(webview: vscode.Webview) {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: var(--vscode-font-family);
        font-size: 12px;
        color: var(--vscode-editor-foreground);
        background: var(--vscode-sideBar-background);
        padding: 12px;
        margin: 0;
      }
      .app-header { margin-bottom: 12px; }
      .app-title { margin: 0; font-size: 13px; font-weight: 600; }
      .app-subtitle { margin: 4px 0 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
      .section {
        margin-bottom: 12px;
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 8px;
        padding: 10px;
        background: var(--vscode-editorWidget-background);
      }
      .section-title {
        margin: 0 0 8px;
        font-size: 11px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
      }
      .section-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .settings-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid var(--vscode-focusBorder);
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        font-size: 10px;
        font-weight: 600;
        text-transform: none;
        letter-spacing: normal;
      }
      .row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
      .inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      details {
        margin-top: 8px;
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 6px;
        padding: 8px;
        background: var(--vscode-sideBar-background);
      }
      details[open] { background: var(--vscode-editorWidget-background); }
      summary {
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        color: var(--vscode-editor-foreground);
      }
      .details-help {
        margin: 4px 0 10px;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }
      label { font-size: 12px; color: var(--vscode-descriptionForeground); }
      input, select, button {
        font-family: inherit;
        font-size: 12px;
      }
      input:not([type="checkbox"]), select {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border-radius: 4px;
      }
      input[type="checkbox"] {
        width: auto;
        margin: 0;
        flex: 0 0 auto;
      }
      button {
        padding: 7px 10px;
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        cursor: pointer;
        border-radius: 4px;
      }
      button[disabled] { opacity: 0.6; cursor: not-allowed; }
      .btn-primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .btn-secondary {
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-editor-foreground);
        border-color: var(--vscode-editorWidget-border);
      }
      .btn-danger {
        background: var(--vscode-inputValidation-errorBackground, #7f1d1d);
        color: var(--vscode-inputValidation-errorForeground, #ffffff);
        border-color: var(--vscode-inputValidation-errorBorder, transparent);
      }
      .actions-row { margin-top: 8px; }
      .scenario-row {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: end;
        gap: 8px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 12px;
        padding: 3px 8px;
        font-size: 11px;
        gap: 6px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
      .badge.ok { border-color: var(--vscode-testing-iconPassed, #2ea043); }
      .badge.error { border-color: var(--vscode-testing-iconFailed, #f85149); }
      .badge.loading { border-color: var(--vscode-progressBar-background); }
      .badge.unknown { border-color: var(--vscode-descriptionForeground); }
      .badge-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
      }
      .progress-wrap { margin-top: 8px; display: none; }
      progress { width: 100%; }
      .progress-label { margin-top: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); }
      .small { font-size: 11px; color: var(--vscode-descriptionForeground); }
      .checkbox-inline { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-start; }
      .label-with-info { display: inline-flex; align-items: center; gap: 6px; }
      .info-hint {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        cursor: help;
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 999px;
        width: 16px;
        height: 16px;
        padding: 0;
        line-height: 1.3;
        user-select: none;
      }
      .info-hint::after {
        content: attr(data-tooltip);
        position: absolute;
        left: 0;
        top: calc(100% + 7px);
        z-index: 20;
        width: max-content;
        max-width: 260px;
        padding: 7px 8px;
        border-radius: 6px;
        border: 1px solid var(--vscode-editorWidget-border);
        background: var(--vscode-editorHoverWidget-background);
        color: var(--vscode-editorHoverWidget-foreground);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
        white-space: normal;
        font-size: 11px;
        line-height: 1.4;
        opacity: 0;
        transform: translateY(-2px);
        pointer-events: none;
        transition: opacity 120ms ease, transform 120ms ease;
      }
      .info-hint:hover::after,
      .info-hint:focus-visible::after {
        opacity: 1;
        transform: translateY(0);
      }
      .checkbox-row { margin-bottom: 8px; align-items: flex-start; }
      .narrow-input { width: 100px; }
      .run-actions { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 14px; }
    </style>
  </head>
  <body>
    <div class="app-header">
      <h2 class="app-title">Synthtrace Runner</h2>
      <p class="app-subtitle">Run scenarios with optional advanced CLI controls</p>
    </div>
    <div class="section">
      <h3 class="section-title">Connection</h3>
      <div class="inline">
        <button id="connectBtn" class="btn-secondary">Test Connection</button>
        <span class="badge" id="esBadge">Elasticsearch ❔</span>
        <span class="badge" id="kbBadge">Kibana ❔</span>
        <button id="openKibanaBtn" type="button" class="btn-secondary">Open Kibana</button>
      </div>
      <details id="connectionDetails">
        <summary>Connection settings</summary>
        <div class="row">
          <label for="esEndpoint">Elasticsearch endpoint (optional)</label>
          <input id="esEndpoint" placeholder="http://localhost:9200" />
        </div>
        <div class="row">
          <label for="kibanaEndpoint">Kibana endpoint (optional)</label>
          <input id="kibanaEndpoint" placeholder="http://localhost:5601" />
        </div>
        <div class="row">
          <label for="username">Username (optional)</label>
          <input id="username" placeholder="elastic" />
        </div>
        <div class="row">
          <label for="password">Password (optional)</label>
          <input id="password" type="password" placeholder="changeme" />
        </div>
        <div class="row">
          <label for="apiKey">API key (optional, takes precedence)</label>
          <input id="apiKey" type="password" placeholder="your-api-key" />
        </div>
      </details>
    </div>

    <div class="section">
      <h3 class="section-title">Scenario</h3>
      <div class="row">
        <label for="scenarioSearch">Search scenario</label>
        <input id="scenarioSearch" type="search" placeholder="Type to filter scenarios..." />
      </div>
      <div class="row scenario-row">
        <div>
          <label for="scenarioSelect">Scenario</label>
          <select id="scenarioSelect"></select>
        </div>
        <button id="openScenarioBtn" type="button" class="btn-secondary">Open</button>
      </div>
      <div class="inline actions-row">
        <button id="refreshBtn" type="button" class="btn-secondary">Refresh scenarios</button>
      </div>
    </div>

    <div class="section">
      <h3 class="section-title">Time Range</h3>
      <details id="timeRangeDetails">
        <summary>Time range</summary>
        <p class="details-help">These values are auto-applied as <code>--from</code> and <code>--to</code>.</p>
        <div class="row">
          <label for="from">From (optional)</label>
          <input id="from" placeholder='now-15m or 2026-03-06T12:00:00.000Z' />
          <label class="small" for="fromDateTime">Or pick date/time</label>
          <input id="fromDateTime" type="datetime-local" />
        </div>
        <div class="row">
          <label for="to">To (optional)</label>
          <input id="to" placeholder='now or 2026-03-06T13:00:00.000Z' />
          <label class="small" for="toDateTime">Or pick date/time</label>
          <input id="toDateTime" type="datetime-local" />
        </div>
      </details>
    </div>

    <div class="section">
      <div class="section-title-row">
        <h3 class="section-title">Advanced Settings</h3>
        <span id="advancedSettingsBadge" class="settings-badge" style="display:none;"></span>
      </div>
      <details id="advancedSettingsDetails">
        <summary>Advanced settings</summary>
        <p class="details-help">Optional flags passed to synthtrace, in addition to defaults handled by this extension.</p>
        <div class="row">
          <label for="versionOverride" class="label-with-info">
            Version override (optional)
            <span class="info-hint" tabindex="0" data-tooltip="String used for observer.version. Defaults to the installed package version.">(i)</span>
          </label>
          <input id="versionOverride" placeholder="e.g. 8.18.0" />
        </div>
        <div class="row">
          <label for="logLevel" class="label-with-info">
            Log level (optional)
            <span class="info-hint" tabindex="0" data-tooltip="Log level to use: verbose, debug, info, or error.">(i)</span>
          </label>
          <select id="logLevel">
            <option value="">Default (info)</option>
            <option value="verbose">verbose</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="error">error</option>
          </select>
        </div>
        <div class="row">
          <label for="dataType" class="label-with-info">
            Type (optional)
            <span class="info-hint" tabindex="0" data-tooltip="Type of data to be generated. Use log when generating logs (default is apm).">(i)</span>
          </label>
          <input id="dataType" placeholder="apm or log" />
        </div>
        <div class="row">
          <label for="concurrency" class="label-with-info">
            Concurrency (optional)
            <span class="info-hint" tabindex="0" data-tooltip="Concurrency of Elasticsearch client bulk indexing.">(i)</span>
          </label>
          <input id="concurrency" type="number" min="1" placeholder="e.g. 1" />
        </div>
        <div class="row">
          <label for="workers" class="label-with-info">
            Workers (optional)
            <span class="info-hint" tabindex="0" data-tooltip="Amount of Node.js worker threads.">(i)</span>
          </label>
          <input id="workers" class="narrow-input" type="number" min="1" placeholder="e.g. 4" />
        </div>
        <div class="row">
          <label for="liveBucketSize" class="label-with-info">
            Live bucket size (ms, optional)
            <span class="info-hint" tabindex="0" data-tooltip="Bucket size in ms for live streaming.">(i)</span>
          </label>
          <input id="liveBucketSize" type="number" min="1" placeholder="e.g. 1000" />
        </div>
        <div class="row checkbox-row">
          <label class="checkbox-inline label-with-info" for="live">
            <input id="live" type="checkbox" />
            Live
            <span class="info-hint" tabindex="0" data-tooltip="Generate and index data continuously.">(i)</span>
          </label>
        </div>
        <div class="row checkbox-row">
          <label class="checkbox-inline label-with-info" for="clean">
            <input id="clean" type="checkbox" />
            Clean
            <span class="info-hint" tabindex="0" data-tooltip="Clean APM data before indexing new data.">(i)</span>
          </label>
        </div>
        <div class="row checkbox-row">
          <label class="checkbox-inline label-with-info" for="uniqueIds">
            <input id="uniqueIds" type="checkbox" />
            Unique IDs
            <span class="info-hint" tabindex="0" data-tooltip="Generate unique ids to avoid id collisions.">(i)</span>
          </label>
        </div>
        <div class="row checkbox-row">
          <label class="checkbox-inline label-with-info" for="insecure">
            <input id="insecure" type="checkbox" />
            Insecure
            <span class="info-hint" tabindex="0" data-tooltip="Skip SSL certificate validation (useful for self-signed certificates).">(i)</span>
          </label>
        </div>
      </details>
    </div>

    <div class="section">
      <h3 class="section-title">Run Controls</h3>
      <div class="run-actions">
        <button id="runBtn" class="btn-primary">Run</button>
        <button id="stopBtn" class="btn-danger" disabled>Stop</button>
      </div>
      <div class="progress-wrap" id="progressWrap">
        <progress id="progressBar" max="100"></progress>
        <div class="progress-label" id="progressLabel"></div>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const byId = (id) => document.getElementById(id);

      const fields = {
        esEndpoint: byId('esEndpoint'),
        kibanaEndpoint: byId('kibanaEndpoint'),
        username: byId('username'),
        password: byId('password'),
        apiKey: byId('apiKey'),
        from: byId('from'),
        to: byId('to'),
        scenarioSearch: byId('scenarioSearch'),
        scenario: byId('scenarioSelect'),
        versionOverride: byId('versionOverride'),
        live: byId('live'),
        clean: byId('clean'),
        logLevel: byId('logLevel'),
        dataType: byId('dataType'),
        concurrency: byId('concurrency'),
        uniqueIds: byId('uniqueIds'),
        liveBucketSize: byId('liveBucketSize'),
        insecure: byId('insecure'),
        workers: byId('workers'),
      };
      const advancedSettingsBadge = byId('advancedSettingsBadge');
      let allScenarios = [];
      let preferredScenario = '';

      function getForm() {
        return {
          esEndpoint: fields.esEndpoint.value.trim(),
          kibanaEndpoint: fields.kibanaEndpoint.value.trim(),
          username: fields.username.value.trim(),
          password: fields.password.value,
          apiKey: fields.apiKey.value.trim(),
          from: fields.from.value.trim(),
          to: fields.to.value.trim(),
          scenario: fields.scenario.value,
          versionOverride: fields.versionOverride.value.trim(),
          live: fields.live.checked,
          clean: fields.clean.checked,
          logLevel: fields.logLevel.value,
          dataType: fields.dataType.value.trim(),
          concurrency: fields.concurrency.value.trim(),
          uniqueIds: fields.uniqueIds.checked,
          liveBucketSize: fields.liveBucketSize.value.trim(),
          insecure: fields.insecure.checked,
          workers: fields.workers.value.trim(),
        };
      }

      function setBadge(el, label, status) {
        const statusLabel = status === 'ok'
          ? 'Connected'
          : status === 'error'
            ? 'Unavailable'
            : status === 'loading'
              ? 'Checking...'
              : 'Unknown';
        el.classList.remove('ok', 'error', 'loading', 'unknown');
        el.classList.add(
          status === 'ok'
            ? 'ok'
            : status === 'error'
              ? 'error'
              : status === 'loading'
                ? 'loading'
                : 'unknown',
        );
        el.innerHTML = '<span class="badge-dot"></span>' + label + ': ' + statusLabel;
      }

      function renderScenarioOptions() {
        const select = fields.scenario;
        const currentValue = select.value;
        const searchTerm = fields.scenarioSearch.value.trim().toLowerCase();
        const filtered = searchTerm
          ? allScenarios.filter((scenario) => scenario.toLowerCase().includes(searchTerm))
          : allScenarios;

        select.innerHTML = '';
        for (const scenario of filtered) {
          const opt = document.createElement('option');
          opt.value = scenario;
          opt.textContent = scenario;
          select.appendChild(opt);
        }

        const candidate = preferredScenario || currentValue;
        if (candidate && Array.from(select.options).some((o) => o.value === candidate)) {
          select.value = candidate;
        } else if (select.options.length > 0) {
          select.selectedIndex = 0;
        }
      }

      function getModifiedAdvancedSettingsCount() {
        let count = 0;
        if (fields.versionOverride.value.trim()) count++;
        if (fields.logLevel.value.trim()) count++;
        if (fields.dataType.value.trim()) count++;
        if (fields.concurrency.value.trim()) count++;
        if (fields.workers.value.trim()) count++;
        if (fields.liveBucketSize.value.trim()) count++;
        if (fields.live.checked) count++;
        if (fields.clean.checked) count++;
        if (fields.uniqueIds.checked) count++;
        if (fields.insecure.checked) count++;
        return count;
      }

      function updateAdvancedSettingsBadge() {
        const count = getModifiedAdvancedSettingsCount();
        if (count === 0) {
          advancedSettingsBadge.style.display = 'none';
          advancedSettingsBadge.textContent = '';
          return;
        }
        advancedSettingsBadge.style.display = 'inline-flex';
        advancedSettingsBadge.textContent = count === 1 ? '1 modified setting' : count + ' modified settings';
      }

      function syncDateTimeToText(dateInputId, textInputId) {
        const dateInput = byId(dateInputId);
        const textInput = byId(textInputId);
        if (!dateInput.value) {
          return;
        }
        const date = new Date(dateInput.value);
        if (!Number.isNaN(date.getTime())) {
          textInput.value = date.toISOString();
        }
      }

      byId('fromDateTime').addEventListener('change', () => syncDateTimeToText('fromDateTime', 'from'));
      byId('toDateTime').addEventListener('change', () => syncDateTimeToText('toDateTime', 'to'));

      byId('connectBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'connect', payload: getForm() });
      });

      byId('refreshBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'refreshScenarios' });
      });
      byId('openKibanaBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'openKibana' });
      });
      byId('openScenarioBtn').addEventListener('click', () => {
        vscode.postMessage({
          type: 'openScenario',
          payload: { scenario: fields.scenario.value },
        });
      });
      fields.scenarioSearch.addEventListener('input', () => {
        renderScenarioOptions();
      });

      byId('runBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'run', payload: getForm() });
      });
      byId('stopBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'stop' });
      });
      const advancedSettingFields = [
        fields.versionOverride,
        fields.logLevel,
        fields.dataType,
        fields.concurrency,
        fields.workers,
        fields.liveBucketSize,
        fields.live,
        fields.clean,
        fields.uniqueIds,
        fields.insecure,
      ];
      for (const el of advancedSettingFields) {
        el.addEventListener('input', updateAdvancedSettingsBadge);
        el.addEventListener('change', updateAdvancedSettingsBadge);
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type !== 'state') {
          return;
        }

        const state = message.payload;
        fields.esEndpoint.value = state.esEndpoint ?? '';
        fields.kibanaEndpoint.value = state.kibanaEndpoint ?? '';
        fields.username.value = state.username ?? '';
        fields.password.value = state.password ?? '';
        fields.apiKey.value = state.apiKey ?? '';
        fields.from.value = state.from ?? '';
        fields.to.value = state.to ?? '';
        fields.versionOverride.value = state.versionOverride ?? '';
        fields.live.checked = !!state.live;
        fields.clean.checked = !!state.clean;
        fields.logLevel.value = state.logLevel ?? '';
        fields.dataType.value = state.dataType ?? '';
        fields.concurrency.value = state.concurrency ?? '';
        fields.uniqueIds.checked = !!state.uniqueIds;
        fields.liveBucketSize.value = state.liveBucketSize ?? '';
        fields.insecure.checked = !!state.insecure;
        fields.workers.value = state.workers ?? '';
        updateAdvancedSettingsBadge();

        allScenarios = Array.isArray(state.scenarios) ? state.scenarios : [];
        preferredScenario = state.scenario || '';
        renderScenarioOptions();

        setBadge(byId('esBadge'), 'Elasticsearch', state.esStatus);
        setBadge(byId('kbBadge'), 'Kibana', state.kibanaStatus);

        const runBtn = byId('runBtn');
        const stopBtn = byId('stopBtn');
        runBtn.disabled = !!state.isRunning;
        stopBtn.disabled = !state.isRunning;
        runBtn.textContent = state.isRunning ? 'Running...' : 'Run';

        const progressWrap = byId('progressWrap');
        const progressBar = byId('progressBar');
        const progressLabel = byId('progressLabel');
        const shouldShowProgress = state.isRunning || state.runStatus === 'done' || state.runStatus === 'error';
        progressWrap.style.display = shouldShowProgress ? 'block' : 'none';
        if (state.progressValue === null || state.progressValue === undefined) {
          progressBar.removeAttribute('value');
        } else {
          progressBar.value = Number(state.progressValue);
        }
        progressLabel.textContent = state.progressLabel || '';
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}

async function getSynthtraceScenarios(scenariosRoot: string): Promise<string[]> {
  const files = await collectTsFiles(scenariosRoot);
  const runnable: string[] = [];

  for (const filePath of files) {
    const relative = path.relative(scenariosRoot, filePath);
    const normalized = relative.split(path.sep).join("/");
    const base = path.basename(normalized);
    const parts = normalized.split("/");

    if (parts.includes("helpers")) {
      continue;
    }
    if (
      base === "index.ts" ||
      base.endsWith(".test.ts") ||
      base.endsWith(".spec.ts")
    ) {
      continue;
    }

    const content = await fs.readFile(filePath, "utf8");
    if (!/export\s+default/.test(content)) {
      continue;
    }

    runnable.push(normalized.replace(/\.ts$/, ""));
  }

  return runnable.sort((a, b) => a.localeCompare(b));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectTsFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nestedLists = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return collectTsFiles(fullPath);
      }
      return fullPath.endsWith(".ts") ? [fullPath] : [];
    }),
  );
  return nestedLists.flat();
}

async function checkEndpoint(
  endpoint: string,
  route: string,
  authHeader?: string,
): Promise<boolean> {
  const cleaned = endpoint.trim();
  if (!cleaned) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return false;
  }

  const finalUrl = new URL(
    route,
    `${url.origin}${url.pathname.replace(/\/$/, "")}/`,
  ).toString();
  const headers: Record<string, string> = {};
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  try {
    const response = await fetch(finalUrl, {
      method: "GET",
      headers,
    } as RequestInit);
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

function attachAuthToUrl(
  endpoint: string,
  username: string,
  password: string,
): string {
  const cleaned = endpoint.trim();
  if (!cleaned) {
    return "";
  }
  const url = new URL(cleaned);
  if (username.trim()) {
    url.username = username.trim();
    url.password = password;
  }
  return url.toString().replace(/\/$/, "");
}

function createBasicAuthHeader(
  username: string,
  password: string,
): string | undefined {
  if (!username.trim()) {
    return undefined;
  }
  return `Basic ${Buffer.from(`${username.trim()}:${password}`).toString("base64")}`;
}

function createApiKeyHeader(apiKey: string): string | undefined {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return undefined;
  }
  return `ApiKey ${trimmed}`;
}

function createAuthHeader(form: SidebarFormState): string | undefined {
  return (
    createApiKeyHeader(form.apiKey) ??
    createBasicAuthHeader(form.username, form.password)
  );
}

function spawnSynthtraceProcess(
  command: string,
  args: string[],
  cwd: string,
  output: vscode.OutputChannel,
  onOutput?: (chunk: string) => void,
): ChildProcess {
  const child = spawn(command, args, { cwd, shell: false, env: process.env });

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    output.append(text);
    onOutput?.(text);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    output.append(text);
    onOutput?.(text);
  });

  return child;
}

function waitForProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`Process terminated by signal ${signal}`));
        return;
      }
      reject(new Error(`Process exited with code ${code}`));
    });
  });
}

function getNonce() {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
