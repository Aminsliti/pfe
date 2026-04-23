export default function Histogram({ data }) {
  if (!data?.length) {
    return <div className="text-muted small">No cycle-time histogram available.</div>;
  }

  const max = Math.max(...data.map((entry) => entry.count), 1);

  return (
    <div className="sim-histogram">
      {data.map((bin, index) => (
        <div key={`${bin.label}-${index}`} className="sim-histogram-bar">
          <div
            className="sim-histogram-fill"
            style={{ height: `${(bin.count / max) * 100}%` }}
            title={`${bin.count} instance(s)`}
          />
          <span className="sim-histogram-lbl">{bin.label}</span>
        </div>
      ))}
    </div>
  );
}
