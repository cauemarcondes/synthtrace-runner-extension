import type { SidebarFormState } from "../types";

interface AdvancedSettingsSectionProps {
  form: SidebarFormState;
  modifiedCount: number;
  onFieldChange: (
    field: keyof SidebarFormState,
    value: string | boolean,
  ) => void;
}

function InfoHint({ text }: { text: string }) {
  return (
    <span className="info-hint" tabIndex={0} data-tooltip={text}>
      (i)
    </span>
  );
}

export function AdvancedSettingsSection({
  form,
  modifiedCount,
  onFieldChange,
}: AdvancedSettingsSectionProps) {
  return (
    <div className="section">
      <div className="section-title-row">
        <h3 className="section-title">Advanced Settings</h3>
        {modifiedCount > 0 && (
          <span className="settings-badge">
            {modifiedCount === 1
              ? "1 modified setting"
              : `${modifiedCount} modified settings`}
          </span>
        )}
      </div>
      <details>
        <summary>Advanced settings</summary>
        <p className="details-help">
          Optional flags passed to synthtrace, in addition to defaults handled by
          this extension.
        </p>
        <div className="row">
          <label htmlFor="versionOverride" className="label-with-info">
            Version override (optional)
            <InfoHint text="String used for observer.version. Defaults to the installed package version." />
          </label>
          <input
            id="versionOverride"
            value={form.versionOverride}
            placeholder="e.g. 8.18.0"
            onChange={(event) =>
              onFieldChange("versionOverride", event.target.value)
            }
          />
        </div>
        <div className="row">
          <label htmlFor="logLevel" className="label-with-info">
            Log level (optional)
            <InfoHint text="Log level to use: verbose, debug, info, or error." />
          </label>
          <select
            id="logLevel"
            value={form.logLevel}
            onChange={(event) => onFieldChange("logLevel", event.target.value)}
          >
            <option value="">Default (info)</option>
            <option value="verbose">verbose</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="error">error</option>
          </select>
        </div>
        <div className="row">
          <label htmlFor="dataType" className="label-with-info">
            Type (optional)
            <InfoHint text="Type of data to be generated. Use log when generating logs (default is apm)." />
          </label>
          <input
            id="dataType"
            value={form.dataType}
            placeholder="apm or log"
            onChange={(event) => onFieldChange("dataType", event.target.value)}
          />
        </div>
        <div className="row">
          <label htmlFor="concurrency" className="label-with-info">
            Concurrency (optional)
            <InfoHint text="Concurrency of Elasticsearch client bulk indexing." />
          </label>
          <input
            id="concurrency"
            type="number"
            min="1"
            value={form.concurrency}
            placeholder="e.g. 1"
            onChange={(event) =>
              onFieldChange("concurrency", event.target.value)
            }
          />
        </div>
        <div className="row">
          <label htmlFor="workers" className="label-with-info">
            Workers (optional)
            <InfoHint text="Amount of Node.js worker threads." />
          </label>
          <input
            id="workers"
            className="narrow-input"
            type="number"
            min="1"
            value={form.workers}
            placeholder="e.g. 4"
            onChange={(event) => onFieldChange("workers", event.target.value)}
          />
        </div>
        <div className="row">
          <label htmlFor="liveBucketSize" className="label-with-info">
            Live bucket size (ms, optional)
            <InfoHint text="Bucket size in ms for live streaming." />
          </label>
          <input
            id="liveBucketSize"
            type="number"
            min="1"
            value={form.liveBucketSize}
            placeholder="e.g. 1000"
            onChange={(event) =>
              onFieldChange("liveBucketSize", event.target.value)
            }
          />
        </div>
        <div className="row checkbox-row">
          <label htmlFor="live" className="checkbox-inline label-with-info">
            <input
              id="live"
              type="checkbox"
              checked={form.live}
              onChange={(event) => onFieldChange("live", event.target.checked)}
            />
            Live
            <InfoHint text="Generate and index data continuously." />
          </label>
        </div>
        <div className="row checkbox-row">
          <label htmlFor="clean" className="checkbox-inline label-with-info">
            <input
              id="clean"
              type="checkbox"
              checked={form.clean}
              onChange={(event) => onFieldChange("clean", event.target.checked)}
            />
            Clean
            <InfoHint text="Clean APM data before indexing new data." />
          </label>
        </div>
        <div className="row checkbox-row">
          <label htmlFor="uniqueIds" className="checkbox-inline label-with-info">
            <input
              id="uniqueIds"
              type="checkbox"
              checked={form.uniqueIds}
              onChange={(event) =>
                onFieldChange("uniqueIds", event.target.checked)
              }
            />
            Unique IDs
            <InfoHint text="Generate unique ids to avoid id collisions." />
          </label>
        </div>
        <div className="row checkbox-row">
          <label htmlFor="insecure" className="checkbox-inline label-with-info">
            <input
              id="insecure"
              type="checkbox"
              checked={form.insecure}
              onChange={(event) =>
                onFieldChange("insecure", event.target.checked)
              }
            />
            Insecure
            <InfoHint text="Skip SSL certificate validation (useful for self-signed certificates)." />
          </label>
        </div>
      </details>
    </div>
  );
}
