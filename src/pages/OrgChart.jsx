import { useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Form,
  InputGroup,
  Modal,
  Row,
  Spinner,
} from 'react-bootstrap';
import { ROLES, useAuth } from '../contexts/AuthContext';
import EntityCollaborationPanel from '../components/EntityCollaborationPanel';
import './OrgChart.css';

const API = 'http://localhost:3001/api';
const CARD_WIDTH = 280;
const CARD_HEIGHT = 164;
const H_GAP = 40;
const V_GAP = 108;
const CANVAS_PADDING = 40;

const TYPE_META = {
  company: { label: 'Organisation', icon: 'bi-building', color: '#dc2626' },
  division: { label: 'Division', icon: 'bi-diagram-2', color: '#2563eb' },
  department: { label: 'Department', icon: 'bi-kanban', color: '#7c3aed' },
  team: { label: 'Team', icon: 'bi-people', color: '#0891b2' },
  position: { label: 'Position', icon: 'bi-person-badge', color: '#475569' },
};

const EMPTY_FORM = {
  name: '',
  title: '',
  nodeType: 'department',
  companyId: '',
  parentId: '',
  userId: '',
  description: '',
  color: '#2563eb',
  isVacant: false,
};

function nodeMeta(nodeType) {
  return TYPE_META[nodeType] || TYPE_META.position;
}

function toForm(node = null, overrides = {}) {
  return {
    name: node?.name || '',
    title: node?.title || '',
    nodeType: node?.nodeType || 'department',
    companyId: node?.companyId ? String(node.companyId) : '',
    parentId: node?.parentId ? String(node.parentId) : '',
    userId: node?.userId ? String(node.userId) : '',
    description: node?.description || '',
    color: node?.color || nodeMeta(node?.nodeType).color || '#2563eb',
    isVacant: Boolean(node?.isVacant),
    ...overrides,
  };
}

function initials(value = '') {
  return (
    value
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'OG'
  );
}

