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
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
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
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "out", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "out", "webview.css"),
    );

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Synthtrace Runner</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div id="root"></div>
    <script src="${scriptUri}"></script>
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
