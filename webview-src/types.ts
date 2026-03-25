export type ConnectionStatus = "unknown" | "loading" | "ok" | "error";
export type RunStatus = "idle" | "loading" | "done" | "error";

export interface SidebarFormState {
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

export interface SidebarViewState extends SidebarFormState {
  esStatus: ConnectionStatus;
  kibanaStatus: ConnectionStatus;
  runStatus: RunStatus;
  runMessage: string;
  isRunning: boolean;
  progressValue: number | null;
  progressLabel: string;
  scenarios: string[];
}

export type OutgoingWebviewMessage =
  | { type: "ready" }
  | { type: "refreshScenarios" }
  | { type: "openScenario"; payload: { scenario: string } }
  | { type: "openKibana" }
  | { type: "connect"; payload: SidebarFormState }
  | { type: "run"; payload: SidebarFormState }
  | { type: "stop" };

export type IncomingWebviewMessage = {
  type: "state";
  payload: SidebarViewState;
};
