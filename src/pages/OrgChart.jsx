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
const CARD_WIDTH = 280;
const CARD_HEIGHT = 168;
const H_GAP = 56;
const V_GAP = 92;
const CANVAS_PADDING = 72;
const MIN_ZOOM = 0.22;
const MAX_ZOOM = 2.4;
const PAN_MARGIN = 56;
const NODE_DRAG_THRESHOLD = 10;

const DEFAULT_TYPE_COLOR = '#0f766e';
const TYPE_META = {
  org_unit: { label: 'Org-Unit', icon: 'bi-diagram-3', color: '#dc2626' },
  company: { label: 'Company', icon: 'bi-house-door-fill', color: '#0f766e' },
  institute: { label: 'Institute', icon: 'bi-bank', color: '#0ea5e9' },
  structure: { label: 'Structure', icon: 'bi-diagram-2-fill', color: '#7c3aed' },
  manager: { label: 'Manager', icon: 'bi-person-workspace', color: '#ea580c' },
  function: { label: 'Function', icon: 'bi-people-fill', color: '#ca8a04' },
};

const EMPTY_FORM = {
  name: '',
  nodeType: 'structure',
  parentId: '',
  description: '',
  color: TYPE_META.structure.color,
  placementMode: 'direct',
  nestedParentId: '',
  baseParentId: '',
};

function nodeMeta(nodeType) {
  return TYPE_META[nodeType] || TYPE_META.function;
}

