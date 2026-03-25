import type { ConnectionStatus } from "../types";

interface ConnectionBadgeProps {
  label: string;
  status: ConnectionStatus;
}

function getStatusLabel(status: ConnectionStatus): string {
  if (status === "ok") {
    return "Connected";
  }
  if (status === "error") {
    return "Unavailable";
  }
  if (status === "loading") {
    return "Checking...";
  }
  return "Unknown";
}

export function ConnectionBadge({ label, status }: ConnectionBadgeProps) {
  return (
    <span className={`badge ${status}`}>
      <span className="badge-dot" />
      {label}: {getStatusLabel(status)}
    </span>
  );
}
