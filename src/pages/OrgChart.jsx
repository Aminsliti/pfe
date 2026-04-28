import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Form,
  InputGroup,
  Modal,
  Spinner,
} from 'react-bootstrap';
import { ROLES, useAuth } from '../contexts/AuthContext';
import { useSnackbar } from '../components/SnackbarProvider';
import EntityCollaborationPanel from '../components/EntityCollaborationPanel';
import './OrgChart.css';

import { API_BASE } from '../utils/api';

const API = API_BASE;
const CARD_WIDTH = 340;
const CARD_HEIGHT = 154;
const H_GAP = 56;
const V_GAP = 96;
const CANVAS_PADDING = 72;
const MIN_ZOOM = 0.22;
const MAX_ZOOM = 2.4;
const PAN_MARGIN = 56;

const TYPE_META = {
  org_unit: { label: 'Org-Unit', icon: 'bi-diagram-3', color: '#14b8a6' },
  company: { label: 'Company', icon: 'bi-house-door-fill', color: '#0f766e' },
  institute: { label: 'Institute', icon: 'bi-bank', color: '#059669' },
  structure: { label: 'Structure', icon: 'bi-diagram-2-fill', color: '#10b981' },
  manager: { label: 'Manager', icon: 'bi-person-workspace', color: '#0284c7' },
  function: { label: 'Function', icon: 'bi-people-fill', color: '#d97706' },
};

const EMPTY_FORM = {
  name: '',
  title: '',
  nodeType: 'structure',
  parentId: '',
  userId: '',
  description: '',
  color: TYPE_META.structure.color,
  isVacant: false,
};

function nodeMeta(nodeType) {
  return TYPE_META[nodeType] || TYPE_META.function;
}

function toForm(node = null, overrides = {}) {
  return {
    name: node?.name || '',
    title: node?.title || '',
    nodeType: node?.nodeType || 'structure',
    parentId: node?.parentId ? String(node.parentId) : '',
    userId: node?.userId ? String(node.userId) : '',
    description: node?.description || '',
    color: nodeMeta(node?.nodeType).color || TYPE_META.structure.color,
    isVacant: Boolean(node?.isVacant),
    ...overrides,
  };
}

function formatDate(value) {
  if (!value) return 'Not available';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function personInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return 'NA';
  }

  return parts.map((part) => part[0]?.toUpperCase() || '').join('');
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

function sortNodes(items = []) {
  return [...items].sort(
    (left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || String(left.name).localeCompare(String(right.name))
  );
}

function buildNodeIndexes(nodes) {
  const byId = new Map();
  const childrenByParent = new Map();

  nodes.forEach((node) => {
    const normalized = {
      ...node,
      id: Number(node.id),
      parentId: node.parentId === null || node.parentId === undefined ? null : Number(node.parentId),
    };

    byId.set(normalized.id, normalized);
    const key = normalized.parentId ?? 0;
    const bucket = childrenByParent.get(key) || [];
    bucket.push(normalized);
    childrenByParent.set(key, bucket);
  });

  childrenByParent.forEach((children, key) => {
    childrenByParent.set(key, sortNodes(children));
  });

  return { byId, childrenByParent };
}

function collectSubtreeNodes(rootId, byId, childrenByParent) {
  if (!rootId || !byId.has(rootId)) {
    const rootLevelNodes = sortNodes(childrenByParent.get(0) || []);
    const summaryNodes = [];

    rootLevelNodes.forEach((rootNode) => {
      summaryNodes.push(rootNode);
      (childrenByParent.get(rootNode.id) || []).forEach((childNode) => {
        summaryNodes.push(childNode);
      });
    });

    return summaryNodes;
  }

  const scopedNodes = [];
  const visit = (nodeId) => {
    const node = byId.get(nodeId);
    if (!node) {
      return;
    }

    scopedNodes.push(node);
    (childrenByParent.get(nodeId) || []).forEach((child) => visit(child.id));
  };

  (childrenByParent.get(rootId) || []).forEach((child) => visit(child.id));
  return scopedNodes;
}

function buildNodeTrail(nodeId, byId) {
  if (!nodeId || !byId.has(nodeId)) {
    return [];
  }

  const trail = [];
  let current = byId.get(nodeId) || null;
  while (current) {
    trail.push(current);
    current = current.parentId ? byId.get(current.parentId) || null : null;
  }

  return trail.reverse();
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
        <Form.Label>Acteur Type</Form.Label>
        <Form.Select
          value={form.nodeType}
          onChange={(event) =>
            setForm((current) => ({ ...current, nodeType: event.target.value, color: nodeMeta(event.target.value).color }))
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
        <Form.Label>Actor</Form.Label>
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
            }));
          }}
        >
          <option value="">Unassigned actor</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>{user.fullName} - {user.role}</option>
          ))}
        </Form.Select>
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

