interface TimeRangeSectionProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

function toIsoString(value: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function TimeRangeSection({
  from,
  to,
  onFromChange,
  onToChange,
}: TimeRangeSectionProps) {
  return (
    <div className="section">
      <h3 className="section-title">Time Range</h3>
      <details>
        <summary>Time range</summary>
        <p className="details-help">
          These values are auto-applied as <code>--from</code> and <code>--to</code>.
        </p>
        <div className="row">
          <label htmlFor="from">From (optional)</label>
          <input
            id="from"
            value={from}
            placeholder="now-15m or 2026-03-06T12:00:00.000Z"
            onChange={(event) => onFromChange(event.target.value)}
          />
          <label className="small" htmlFor="fromDateTime">
            Or pick date/time
          </label>
          <input
            id="fromDateTime"
            type="datetime-local"
            onChange={(event) => {
              const iso = toIsoString(event.target.value);
              if (iso) {
                onFromChange(iso);
              }
            }}
          />
        </div>
        <div className="row">
          <label htmlFor="to">To (optional)</label>
          <input
            id="to"
            value={to}
            placeholder="now or 2026-03-06T13:00:00.000Z"
            onChange={(event) => onToChange(event.target.value)}
          />
          <label className="small" htmlFor="toDateTime">
            Or pick date/time
          </label>
          <input
            id="toDateTime"
            type="datetime-local"
            onChange={(event) => {
              const iso = toIsoString(event.target.value);
              if (iso) {
                onToChange(iso);
              }
            }}
          />
        </div>
      </details>
    </div>
  );
}
