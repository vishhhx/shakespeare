import { cn } from "@/lib/utils";
import {
  LIFECYCLE,
  ROLE_LABELS,
  SEVERITY_CLASSES,
  SEVERITY_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  type ActorRole,
  type EmergencySeverity,
  type EmergencyStatus,
} from "@/lib/emergency";

const pill = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset";

export function StatusBadge({ status, className }: { status: EmergencyStatus; className?: string }) {
  return <span className={cn(pill, STATUS_CLASSES[status], className)}>{STATUS_LABELS[status]}</span>;
}

export function SeverityBadge({ severity, className }: { severity: EmergencySeverity; className?: string }) {
  return <span className={cn(pill, SEVERITY_CLASSES[severity], className)}>{SEVERITY_LABELS[severity]}</span>;
}

export function RoleBadge({ role }: { role: ActorRole }) {
  return <span className={cn(pill, "bg-muted text-foreground ring-border normal-case tracking-normal")}>{ROLE_LABELS[role]}</span>;
}

/** reported → verified → in progress → resolved → closed, with the current step highlighted. */
export function Lifecycle({ status }: { status: EmergencyStatus }) {
  const current = LIFECYCLE.indexOf(status);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label={`Case progress: ${STATUS_LABELS[status]}`}>
      {LIFECYCLE.map((step, index) => (
        <li key={step} className="space-y-1">
          <div className={cn("h-1 rounded-full", index <= current ? "bg-foreground" : "bg-border")} />
          <p className={cn("truncate text-[11px]", index === current ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {STATUS_LABELS[step]}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function StatTile({ label, value, tone }: { label: string; value: number | string; tone?: "danger" | "default" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "danger" ? "text-red-600 dark:text-red-400" : "text-foreground")}>
        {value}
      </p>
    </div>
  );
}

export function Panel({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4", className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}
