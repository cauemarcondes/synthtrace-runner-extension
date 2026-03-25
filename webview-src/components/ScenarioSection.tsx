interface ScenarioSectionProps {
  scenarioSearch: string;
  scenarios: string[];
  selectedScenario: string;
  onScenarioSearchChange: (value: string) => void;
  onScenarioChange: (value: string) => void;
  onRefreshScenarios: () => void;
  onOpenScenario: () => void;
}

export function ScenarioSection({
  scenarioSearch,
  scenarios,
  selectedScenario,
  onScenarioSearchChange,
  onScenarioChange,
  onRefreshScenarios,
  onOpenScenario,
}: ScenarioSectionProps) {
  return (
    <div className="section">
      <h3 className="section-title">Scenario</h3>
      <div className="row">
        <label htmlFor="scenarioSearch">Search scenario</label>
        <input
          id="scenarioSearch"
          type="search"
          value={scenarioSearch}
          placeholder="Type to filter scenarios..."
          onChange={(event) => onScenarioSearchChange(event.target.value)}
        />
      </div>

      <div className="row scenario-row">
        <div>
          <label htmlFor="scenarioSelect">Scenario</label>
          <select
            id="scenarioSelect"
            value={selectedScenario}
            onChange={(event) => onScenarioChange(event.target.value)}
          >
            {scenarios.map((scenario) => (
              <option key={scenario} value={scenario}>
                {scenario}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-secondary" onClick={onOpenScenario}>
          Open
        </button>
      </div>

      <div className="inline actions-row">
        <button type="button" className="btn-secondary" onClick={onRefreshScenarios}>
          Refresh scenarios
        </button>
      </div>
    </div>
  );
}
