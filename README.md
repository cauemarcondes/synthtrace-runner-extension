# Synthtrace Runner Extension

VS Code/Cursor sidebar extension to run Kibana `synthtrace` scenarios.

## Location

`/Users/caue.marcondes/dev/synthtrace-runner-extension`

## Prerequisites

- Kibana repository available at:
  - `/Users/caue.marcondes/elastic/kibana`
- Node.js installed
- Kibana dependencies bootstrapped if needed:
  - `yarn kbn bootstrap` (from Kibana root)

## Run In Extension Development Host

1. Open this folder in VS Code or Cursor:
   - `/Users/caue.marcondes/dev/synthtrace-runner-extension`
2. Install dependencies:
   - `npm install`
3. Compile:
   - `npm run compile`
4. Press `F5` (or run `Run Extension`) to launch an Extension Development Host window.
5. In the new window, open the **Synthtrace** activity bar icon.

## Sidebar Features

- Optional connection fields:
  - Elasticsearch endpoint (default: `http://localhost:9200`)
  - Kibana endpoint (default: `http://localhost:5601`)
  - Username and password
  - API key (`--apiKey`) auth option
  - Connection settings are collapsible (closed by default)
- `Connect` button:
  - Tests Elasticsearch (`/`) and Kibana (`/api/status`)
  - Uses API key auth when provided (otherwise basic auth)
  - Updates badges:
    - `Elasticsearch ✅/❌`
    - `Kibana ✅/❌`
- Scenario selector:
  - Loads runnable scenarios from:
    - `src/platform/packages/shared/kbn-synthtrace/src/scenarios`
- Optional time range:
  - Collapsible section (closed by default)
  - Defaults to `from=now-15m` and `to=now`
  - Text values (e.g. `now-15m`, `now`)
  - Date-time pickers that fill ISO date strings
- `Run` button:
  - Disabled while synthtrace is running
  - Executes:
    - `node scripts/synthtrace.js <scenario> [--target=...] [--kibana=...] [--apiKey=...] [--from=...] [--to=...]`
- Run options:
  - `Clean` toggle maps to `--clean`
  - `Workers` toggle + numeric input maps to `--workers=<n>`
- `Stop` button:
  - Disabled by default
  - Enabled only while a run is active
  - Sends termination signal to stop the running synthtrace process
- Status callout:
  - Shows `loading...` while running
  - Shows `Done` on success (or error message)
- Progress bar:
  - Appears after clicking `Run`
  - Shows live ingestion status (indeterminate bar + indexed/produced counters parsed from synthtrace output)

## Notes

- One extension package works in both VS Code and Cursor.
- Output logs are written to the **Synthtrace Runner** output channel.
