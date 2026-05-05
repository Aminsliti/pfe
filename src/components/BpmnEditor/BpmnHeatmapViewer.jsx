import { useEffect, useMemo, useRef, useState } from 'react';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function buildHeatmapEntries(results = {}) {
  const tasks = Array.isArray(results.task_results) ? results.task_results : [];
  const bottlenecks = Array.isArray(results.bottlenecks) ? results.bottlenecks : [];
  const taskBottleneckNames = new Set(
    bottlenecks
      .filter((entry) => entry.type === 'task')
      .map((entry) => entry.name)
  );

  const maxDuration = Math.max(1, ...tasks.map((task) => Number(task.avg_duration ?? 0)));
  const maxWait = Math.max(1, ...tasks.map((task) => Number(task.avg_wait_min ?? 0)));

  return tasks
    .map((task) => {
      const durationScore = Number(task.avg_duration ?? 0) / maxDuration;
      const waitScore = Number(task.avg_wait_min ?? 0) / maxWait;
      const bottleneckBoost = taskBottleneckNames.has(task.task_name || task.task_id) ? 0.25 : 0;
      const score = durationScore * 0.55 + waitScore * 0.35 + bottleneckBoost;
      const level = score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : score >= 0.18 ? 'low' : 'normal';

      return {
        ...task,
        level,
        score: round(score, 2),
      };
    })
    .sort((left, right) => right.score - left.score);
}

export default function BpmnHeatmapViewer({ bpmnXml, results }) {
  const containerRef = useRef(null);
  const [error, setError] = useState('');
  const heatmapEntries = useMemo(() => buildHeatmapEntries(results), [results]);

  useEffect(() => {
    let cancelled = false;
    let viewer = null;
    let renderPromise = Promise.resolve();

    const mountViewer = async () => {
      if (!containerRef.current || !bpmnXml) {
        setError('');
        return;
      }

      try {
        const { default: NavigatedViewer } = await import('bpmn-js/lib/NavigatedViewer');
        if (cancelled || !containerRef.current) {
          return;
        }

        containerRef.current.innerHTML = '';
        viewer = new NavigatedViewer({
          container: containerRef.current,
        });

        renderPromise = viewer.importXML(bpmnXml);
        await renderPromise;

        if (cancelled) {
          return;
        }

        const canvas = viewer.get('canvas');
        canvas.zoom('fit-viewport');

        heatmapEntries.forEach((entry) => {
          if (entry.level === 'normal') {
            return;
          }

          canvas.addMarker(entry.task_id, `sim-heat-${entry.level}`);
        });

        setError('');
      } catch (importError) {
        if (!cancelled) {
          console.error('BPMN heatmap import error:', importError);
          setError('Impossible d afficher le diagramme BPMN pour cette simulation.');
        }
      }
    };

    mountViewer();

    return () => {
      cancelled = true;
      Promise.resolve(renderPromise).finally(() => {
        viewer?.destroy();
      });
    };
  }, [bpmnXml, heatmapEntries]);

  return (
    <div className="sim-heatmap-shell">
      <div className="sim-heatmap-header">
        <div>
          <strong>Heatmap BPMN</strong>
          <div className="text-muted small">Les taches les plus lentes, en attente, ou surchargees sont colorees directement sur le diagramme.</div>
        </div>
        <div className="sim-heatmap-legend">
          <span className="sim-heatmap-chip level-low">Faible</span>
          <span className="sim-heatmap-chip level-medium">Moyen</span>
          <span className="sim-heatmap-chip level-high">Critique</span>
        </div>
      </div>

      {error ? (
        <div className="alert alert-warning mb-0">{error}</div>
      ) : (
        <div ref={containerRef} className="sim-heatmap-canvas" />
      )}

      {heatmapEntries.length > 0 && (
        <div className="sim-heatmap-ranking">
          {heatmapEntries.slice(0, 5).map((entry) => (
            <div key={entry.task_id} className={`sim-heatmap-rank level-${entry.level}`}>
              <div>
                <strong>{entry.task_name || entry.task_id}</strong>
                <div className="text-muted small">
                  {round(entry.avg_duration)} min moyenne · {round(entry.avg_wait_min)} min attente
                </div>
              </div>
              <span>{entry.level}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
