# Synthtrace Runner

`Synthtrace Runner` is a VS Code/Cursor sidebar extension that helps you run Kibana
`synthtrace` scenarios without leaving the IDE.

It provides a UI for connection testing, scenario discovery, advanced CLI options,
run control, and progress visibility.

## What The Extension Does

- Tests Elasticsearch and Kibana connectivity from the sidebar.
- Loads runnable synthtrace scenarios from Kibana.
- Lets you search scenarios by name and open a scenario file directly in the IDE.
- Builds and runs `scripts/synthtrace.js` with:
  - automatic options (`--target`, `--kibana`, `--apiKey`, `--from`, `--to`)
  - optional advanced settings (`--live`, `--clean`, `--workers`, `--logLevel`, etc.)
- Shows ingestion progress, including live-mode behavior.
- Exposes quick actions such as opening Kibana in the browser.

## Prerequisites

- Node.js 18+ (or a version compatible with your VS Code/Cursor setup)
- A Kibana repository with dependencies bootstrapped
- Access to `scripts/synthtrace.js` and
  `src/platform/packages/shared/kbn-synthtrace/src/scenarios`
- Open the Kibana repository as the active workspace when using this extension

## Build And Run (Development)

1. Install dependencies:
   - `npm install`
2. Compile:
   - `npm run compile`
3. Start extension dev host:
   - Press `F5` in VS Code/Cursor (Run Extension)
4. In the Extension Development Host window, open the **Synthtrace Runner** activity bar view.

### Optional: watch mode

- `npm run watch`

## Add It To Your IDE

### Option 1: Run locally (best for development)

- Use `F5` to launch an Extension Development Host.

### Option 2: Package as VSIX and install

1. Install the packaging tool:
   - `npm install -g @vscode/vsce`
2. Package:
   - `vsce package`
3. Install in VS Code/Cursor:
   - VS Code: `Extensions: Install from VSIX...`
   - Cursor: same extension install flow from VSIX

## Main UI Sections

- **Connection**
  - Test connection, view Elasticsearch/Kibana status badges, open Kibana URL
- **Scenario**
  - Search/filter scenarios, select scenario, open scenario in IDE, refresh list
- **Time Range**
  - Configure `from`/`to` (auto-applied CLI options)
- **Advanced Settings**
  - Optional synthtrace flags with inline help and modified-settings badge
- **Run Controls**
  - Run/stop execution and monitor ingestion progress

## Notes

- Output logs are written to the **Synthtrace Runner** output channel.
- This extension is designed to work in both VS Code and Cursor.