export function OrgChart({ publicView = false }) {
  const { hasAnyRole } = useAuth();
  const { showSnackbar, confirmAction } = useSnackbar();
  const canEdit = !publicView && hasAnyRole([ROLES.ADMIN]);

  const [nodes, setNodes] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [focusedNodeId, setFocusedNodeId] = useState(null);
  const [inspectorForm, setInspectorForm] = useState(EMPTY_FORM);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [searchTerm, setSearchTerm] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [boardFullscreen, setBoardFullscreen] = useState(false);
  const boardRef = useRef(null);
  const canvasRef = useRef(null);
  const autoFitEnabledRef = useRef(true);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const panSessionRef = useRef(null);

  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  const loadOrgChart = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const requests = publicView
        ? [fetch(`${API}/orgchart/nodes`)]
        : [fetch(`${API}/orgchart/nodes`), fetch(`${API}/orgchart/meta`)];
      const [nodesResponse, metaResponse] = await Promise.all(requests);
      const nextNodes = await parseApiPayload(nodesResponse, 'Failed to load organigram nodes.');
      const meta = metaResponse
        ? await parseApiPayload(metaResponse, 'Failed to load organigram metadata.')
        : { users: [] };
      setNodes(nextNodes);
      setUsers(meta.users || []);
      setSelectedId((current) => {
        if (current && nextNodes.some((node) => node.id === current)) {
          return current;
        }

        return publicView ? null : nextNodes[0]?.id || null;
      });
    } catch (requestError) {
      console.error(requestError);
      setError(requestError.message || 'The organigram could not be loaded.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadOrgChart();
  }, [publicView]);

  useEffect(() => {
    const selected = nodes.find((node) => node.id === selectedId);
    setInspectorForm(selected ? toForm(selected) : EMPTY_FORM);
  }, [nodes, selectedId]);

  const nodeIndexes = useMemo(() => buildNodeIndexes(nodes), [nodes]);

  useEffect(() => {
    if (focusedNodeId && !nodeIndexes.byId.has(focusedNodeId)) {
      setFocusedNodeId(null);
    }
  }, [focusedNodeId, nodeIndexes]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setBoardFullscreen(document.fullscreenElement === boardRef.current);
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  const selectedNode = nodes.find((node) => node.id === selectedId) || null;
  const focusTrail = useMemo(() => buildNodeTrail(focusedNodeId, nodeIndexes.byId), [focusedNodeId, nodeIndexes]);
  const focusedRootNode = focusedNodeId ? nodeIndexes.byId.get(focusedNodeId) || null : null;
  const scopedNodes = useMemo(
    () => collectSubtreeNodes(focusedNodeId, nodeIndexes.byId, nodeIndexes.childrenByParent),
    [focusedNodeId, nodeIndexes]
  );
  const visibleIds = useMemo(() => buildVisibleIds(scopedNodes, deferredSearch), [scopedNodes, deferredSearch]);
  const visibleNodes = scopedNodes.filter((node) => visibleIds.has(node.id));
  const layout = buildLayout(visibleNodes);

  const constrainPan = useCallback((nextX, nextY, nextZoom = zoomRef.current) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: nextX, y: nextY };
    }

    const scaledWidth = layout.width * nextZoom;
    const scaledHeight = layout.height * nextZoom;
    const viewportWidth = canvas.clientWidth;
    const viewportHeight = canvas.clientHeight;

    const x = scaledWidth + PAN_MARGIN * 2 <= viewportWidth
      ? (viewportWidth - scaledWidth) / 2
      : clamp(nextX, viewportWidth - scaledWidth - PAN_MARGIN, PAN_MARGIN);

    const y = scaledHeight + PAN_MARGIN * 2 <= viewportHeight
      ? (viewportHeight - scaledHeight) / 2
      : clamp(nextY, viewportHeight - scaledHeight - PAN_MARGIN, PAN_MARGIN);

    return { x, y };
  }, [layout.height, layout.width]);

  const fitCanvasToViewport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const horizontalPadding = boardFullscreen ? 56 : 40;
    const verticalPadding = boardFullscreen ? 56 : 40;
    const widthScale = (canvas.clientWidth - horizontalPadding) / layout.width;
    const heightScale = (canvas.clientHeight - verticalPadding) / layout.height;
    const nextZoom = Math.min(widthScale, heightScale);

    if (!Number.isFinite(nextZoom) || nextZoom <= 0) {
      return;
    }

    const minReadableZoom = focusedNodeId ? 0.2 : 0.3;
    const fittedZoom = clamp(Number(nextZoom.toFixed(2)), minReadableZoom, MAX_ZOOM);
    const scaledWidth = layout.width * fittedZoom;
    const scaledHeight = layout.height * fittedZoom;
    const centeredPan = constrainPan(
      (canvas.clientWidth - scaledWidth) / 2,
      (canvas.clientHeight - scaledHeight) / 2,
      fittedZoom
    );

    setZoom(fittedZoom);
    setPan(centeredPan);
  }, [boardFullscreen, constrainPan, focusedNodeId, layout.height, layout.width]);

  useEffect(() => {
    if (loading || !visibleNodes.length || !canvasRef.current) {
      return undefined;
    }

    autoFitEnabledRef.current = true;

    const runFit = () => {
      if (autoFitEnabledRef.current) {
        fitCanvasToViewport();
      }
    };

    const rafId = window.requestAnimationFrame(runFit);
    const resizeObserver = new ResizeObserver(() => {
      if (autoFitEnabledRef.current) {
        window.requestAnimationFrame(runFit);
      }
    });

    resizeObserver.observe(canvasRef.current);

    return () => {
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [fitCanvasToViewport, focusedNodeId, loading, visibleNodes.length]);

  const parentOptions = selectedNode
    ? nodes.filter((node) => node.id !== selectedNode.id && !wouldCycle(nodes, selectedNode.id, node.id))
    : nodes;

  const showMessage = (text, variant = 'success') => showSnackbar(text, variant);

  const openNodeDetails = (nodeId) => {
    setSelectedId(nodeId);
    setShowDetailsModal(true);
  };

  const enterSubOrganization = useCallback((nodeId, { closeModal = false } = {}) => {
    const normalizedNodeId = Number(nodeId);
    if (!Number.isInteger(normalizedNodeId) || !nodeIndexes.byId.has(normalizedNodeId)) {
      return;
    }

    autoFitEnabledRef.current = true;
    setFocusedNodeId(normalizedNodeId);
    setSelectedId(normalizedNodeId);
    if (closeModal) {
      setShowDetailsModal(false);
    }
  }, [nodeIndexes]);

  const jumpToFocusedTrailIndex = useCallback((index) => {
    autoFitEnabledRef.current = true;
    if (index < 0) {
      setFocusedNodeId(null);
      return;
    }

    const nextNode = focusTrail[index];
    setFocusedNodeId(nextNode?.id || null);
  }, [focusTrail]);

  const openCreateModal = (parentNode = null) => {
    const suggestedType = parentNode
      ? parentNode.nodeType === 'company'
        ? 'institute'
        : parentNode.nodeType === 'institute'
          ? 'structure'
          : parentNode.nodeType === 'structure'
            ? 'manager'
            : parentNode.nodeType === 'manager'
              ? 'function'
              : parentNode.nodeType === 'org_unit'
                ? 'function'
                : 'function'
      : 'company';

    setCreateForm(
      toForm(null, {
        parentId: parentNode?.id ? String(parentNode.id) : '',
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
        parentId: inspectorForm.parentId || null,
        userId: inspectorForm.userId || null,
      });
      showMessage('Organigram acteur updated successfully.');
      await loadOrgChart(true);
      setSelectedId(data.id);
    } catch (requestError) {
      console.error(requestError);
      showMessage(requestError.message || 'Failed to update acteur.', 'danger');
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
        parentId: createForm.parentId || null,
        userId: createForm.userId || null,
      });
      showMessage('New organigram acteur created.');
      setShowCreateModal(false);
      await loadOrgChart(true);
      setSelectedId(data.id);
    } catch (requestError) {
      console.error(requestError);
      showMessage(requestError.message || 'Failed to create acteur.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedNode = async () => {
    if (!selectedNode) return;
    const confirmed = await confirmAction({
      title: 'Delete acteur',
      message: `Delete "${selectedNode.name}"? Children will move to the deleted acteur's parent.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await persistNode(`${API}/orgchart/nodes/${selectedNode.id}`, 'DELETE', {});
      showMessage('Organigram acteur deleted.');
      setShowDetailsModal(false);
      setSelectedId(selectedNode.parentId || null);
      await loadOrgChart(true);
    } catch (requestError) {
      console.error(requestError);
      showMessage(requestError.message || 'Failed to delete acteur.', 'danger');
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
      showMessage(requestError.message || 'Failed to move acteur.', 'danger');
    } finally {
      setSaving(false);
      setDraggedId(null);
      setDropTargetId(null);
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

  const handleManualZoom = (direction) => {
    autoFitEnabledRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const nextZoom = clamp(
      Number((direction === 'in' ? zoomRef.current + 0.12 : zoomRef.current - 0.12).toFixed(2)),
      MIN_ZOOM,
      MAX_ZOOM
    );
    const viewportCenterX = canvas.clientWidth / 2;
    const viewportCenterY = canvas.clientHeight / 2;
    const contentX = (viewportCenterX - panRef.current.x) / zoomRef.current;
    const contentY = (viewportCenterY - panRef.current.y) / zoomRef.current;
    const constrainedPan = constrainPan(
      viewportCenterX - contentX * nextZoom,
      viewportCenterY - contentY * nextZoom,
      nextZoom
    );

    setZoom(nextZoom);
    setPan(constrainedPan);
  };

  const handleFitZoom = () => {
    autoFitEnabledRef.current = true;
    fitCanvasToViewport();
  };

  const stopCanvasPan = useCallback((pointerId = null) => {
    if (pointerId !== null && canvasRef.current?.hasPointerCapture?.(pointerId)) {
      canvasRef.current.releasePointerCapture(pointerId);
    }

    panSessionRef.current = null;
    setIsPanning(false);
  }, []);

  const handleCanvasPointerDown = useCallback((event) => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }

    const interactiveTarget = event.target.closest('.org-card-node, button, input, select, textarea, a');
    if (interactiveTarget) {
      return;
    }

    event.preventDefault();
    autoFitEnabledRef.current = false;
    panSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panRef.current.x,
      originY: panRef.current.y,
    };
    canvasRef.current?.setPointerCapture?.(event.pointerId);
    setIsPanning(true);
  }, []);

  const handleCanvasPointerMove = useCallback((event) => {
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    setPan(
      constrainPan(
        session.originX + (event.clientX - session.startX),
        session.originY + (event.clientY - session.startY),
        zoomRef.current
      )
    );
  }, [constrainPan]);

  const handleCanvasPointerUp = useCallback((event) => {
    if (panSessionRef.current?.pointerId === event.pointerId) {
      stopCanvasPan(event.pointerId);
    }
  }, [stopCanvasPan]);

  const handleCanvasWheel = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    event.preventDefault();
    autoFitEnabledRef.current = false;

    if (event.shiftKey) {
      setPan(constrainPan(
        panRef.current.x - event.deltaY,
        panRef.current.y,
        zoomRef.current
      ));
      return;
    }

    if (Math.abs(event.deltaX) > 0.5) {
      setPan(constrainPan(
        panRef.current.x - event.deltaX,
        panRef.current.y - event.deltaY,
        zoomRef.current
      ));
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const zoomFactor = Math.exp(-event.deltaY * (event.ctrlKey || event.metaKey ? 0.0026 : 0.0019));
    const nextZoom = clamp(Number((zoomRef.current * zoomFactor).toFixed(3)), MIN_ZOOM, MAX_ZOOM);

    if (Math.abs(nextZoom - zoomRef.current) < 0.001) {
      return;
    }

    const contentX = (pointerX - panRef.current.x) / zoomRef.current;
    const contentY = (pointerY - panRef.current.y) / zoomRef.current;
    const constrainedPan = constrainPan(
      pointerX - contentX * nextZoom,
      pointerY - contentY * nextZoom,
      nextZoom
    );

    setZoom(nextZoom);
    setPan(constrainedPan);
  }, [constrainPan]);

  return (
    <Container fluid className="org-page">
      {error && <Alert variant="danger">{error}</Alert>}
      <div className="org-workspace">
        <Card className={`org-board${boardFullscreen ? ' is-fullscreen' : ''}`} ref={boardRef}>
          <Card.Body>
            <div className="org-board__toolbar">
              <div className="org-board__filters">
                <InputGroup>
                  <InputGroup.Text><i className="bi bi-search"></i></InputGroup.Text>
                  <Form.Control value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search acteurs, roles, or people" />
                </InputGroup>
              </div>

              <div className="org-board__tools">
                <Button variant="outline-secondary" className="org-fullscreen-btn" onClick={toggleBoardFullscreen}>
                  <i className={`bi ${boardFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'} me-2`}></i>
                  {boardFullscreen ? 'Exit full screen' : 'Full screen'}
                </Button>
                <div className="org-zoom">
                  <button onClick={() => handleManualZoom('out')}>-</button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button onClick={() => handleManualZoom('in')}>+</button>
                  <button type="button" className="org-zoom__fit" onClick={handleFitZoom}>Fit</button>
                </div>
                <Badge bg="light" text="dark" className="org-badge">{visibleNodes.length} visible</Badge>
              </div>
            </div>

            <div className="org-board__scope">
              <button
                type="button"
                className={`org-scope-chip ${focusTrail.length ? '' : 'is-active'}`}
                onClick={() => jumpToFocusedTrailIndex(-1)}
              >
                Organigramme complet
              </button>
              {focusTrail.map((node, index) => (
                <button
                  key={node.id}
                  type="button"
                  className={`org-scope-chip ${index === focusTrail.length - 1 ? 'is-active' : ''}`}
                  onClick={() => jumpToFocusedTrailIndex(index)}
                >
                  {node.name}
                </button>
              ))}
              {focusedRootNode ? (
                <Badge bg="light" text="dark" className="org-badge">
                  Sous-organisation: {focusedRootNode.name}
                </Badge>
              ) : null}
            </div>

            {loading ? (
              <div className="org-state"><Spinner animation="border" variant="danger" /><p>Loading the organigram editor...</p></div>
            ) : visibleNodes.length === 0 ? (
              <div className="org-state">
                <div className="org-state__icon"><i className="bi bi-diagram-3"></i></div>
                <h3>No acteurs to display</h3>
                <p>{searchTerm ? 'Adjust the search to bring matching acteurs back into view.' : 'Create the first acteur to start building the organisation.'}</p>
                {canEdit && <Button variant="danger" onClick={() => openCreateModal()}>Create first acteur</Button>}
              </div>
            ) : (
              <div
                className={`org-canvas${boardFullscreen ? ' is-fullscreen-fit' : ''}${isPanning ? ' is-panning' : ''}`}
                ref={canvasRef}
                onWheel={handleCanvasWheel}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
              >
                <div
                  className="org-canvas__stage"
                  style={{
                    width: layout.width,
                    height: layout.height,
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'top left',
                  }}
                >
                  <svg className="org-canvas__links" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
                    {layout.edges.map(([from, to]) => {
                      const fromX = from.left + CARD_WIDTH / 2 + CANVAS_PADDING;
                      const fromY = from.top + CARD_HEIGHT + CANVAS_PADDING;
                      const toX = to.left + CARD_WIDTH / 2 + CANVAS_PADDING;
                      const toY = to.top + CANVAS_PADDING;
                      const midY = fromY + Math.max(22, (toY - fromY) / 2);
                      return (
                        <path
                          key={`${from.id}-${to.id}`}
                          d={`M ${fromX} ${fromY} V ${midY} H ${toX} V ${toY}`}
                          fill="none"
                          stroke="rgba(148, 163, 184, 0.55)"
                          strokeWidth="2"
                        />
                      );
                    })}
                  </svg>

                  {layout.nodes.map((node) => {
                    const meta = nodeMeta(node.nodeType);
                    const directChildren = nodeIndexes.childrenByParent.get(node.id) || [];
                    const dropAllowed = draggedId !== null && draggedId !== node.id && !wouldCycle(nodes, draggedId, node.id);
                    return (
                      <div
                        key={node.id}
                        className={[
                          'org-card-node',
                          ['company', 'institute'].includes(node.nodeType) ? 'is-solid' : 'is-outline',
                          selectedId === node.id ? 'is-selected' : '',
                          dropTargetId === node.id ? 'is-drop-target' : '',
                          deferredSearch && matchesSearch(node, deferredSearch) ? 'is-match' : '',
                        ].filter(Boolean).join(' ')}
                        style={{ left: node.left + CANVAS_PADDING, top: node.top + CANVAS_PADDING, '--node-accent': meta.color }}
                        role="button"
                        tabIndex={0}
                        onClick={() => openNodeDetails(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openNodeDetails(node.id);
                          }
                        }}
                        draggable={canEdit}
                        onDragStart={() => setDraggedId(node.id)}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setDropTargetId(null);
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
                        {(node.userName || node.userRole || node.isVacant) ? (
                          <div className="org-card-node__person">
                            <span className="org-card-node__avatar">
                              {node.isVacant ? <i className="bi bi-person-dash-fill"></i> : personInitials(node.userName || node.name)}
                            </span>
                            <div>
                              <strong>{node.isVacant ? 'Vacant role' : node.userName || 'Assigned actor'}</strong>
                              <small>{node.isVacant ? 'No actor assigned yet' : node.userRole || 'Role linked to this node'}</small>
                            </div>
                          </div>
                        ) : null}
                        <div className="org-card-node__footer">
                          <span>{meta.label}</span>
                          <span>{descendantCount(nodes, node.id)} nested</span>
                        </div>
                        {(directChildren.length > 0 || canEdit) && (
                          <div className="org-card-node__actions">
                            {directChildren.length > 0 ? (
                              <button
                                type="button"
                                className="org-card-node__navigate"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  enterSubOrganization(node.id);
                                }}
                              >
                                <i className="bi bi-diagram-3-fill"></i>Sous-structure
                              </button>
                            ) : <span></span>}
                            {canEdit ? (
                              <div className="d-flex align-items-center gap-2">
                                <span className="org-card-node__drag"><i className="bi bi-grip-vertical"></i>Drag</span>
                                <button type="button" className="org-card-node__add" onClick={(event) => { event.stopPropagation(); openCreateModal(node); }}><i className="bi bi-plus-lg"></i></button>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="org-canvas__hint">Mouse wheel to zoom. Drag empty space to pan across the organigram.</div>
              </div>
            )}
          </Card.Body>
        </Card>

      </div>

      <Modal show={Boolean(selectedNode && showDetailsModal)} onHide={() => setShowDetailsModal(false)} size="xl" centered>
        <Modal.Header closeButton className="org-modal__header">
          <Modal.Title>{selectedNode ? selectedNode.name : 'Acteur details'}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="org-modal__body">
          {selectedNode ? (
            <div className="d-flex flex-column gap-4">
              <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                <div>
                  <span className="org-inspector__eyebrow">Acteur</span>
                  <h2 className="mb-2">{selectedNode.name}</h2>
                </div>
                <Badge bg="light" text="dark">{nodeMeta(selectedNode.nodeType).label}</Badge>
              </div>

              <div className="org-inspector__meta">
                <div><span>Created</span><strong>{formatDate(selectedNode.createdAt)}</strong></div>
                <div><span>Updated</span><strong>{formatDate(selectedNode.updatedAt)}</strong></div>
                <div><span>Direct reports</span><strong>{childCount(nodes, selectedNode.id)}</strong></div>
                <div><span>All descendants</span><strong>{descendantCount(nodes, selectedNode.id)}</strong></div>
              </div>

              {childCount(nodes, selectedNode.id) > 0 ? (
                <div className="d-flex flex-wrap gap-2">
                  <Button
                    variant="outline-secondary"
                    onClick={() => enterSubOrganization(selectedNode.id, { closeModal: true })}
                  >
                    <i className="bi bi-diagram-3-fill me-2"></i>Ouvrir la sous-structure
                  </Button>
                </div>
              ) : null}

              {canEdit ? (
                <Form onSubmit={saveSelectedNode}>
                  <OrgNodeFields form={inspectorForm} setForm={setInspectorForm} users={users} parentOptions={parentOptions} />
                  <div className="org-inspector__actions">
                    <Button variant="outline-secondary" onClick={() => openCreateModal(selectedNode)}><i className="bi bi-plus-circle me-2"></i>Add Child</Button>
                    <Button type="submit" variant="danger" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
                  </div>
                  <Button variant="outline-danger" className="org-inspector__delete" onClick={deleteSelectedNode} disabled={saving}>
                    <i className="bi bi-trash me-2"></i>Delete acteur
                  </Button>
                </Form>
              ) : (
                <div className="org-inspector__readonly">
                  <p>{selectedNode.description || 'No description for this acteur yet.'}</p>
                  <ul>
                    <li>Title: {selectedNode.title || 'Not specified'}</li>
                  </ul>
                </div>
              )}

              {!publicView ? (
                <div>
                  <EntityCollaborationPanel
                    entityType="orgchart_node"
                    entityId={selectedNode.id}
                    title="Commentaires et fichiers de l acteur"
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </Modal.Body>
      </Modal>

      <Modal show={showCreateModal} onHide={() => setShowCreateModal(false)} size="lg" centered>
        <Modal.Header closeButton className="org-modal__header">
          <Modal.Title>Create Organigram Acteur</Modal.Title>
        </Modal.Header>
        <Modal.Body className="org-modal__body">
          <Form onSubmit={createNode}>
            <OrgNodeFields form={createForm} setForm={setCreateForm} users={users} parentOptions={nodes} />
            <div className="org-modal__actions">
              <Button variant="outline-secondary" onClick={() => setShowCreateModal(false)}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={saving}>{saving ? 'Creating...' : 'Create Acteur'}</Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
}

export default OrgChart;