function toForm(node = null, overrides = {}) {
  return {
    name: node?.name || '',
    nodeType: node?.nodeType || 'structure',
    parentId: node?.parentId ? String(node.parentId) : '',
    description: node?.description || '',
    color: node?.color || nodeMeta(node?.nodeType).color || TYPE_META.structure.color,
    placementMode: overrides.placementMode || 'direct',
    nestedParentId: overrides.nestedParentId || '',
    baseParentId: overrides.baseParentId || '',
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

function normalizeNodePosition(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.round(numeric));
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
      placementMode: node.placementMode === 'nested' ? 'nested' : 'direct',
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
    const allNodes = [];
    const visit = (parentId, includeNestedChildren = false) => {
      const branch = sortNodes(childrenByParent.get(parentId) || []).filter(
        (node) => includeNestedChildren || node.placementMode !== 'nested'
      );
      branch.forEach((node) => {
        allNodes.push(node);
        visit(node.id, false);
      });
    };
    // Main view must stay "outside only": never include nested children here.
    visit(0, false);
    return allNodes;
  }

  const focusedNode = byId.get(rootId);
  if (!focusedNode) {
    return [];
  }

  return [
    focusedNode,
    ...(childrenByParent.get(rootId) || []).filter((node) => node.placementMode === 'nested'),
  ];
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

function buildLayout(nodes, { applyManualPositions = true } = {}) {
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

  if (applyManualPositions) {
    laidOut.forEach((node) => {
      const normalizedPosX = normalizeNodePosition(node.posX);
      const normalizedPosY = normalizeNodePosition(node.posY);

      if (normalizedPosX !== null) {
        node.left = normalizedPosX;
      }
      if (normalizedPosY !== null) {
        node.top = normalizedPosY;
      }
    });
  }

  const minLeft = laidOut.reduce((min, node) => Math.min(min, Number(node.left) || 0), 0);
  const minTop = laidOut.reduce((min, node) => Math.min(min, Number(node.top) || 0), 0);
  const xOffset = minLeft < 0 ? Math.abs(minLeft) : 0;
  const yOffset = minTop < 0 ? Math.abs(minTop) : 0;

  if (xOffset || yOffset) {
    laidOut.forEach((node) => {
      node.left += xOffset;
      node.top += yOffset;
    });
  }

  return {
    nodes: laidOut,
    edges,
    width: Math.max(
      laidOut.reduce((max, node) => Math.max(max, (node.left || 0) + CARD_WIDTH), 0) + CANVAS_PADDING * 2,
      rootCursor + CANVAS_PADDING * 2,
      720
    ),
    height: Math.max(
      laidOut.reduce((max, node) => Math.max(max, (node.top || 0) + CARD_HEIGHT), 0) + CANVAS_PADDING * 2,
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

function OrgNodeFields({ form, setForm, parentOptions, mode = 'edit', lockedPlacementMode = null }) {
  const scopedParentId = form.baseParentId || form.parentId || '';
  const showPlacementOptions = mode === 'create' && Boolean(scopedParentId);
  const directLocked = lockedPlacementMode === 'direct';
  const nestedLocked = lockedPlacementMode === 'nested';
  return (
    <div className="org-form-grid">
      <Form.Group>
        <Form.Label>Name *</Form.Label>
        <Form.Control value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
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
        <Form.Select
          value={form.parentId}
          disabled={mode === 'create' && Boolean(form.baseParentId)}
          onChange={(event) => {
            const nextParentId = event.target.value;
            setForm((current) => ({
              ...current,
              parentId: nextParentId,
              placementMode: nextParentId ? current.placementMode : 'direct',
            }));
          }}
        >
          <option value="">Top level</option>
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </Form.Select>
      </Form.Group>
      <Form.Group>
        <Form.Label>Type color</Form.Label>
        <Form.Control
          type="color"
          value={form.color || TYPE_META.structure.color}
          onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
        />
      </Form.Group>
      {showPlacementOptions ? (
        <>
          <Form.Group className="org-form-grid__full">
            <Form.Label>Placement</Form.Label>
            <div className="d-flex gap-3 flex-wrap">
              <Form.Check
                type="radio"
                id="org-placement-direct"
                name="org-placement-mode"
                label="Fils visible sur l'organigramme principal"
                checked={form.placementMode === 'direct'}
                disabled={nestedLocked}
                onChange={() => setForm((current) => ({
                  ...current,
                  placementMode: 'direct',
                  parentId: current.baseParentId || current.parentId,
                }))}
              />
              <Form.Check
                type="radio"
                id="org-placement-nested"
                name="org-placement-mode"
                label="Interne (visible apres Expand du parent)"
                checked={form.placementMode === 'nested'}
                disabled={directLocked}
                onChange={() => setForm((current) => ({
                  ...current,
                  placementMode: 'nested',
                  parentId: current.baseParentId || current.parentId,
                }))}
              />
            </div>
          </Form.Group>
        </>
      ) : null}
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
  const [boardFullscreen, setBoardFullscreen] = useState(false);
  const [layoutMode, setLayoutMode] = useState('auto'); // 'auto' | 'manual'
  const boardRef = useRef(null);
  const canvasRef = useRef(null);
  const autoFitEnabledRef = useRef(true);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const panSessionRef = useRef(null);
  const nodeDragSessionRef = useRef(null);
  const suppressNodeClickRef = useRef(false);

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
      const [nodesResponse] = await Promise.all([fetch(`${API}/orgchart/nodes`)]);
      const nextNodes = await parseApiPayload(nodesResponse, 'Failed to load organigram nodes.');
      setNodes(nextNodes);
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
  const modalContainer = boardRef.current || undefined;
  const focusTrail = useMemo(() => buildNodeTrail(focusedNodeId, nodeIndexes.byId), [focusedNodeId, nodeIndexes]);
  const scopedNodes = useMemo(
    () => collectSubtreeNodes(focusedNodeId, nodeIndexes.byId, nodeIndexes.childrenByParent),
    [focusedNodeId, nodeIndexes]
  );
  const visibleIds = useMemo(() => buildVisibleIds(scopedNodes, deferredSearch), [scopedNodes, deferredSearch]);
  const visibleNodes = scopedNodes.filter((node) => visibleIds.has(node.id));
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const layout = buildLayout(visibleNodes, { applyManualPositions: layoutMode === 'manual' });

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

  const updateZoomAtPoint = useCallback((nextZoom, clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const clampedZoom = clamp(Number(nextZoom.toFixed(2)), MIN_ZOOM, MAX_ZOOM);
    const anchorX = clientX - rect.left;
    const anchorY = clientY - rect.top;
    const worldX = (anchorX - panRef.current.x) / zoomRef.current;
    const worldY = (anchorY - panRef.current.y) / zoomRef.current;
    const nextPan = constrainPan(anchorX - worldX * clampedZoom, anchorY - worldY * clampedZoom, clampedZoom);

    autoFitEnabledRef.current = false;
    setZoom(clampedZoom);
    setPan(nextPan);
  }, [constrainPan]);

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

  const lockedPlacementModeForCreateParent = useMemo(() => {
    if (!createForm.baseParentId) return null;
    const parentId = Number(createForm.baseParentId);
    if (!Number.isInteger(parentId) || parentId <= 0) return null;

    const children = nodes.filter((node) => node.parentId === parentId);
    if (children.some((child) => child.placementMode === 'nested')) return 'nested';
    if (children.some((child) => (child.placementMode || 'direct') === 'direct')) return 'direct';
    return null;
  }, [createForm.baseParentId, nodes]);
  const showMessage = (text, variant = 'success') => showSnackbar(text, variant);

  const openNodeDetails = (nodeId) => {
    if (suppressNodeClickRef.current) {
      suppressNodeClickRef.current = false;
      return;
    }
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

  const goBackFromFocusedNode = useCallback(() => {
    autoFitEnabledRef.current = true;
    if (focusTrail.length <= 1) {
      setFocusedNodeId(null);
      return;
    }

    setFocusedNodeId(focusTrail[focusTrail.length - 2]?.id || null);
  }, [focusTrail]);

  const openCreateModal = (parentNode = null) => {
    // Root creation: only one top-level company allowed.
    if (!parentNode) {
      const hasCompany = nodes.some((node) => node.nodeType === 'company');
      if (hasCompany) {
        showMessage('Only one top-level Company is allowed in the organigram.', 'danger');
        return;
      }
      setCreateForm(toForm(null, {
        parentId: '',
        nodeType: 'company',
        color: nodeMeta('company').color,
        baseParentId: '',
        placementMode: 'direct',
      }));
      setShowCreateModal(true);
      return;
    }

    // A Function cannot have children.
    if (parentNode.nodeType === 'function') {
      showMessage('A Function acteur cannot have children.', 'danger');
      return;
    }

    // Determine allowed child type based on simple hierarchy rules.
    let suggestedType = 'structure';
    if (parentNode.nodeType === 'company') {
      // Under company: either institute or manager. Prefer institute by default.
      suggestedType = 'institute';
    } else if (parentNode.nodeType === 'institute') {
      // Under institute: only structure.
      suggestedType = 'structure';
    } else if (parentNode.nodeType === 'manager') {
      // Under CEO manager: structure.
      suggestedType = 'structure';
    } else if (parentNode.nodeType === 'structure') {
      // Under structure: allow another structure by default.
      suggestedType = 'structure';
    }

    const parentIdNum = parentNode?.id ? Number(parentNode.id) : null;
    let lockedPlacementMode = null;
    if (parentIdNum && Number.isInteger(parentIdNum)) {
      const children = nodes.filter((node) => node.parentId === parentIdNum);
      if (children.some((child) => child.placementMode === 'nested')) {
        lockedPlacementMode = 'nested';
      } else if (children.some((child) => (child.placementMode || 'direct') === 'direct')) {
        lockedPlacementMode = 'direct';
      }
    }

    const initialPlacementMode = lockedPlacementMode || 'direct';

    setCreateForm(toForm(null, {
      parentId: parentNode?.id ? String(parentNode.id) : '',
      nodeType: suggestedType,
      color: nodeMeta(suggestedType).color,
      baseParentId: parentNode?.id ? String(parentNode.id) : '',
      placementMode: parentNode?.id ? initialPlacementMode : 'direct',
    }));
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
    // Enforce hierarchy constraints before saving edits.
    const parentId = inspectorForm.parentId ? Number(inspectorForm.parentId) : null;
    const parentNode = Number.isInteger(parentId) ? nodes.find((node) => node.id === parentId) || null : null;

    // Company: only one, and must remain at top level.
    if (inspectorForm.nodeType === 'company') {
      if (parentNode) {
        showMessage('Company must stay at the top level (no parent).', 'danger');
        return;
      }
      const otherCompany = nodes.find((node) => node.nodeType === 'company' && node.id !== selectedNode.id);
      if (otherCompany) {
        showMessage('Only one Company acteur is allowed.', 'danger');
        return;
      }
    }

    // Institute: can only be under a Company.
    if (inspectorForm.nodeType === 'institute') {
      if (!parentNode || parentNode.nodeType !== 'company') {
        showMessage('An Institute acteur must be directly under a Company.', 'danger');
        return;
      }
    }

    // No children allowed under Function: disallow setting parent to a Function.
    if (parentNode && parentNode.nodeType === 'function') {
      showMessage('A Function acteur cannot have children.', 'danger');
      return;
    }

    setSaving(true);
    try {
      const data = await persistNode(`${API}/orgchart/nodes/${selectedNode.id}`, 'PUT', {
        ...inspectorForm,
        parentId: inspectorForm.parentId || null,
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
    const parentId = createForm.baseParentId
      ? Number(createForm.baseParentId)
      : createForm.parentId
        ? Number(createForm.parentId)
        : null;
    const parentNode = Number.isInteger(parentId) ? nodes.find((node) => node.id === parentId) || null : null;

    // Root creation: only one top-level Company.
    if (!parentNode) {
      const hasCompany = nodes.some((node) => node.nodeType === 'company');
      if (hasCompany) {
        showMessage('Only one top-level Company is allowed in the organigram.', 'danger');
        return;
      }
      if (createForm.nodeType !== 'company') {
        showMessage('Top-level acteur must be of type Company.', 'danger');
        return;
      }
    }

    // Company can only exist at top level.
    if (createForm.nodeType === 'company' && parentNode) {
      showMessage('Company acteurs can only be created at the top level.', 'danger');
      return;
    }

    // Institute can only be under Company.
    if (createForm.nodeType === 'institute' && (!parentNode || parentNode.nodeType !== 'company')) {
      showMessage('An Institute acteur must be created directly under a Company.', 'danger');
      return;
    }

    // Function cannot have children: disallow creating a child under a Function.
    if (parentNode && parentNode.nodeType === 'function') {
      showMessage('A Function acteur cannot have children.', 'danger');
      return;
    }

    setSaving(true);
    try {
      setLayoutMode('auto');
      const selectedPlacementMode = createForm.placementMode === 'nested' ? 'nested' : 'direct';
      const data = await persistNode(`${API}/orgchart/nodes`, 'POST', {
        ...createForm,
        parentId: createForm.parentId || null,
        placementMode: selectedPlacementMode,
      });
      showMessage(
        data?.placementMode === 'nested'
          ? 'New organigram acteur created (inside/Expand).'
          : 'New organigram acteur created (outside/main).'
      );
      setShowCreateModal(false);
      await loadOrgChart(true);
      if (data?.placementMode === 'nested') {
        setFocusedNodeId(data.parentId ? Number(data.parentId) : null);
      } else {
        // Direct children are rendered in the main board scope.
        setFocusedNodeId(null);
      }
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

  const saveNodePosition = async (nodeId, posX, posY) => {
    const safePosX = normalizeNodePosition(posX) ?? 0;
    const safePosY = normalizeNodePosition(posY) ?? 0;

    setSaving(true);
    try {
      await persistNode(`${API}/orgchart/nodes/${nodeId}/position`, 'PATCH', { posX: safePosX, posY: safePosY });
      showMessage('Organigram updated.');
      await loadOrgChart(true);
      setSelectedId(nodeId);
    } catch (requestError) {
      console.error(requestError);
      showMessage(requestError.message || 'Failed to move acteur.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleCanvasWheel = useCallback((event) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextZoom = zoomRef.current + direction * 0.08;
    updateZoomAtPoint(nextZoom, event.clientX, event.clientY);
  }, [updateZoomAtPoint]);

  const handleCanvasPointerDown = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest('.org-card-node, button, input, select, textarea, a')) {
      return;
    }

    panSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panRef.current.x,
      originY: panRef.current.y,
    };
    setIsPanning(true);
    autoFitEnabledRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handleCanvasPointerMove = useCallback((event) => {
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const nextPan = constrainPan(
      session.originX + (event.clientX - session.startX),
      session.originY + (event.clientY - session.startY),
      zoomRef.current
    );
    setPan(nextPan);
  }, [constrainPan]);

  const handleCanvasPointerUp = useCallback((event) => {
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    panSessionRef.current = null;
    setIsPanning(false);
  }, []);

  const handleNodePointerDown = useCallback((event, node) => {
    if (!canEdit) {
      return;
    }
    if (event.target.closest('button,input,select,textarea,a')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    nodeDragSessionRef.current = {
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: Number.isFinite(Number(node.posX)) ? Number(node.posX) : node.left,
      originY: Number.isFinite(Number(node.posY)) ? Number(node.posY) : node.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [canEdit]);

  const handleNodePointerMove = useCallback((event) => {
    const session = nodeDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    if (!session.moved) {
      if (Math.abs(deltaX) < NODE_DRAG_THRESHOLD && Math.abs(deltaY) < NODE_DRAG_THRESHOLD) {
        return;
      }

      session.moved = true;
      suppressNodeClickRef.current = true;
      setLayoutMode('manual');
      autoFitEnabledRef.current = false;
    }

    const nextX = normalizeNodePosition(session.originX + (deltaX / zoomRef.current)) ?? 0;
    const nextY = normalizeNodePosition(session.originY + (deltaY / zoomRef.current)) ?? 0;

    setNodes((current) => current.map((currentNode) => (
      currentNode.id === session.id
        ? { ...currentNode, posX: nextX, posY: nextY }
        : currentNode
    )));
  }, []);

  const handleNodePointerUp = useCallback(async (event) => {
    const session = nodeDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    nodeDragSessionRef.current = null;

    if (session.moved) {
      await saveNodePosition(
        session.id,
        normalizeNodePosition(session.originX + ((event.clientX - session.startX) / zoomRef.current)) ?? 0,
        normalizeNodePosition(session.originY + ((event.clientY - session.startY) / zoomRef.current)) ?? 0
      );
      window.setTimeout(() => {
        suppressNodeClickRef.current = false;
      }, 0);
    }
  }, []);

  const handleZoomButton = useCallback((direction) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    updateZoomAtPoint(
      zoomRef.current + direction * 0.12,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
  }, [updateZoomAtPoint]);

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

  const applyAutoLayout = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await persistNode(`${API}/orgchart/positions/clear`, 'POST', {});
      setLayoutMode('auto');
      await loadOrgChart(true);
      showMessage('Auto layout applied.');
    } catch (requestError) {
      console.error(requestError);
      showMessage(requestError.message || 'Failed to apply auto layout.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const clearOrgChart = async () => {
    if (!canEdit) return;
    const confirmed = await confirmAction({
      title: 'Clear organigram',
      message: 'This will delete ALL organigram nodes.',
      confirmLabel: 'Clear all',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await persistNode(`${API}/orgchart/clear`, 'POST', {});
      showMessage('Organigram cleared.');
      setSelectedId(null);
      setFocusedNodeId(null);
      await loadOrgChart(true);
    } catch (requestError) {
      console.error(requestError);
      showMessage(requestError.message || 'Failed to clear organigram.', 'danger');
    } finally {
      setSaving(false);
    }
  };

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
                <div className="org-zoom">
                  <button type="button" onClick={() => handleZoomButton(-1)} aria-label="Zoom out">-</button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={() => handleZoomButton(1)} aria-label="Zoom in">+</button>
                  <button type="button" className="org-zoom__fit" onClick={fitCanvasToViewport}>Fit</button>
                </div>
                {canEdit ? (
                  <Button
                    variant={layoutMode === 'auto' ? 'secondary' : 'outline-secondary'}
                    size="sm"
                    onClick={applyAutoLayout}
                    disabled={saving}
                  >
                    Auto arrange
                  </Button>
                ) : null}
                  {canEdit ? (
                    <Button variant="outline-danger" size="sm" onClick={clearOrgChart} disabled={saving}>
                      Clear organigram
                    </Button>
                  ) : null}
                <Button variant="outline-secondary" className="org-fullscreen-btn" onClick={toggleBoardFullscreen}>
                  <i className={`bi ${boardFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'} me-2`}></i>
                  {boardFullscreen ? 'Exit full screen' : 'Full screen'}
                </Button>
                <div className="org-board__status-stack">
                  <Badge bg="light" text="dark" className="org-badge">{visibleNodes.length} visible</Badge>
                  {focusTrail.length ? (
                    <button
                      type="button"
                      className="org-scope-back"
                      onClick={goBackFromFocusedNode}
                    >
                      Retour
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="org-board__scope">
              {focusTrail.length ? (
                focusTrail.map((node, index) => (
                  <button
                    key={node.id}
                    type="button"
                    className={`org-scope-chip ${index === focusTrail.length - 1 ? 'is-active' : ''}`}
                    onClick={() => jumpToFocusedTrailIndex(index)}
                  >
                    {node.name}
                  </button>
                ))
              ) : (
                <button
                  type="button"
                  className="org-scope-chip is-active"
                  onClick={() => jumpToFocusedTrailIndex(-1)}
                >
                  Organigramme complet
                </button>
              )}
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
                    const nestedChildren = (nodeIndexes.childrenByParent.get(node.id) || []).filter(
                      (child) => child.placementMode === 'nested'
                    );
                    const hasChildren = nestedChildren.length > 0;
                    return (
                      <div
                        key={node.id}
                        className={[
                          'org-card-node',
                          `org-card-node--${String(node.nodeType || 'function').replace(/_/g, '-')}`,
                          'is-outline',
                          selectedId === node.id ? 'is-selected' : '',
                          deferredSearch && matchesSearch(node, deferredSearch) ? 'is-match' : '',
                        ].filter(Boolean).join(' ')}
                        style={{
                          left: node.left + CANVAS_PADDING,
                          top: node.top + CANVAS_PADDING,
                          '--node-accent': node.color && node.color !== DEFAULT_TYPE_COLOR ? node.color : meta.color,
                        }}
                        role="button"
                        tabIndex={0}
                        onClick={() => openNodeDetails(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openNodeDetails(node.id);
                          }
                        }}
                        onPointerDown={(event) => handleNodePointerDown(event, node)}
                        onPointerMove={handleNodePointerMove}
                        onPointerUp={handleNodePointerUp}
                        onPointerCancel={handleNodePointerUp}
                      >
                        <div className="org-card-node__topline"></div>
                        <div className="org-card-node__header">
                          <div className="org-card-node__identity">
                            <span className="org-card-node__icon-badge"><i className={`bi ${meta.icon}`}></i></span>
                            <span className="org-card-node__type">{meta.label}</span>
                          </div>
                        </div>
                        <div className="org-card-node__body">
                          <h3>{node.name}</h3>
                        </div>
                        <div className="org-card-node__actions">
                          <button
                            type="button"
                            className={`org-card-node__navigate ${hasChildren ? 'is-expandable' : 'is-disabled'}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (hasChildren) {
                                enterSubOrganization(node.id);
                              }
                            }}
                          >
                            <i className="bi bi-diagram-3-fill"></i>Expand
                          </button>
                          {canEdit ? (
                            <button
                              type="button"
                              className="org-card-node__add"
                              onClick={(event) => {
                                event.stopPropagation();
                                openCreateModal(node);
                              }}
                            >
                              <i className="bi bi-plus-lg"></i>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card.Body>
        </Card>

      </div>

      <Modal
        show={Boolean(selectedNode && showDetailsModal)}
        onHide={() => setShowDetailsModal(false)}
        size="xl"
        centered
        container={modalContainer}
      >
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

              {(nodeIndexes.childrenByParent.get(selectedNode.id) || []).some(
                (child) => child.placementMode === 'nested'
              ) ? (
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
                  <OrgNodeFields form={inspectorForm} setForm={setInspectorForm} parentOptions={parentOptions} />
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

      <Modal
        show={showCreateModal}
        onHide={() => setShowCreateModal(false)}
        size="lg"
        centered
        container={modalContainer}
      >
        <Modal.Header closeButton className="org-modal__header">
          <Modal.Title>Create Organigram Acteur</Modal.Title>
        </Modal.Header>
        <Modal.Body className="org-modal__body">
          <Form onSubmit={createNode}>
            <OrgNodeFields
              form={createForm}
              setForm={setCreateForm}
              parentOptions={nodes}
              mode="create"
              lockedPlacementMode={lockedPlacementModeForCreateParent}
            />
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
