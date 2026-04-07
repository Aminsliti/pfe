import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Table } from 'react-bootstrap';
import { API, readApiPayload } from './utils';

export default function TasksTab({ scenario, graph, resources, onScenarioReload }) {
  const [taskRows, setTaskRows] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const mergedTasks = useMemo(() => {
    const byId = new Map((scenario.task_data || []).map((task) => [task.task_id, task]));

    return graph.tasks.map((task) => ({
      task_id: task.task_id,
      task_name: task.task_name,
      ...(byId.get(task.task_id) || {
        duration_min: 30,
        duration_type: 'fixed',
        duration_std: 0,
        resource_id: '',
        cost: 0,
        sla_target_min: '',
      }),
    }));
  }, [graph.tasks, scenario.task_data]);

  useEffect(() => {
    setTaskRows(mergedTasks);
  }, [mergedTasks]);

  const saveTask = async (task) => {
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/tasks/${task.task_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...task,
          resource_id: task.resource_id || null,
          sla_target_min: task.sla_target_min || null,
        }),
      });
      await readApiPayload(response, 'Failed to save task.');
      setMessage(`Task "${task.task_name}" saved.`);
      onScenarioReload?.();
    } catch (saveError) {
      setError(saveError.message || 'Failed to save task.');
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {error && <Alert variant="danger">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body className="p-0">
          <Table hover className="sim-table mb-0">
            <thead>
              <tr>
                <th>Task</th>
                <th>Duration (min)</th>
                <th>Distribution</th>
                <th>Std dev</th>
                <th>Resource</th>
                <th>Cost</th>
                <th>SLA target</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {taskRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-muted py-4">
                    No BPMN tasks found in the linked process.
                  </td>
                </tr>
              ) : (
                taskRows.map((task, index) => (
                  <tr key={task.task_id}>
                    <td>
                      <strong>{task.task_name}</strong>
                      <div className="text-muted small">{task.task_id}</div>
                    </td>
                    <td>
                      <Form.Control
                        size="sm"
                        type="number"
                        min={0}
                        value={task.duration_min || 0}
                        onChange={(event) =>
                          setTaskRows((current) =>
                            current.map((entry, rowIndex) =>
                              rowIndex === index ? { ...entry, duration_min: Number(event.target.value) } : entry,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <Form.Select
                        size="sm"
                        value={task.duration_type || 'fixed'}
                        onChange={(event) =>
                          setTaskRows((current) =>
                            current.map((entry, rowIndex) =>
                              rowIndex === index ? { ...entry, duration_type: event.target.value } : entry,
                            ),
                          )
                        }
                      >
                        <option value="fixed">Fixed</option>
                        <option value="normal">Normal</option>
                        <option value="uniform">Uniform</option>
                        <option value="exponential">Exponential</option>
                      </Form.Select>
                    </td>
                    <td>
                      <Form.Control
                        size="sm"
                        type="number"
                        min={0}
                        value={task.duration_std || 0}
                        onChange={(event) =>
                          setTaskRows((current) =>
                            current.map((entry, rowIndex) =>
                              rowIndex === index ? { ...entry, duration_std: Number(event.target.value) } : entry,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <Form.Select
                        size="sm"
                        value={task.resource_id || ''}
                        onChange={(event) =>
                          setTaskRows((current) =>
                            current.map((entry, rowIndex) =>
                              rowIndex === index
                                ? { ...entry, resource_id: event.target.value ? Number(event.target.value) : '' }
                                : entry,
                            ),
                          )
                        }
                      >
                        <option value="">None</option>
                        {resources.map((resource) => (
                          <option key={resource.id} value={resource.id}>
                            {resource.name}
                          </option>
                        ))}
                      </Form.Select>
                    </td>
                    <td>
                      <Form.Control
                        size="sm"
                        type="number"
                        min={0}
                        value={task.cost || 0}
                        onChange={(event) =>
                          setTaskRows((current) =>
                            current.map((entry, rowIndex) =>
                              rowIndex === index ? { ...entry, cost: Number(event.target.value) } : entry,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <Form.Control
                        size="sm"
                        type="number"
                        min={0}
                        value={task.sla_target_min || ''}
                        onChange={(event) =>
                          setTaskRows((current) =>
                            current.map((entry, rowIndex) =>
                              rowIndex === index ? { ...entry, sla_target_min: event.target.value } : entry,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <Button size="sm" variant="outline-danger" onClick={() => saveTask(task)}>
                        Save
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
}
