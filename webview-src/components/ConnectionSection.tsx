import { ConnectionBadge } from "./ConnectionBadge";
import type { ConnectionStatus, SidebarFormState } from "../types";

interface ConnectionSectionProps {
  form: SidebarFormState;
  esStatus: ConnectionStatus;
  kibanaStatus: ConnectionStatus;
  onFieldChange: (
    field: keyof SidebarFormState,
    value: string | boolean,
  ) => void;
  onConnect: () => void;
  onOpenKibana: () => void;
}

export function ConnectionSection({
  form,
  esStatus,
  kibanaStatus,
  onFieldChange,
  onConnect,
  onOpenKibana,
}: ConnectionSectionProps) {
  return (
    <div className="section">
      <h3 className="section-title">Connection</h3>
      <div className="inline">
        <button className="btn-secondary" onClick={onConnect}>
          Test Connection
        </button>
        <ConnectionBadge label="Elasticsearch" status={esStatus} />
        <ConnectionBadge label="Kibana" status={kibanaStatus} />
        <button type="button" className="btn-secondary" onClick={onOpenKibana}>
          Open Kibana
        </button>
      </div>

      <details>
        <summary>Connection settings</summary>
        <div className="row">
          <label htmlFor="esEndpoint">Elasticsearch endpoint (optional)</label>
          <input
            id="esEndpoint"
            value={form.esEndpoint}
            placeholder="http://localhost:9200"
            onChange={(event) => onFieldChange("esEndpoint", event.target.value)}
          />
        </div>
        <div className="row">
          <label htmlFor="kibanaEndpoint">Kibana endpoint (optional)</label>
          <input
            id="kibanaEndpoint"
            value={form.kibanaEndpoint}
            placeholder="http://localhost:5601"
            onChange={(event) =>
              onFieldChange("kibanaEndpoint", event.target.value)
            }
          />
        </div>
        <div className="row">
          <label htmlFor="username">Username (optional)</label>
          <input
            id="username"
            value={form.username}
            placeholder="elastic"
            onChange={(event) => onFieldChange("username", event.target.value)}
          />
        </div>
        <div className="row">
          <label htmlFor="password">Password (optional)</label>
          <input
            id="password"
            type="password"
            value={form.password}
            placeholder="changeme"
            onChange={(event) => onFieldChange("password", event.target.value)}
          />
        </div>
        <div className="row">
          <label htmlFor="apiKey">API key (optional, takes precedence)</label>
          <input
            id="apiKey"
            type="password"
            value={form.apiKey}
            placeholder="your-api-key"
            onChange={(event) => onFieldChange("apiKey", event.target.value)}
          />
        </div>
      </details>
    </div>
  );
}
