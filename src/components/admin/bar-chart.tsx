export function BarChart({ data, title }: { data: { label: string; count: number }[]; title: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div>
      <p className="text-sm font-medium mb-4">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-muted">No data yet.</p>
      ) : (
        <div className="space-y-2.5">
          {data.map((d) => (
            <div key={d.label} className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0 truncate text-muted" title={d.label}>
                {d.label}
              </span>
              <div className="h-2.5 flex-1 rounded-full bg-surface-muted">
                <div
                  className="h-2.5 rounded-full bg-primary"
                  style={{ width: `${Math.max(4, (d.count / max) * 100)}%` }}
                />
              </div>
              <span className="w-6 shrink-0 text-right font-medium">{d.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
