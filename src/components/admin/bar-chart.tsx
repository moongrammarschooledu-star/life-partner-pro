export function BarChart({
  data,
  title,
  onBarClick,
  percentMode,
}: {
  data: { label: string; count: number }[];
  title: string;
  onBarClick?: (label: string) => void;
  percentMode?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div>
      <p className="text-sm font-medium mb-4">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-muted">No data yet.</p>
      ) : (
        <div className="space-y-2.5">
          {data.map((d) => {
            const Wrapper = onBarClick ? "button" : "div";
            return (
              <Wrapper
                key={d.label}
                type={onBarClick ? "button" : undefined}
                onClick={onBarClick ? () => onBarClick(d.label) : undefined}
                className={`flex w-full items-center gap-3 text-sm ${onBarClick ? "cursor-pointer text-left hover:opacity-80" : ""}`}
              >
                <span className="w-28 shrink-0 truncate text-muted" title={d.label}>
                  {d.label}
                </span>
                <div className="h-2.5 flex-1 rounded-full bg-surface-muted">
                  <div className="h-2.5 rounded-full bg-primary" style={{ width: `${Math.max(4, (d.count / max) * 100)}%` }} />
                </div>
                <span className="w-10 shrink-0 text-right font-medium">
                  {percentMode && total > 0 ? `${Math.round((d.count / total) * 100)}%` : d.count}
                </span>
              </Wrapper>
            );
          })}
        </div>
      )}
    </div>
  );
}