function formatDate(value) {
  if (!value) return 'Not available';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function matchesSearch(node, term) {
  if (!term) return true;
  const haystack = [
    node.name,
    node.title,
    node.userName,
    node.userRole,
    node.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(term);
}

function buildVisibleIds(nodes, search) {
  if (!search) {
    return new Set(nodes.map((node) => node.id));
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visible = new Set();
  nodes.forEach((node) => {
    if (!matchesSearch(node, search)) return;
    let current = node;
    while (current) {
      visible.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : null;
    }
  });
  return visible;
}

function buildLayout(nodes) {
  const byId = new Map();
  const roots = [];

  nodes.forEach((node) => byId.set(node.id, { ...node, children: [] }));
  byId.forEach((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortTree = (items) => {
    items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
    items.forEach((item) => sortTree(item.children));
  };
  sortTree(roots);

  const measure = (node) => {
    if (!node.children.length) {
      node.branchWidth = CARD_WIDTH;
      return node.branchWidth;
    }
    let width = 0;
    node.children.forEach((child, index) => {
      width += measure(child) + (index > 0 ? H_GAP : 0);
    });
    node.branchWidth = Math.max(width, CARD_WIDTH);
    return node.branchWidth;
  };

  const place = (node, left, top) => {
    node.left = left + (node.branchWidth - CARD_WIDTH) / 2;
    node.top = top;
    let cursor = left;
    node.children.forEach((child) => {
      place(child, cursor, top + CARD_HEIGHT + V_GAP);
      cursor += child.branchWidth + H_GAP;
    });
  };

  roots.forEach((root) => measure(root));
  let rootCursor = 0;
  roots.forEach((root, index) => {
    place(root, rootCursor, 0);
    rootCursor += root.branchWidth + (index < roots.length - 1 ? H_GAP * 2 : 0);
  });

  const laidOut = [];
  const edges = [];
  const collect = (node) => {
    laidOut.push(node);
    node.children.forEach((child) => {
      edges.push([node, child]);
      collect(child);
    });
  };
  roots.forEach(collect);

  return {
    nodes: laidOut,
    edges,
    width: Math.max(rootCursor + CANVAS_PADDING * 2, 720),
    height: Math.max(
      laidOut.reduce((max, node) => Math.max(max, node.top + CARD_HEIGHT), 0) + CANVAS_PADDING * 2,
      420
    ),
  };
}

function wouldCycle(nodes, nodeId, parentId) {
  if (parentId === null || parentId === undefined) return false;
  if (nodeId === parentId) return true;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(parentId);
  while (current) {
    if (current.id === nodeId) return true;
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return false;
}

function childCount(nodes, nodeId) {
  return nodes.filter((node) => node.parentId === nodeId).length;
}

function descendantCount(nodes, nodeId) {
  const children = nodes.filter((node) => node.parentId === nodeId);
  return children.reduce((total, child) => total + 1 + descendantCount(nodes, child.id), 0);
}

async function parseApiPayload(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 404 && response.url.includes('/api/orgchart/')) {
      throw new Error('Org chart API not found on port 3001. Restart the backend so it loads the new organigram routes.');
    }

    if (isJson && payload?.error) {
      throw new Error(payload.error);
    }

    throw new Error(fallbackMessage);
  }

  return payload;
}

function OrgNodeFields({ form, setForm, users, parentOptions }) {
  const availableUsers = users.filter((user) => !form.companyId || String(user.companyId) === form.companyId);

  return (
    <div className="org-form-grid">
      <Form.Group>
        <Form.Label>Name *</Form.Label>
        <Form.Control value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
      </Form.Group>
      <Form.Group>
        <Form.Label>Title / Subtitle</Form.Label>
        <Form.Control value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
      </Form.Group>
      <Form.Group>
        <Form.Label>Node Type</Form.Label>
        <Form.Select
          value={form.nodeType}
          onChange={(event) =>
            setForm((current) => ({ ...current, nodeType: event.target.value, color: current.color || nodeMeta(event.target.value).color }))
          }
        >
          {Object.entries(TYPE_META).map(([value, meta]) => (
            <option key={value} value={value}>{meta.label}</option>
          ))}
        </Form.Select>
      </Form.Group>
      <Form.Group>
        <Form.Label>Parent</Form.Label>
        <Form.Select value={form.parentId} onChange={(event) => setForm((current) => ({ ...current, parentId: event.target.value }))}>
          <option value="">Top level</option>
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </Form.Select>
      </Form.Group>
      <Form.Group>
        <Form.Label>Assigned Person</Form.Label>
        <Form.Select
          value={form.userId}
          disabled={form.isVacant}
          onChange={(event) => {
            const selectedUser = users.find((user) => String(user.id) === event.target.value);
            setForm((current) => ({
              ...current,
              userId: event.target.value,
              isVacant: false,
              name: current.name || selectedUser?.fullName || current.name,
              title: current.title || selectedUser?.role || current.title,
              companyId: current.companyId || (selectedUser?.companyId ? String(selectedUser.companyId) : ''),
            }));
          }}
        >
          <option value="">Unassigned</option>
          {availableUsers.map((user) => (
            <option key={user.id} value={user.id}>{user.fullName} · {user.role}</option>
          ))}
        </Form.Select>
      </Form.Group>
      <Form.Group>
        <Form.Label>Card Color</Form.Label>
        <div className="org-color-field">
          <Form.Control type="color" value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} />
          <Form.Control value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} />
        </div>
      </Form.Group>
      <Form.Group className="org-form-grid__full">
        <Form.Check
          type="switch"
          id="org-node-vacant"
          label="Mark as vacant role"
          checked={form.isVacant}
          onChange={(event) => setForm((current) => ({ ...current, isVacant: event.target.checked, userId: event.target.checked ? '' : current.userId }))}
        />
      </Form.Group>
      <Form.Group className="org-form-grid__full">
        <Form.Label>Description</Form.Label>
        <Form.Control
          as="textarea"
          rows={4}
          value={form.description}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
        />
      </Form.Group>
    </div>
  );
}

export function OrgChart() {
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole([ROLES.ADMIN]);

  const [nodes, setNodes] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState({ text: '', variant: 'success' });
  const [selectedId, setSelectedId] = useState(null);
  const [inspectorForm, setInspectorForm] = useState(EMPTY_FORM);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [searchTerm, setSearchTerm] = useState('');
  const [zoom, setZoom] = useState(1);
  const [draggedId, setDraggedId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  const [boardFullscreen, setBoardFullscreen] = useState(false);
  const boardRef = useRef(null);
  const canvasRef = useRef(null);

  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());

  const loadOrgChart = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [nodesResponse, metaResponse] = await Promise.all([
        fetch(`${API}/orgchart/nodes`),
        fetch(`${API}/orgchart/meta`),
      ]);
      const nextNodes = await parseApiPayload(nodesResponse, 'Failed to load organigram nodes.');
      const meta = await parseApiPayload(metaResponse, 'Failed to load organigram metadata.');
      setNodes(nextNodes);
      setUsers(meta.users || []);
      setSelectedId((current) => (current && nextNodes.some((node) => node.id === current) ? current : nextNodes[0]?.id || null));
    } catch (requestError) {
      console.error(requestError);
      setError(requestError.message || 'The organigram could not be loaded.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadOrgChart();
  }, []);

  useEffect(() => {
    const selected = nodes.find((node) => node.id === selectedId);
    setInspectorForm(selected ? toForm(selected) : EMPTY_FORM);
  }, [nodes, selectedId]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setBoardFullscreen(document.fullscreenElement === boardRef.current);
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  const selectedNode = nodes.find((node) => node.id === selectedId) || null;
  const visibleIds = buildVisibleIds(nodes, deferredSearch);
  const visibleNodes = nodes.filter((node) => visibleIds.has(node.id));
  const layout = buildLayout(visibleNodes);

  const parentOptions = selectedNode
    ? nodes.filter((node) => node.id !== selectedNode.id && !wouldCycle(nodes, selectedNode.id, node.id))
    : nodes;

  const metrics = {
    total: nodes.length,
    filled: nodes.filter((node) => node.userId).length,
    open: nodes.filter((node) => node.nodeType === 'position' && (node.isVacant || !node.userId)).length,
  };

  const fitBoardToViewport = () => {
    if (!canvasRef.current || !layout.width || !layout.height) {
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const horizontalPadding = 56;
    const verticalPadding = 56;
    const availableWidth = Math.max(rect.width - horizontalPadding, 240);
    const availableHeight = Math.max(rect.height - verticalPadding, 240);
    const widthScale = availableWidth / layout.width;
    const heightScale = availableHeight / layout.height;
    const nextZoom = Math.max(0.35, Math.min(1.6, +Math.min(widthScale, heightScale).toFixed(2)));

    setZoom(nextZoom);
    canvasRef.current.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  };

  useEffect(() => {
    if (!boardFullscreen || loading || visibleNodes.length === 0) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      fitBoardToViewport();
    });

    const handleResize = () => fitBoardToViewport();
    window.addEventListener('resize', handleResize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [boardFullscreen, loading, visibleNodes.length, layout.width, layout.height]);

  const showMessage = (text, variant = 'success') => setFeedback({ text, variant });

  const openCreateModal = (parentNode = null) => {
    const suggestedType = parentNode
      ? parentNode.nodeType === 'company'
        ? 'division'
        : parentNode.nodeType === 'division'
          ? 'department'
          : parentNode.nodeType === 'department'
            ? 'team'
            : 'position'
      : 'company';

    setCreateForm(
      toForm(null, {
        parentId: parentNode?.id ? String(parentNode.id) : '',
        companyId: parentNode?.companyId ? String(parentNode.companyId) : '',
        nodeType: suggestedType,
        color: nodeMeta(suggestedType).color,
      })
    );
    setShowCreateModal(true);
  };

  const persistNode = async (url, method, payload) => {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseApiPayload(response, 'Request failed.');
  };

  const saveSelectedNode = async (event) => {
    event.preventDefault();
    if (!selectedNode) return;
    setSaving(true);
    try {
      const data = await persistNode(`${API}/orgchart/nodes/${selectedNode.id}`, 'PUT', {
        ...inspectorForm,
        companyId: inspectorForm.companyId || null,
        parentId: inspectorForm.parentId || null,
        userId: inspectorForm.userId || null,
      });
      showMessage('Organigram node updated successfully.');
      await loadOrgChart(true);
      setSelectedId(data.id);
    } catch (requestError) {
      console.error(requestError);
      showMessage(requestError.message || 'Failed to update node.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const createNode = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await persistNode(`${API}/orgchart/nodes`, 'POST', {
        ...createForm,
        companyId: createForm.companyId || null,
        parentId: createForm.parentId || null,
        userId: createForm.userId || null,
      });
      showMessage('New organigram node created.');
      setShowCreateModal(false);
      await loadOrgChart(true);
      setSelectedId(data.id);
    } catch (requestError) {
      console.error(requestError);
      showMessage(requestError.message || 'Failed to create node.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedNode = async () => {
    if (!selectedNode) return;
    if (!window.confirm(`Delete "${selectedNode.name}"? Children will move to the deleted node's parent.`)) return;
    setSaving(true);
    try {
      await persistNode(`${API}/orgchart/nodes/${selectedNode.id}`, 'DELETE', {});
      showMessage('Organigram node deleted.');
      setSelectedId(selectedNode.parentId || null);
      await loadOrgChart(true);
    } catch (requestError) {
      console.error(requestError);
      showMessage(requestError.message || 'Failed to delete node.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const moveNode = async (nodeId, parentId) => {
    if (nodeId === null || wouldCycle(nodes, nodeId, parentId)) return;
    setSaving(true);
    try {
      await persistNode(`${API}/orgchart/nodes/${nodeId}/move`, 'PATCH', { parentId });
      showMessage('Organigram updated.');
      await loadOrgChart(true);
      setSelectedId(nodeId);
    } catch (requestError) {
      console.error(requestError);
      showMessage(requestError.message || 'Failed to move node.', 'danger');
    } finally {
      setSaving(false);
      setDraggedId(null);
      setDropTargetId(null);
      setRootDropActive(false);
    }
  };

  const toggleBoardFullscreen = async () => {
    if (!boardRef.current) {
      return;
    }

    try {
      if (document.fullscreenElement === boardRef.current) {
        await document.exitFullscreen();
      } else {
        await boardRef.current.requestFullscreen();
      }
    } catch (requestError) {
      console.error(requestError);
      showMessage('Fullscreen mode is not available in this browser context.', 'danger');
    }
  };

  return (
    <Container fluid className="org-page">
      <section className="org-hero">
        <div className="org-hero__copy">
          <span className="org-hero__eyebrow">Organisation Builder</span>
          <h1>Interactive Org Chart</h1>
          <p>Build real organigrams with departments, teams, positions, and assigned people. Drag cards to re-parent them or edit the selected node in the inspector.</p>
        </div>
        <div className="org-hero__actions">
          <Button variant="outline-secondary" className="org-hero__refresh" onClick={() => loadOrgChart()}>
            <i className="bi bi-arrow-clockwise me-2"></i>Refresh
          </Button>
          {canEdit && (
            <Button className="org-hero__primary" onClick={() => openCreateModal()}>
              <i className="bi bi-plus-circle me-2"></i>Add Root Node
            </Button>
          )}
        </div>
      </section>

      {feedback.text && <Alert variant={feedback.variant} dismissible onClose={() => setFeedback({ text: '', variant: 'success' })} className="org-feedback">{feedback.text}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}
      {!canEdit && <Alert variant="info" className="org-readonly-banner">You are viewing the organigram in read-only mode.</Alert>}

      <Row className="g-3 org-metrics">
        <Col lg={4} md={6}><Card className="org-metric-card"><Card.Body><span>Nodes</span><strong>{metrics.total}</strong><p>Structure blocks across the organigram.</p></Card.Body></Card></Col>
        <Col lg={4} md={6}><Card className="org-metric-card"><Card.Body><span>Filled positions</span><strong>{metrics.filled}</strong><p>Roles already assigned to a person.</p></Card.Body></Card></Col>
        <Col lg={4} md={6}><Card className="org-metric-card"><Card.Body><span>Open positions</span><strong>{metrics.open}</strong><p>Vacant or unassigned positions.</p></Card.Body></Card></Col>
      </Row>

      <div className="org-workspace">
        <Card className={`org-board${boardFullscreen ? ' is-fullscreen' : ''}`} ref={boardRef}>
          <Card.Body>
            <div className="org-board__toolbar">
              <div className="org-board__filters">
                <InputGroup>
                  <InputGroup.Text><i className="bi bi-search"></i></InputGroup.Text>
                  <Form.Control value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search nodes, roles, or people" />
                </InputGroup>
              </div>

              <div className="org-board__tools">
                <Button variant="outline-secondary" className="org-fullscreen-btn" onClick={toggleBoardFullscreen}>
                  <i className={`bi ${boardFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'} me-2`}></i>
                  {boardFullscreen ? 'Exit full screen' : 'Full screen'}
                </Button>
                <div className="org-zoom">
                  <button onClick={() => setZoom((current) => Math.max(0.6, +(current - 0.1).toFixed(1)))}>-</button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button onClick={() => setZoom((current) => Math.min(1.6, +(current + 0.1).toFixed(1)))}>+</button>
                </div>
                <Badge bg="light" text="dark" className="org-badge">{visibleNodes.length} visible</Badge>
              </div>
            </div>

            {canEdit && (
              <div
                className={`org-root-dropzone${rootDropActive ? ' is-active' : ''}`}
                onDragOver={(event) => {
                  if (draggedId === null) return;
                  event.preventDefault();
                  setRootDropActive(true);
                }}
                onDragLeave={() => setRootDropActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedId !== null) moveNode(draggedId, null);
                }}
              >
                <i className="bi bi-arrows-move"></i>Drop a node here to make it top-level
              </div>
            )}

            {loading ? (
              <div className="org-state"><Spinner animation="border" variant="danger" /><p>Loading the organigram editor...</p></div>
            ) : visibleNodes.length === 0 ? (
              <div className="org-state">
                <div className="org-state__icon"><i className="bi bi-diagram-3"></i></div>
                <h3>No nodes to display</h3>
                <p>{searchTerm ? 'Adjust the search to bring matching nodes back into view.' : 'Create the first root node to start building the organisation.'}</p>
                {canEdit && <Button variant="danger" onClick={() => openCreateModal()}>Create first node</Button>}
              </div>
            ) : (
              <div className="org-canvas" ref={canvasRef}>
                <div className="org-canvas__zoom" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
                  <div className="org-canvas__inner" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
                    <svg className="org-canvas__links" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
                      {layout.edges.map(([from, to]) => {
                        const fromX = from.left + CARD_WIDTH / 2 + CANVAS_PADDING;
                        const fromY = from.top + CARD_HEIGHT + CANVAS_PADDING;
                        const toX = to.left + CARD_WIDTH / 2 + CANVAS_PADDING;
                        const toY = to.top + CANVAS_PADDING;
                        const midY = (fromY + toY) / 2;
                        return <path key={`${from.id}-${to.id}`} d={`M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`} fill="none" stroke="rgba(100, 116, 139, 0.45)" strokeWidth="2" />;
                      })}
                    </svg>

                    {layout.nodes.map((node) => {
                      const meta = nodeMeta(node.nodeType);
                      const dropAllowed = draggedId !== null && draggedId !== node.id && !wouldCycle(nodes, draggedId, node.id);
                      return (
                        <div
                          key={node.id}
                          className={['org-card-node', selectedId === node.id ? 'is-selected' : '', dropTargetId === node.id ? 'is-drop-target' : '', deferredSearch && matchesSearch(node, deferredSearch) ? 'is-match' : ''].filter(Boolean).join(' ')}
                          style={{ left: node.left + CANVAS_PADDING, top: node.top + CANVAS_PADDING, '--node-accent': node.color || meta.color }}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedId(node.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedId(node.id);
                            }
                          }}
                          draggable={canEdit}
                          onDragStart={() => setDraggedId(node.id)}
                          onDragEnd={() => {
                            setDraggedId(null);
                            setDropTargetId(null);
                            setRootDropActive(false);
                          }}
                          onDragOver={(event) => {
                            if (!canEdit || !dropAllowed) return;
                            event.preventDefault();
                            setDropTargetId(node.id);
                          }}
                          onDragLeave={() => {
                            if (dropTargetId === node.id) setDropTargetId(null);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (dropAllowed && draggedId !== null) moveNode(draggedId, node.id);
                          }}
                        >
                          <div className="org-card-node__topline"></div>
                          <div className="org-card-node__header">
                            <span className="org-card-node__type"><i className={`bi ${meta.icon}`}></i>{meta.label}</span>
                            <span className="org-card-node__children">{childCount(nodes, node.id)} direct</span>
                          </div>
                          <div className="org-card-node__body">
                            <h3>{node.name}</h3>
                            <p>{node.title || 'No title defined yet'}</p>
                          </div>
                          <div className="org-card-node__person">
                            <div className="org-card-node__avatar">{node.isVacant ? 'V' : initials(node.userName || node.name)}</div>
                            <div>
                              <strong>{node.isVacant ? 'Vacant role' : node.userName || 'Unassigned'}</strong>
                              <small>{node.isVacant ? 'Ready to fill' : node.userRole || 'No person assigned'}</small>
                            </div>
                          </div>
                          <div className="org-card-node__footer"><span>{meta.label}</span><span>{descendantCount(nodes, node.id)} nested</span></div>
                          {canEdit && (
                            <div className="org-card-node__actions">
                              <span className="org-card-node__drag"><i className="bi bi-grip-vertical"></i>Drag</span>
                              <button type="button" className="org-card-node__add" onClick={(event) => { event.stopPropagation(); openCreateModal(node); }}><i className="bi bi-plus-lg"></i></button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </Card.Body>
        </Card>

        <Card className="org-inspector">
          <Card.Body>
            <div className="org-inspector__header">
              <div>
                <span className="org-inspector__eyebrow">Inspector</span>
                <h2>{selectedNode ? selectedNode.name : 'Select a node'}</h2>
              </div>
              {selectedNode && <Badge bg="light" text="dark">{nodeMeta(selectedNode.nodeType).label}</Badge>}
            </div>

            {selectedNode ? (
              <>
                <div className="org-inspector__meta">
                  <div><span>Created</span><strong>{formatDate(selectedNode.createdAt)}</strong></div>
                  <div><span>Updated</span><strong>{formatDate(selectedNode.updatedAt)}</strong></div>
                  <div><span>Direct reports</span><strong>{childCount(nodes, selectedNode.id)}</strong></div>
                  <div><span>All descendants</span><strong>{descendantCount(nodes, selectedNode.id)}</strong></div>
                </div>

                {canEdit ? (
                  <Form onSubmit={saveSelectedNode}>
                    <OrgNodeFields form={inspectorForm} setForm={setInspectorForm} users={users} parentOptions={parentOptions} />
                    <div className="org-inspector__actions">
                      <Button variant="outline-secondary" onClick={() => openCreateModal(selectedNode)}><i className="bi bi-plus-circle me-2"></i>Add Child</Button>
                      <Button type="submit" variant="danger" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
                    </div>
                    <Button variant="outline-danger" className="org-inspector__delete" onClick={deleteSelectedNode} disabled={saving}>
                      <i className="bi bi-trash me-2"></i>Delete Node
                    </Button>
                  </Form>
                ) : (
                  <div className="org-inspector__readonly">
                    <p>{selectedNode.description || 'No description for this node yet.'}</p>
                    <ul>
                      <li>Assigned: {selectedNode.userName || 'Unassigned'}</li>
                      <li>Title: {selectedNode.title || 'Not specified'}</li>
                    </ul>
                  </div>
                )}

                <div className="mt-4">
                  <EntityCollaborationPanel
                    entityType="orgchart_node"
                    entityId={selectedNode.id}
                    title="Commentaires et fichiers du noeud"
                  />
                </div>
              </>
            ) : (
              <div className="org-inspector__empty">
                <div className="org-state__icon"><i className="bi bi-cursor"></i></div>
                <h3>No node selected</h3>
                <p>Click any card in the chart to inspect or edit it.</p>
                {canEdit && <Button variant="danger" onClick={() => openCreateModal()}>Add Root Node</Button>}
              </div>
            )}
          </Card.Body>
        </Card>
      </div>

      <Modal show={showCreateModal} onHide={() => setShowCreateModal(false)} size="lg" centered>
        <Modal.Header closeButton className="org-modal__header">
          <Modal.Title>Create Organigram Node</Modal.Title>
        </Modal.Header>
        <Modal.Body className="org-modal__body">
          <Form onSubmit={createNode}>
            <OrgNodeFields form={createForm} setForm={setCreateForm} users={users} parentOptions={nodes} />
            <div className="org-modal__actions">
              <Button variant="outline-secondary" onClick={() => setShowCreateModal(false)}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={saving}>{saving ? 'Creating...' : 'Create Node'}</Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
}

export default OrgChart;
