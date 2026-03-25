import { useEffect, useMemo, useState } from "react";
import { AdvancedSettingsSection } from "./components/AdvancedSettingsSection";
import { ConnectionSection } from "./components/ConnectionSection";
import { RunControlsSection } from "./components/RunControlsSection";
import { ScenarioSection } from "./components/ScenarioSection";
import { TimeRangeSection } from "./components/TimeRangeSection";
import type {
  IncomingWebviewMessage,
  SidebarFormState,
  SidebarViewState,
} from "./types";
import { vscodeApi } from "./vscodeApi";

const DEFAULT_FORM: SidebarFormState = {
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
};

const DEFAULT_VIEW_STATE: SidebarViewState = {
  ...DEFAULT_FORM,
  esStatus: "unknown",
  kibanaStatus: "unknown",
  runStatus: "idle",
  runMessage: "",
  isRunning: false,
  progressValue: null,
  progressLabel: "",
  scenarios: [],
};

function toFormState(state: SidebarViewState): SidebarFormState {
  return {
    esEndpoint: state.esEndpoint,
    kibanaEndpoint: state.kibanaEndpoint,
    username: state.username,
    password: state.password,
    apiKey: state.apiKey,
    from: state.from,
    to: state.to,
    scenario: state.scenario,
    versionOverride: state.versionOverride,
    live: state.live,
    clean: state.clean,
    logLevel: state.logLevel,
    dataType: state.dataType,
    concurrency: state.concurrency,
    uniqueIds: state.uniqueIds,
    liveBucketSize: state.liveBucketSize,
    insecure: state.insecure,
    workers: state.workers,
  };
}

function withSelectedScenario(
  form: SidebarFormState,
  selectedScenario: string,
): SidebarFormState {
  return { ...form, scenario: selectedScenario };
}

export function App() {
  const [viewState, setViewState] = useState<SidebarViewState>(DEFAULT_VIEW_STATE);
  const [form, setForm] = useState<SidebarFormState>(DEFAULT_FORM);
  const [scenarioSearch, setScenarioSearch] = useState("");

  useEffect(() => {
    const onMessage = (event: MessageEvent<IncomingWebviewMessage>) => {
      const message = event.data;
      if (message?.type !== "state") {
        return;
      }
      setViewState(message.payload);
      setForm(toFormState(message.payload));
    };

    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const filteredScenarios = useMemo(() => {
    const query = scenarioSearch.trim().toLowerCase();
    if (!query) {
      return viewState.scenarios;
    }
    return viewState.scenarios.filter((scenario) =>
      scenario.toLowerCase().includes(query),
    );
  }, [scenarioSearch, viewState.scenarios]);

  const selectedScenario = useMemo(() => {
    if (filteredScenarios.includes(form.scenario)) {
      return form.scenario;
    }
    return filteredScenarios[0] ?? "";
  }, [filteredScenarios, form.scenario]);

  const modifiedAdvancedSettingsCount = useMemo(() => {
    let count = 0;
    if (form.versionOverride.trim()) count++;
    if (form.logLevel.trim()) count++;
    if (form.dataType.trim()) count++;
    if (form.concurrency.trim()) count++;
    if (form.workers.trim()) count++;
    if (form.liveBucketSize.trim()) count++;
    if (form.live) count++;
    if (form.clean) count++;
    if (form.uniqueIds) count++;
    if (form.insecure) count++;
    return count;
  }, [form]);

  const handleFieldChange = (
    field: keyof SidebarFormState,
    value: string | boolean,
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <>
      <div className="app-header">
        <h2 className="app-title">Synthtrace Runner</h2>
        <p className="app-subtitle">
          Run scenarios with optional advanced CLI controls
        </p>
      </div>

      <ConnectionSection
        form={form}
        esStatus={viewState.esStatus}
        kibanaStatus={viewState.kibanaStatus}
        onFieldChange={handleFieldChange}
        onConnect={() =>
          vscodeApi.postMessage({
            type: "connect",
            payload: withSelectedScenario(form, selectedScenario),
          })
        }
        onOpenKibana={() => vscodeApi.postMessage({ type: "openKibana" })}
      />

      <ScenarioSection
        scenarioSearch={scenarioSearch}
        scenarios={filteredScenarios}
        selectedScenario={selectedScenario}
        onScenarioSearchChange={setScenarioSearch}
        onScenarioChange={(value) => handleFieldChange("scenario", value)}
        onRefreshScenarios={() => vscodeApi.postMessage({ type: "refreshScenarios" })}
        onOpenScenario={() =>
          vscodeApi.postMessage({
            type: "openScenario",
            payload: { scenario: selectedScenario },
          })
        }
      />

      <TimeRangeSection
        from={form.from}
        to={form.to}
        onFromChange={(value) => handleFieldChange("from", value)}
        onToChange={(value) => handleFieldChange("to", value)}
      />

      <AdvancedSettingsSection
        form={form}
        modifiedCount={modifiedAdvancedSettingsCount}
        onFieldChange={handleFieldChange}
      />

      <RunControlsSection
        isRunning={viewState.isRunning}
        runStatus={viewState.runStatus}
        progressValue={viewState.progressValue}
        progressLabel={viewState.progressLabel}
        onRun={() =>
          vscodeApi.postMessage({
            type: "run",
            payload: withSelectedScenario(form, selectedScenario),
          })
        }
        onStop={() => vscodeApi.postMessage({ type: "stop" })}
      />
    </>
  );
}
