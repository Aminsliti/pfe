import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Container, Form, Row } from 'react-bootstrap';
import './SimulationScenarios.css';
import { API, fmt, parseBpmnGraph, readApiPayload, statusLabel, statusVariant } from './simulation-workbench/utils';

const ScenarioCreateModal = lazy(() => import('./simulation-workbench/ScenarioCreateModal'));
const OverviewTab = lazy(() => import('./simulation-workbench/OverviewTab'));
const ResourcesTab = lazy(() => import('./simulation-workbench/ResourcesTab'));
const TasksTab = lazy(() => import('./simulation-workbench/TasksTab'));
const FlowsTab = lazy(() => import('./simulation-workbench/FlowsTab'));
const ResultsTab = lazy(() => import('./simulation-workbench/ResultsTab'));

function PanelFallback({ label = 'Loading workspace panel...' }) {
  return <div className="text-center py-5 text-muted">{label}</div>;
}

function ActiveScenarioView({
  activeScenario,
  activeTab,
  detailLoading,
  error,
  graph,
  linkedProcess,
  onBack,
  onDelete,
  onReload,
  onSetActiveTab,
  onScenarioChange,
  processes,
  scenarios,
}) {
  const tabProps = {
    overview: {
      component: OverviewTab,
      props: {
        scenario: activeScenario,
        processes,
        onScenarioChange,
        onReload,
      },
    },
    resources: {
      component: ResourcesTab,
      props: {
        scenario: activeScenario,
        onScenarioReload: onReload,
      },
    },
    tasks: {
      component: TasksTab,
      props: {
        scenario: activeScenario,
        graph,
        resources: activeScenario.resources || [],
        onScenarioReload: onReload,
      },
    },
    flows: {
      component: FlowsTab,
      props: {
        scenario: activeScenario,
        graph,
        onScenarioReload: onReload,
      },
    },
    results: {
      component: ResultsTab,
      props: {
        scenario: activeScenario,
        scenarios,
        onScenarioChange,
        onScenarioReload: onReload,
      },
    },
  };

  const selectedTab = tabProps[activeTab] || tabProps.overview;
  const TabComponent = selectedTab.component;

  return (
    <Container fluid className="py-4 px-4">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-4">
        <div>
          <Button variant="link" className="px-0 text-muted text-decoration-none" onClick={onBack}>
            <i className="bi bi-arrow-left me-1" />
            Back to simulations
          </Button>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <h2 className="mb-0">{activeScenario.name}</h2>
            <Badge bg={statusVariant(activeScenario.status)}>{statusLabel(activeScenario.status)}</Badge>
            <Badge bg="light" text="dark">
              {activeScenario.process_name || linkedProcess?.name || 'No process linked'}
            </Badge>
          </div>
          <div className="text-muted mt-2">
            {activeScenario.description || 'Configure calendars, SLAs, arrivals, and advanced analysis for this scenario.'}
          </div>
        </div>

        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={onReload} disabled={detailLoading}>
            {detailLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button variant="outline-danger" onClick={() => onDelete(activeScenario.id)}>
            Delete
          </Button>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body className="p-3">
          <div className="d-flex flex-wrap gap-2 mb-4">
            {[
              ['overview', 'Overview'],
              ['resources', 'Resources'],
              ['tasks', 'Task data'],
              ['flows', 'Flow probabilities'],
              ['results', 'Results'],
            ].map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={activeTab === key ? 'danger' : 'outline-secondary'}
                onClick={() => onSetActiveTab(key)}
              >
                {label}
              </Button>
            ))}
          </div>

          {detailLoading ? (
            <div className="text-center py-5 text-muted">Loading scenario...</div>
          ) : (
            <Suspense fallback={<PanelFallback label="Loading selected tab..." />}>
              <TabComponent {...selectedTab.props} />
            </Suspense>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
}

export default function SimulationWorkbench() {
  const [scenarios, setScenarios] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [activeScenario, setActiveScenario] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [showCreate, setShowCreate] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadProcesses = async () => {
    const response = await fetch(`${API}/processes`);
    return readApiPayload(response, 'Failed to load processes.');
  };

  const loadScenarios = async () => {
    const response = await fetch(`${API}/simulations`);
    return readApiPayload(response, 'Failed to load scenarios.');
  };

  const bootstrap = async () => {
    setListLoading(true);
    setError('');

    try {
      const [nextProcesses, nextScenarios] = await Promise.all([loadProcesses(), loadScenarios()]);
      setProcesses(Array.isArray(nextProcesses) ? nextProcesses : []);
      setScenarios(Array.isArray(nextScenarios) ? nextScenarios : []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load simulations.');
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    bootstrap();
  }, []);

  const refreshScenarioList = async () => {
    try {
      setScenarios(await loadScenarios());
    } catch (loadError) {
      setError(loadError.message || 'Failed to refresh scenarios.');
    }
  };

  const openScenario = async (scenarioId) => {
    setDetailLoading(true);
    setError('');

    try {
      const response = await fetch(`${API}/simulations/${scenarioId}`);
      const payload = await readApiPayload(response, 'Failed to load scenario.');
      setActiveScenario(payload);
      setActiveTab('overview');
    } catch (loadError) {
      setError(loadError.message || 'Failed to load scenario.');
    } finally {
      setDetailLoading(false);
    }
  };

  const reloadActiveScenario = async () => {
    if (!activeScenario?.id) {
      return;
    }

    await Promise.all([openScenario(activeScenario.id), refreshScenarioList()]);
  };

  const applyScenarioChange = (updater) => {
    setActiveScenario((current) => {
      if (!current) {
        return current;
      }

      const next = typeof updater === 'function' ? updater(current) : updater;

      if (next?.id) {
        setScenarios((items) =>
          items.map((entry) =>
            entry.id === next.id
              ? {
                  ...entry,
                  ...next,
                  process_name: next.process_name || entry.process_name,
                }
              : entry,
          ),
        );
      }

      return next;
    });
  };

  const deleteScenario = async (scenarioId) => {
    if (!window.confirm('Delete this simulation scenario?')) {
      return;
    }

    try {
      const response = await fetch(`${API}/simulations/${scenarioId}`, { method: 'DELETE' });
      await readApiPayload(response, 'Failed to delete scenario.');
      setScenarios((items) => items.filter((entry) => entry.id !== scenarioId));
      if (activeScenario?.id === scenarioId) {
        setActiveScenario(null);
      }
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete scenario.');
    }
  };

  const filteredScenarios = scenarios.filter((scenario) => {
    const haystack = `${scenario.name} ${scenario.description || ''} ${scenario.process_name || ''}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || scenario.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const scenarioStats = {
    total: scenarios.length,
    running: scenarios.filter((scenario) => scenario.status === 'running').length,
    completed: scenarios.filter((scenario) => scenario.status === 'completed').length,
    failed: scenarios.filter((scenario) => scenario.status === 'failed').length,
  };

  const linkedProcess = processes.find((process) => process.id === activeScenario?.process_id);
  const graph = useMemo(
    () => parseBpmnGraph(activeScenario?.bpmn_xml || linkedProcess?.bpmn_xml),
    [activeScenario?.bpmn_xml, linkedProcess?.bpmn_xml],
  );

  if (activeScenario) {
    return (
      <ActiveScenarioView
        activeScenario={activeScenario}
        activeTab={activeTab}
        detailLoading={detailLoading}
        error={error}
        graph={graph}
        linkedProcess={linkedProcess}
        onBack={() => setActiveScenario(null)}
        onDelete={deleteScenario}
        onReload={reloadActiveScenario}
        onScenarioChange={applyScenarioChange}
        onSetActiveTab={setActiveTab}
        processes={processes}
        scenarios={scenarios}
      />
    );
  }

  return (
    <Container fluid className="py-4 px-4">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-4">
        <div>
          <h1 className="mb-2">Simulation Workbench</h1>
          <div className="text-muted">
            Build advanced scenarios with calendars, SLAs, Monte Carlo analysis, staffing plans, and polished reports.
          </div>
        </div>
        <Button variant="danger" onClick={() => setShowCreate(true)}>
          <i className="bi bi-plus-lg me-2" />
          New scenario
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Row className="g-3 mb-4">
        {[
          ['Total scenarios', scenarioStats.total, 'dark'],
          ['Running', scenarioStats.running, 'warning'],
          ['Completed', scenarioStats.completed, 'success'],
          ['Failed', scenarioStats.failed, 'danger'],
        ].map(([label, value, variant]) => (
          <Col md={6} xl={3} key={label}>
            <Card className="border-0 shadow-sm h-100">
              <Card.Body>
                <div className="text-muted small text-uppercase">{label}</div>
                <div className={`display-6 fw-bold mt-2 text-${variant}`}>{value}</div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <Card className="border-0 shadow-sm mb-4">
        <Card.Body>
          <Row className="g-3">
            <Col lg={8}>
              <Form.Group>
                <Form.Label>Search scenarios</Form.Label>
                <Form.Control
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, description, or process"
                />
              </Form.Group>
            </Col>
            <Col lg={4}>
              <Form.Group>
                <Form.Label>Status</Form.Label>
                <Form.Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {listLoading ? (
        <Card className="border-0 shadow-sm">
          <Card.Body className="text-center py-5 text-muted">Loading scenarios...</Card.Body>
        </Card>
      ) : filteredScenarios.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <Card.Body className="text-center py-5 text-muted">No scenarios match the current filters.</Card.Body>
        </Card>
      ) : (
        <Row className="g-4">
          {filteredScenarios.map((scenario) => (
            <Col lg={6} xl={4} key={scenario.id}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body className="d-flex flex-column">
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
                    <div>
                      <h5 className="mb-1">{scenario.name}</h5>
                      <div className="text-muted small">{scenario.process_name || 'No linked process'}</div>
                    </div>
                    <Badge bg={statusVariant(scenario.status)}>{statusLabel(scenario.status)}</Badge>
                  </div>

                  <div className="text-muted small mb-3">{scenario.description || 'No description provided.'}</div>

                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <Badge bg="light" text="dark">
                      {scenario.process_instances || 0} instances
                    </Badge>
                    <Badge bg="light" text="dark">
                      {scenario.monte_carlo_runs || 1} Monte Carlo run(s)
                    </Badge>
                    <Badge bg="light" text="dark">
                      {scenario.import_csv_arrivals ? 'CSV arrivals' : 'Generated arrivals'}
                    </Badge>
                  </div>

                  {scenario.results ? (
                    <div className="border rounded-3 p-3 bg-light mb-3">
                      <div className="d-flex justify-content-between">
                        <span className="text-muted small">Avg cycle</span>
                        <strong>{fmt(scenario.results.avg_duration_min)} min</strong>
                      </div>
                      <div className="d-flex justify-content-between">
                        <span className="text-muted small">Total cost</span>
                        <strong>{fmt(scenario.results.total_cost, 2)} EUR</strong>
                      </div>
                      <div className="d-flex justify-content-between">
                        <span className="text-muted small">Late rate</span>
                        <strong>{fmt(scenario.results.sla_summary?.late_instance_rate, 1)}%</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted small mb-3">
                      Run this scenario to generate KPIs, heatmaps, and advanced analysis.
                    </div>
                  )}

                  <div className="mt-auto d-flex justify-content-between align-items-center">
                    <Button variant="danger" size="sm" onClick={() => openScenario(scenario.id)}>
                      Open workbench
                    </Button>
                    <Button variant="outline-danger" size="sm" onClick={() => deleteScenario(scenario.id)}>
                      Delete
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {showCreate && (
        <Suspense fallback={<PanelFallback label="Loading scenario creator..." />}>
          <ScenarioCreateModal
            show={showCreate}
            onHide={() => setShowCreate(false)}
            processes={processes}
            onCreated={async (created) => {
              setShowCreate(false);
              await refreshScenarioList();
              await openScenario(created.id);
            }}
          />
        </Suspense>
      )}
    </Container>
  );
}
