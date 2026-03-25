interface RunControlsSectionProps {
  isRunning: boolean;
  runStatus: "idle" | "loading" | "done" | "error";
  progressValue: number | null;
  progressLabel: string;
  onRun: () => void;
  onStop: () => void;
}

export function RunControlsSection({
  isRunning,
  runStatus,
  progressValue,
  progressLabel,
  onRun,
  onStop,
}: RunControlsSectionProps) {
  const showProgress = isRunning || runStatus === "done" || runStatus === "error";

  return (
    <div className="section">
      <h3 className="section-title">Run Controls</h3>
      <div className="run-actions">
        <button className="btn-primary" disabled={isRunning} onClick={onRun}>
          {isRunning ? "Running..." : "Run"}
        </button>
        <button className="btn-danger" disabled={!isRunning} onClick={onStop}>
          Stop
        </button>
      </div>
      <div className={`progress-wrap ${showProgress ? "visible" : ""}`}>
        <progress max={100} {...(progressValue == null ? {} : { value: progressValue })} />
        <div className="progress-label">{progressLabel || ""}</div>
      </div>
    </div>
  );
}
