import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  InputGroup,
  ProgressBar,
  Row,
  Table,
} from 'react-bootstrap';
import Histogram from './Histogram';
import ScenarioComparisonPanel from './ScenarioComparisonPanel';
import { API, fmt, parseBpmnGraph, readApiPayload, statusLabel, statusVariant } from './utils';

const BpmnHeatmapViewer = lazy(() => import('../../components/BpmnEditor/BpmnHeatmapViewer'));

function HeatmapFallback() {
  return <div className="text-muted small">Loading BPMN heatmap...</div>;
}

export default function ResultsTab({ scenario, scenarios, onScenarioChange, onScenarioReload }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [whatIf, setWhatIf] = useState({ mode: 'task', targetId: '', value: '' });
  const [whatIfResult, setWhatIfResult] = useState(null);
  const [sensitivity, setSensitivity] = useState(scenario.results?.sensitivity || null);
  const [planning, setPlanning] = useState(scenario.results?.resource_planning || null);
  const [planningTarget, setPlanningTarget] = useState('');
  const [explanation, setExplanation] = useState(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationRefreshKey, setExplanationRefreshKey] = useState(0);

  const graph = useMemo(() => parseBpmnGraph(scenario.bpmn_xml), [scenario.bpmn_xml]);
  const results = scenario.results || null;
  const taskResults = Array.isArray(results?.task_results) ? results.task_results : [];
  const resourceResults = Array.isArray(results?.resource_results) ? results.resource_results : [];
  const bottlenecks = Array.isArray(results?.bottlenecks) ? results.bottlenecks : [];
  const monteCarlo = results?.monte_carlo || null;

  useEffect(() => {
    setSensitivity(scenario.results?.sensitivity || null);
    setPlanning(scenario.results?.resource_planning || null);

    const suggestedTarget =
      Math.max(
        0,
        ...(scenario.task_data || []).map((task) => Number(task.sla_target_min) || 0),
      ) ||
      Number(scenario.results?.avg_duration_min) ||
      0;

    setPlanningTarget((current) => current || (suggestedTarget ? String(Math.round(suggestedTarget)) : ''));
  }, [scenario]);

  useEffect(() => {
    let cancelled = false;

    const loadExplanation = async () => {
      if (!scenario?.id) {
        setExplanation(null);
        return;
      }

      setExplanationLoading(true);
      try {
        const response = await fetch(`${API}/simulations/${scenario.id}/explanation`);
        const payload = await readApiPayload(response, 'Failed to load scenario explanation.');
        if (!cancelled) {
          setExplanation(payload.explanation || null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setExplanation(null);
          setError(loadError.message || 'Failed to load scenario explanation.');
        }
      } finally {
        if (!cancelled) {
          setExplanationLoading(false);
        }
      }
    };

    loadExplanation();
    return () => {
      cancelled = true;
    };
  }, [scenario?.id, scenario?.status, scenario?.results?.simulated_at, explanationRefreshKey]);

  const runScenario = async () => {
    setRunning(true);
    setError('');
    try {
      onScenarioChange((current) => ({ ...current, status: 'running' }));
      const response = await fetch(`${API}/simulations/${scenario.id}/run`, { method: 'POST' });
      const payload = await readApiPayload(response, 'Simulation failed.');
      onScenarioChange((current) => ({
        ...current,
        ...(payload.scenario || {}),
        status: payload.status || 'completed',
        results: payload.results,
      }));
      setSensitivity(payload.results?.sensitivity || null);
      setPlanning(payload.results?.resource_planning || null);
      onScenarioReload?.();
    } catch (runError) {
      setError(runError.message || 'Simulation failed.');
      onScenarioChange((current) => ({ ...current, status: 'failed', last_error: runError.message }));
      onScenarioReload?.();
    } finally {
      setRunning(false);
    }
  };

  const download = async (endpoint, fallbackName) => {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error('Download failed.');
      }
      const blob = await response.blob();
      const header = response.headers.get('content-disposition') || '';
      const fileName = header.split('filename=')[1]?.replace(/"/g, '') || fallbackName;
      const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: fileName,
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (downloadError) {
      setError(downloadError.message || 'Download failed.');
    }
  };

  const exportReport = async (format) => {
    const extension = format === 'excel' ? 'xls' : format;
    await download(
      `${API}/simulations/${scenario.id}/report?format=${format}`,
      `simulation-${scenario.id}-report.${extension}`,
    );
  };

  const runWhatIf = async () => {
    if (!whatIf.targetId || !whatIf.value) {
      return;
    }

    const body =
      whatIf.mode === 'task'
        ? { task_overrides: [{ task_id: whatIf.targetId, duration_multiplier: Number(whatIf.value) / 100 }] }
        : { resource_overrides: [{ resource_id: Number(whatIf.targetId), quantity: Number(whatIf.value) }] };

    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/what-if`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setWhatIfResult(await readApiPayload(response, 'What-if analysis failed.'));
    } catch (analysisError) {
      setError(analysisError.message || 'What-if analysis failed.');
    }
  };

  const loadSensitivity = async () => {
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/sensitivity`);
      setSensitivity(await readApiPayload(response, 'Failed to load sensitivity analysis.'));
    } catch (analysisError) {
      setError(analysisError.message || 'Failed to load sensitivity analysis.');
    }
  };

  const loadPlanning = async () => {
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/resource-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_cycle_time_min: Number(planningTarget) }),
      });
      setPlanning(await readApiPayload(response, 'Failed to build resource plan.'));
    } catch (analysisError) {
      setError(analysisError.message || 'Failed to build resource plan.');
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {error && <Alert variant="danger">{error}</Alert>}
      <Card className="border-0 shadow-sm">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <h6 className="mb-1">Run and export</h6>
              <div className="text-muted small">Launch the simulation and export polished reports.</div>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <Badge bg={statusVariant(scenario.status)}>{statusLabel(scenario.status)}</Badge>
              <Button variant="danger" onClick={runScenario} disabled={running}>
                {running ? 'Running...' : 'Run simulation'}
              </Button>
              <Button variant="outline-secondary" onClick={() => download(`${API}/simulations/${scenario.id}/export`, `simulation-${scenario.id}.csv`)}>
                CSV
              </Button>
              <Button variant="outline-secondary" onClick={() => exportReport('excel')}>
                Excel
              </Button>
              <Button variant="outline-secondary" onClick={() => exportReport('pdf')}>
                PDF report
              </Button>
            </div>
          </div>
          {scenario.last_error && (
            <Alert variant="danger" className="mt-3 mb-0">
              {scenario.last_error}
            </Alert>
          )}
        </Card.Body>
      </Card>

      {!results ? (
        <Card className="border-0 shadow-sm">
          <Card.Body className="text-center py-5 text-muted">Run the scenario to generate results.</Card.Body>
        </Card>
      ) : (
        <>
          <Card className="border-0 shadow-sm">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                <div>
                  <h6 className="mb-1">Scenario explanation</h6>
                  <div className="text-muted small">Readable interpretation of the scenario setup, performance, bottlenecks, and planning implications.</div>
                </div>
                <Button variant="outline-secondary" size="sm" onClick={() => setExplanationRefreshKey((value) => value + 1)} disabled={explanationLoading}>
                  {explanationLoading ? 'Refreshing...' : 'Refresh'}
                </Button>
              </div>

              {explanationLoading ? (
                <div className="text-muted small">Loading explanation...</div>
              ) : !explanation ? (
                <div className="text-muted small">No explanation available yet.</div>
              ) : (
                <div className="d-flex flex-column gap-3">
                  <Alert variant="light" className="mb-0 border">
                    <div className="fw-semibold mb-1">Executive summary</div>
                    <div className="small mb-0">{explanation.summary}</div>
                  </Alert>

                  <Row className="g-3">
                    {(explanation.sections || []).map((section) => (
                      <Col lg={6} key={section.title}>
                        <div className="border rounded-3 h-100 p-3">
                          <div className="fw-semibold mb-2">{section.title}</div>
                          <div className="small text-muted mb-2">{section.body}</div>
                          {(section.bullets || []).length > 0 && (
                            <div className="d-flex flex-column gap-1">
                              {section.bullets.map((bullet) => (
                                <div key={bullet} className="small">
                                  - {bullet}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </Col>
                    ))}
                  </Row>
                </div>
              )}
            </Card.Body>
          </Card>

          <Row className="g-3">
            {[
              ['Average cycle', `${fmt(results.avg_duration_min)} min`, 'primary'],
              ['P95', `${fmt(results.p95_duration_min)} min`, 'danger'],
              ['Total cost', `${fmt(results.total_cost, 2)} EUR`, 'success'],
              ['Late instances', `${results.late_instances ?? 0}`, 'warning'],
              ['Arrival source', results.arrival_source || '-', 'secondary'],
              ['Monte Carlo', `${scenario.monte_carlo_runs || 1} run(s)`, 'dark'],
            ].map(([label, value, color]) => (
              <Col sm={6} xl={2} key={label}>
                <Card className={`border-0 shadow-sm sim-kpi-card border-${color}`}>
                  <Card.Body className="py-3 text-center">
                    <div className={`sim-kpi-value text-${color}`}>{value}</div>
                    <div className="sim-kpi-label">{label}</div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>

          {scenario.bpmn_xml && results.task_results?.length > 0 && (
            <Card className="border-0 shadow-sm">
              <Card.Body>
                <Suspense fallback={<HeatmapFallback />}>
                  <BpmnHeatmapViewer bpmnXml={scenario.bpmn_xml} results={results} />
                </Suspense>
              </Card.Body>
            </Card>
          )}

          <ScenarioComparisonPanel scenario={scenario} scenarios={scenarios} />

          <Card className="border-0 shadow-sm">
            <Card.Body>
              <h6 className="mb-3">Cycle-time distribution</h6>
              <Histogram data={results.histogram || []} />
            </Card.Body>
          </Card>

          <Row className="g-4">
            <Col xl={7}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h6 className="mb-0">Task performance and SLA</h6>
                    <Badge bg={results.sla_summary?.late_instance_rate > 0 ? 'warning' : 'success'}>
                      {fmt(results.sla_summary?.late_instance_rate, 1)}% late
                    </Badge>
                  </div>
                  <div className="table-responsive">
                    <Table hover className="sim-table mb-0">
                      <thead>
                        <tr>
                          <th>Task</th>
                          <th>Avg duration</th>
                          <th>Queue wait</th>
                          <th>Calendar wait</th>
                          <th>SLA target</th>
                          <th>Breach rate</th>
                          <th>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {taskResults.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center text-muted py-4">
                              No task results available.
                            </td>
                          </tr>
                        ) : (
                          taskResults.map((task) => (
                            <tr key={task.task_id}>
                              <td>
                                <strong>{task.task_name || task.task_id}</strong>
                                <div className="text-muted small">{task.executions} execution(s)</div>
                              </td>
                              <td>{fmt(task.avg_duration)} min</td>
                              <td>{fmt(task.avg_queue_wait_min)} min</td>
                              <td>{fmt(task.avg_calendar_wait_min)} min</td>
                              <td>{task.sla_target_min ? `${fmt(task.sla_target_min)} min` : '-'}</td>
                              <td>
                                <Badge bg={(task.sla_breach_rate || 0) > 0 ? 'warning' : 'success'}>
                                  {fmt(task.sla_breach_rate, 1)}%
                                </Badge>
                              </td>
                              <td>{fmt(task.total_cost, 2)} EUR</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </Table>
                  </div>
                </Card.Body>
              </Card>
            </Col>

            <Col xl={5}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h6 className="mb-0">Resource utilisation</h6>
                    <div className="text-muted small">Calendars and windows applied</div>
                  </div>
                  {resourceResults.length === 0 ? (
                    <div className="text-muted small">No resource data available.</div>
                  ) : (
                    <div className="d-flex flex-column gap-3">
                      {resourceResults.map((resource) => (
                        <div key={resource.resource_id} className="border rounded-3 p-3">
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <div>
                              <strong>{resource.resource_name}</strong>
                              <div className="text-muted small">{resource.quantity} unit(s)</div>
                            </div>
                            <Badge bg={resource.utilization_rate >= 90 ? 'danger' : resource.utilization_rate >= 70 ? 'warning' : 'success'}>
                              {fmt(resource.utilization_rate, 1)}%
                            </Badge>
                          </div>
                          <div className="sim-resource-util mb-2">
                            <ProgressBar
                              now={Math.min(100, Number(resource.utilization_rate) || 0)}
                              variant={resource.utilization_rate >= 90 ? 'danger' : resource.utilization_rate >= 70 ? 'warning' : 'success'}
                            />
                            <span>{fmt(resource.utilization_rate, 1)}%</span>
                          </div>
                          <div className="row g-2 small text-muted">
                            <div className="col-6">Busy: {fmt(resource.total_busy_min)} min</div>
                            <div className="col-6">Capacity: {fmt(resource.capacity_window_min)} min</div>
                            <div className="col-6">Queue wait: {fmt(resource.avg_queue_wait_min)} min</div>
                            <div className="col-6">Calendar wait: {fmt(resource.avg_calendar_wait_min)} min</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Card className="border-0 shadow-sm">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="mb-0">Bottlenecks</h6>
                <div className="text-muted small">Slow steps, overloads, and SLA breaches</div>
              </div>
              {bottlenecks.length === 0 ? (
                <div className="text-muted small">No bottlenecks detected in this run.</div>
              ) : (
                <div className="sim-bottlenecks">
                  {bottlenecks.map((item, index) => (
                    <Card key={`${item.type}-${item.name}-${index}`} className={`border-0 shadow-sm sim-bottleneck-card severity-${item.severity || 'low'}`}>
                      <Card.Body>
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <Badge bg="light" text="dark">
                            {item.type}
                          </Badge>
                          <Badge bg={item.severity === 'high' ? 'danger' : item.severity === 'medium' ? 'warning' : 'secondary'}>
                            {item.severity || 'low'}
                          </Badge>
                        </div>
                        <div className="sim-bottleneck-metric">
                          {fmt(item.metric, 1)} {item.unit || ''}
                        </div>
                        <div className="fw-semibold">{item.name}</div>
                        <div className="text-muted small mt-1">{item.details}</div>
                      </Card.Body>
                    </Card>
                  ))}
                </div>
              )}
            </Card.Body>
          </Card>

          <Row className="g-4">
            <Col xl={6}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h6 className="mb-1">Monte Carlo confidence</h6>
                      <div className="text-muted small">Multiple runs with confidence ranges and bottleneck frequency.</div>
                    </div>
                    <Button variant="outline-secondary" size="sm" onClick={runScenario} disabled={running || (scenario.monte_carlo_runs || 1) <= 1}>
                      Refresh
                    </Button>
                  </div>

                  {!monteCarlo ? (
                    <Alert variant="light" className="mb-0">
                      Increase Monte Carlo runs above 1 in the scenario settings, then rerun the simulation to get confidence intervals.
                    </Alert>
                  ) : (
                    <div className="d-flex flex-column gap-3">
                      <Row className="g-3">
                        {[
                          ['Average cycle', monteCarlo.duration, 'min'],
                          ['P95 cycle', monteCarlo.p95_duration, 'min'],
                          ['Total cost', monteCarlo.total_cost, 'EUR'],
                          ['Late rate', monteCarlo.late_instance_rate, '%'],
                        ].map(([label, sample, unit]) => (
                          <Col sm={6} key={label}>
                            <div className="border rounded-3 p-3 h-100 bg-light">
                              <div className="text-muted small text-uppercase">{label}</div>
                              <div className="fw-bold mt-1">
                                {fmt(sample.mean, 2)} {unit}
                              </div>
                              <div className="small text-muted">
                                90% band {fmt(sample.ci_low, 2)} to {fmt(sample.ci_high, 2)} {unit}
                              </div>
                            </div>
                          </Col>
                        ))}
                      </Row>

                      <div>
                        <div className="fw-semibold mb-2">Most frequent bottlenecks</div>
                        <Table hover className="sim-table mb-0">
                          <thead>
                            <tr>
                              <th>Type</th>
                              <th>Name</th>
                              <th>Frequency</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(monteCarlo.bottleneck_frequency || []).map((entry) => (
                              <tr key={`${entry.type}-${entry.name}`}>
                                <td>{entry.type}</td>
                                <td>{entry.name}</td>
                                <td>{fmt(entry.rate, 1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>

            <Col xl={6}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h6 className="mb-1">What-if analysis</h6>
                      <div className="text-muted small">Change one task duration or resource headcount and rerun instantly.</div>
                    </div>
                    <Button variant="outline-danger" size="sm" onClick={runWhatIf} disabled={!whatIf.targetId || !whatIf.value}>
                      Run what-if
                    </Button>
                  </div>

                  <Row className="g-3 mb-3">
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label>Mode</Form.Label>
                        <Form.Select value={whatIf.mode} onChange={(event) => setWhatIf({ mode: event.target.value, targetId: '', value: '' })}>
                          <option value="task">Task duration</option>
                          <option value="resource">Resource quantity</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={5}>
                      <Form.Group>
                        <Form.Label>Target</Form.Label>
                        <Form.Select value={whatIf.targetId} onChange={(event) => setWhatIf((current) => ({ ...current, targetId: event.target.value }))}>
                          <option value="">Select</option>
                          {(whatIf.mode === 'task' ? graph.tasks : scenario.resources || []).map((entry) => (
                            <option key={whatIf.mode === 'task' ? entry.task_id : entry.id} value={whatIf.mode === 'task' ? entry.task_id : entry.id}>
                              {whatIf.mode === 'task' ? entry.task_name : entry.name}
                            </option>
                          ))}
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group>
                        <Form.Label>{whatIf.mode === 'task' ? 'Duration %' : 'Units'}</Form.Label>
                        <Form.Control
                          type="number"
                          min={whatIf.mode === 'task' ? 10 : 1}
                          value={whatIf.value}
                          onChange={(event) => setWhatIf((current) => ({ ...current, value: event.target.value }))}
                          placeholder={whatIf.mode === 'task' ? '120' : '3'}
                        />
                      </Form.Group>
                    </Col>
                  </Row>

                  {!whatIfResult ? (
                    <Alert variant="light" className="mb-0">
                      Run an analysis to compare baseline and candidate outcomes.
                    </Alert>
                  ) : (
                    <Row className="g-3">
                      {[
                        ['Avg cycle delta', whatIfResult.comparison?.avg_duration_delta, 'min'],
                        ['P95 delta', whatIfResult.comparison?.p95_duration_delta, 'min'],
                        ['Cost delta', whatIfResult.comparison?.total_cost_delta, 'EUR'],
                        ['Late-rate delta', whatIfResult.comparison?.late_rate_delta, '%'],
                      ].map(([label, value, unit]) => (
                        <Col sm={6} key={label}>
                          <div className="border rounded-3 p-3 h-100 bg-light">
                            <div className="text-muted small">{label}</div>
                            <div className={`fw-bold mt-1 ${(Number(value) || 0) <= 0 ? 'text-success' : 'text-danger'}`}>
                              {fmt(value, 2)} {unit}
                            </div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="g-4">
            <Col xl={6}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h6 className="mb-1">Sensitivity analysis</h6>
                      <div className="text-muted small">See which task or resource most affects cycle time.</div>
                    </div>
                    <Button variant="outline-secondary" size="sm" onClick={loadSensitivity}>
                      Refresh
                    </Button>
                  </div>

                  {!sensitivity?.impacts?.length ? (
                    <Alert variant="light" className="mb-0">
                      No sensitivity analysis is available yet.
                    </Alert>
                  ) : (
                    <Table hover className="sim-table mb-0">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Name</th>
                          <th>Change</th>
                          <th>Cycle impact</th>
                          <th>Cost impact</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sensitivity.impacts.slice(0, 8).map((impact) => (
                          <tr key={`${impact.type}-${impact.id}`}>
                            <td>{impact.type}</td>
                            <td>{impact.name}</td>
                            <td>{impact.change}</td>
                            <td className={(impact.cycle_impact_min || 0) <= 0 ? 'text-success' : 'text-danger'}>
                              {fmt(impact.cycle_impact_min, 2)} min
                            </td>
                            <td>{fmt(impact.cost_impact, 2)} EUR</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card.Body>
              </Card>
            </Col>

            <Col xl={6}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h6 className="mb-1">Resource planning</h6>
                      <div className="text-muted small">Recommend extra capacity to hit a target SLA.</div>
                    </div>
                    <div className="d-flex gap-2">
                      <InputGroup size="sm" style={{ width: 190 }}>
                        <Form.Control
                          type="number"
                          min={1}
                          value={planningTarget}
                          onChange={(event) => setPlanningTarget(event.target.value)}
                          placeholder="Target cycle"
                        />
                        <InputGroup.Text>min</InputGroup.Text>
                      </InputGroup>
                      <Button variant="outline-danger" size="sm" onClick={loadPlanning} disabled={!planningTarget}>
                        Plan
                      </Button>
                    </div>
                  </div>

                  {!planning ? (
                    <Alert variant="light" className="mb-0">
                      Enter a target cycle time to compute staffing recommendations.
                    </Alert>
                  ) : (
                    <div className="d-flex flex-column gap-3">
                      <Alert variant={planning.meets_target ? 'success' : 'warning'} className="mb-0">
                        {planning.summary}
                      </Alert>
                      <div className="small text-muted">
                        Baseline average cycle: {fmt(planning.baseline?.avg_duration_min, 2)} min
                      </div>
                      <Table hover className="sim-table mb-0">
                        <thead>
                          <tr>
                            <th>Resource</th>
                            <th>Add units</th>
                            <th>Projected cycle</th>
                            <th>Improvement</th>
                            <th>Target met</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(planning.recommendations || []).length === 0 ? (
                            <tr>
                              <td colSpan={5} className="text-center text-muted py-4">
                                No recommendation found.
                              </td>
                            </tr>
                          ) : (
                            planning.recommendations.map((entry) => (
                              <tr key={`${entry.resource_id}-${entry.add_units}`}>
                                <td>{entry.resource_name}</td>
                                <td>+{entry.add_units}</td>
                                <td>{fmt(entry.projected_avg_duration_min, 2)} min</td>
                                <td className="text-success">{fmt(entry.improvement_min, 2)} min</td>
                                <td>
                                  <Badge bg={entry.meets_target ? 'success' : 'secondary'}>
                                    {entry.meets_target ? 'Yes' : 'No'}
                                  </Badge>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
