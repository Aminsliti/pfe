import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSnackbar } from '../components/SnackbarProvider';
import { Container, Row, Col, Card, Button, Modal, Form, Alert, Badge, InputGroup, FormControl, ProgressBar, Dropdown } from 'react-bootstrap';
import { buildBpmnSubprocessTrail, getBpmnSubprocesses } from '../utils/bpmnSubprocesses';

import { API_BASE } from '../utils/api';

const API = API_BASE;
const BpmnEditorModeler = lazy(() => import('../components/BpmnEditor/BpmnEditorModeler'));
const BpmnProcessPreview = lazy(() => import('../components/BpmnEditor/BpmnProcessPreview'));
const PROCESS_SECTION_CONFIG = [
  { key: 'pilotage', label: 'Processus de pilotage', icon: 'bi-compass' },
  { key: 'metiers', label: 'Processus metiers', icon: 'bi-briefcase' },
  { key: 'support', label: 'Processus support', icon: 'bi-life-preserver' },
];
const DEFAULT_PROCESS_SECTION = 'metiers';

function ModelerFallback() {
  return (
    <Container fluid className="py-4">
      <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '70vh' }}>
        <div className="spinner-border text-danger" role="status" />
        <p className="mt-3 mb-0 text-muted">Loading BPMN editor...</p>
      </div>
    </Container>
  );
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function parseFilenameFromDisposition(disposition, fallback) {
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

function replaceExtension(filename, nextExtension) {
  const safe = filename || 'process.bpmn';
  return safe.replace(/\.[^./\\]+$/i, nextExtension);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (!(blob instanceof Blob)) {
      reject(new Error('Unable to render the diagram image for this export.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read the rendered diagram image.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

async function readApiPayload(response, fallbackError = 'Request failed') {
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(
      contentType.includes('application/json')
        ? payload?.error || fallbackError
        : response.status === 404
          ? 'This feature needs the latest backend. Restart the backend server and try again.'
          : payload || fallbackError
    );
  }

  return payload;
}

function buildCategoryTree(categories = []) {
  const byId = new Map();
  const roots = [];

  categories.forEach((category) => {
    byId.set(category.id, { ...category, children: [], depth: 0, path: [category.name] });
  });

  byId.forEach((category) => {
    const parent = category.parent_id ? byId.get(category.parent_id) : null;
    if (parent) {
      parent.children.push(category);
    } else {
      roots.push(category);
    }
  });

  const decorate = (nodes, depth = 0, trail = []) => {
    nodes.sort((left, right) => left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' }));
    nodes.forEach((node) => {
      node.depth = depth;
      node.path = [...trail, node.name];
      decorate(node.children, depth + 1, node.path);
    });
  };

  decorate(roots);
  return { roots, byId };
}

function flattenCategoryTree(categories = []) {
  const tree = buildCategoryTree(categories);
  const options = [];

  const visit = (node) => {
    options.push({
      id: node.id,
      name: `${'— '.repeat(node.depth)}${node.name}`,
      plainName: node.name,
      depth: node.depth,
      pathLabel: node.path.join(' > '),
      parent_id: node.parent_id || null,
    });
    node.children.forEach(visit);
  };

  tree.roots.forEach(visit);
  return options;
}

function collectCategoryDescendantIds(category, bucket = new Set()) {
  if (!category) {
    return bucket;
  }

  category.children.forEach((child) => {
    bucket.add(Number(child.id));
    collectCategoryDescendantIds(child, bucket);
  });

  return bucket;
}

function toFormId(value) {
  return value === null || value === undefined ? '' : String(value);
}

function toFormIds(value, fallbackValue = []) {
  if (value === undefined) {
    return toFormIds(fallbackValue, []);
  }

  if (value === null || value === '') {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
}

function toggleFormIdSelection(values, value, checked) {
  const normalizedValues = toFormIds(values);
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return normalizedValues;
  }

  if (checked) {
    return toFormIds([...normalizedValues, normalizedValue]);
  }

  return normalizedValues.filter((entry) => entry !== normalizedValue);
}

function normalizeCategorySection(value, fallbackValue = DEFAULT_PROCESS_SECTION) {
  const normalized = String(value || '').trim().toLowerCase();
  return PROCESS_SECTION_CONFIG.some((section) => section.key === normalized) ? normalized : fallbackValue;
}

function formatWorkflowActionLabel(action = '') {
  return String(action || '').replace(/_/g, ' ');
}

function getWorkflowFlags(workflowInfo, currentStatus) {
  const comments = Array.isArray(workflowInfo?.comments) ? workflowInfo.comments : [];
  const latestRequestChange = comments.find((entry) => entry.action === 'request_change') || null;
  const latestReturnDraft = comments.find((entry) => entry.action === 'return_draft') || null;
  const reopenedAfterRequest =
    latestRequestChange &&
    latestReturnDraft &&
    new Date(latestReturnDraft.created_at || 0) > new Date(latestRequestChange.created_at || 0);
  const pendingReopenRequest = Boolean(latestRequestChange) && !reopenedAfterRequest && currentStatus === 'approved';

  return {
    latestRequestChange,
    latestReturnDraft,
    pendingReopenRequest,
  };
}

function buildWorkflowJourney(workflowInfo, currentStatus) {
  const {
    latestRequestChange,
    latestReturnDraft,
    pendingReopenRequest,
  } = getWorkflowFlags(workflowInfo, currentStatus);

  return [
    {
      key: 'created',
      label: 'Created',
      reached: true,
      current: currentStatus === 'draft' && !workflowInfo?.submitted_at && !latestReturnDraft,
    },
    {
      key: 'draft',
      label: latestReturnDraft ? 'Draft (reopened)' : 'Draft',
      reached: true,
      current: currentStatus === 'draft',
    },
    {
      key: 'submitted',
      label: 'Submitted',
      reached: Boolean(workflowInfo?.submitted_at),
      current: currentStatus === 'review',
    },
    {
      key: 'approved',
      label: 'Approved',
      reached: Boolean(workflowInfo?.approved_at),
      current: currentStatus === 'approved' && !pendingReopenRequest,
    },
    {
      key: 'request_change',
      label: 'Request to reopen',
      reached: Boolean(latestRequestChange),
      current: pendingReopenRequest,
    },
  ];
}

export function ProcessManagement({ publicView = false }) {
  const { user, hasPermission, hasRole, ROLES } = useAuth();
  const { showSnackbar, confirmAction } = useSnackbar();
  const [searchParams, setSearchParams] = useSearchParams();
  const canViewWorkspace = publicView || hasPermission('view_dashboard') || hasPermission('manage_processes');
  const isAdmin = !publicView && hasRole(ROLES.ADMIN);
  const isValidator = !publicView && hasRole(ROLES.VALIDATOR);
  const [processes, setProcesses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingProcess, setEditingProcess] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterStatus, setFilterStatus] = useState(publicView ? 'approved' : '');
  const [viewMode, setViewMode] = useState('hierarchy');
  const [bpmnTarget, setBpmnTarget] = useState(null);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [collapsedSections, setCollapsedSections] = useState(() =>
    Object.fromEntries(PROCESS_SECTION_CONFIG.map((section) => [section.key, true]))
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProcessIds, setSelectedProcessIds] = useState([]);
  const [importForm, setImportForm] = useState({ name: '', description: '', category_id: '', status: 'draft' });
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    bpmn_xml: '',
    category_id: '',
    status: 'draft',
    assigned_designer_ids: [],
    assigned_validator_ids: toFormIds(user?.id ? [user.id] : []),
  });
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
    parent_id: '',
    section: DEFAULT_PROCESS_SECTION,
  });
  const [categoryError, setCategoryError] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [governanceOptions, setGovernanceOptions] = useState({ designers: [], validators: [] });
  const [governanceLoading, setGovernanceLoading] = useState(false);
  const [processDetail, setProcessDetail] = useState(null);
  const [workflowInfo, setWorkflowInfo] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [workflowComment, setWorkflowComment] = useState('');
  const [workflowBusy, setWorkflowBusy] = useState('');
  const [versionSelection, setVersionSelection] = useState({ fromVersion: '', toVersion: '' });
  const [versionDiff, setVersionDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [processReportBusy, setProcessReportBusy] = useState('');
  const [templates, setTemplates] = useState([]);
  const [applyingTemplateId, setApplyingTemplateId] = useState(null);
  const [previewRootElementId, setPreviewRootElementId] = useState(null);
  const fileInputRef = useRef(null);
  const openingProcessRef = useRef(null);
  const syncedProcessParamRef = useRef(null);
  const closingProcessRef = useRef(null);
  const lastOpenedProcessRef = useRef({ id: null, at: 0 });
  const scrollRestoreRef = useRef(null);
  const categoryRowRefs = useRef(new Map());
  const categoryToggleAnchorRef = useRef(null);

  const showMsg = (text, type = 'success') => {
    showSnackbar(text, type);
  };

  const fetchProtectedProcessAsset = (url, init = undefined) => {
    if (!user?.id) {
      throw new Error('Your session expired. Please log in again.');
    }

    const headers = new Headers(init?.headers);
    headers.set('x-user-id', String(user.id));

    return fetch(url, {
      ...init,
      headers,
    });
  };

  const preserveScrollPosition = () => {
    scrollRestoreRef.current = window.scrollY;
  };

  const registerCategoryRowRef = (categoryId, element) => {
    if (!categoryId) {
      return;
    }

    if (element) {
      categoryRowRefs.current.set(Number(categoryId), element);
      return;
    }

    categoryRowRefs.current.delete(Number(categoryId));
  };

  const restoreAnchoredCategoryScroll = (anchor) => {
    if (!anchor) {
      return;
    }

    const nextElement = categoryRowRefs.current.get(Number(anchor.categoryId));
    if (!nextElement) {
      return;
    }

    const nextTop = nextElement.getBoundingClientRect().top;
    const delta = nextTop - anchor.top;

    if (Math.abs(delta) > 1) {
      window.scrollBy({ top: delta, behavior: 'auto' });
    }
  };

  const toggleProcessSelection = (processId, checked) => {
    const normalizedId = Number(processId);
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
      return;
    }

    setSelectedProcessIds((current) => (
      checked
        ? [...new Set([...current, normalizedId])]
        : current.filter((entry) => entry !== normalizedId)
    ));
  };

  const clearProcessSelection = () => {
    setSelectedProcessIds([]);
  };

  const disableSelectionMode = () => {
    setSelectionMode(false);
    clearProcessSelection();
  };

  const normalizeGovernedStatus = (status) => (status === 'active' ? 'approved' : status || 'draft');

  const getAssignedDesignerIds = (record) => toFormIds(
    record?.assigned_designer_ids,
    record?.assigned_designer_id ? [record.assigned_designer_id] : []
  );
  const getAssignedValidatorIds = (record) => toFormIds(
    record?.assigned_validator_ids,
    record?.assigned_validator_id ? [record.assigned_validator_id] : record?.created_by ? [record.created_by] : []
  );
  const isAssignedValidator = (record) => getAssignedValidatorIds(record).some((assignedId) => Number(assignedId) === Number(user?.id || 0));
  const isAssignedDesigner = (record) => getAssignedDesignerIds(record).some((assignedId) => Number(assignedId) === Number(user?.id || 0));
  const canCreateDefinitions = isAdmin || isValidator;
  const canEditProcessDefinition = (process) => {
    if (publicView) {
      return false;
    }

    if (!process) {
      return canCreateDefinitions;
    }

    if (isAdmin || isAssignedValidator(process)) {
      return true;
    }

    return isAssignedDesigner(process) && normalizeGovernedStatus(process.status) === 'draft';
  };
  const canDeleteProcessDefinition = (process) =>
    !publicView && Boolean(process) && (isAdmin || isAssignedValidator(process) || (isAssignedDesigner(process) && normalizeGovernedStatus(process.status) === 'draft'));
  const canSubmitForReview = (process) =>
    !publicView && process && normalizeGovernedStatus(process.status) === 'draft' && (isAdmin || isAssignedValidator(process) || isAssignedDesigner(process));
  const canApproveProcess = (process) =>
    !publicView && process && normalizeGovernedStatus(process.status) === 'review' && (isAdmin || isAssignedValidator(process));
  const canReturnToDraft = (process) =>
    !publicView && process && ['review', 'approved'].includes(normalizeGovernedStatus(process.status)) && (isAdmin || isAssignedValidator(process));
  const canArchiveProcess = (process) =>
    !publicView && process && normalizeGovernedStatus(process.status) === 'approved' && (isAdmin || isAssignedValidator(process));
  const canRestoreProcess = (process) =>
    !publicView && process && normalizeGovernedStatus(process.status) === 'archived' && (isAdmin || isAssignedValidator(process));
  const canRequestChange = (process, workflowState = null) =>
    !publicView &&
    process &&
    normalizeGovernedStatus(process.status) === 'approved' &&
    !workflowState?.pendingReopenRequest &&
    (isAdmin || isAssignedDesigner(process));
  const canDeleteCategoryDefinition = (category) => !publicView && Boolean(category) && (isAdmin || isValidator);
  const canManageProcessAssignments = publicView
    ? false
    : (editingProcess ? (isAdmin || isAssignedValidator(processDetail || editingProcess)) : canCreateDefinitions);

  const renderGovernanceChecklist = ({ options, selectedIds, disabled, onToggle, emptyLabel, inputPrefix }) => (
    <div className="border rounded-3 px-3 py-2 bg-white" style={{ maxHeight: 220, overflowY: 'auto' }}>
      {options.length === 0 ? (
        <div className="text-muted small py-1">{emptyLabel}</div>
      ) : (
        options.map((option) => {
          const optionId = String(option.id);
          return (
            <Form.Check
              key={optionId}
              id={`${inputPrefix}-${optionId}`}
              type="checkbox"
              className="py-1"
              disabled={disabled}
              checked={selectedIds.includes(optionId)}
              onChange={(event) => onToggle(toggleFormIdSelection(selectedIds, optionId, event.target.checked))}
              label={option.full_name || option.username}
            />
          );
        })
      )}
    </div>
  );

  const loadProcesses = async () => {
    if (!canViewWorkspace) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (filterCat) params.append('category', filterCat);
      if (filterStatus) params.append('status', filterStatus);
      const response = await fetch(`${API}/processes?${params.toString()}`);
      if (!response.ok) showMsg('Failed to load processes', 'danger');
      else setProcesses(await response.json());
    } catch {
      showMsg('Network error', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch(`${API}/process-categories`);
      if (response.ok) setCategories(await response.json());
    } catch {}
  };

  const loadTemplates = async () => {
    try {
      const response = await fetch(`${API}/process-templates`);
      if (response.ok) {
        setTemplates(await response.json());
      }
    } catch {}
  };

  const loadGovernanceOptions = async () => {
    setGovernanceLoading(true);
    try {
      const response = await fetch(`${API}/process-governance-options`);
      if (response.ok) {
        const payload = await response.json();
        setGovernanceOptions({
          designers: Array.isArray(payload?.designers) ? payload.designers : [],
          validators: Array.isArray(payload?.validators) ? payload.validators : [],
        });
      }
    } catch {
      setGovernanceOptions({ designers: [], validators: [] });
    } finally {
      setGovernanceLoading(false);
    }
  };

  useEffect(() => {
    if (!canViewWorkspace) {
      return;
    }

    loadCategories();

    if (!publicView) {
      loadTemplates();
    }

    if (canCreateDefinitions) {
      loadGovernanceOptions();
    } else {
      setGovernanceOptions({ designers: [], validators: [] });
    }
  }, [canCreateDefinitions, canViewWorkspace, publicView]);
  useEffect(() => { if (canViewWorkspace) loadProcesses(); }, [canViewWorkspace, searchTerm, filterCat, filterStatus]);
  useEffect(() => {
    setCollapsedSections((previous) => {
      const next = { ...previous };
      let changed = false;

      PROCESS_SECTION_CONFIG.forEach((section) => {
        const nextValue = true;
        if (next[section.key] !== nextValue) {
          next[section.key] = nextValue;
          changed = true;
        }
      });

      return changed ? next : previous;
    });
  }, [publicView]);
  useEffect(() => {
    if (publicView && filterStatus !== 'approved') {
      setFilterStatus('approved');
    }
  }, [publicView, filterStatus]);
  useEffect(() => {
    setCollapsedCategories((previous) => {
      const next = { ...previous };
      let changed = false;
      categories.forEach((category) => {
        if (!(category.id in next)) {
          next[category.id] = true;
          changed = true;
        }
      });
      Object.keys(next).forEach((key) => {
        if (!categories.some((category) => String(category.id) === key)) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [categories, publicView]);
  useEffect(() => {
    setSelectedProcessIds((current) => current.filter((id) => processes.some((process) => Number(process.id) === Number(id))));
  }, [processes]);
  useLayoutEffect(() => {
    if (categoryToggleAnchorRef.current) {
      const anchor = categoryToggleAnchorRef.current;
      restoreAnchoredCategoryScroll(anchor);
      window.requestAnimationFrame(() => {
        restoreAnchoredCategoryScroll(anchor);
        window.setTimeout(() => restoreAnchoredCategoryScroll(anchor), 0);
      });
      categoryToggleAnchorRef.current = null;
      scrollRestoreRef.current = null;
      return;
    }

    if (scrollRestoreRef.current === null) {
      return;
    }

    const targetScroll = scrollRestoreRef.current;
    scrollRestoreRef.current = null;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: targetScroll, behavior: 'auto' });
    });
  }, [collapsedCategories, loading, processes, categories, showModal, showCategoryModal]);
  const statusVariant = (status) => ({
    draft: 'secondary',
    review: 'info',
    approved: 'success',
    active: 'success',
    archived: 'warning',
  }[status] || 'secondary');

  const statusLabel = (status) => ({
    draft: 'Draft',
    review: 'In Review',
    approved: 'Approved',
    active: 'Approved',
    archived: 'Archived',
  }[status] || status);
  const normalizeUiStatus = (status) => normalizeGovernedStatus(status);

  const hydrateProcessDetail = async (processId) => {
    setDetailLoading(true);
    try {
      const [detailResponse, workflowResponse] = await Promise.all([
        fetch(`${API}/processes/${processId}`),
        fetch(`${API}/processes/${processId}/workflow`),
      ]);

      if (!detailResponse.ok) {
        throw new Error('Failed to load process detail');
      }

      const detail = await detailResponse.json();
      const workflow = workflowResponse.ok ? await workflowResponse.json() : null;
      setProcessDetail(detail);
      setWorkflowInfo(workflow);
      setVersionSelection((previous) => ({
        fromVersion: previous.fromVersion || String(detail.versions?.[1]?.version_number || detail.versions?.[0]?.version_number || ''),
        toVersion: previous.toVersion || String(detail.versions?.[0]?.version_number || ''),
      }));
      return detail;
    } finally {
      setDetailLoading(false);
    }
  };

  const openBpmnEditor = (process, initialSubprocessId = null) => {
    if (publicView) {
      return;
    }

    setBpmnTarget({
      ...process,
      initialSubprocessId,
    });
  };
  const openCreate = (defaultCategoryId = '') => {
    if (categoryOptions.length === 0) {
      showMsg('Create a category first. Every process must belong to a category.', 'danger');
      return;
    }

    preserveScrollPosition();
    const resolvedCategoryId = defaultCategoryId || (categoryOptions.length === 1 ? String(categoryOptions[0].id) : '');
    setEditingProcess(null);
    setProcessDetail(null);
    setWorkflowInfo(null);
    setWorkflowComment('');
    setVersionDiff(null);
    setVersionSelection({ fromVersion: '', toVersion: '' });
    setFormData({
      name: '',
      description: '',
      bpmn_xml: '',
      category_id: resolvedCategoryId,
      status: 'draft',
      assigned_designer_ids: [],
      assigned_validator_ids: toFormIds(user?.id ? [user.id] : []),
    });
    const nextSearch = new URLSearchParams(searchParams);
    nextSearch.delete('processId');
    setSearchParams(nextSearch, { replace: true, preventScrollReset: true });
    setShowModal(true);
  };
  const syncProcessSearchParam = (processId = null, options = {}) => {
    syncedProcessParamRef.current = processId ? Number(processId) : null;
    const nextSearch = new URLSearchParams(searchParams);
    if (processId) {
      nextSearch.set('processId', String(processId));
    } else {
      nextSearch.delete('processId');
    }
    setSearchParams(nextSearch, { preventScrollReset: true, ...options });
  };
  const applyProcessForm = (process) => {
    setFormData({
      name: process?.name || '',
      description: process?.description || '',
      bpmn_xml: process?.bpmn_xml || '',
      category_id: toFormId(process?.category_id || ''),
      status: normalizeUiStatus(process?.status),
      assigned_designer_ids: getAssignedDesignerIds(process),
      assigned_validator_ids: getAssignedValidatorIds(process),
    });
  };
  const openEditDetails = async (process, { syncUrl = true } = {}) => {
    const processId = Number(process?.id);
    if (!Number.isInteger(processId) || processId <= 0) {
      return;
    }
    preserveScrollPosition();
    closingProcessRef.current = null;

    const openAttemptTime = Date.now();
    if (
      Number(lastOpenedProcessRef.current.id) === processId &&
      openAttemptTime - Number(lastOpenedProcessRef.current.at || 0) < 400
    ) {
      return;
    }

    const activeProcessId = Number(processDetail?.id || editingProcess?.id || 0);
    if (showModal && activeProcessId === processId) {
      lastOpenedProcessRef.current = { id: processId, at: openAttemptTime };
      return;
    }

    if (openingProcessRef.current === processId) {
      return;
    }

    lastOpenedProcessRef.current = { id: processId, at: openAttemptTime };
    openingProcessRef.current = processId;

    if (syncUrl) {
      syncProcessSearchParam(processId);
    }

    setEditingProcess(process);
    applyProcessForm(process);
    setWorkflowComment('');
    setVersionDiff(null);
    setWorkflowInfo(null);
    setProcessDetail(null);
    setShowModal(true);
    try {
      const detail = await hydrateProcessDetail(processId);
      applyProcessForm(detail);
      setEditingProcess(detail);
    } catch {
      showMsg('Failed to load process details', 'danger');
    } finally {
      if (openingProcessRef.current === processId) {
        openingProcessRef.current = null;
      }
    }
  };
  useEffect(() => {
    const processIdFromUrl = Number(searchParams.get('processId'));
    if (!Number.isInteger(processIdFromUrl) || processIdFromUrl <= 0) {
      syncedProcessParamRef.current = null;
      closingProcessRef.current = null;
      return;
    }

    if (syncedProcessParamRef.current === processIdFromUrl) {
      syncedProcessParamRef.current = null;
      return;
    }

    if (closingProcessRef.current === processIdFromUrl) {
      return;
    }

    if (openingProcessRef.current === processIdFromUrl || Number(editingProcess?.id) === processIdFromUrl) {
      return;
    }

    openEditDetails({ id: processIdFromUrl }, { syncUrl: false });
  }, [searchParams, editingProcess?.id, processDetail?.id, showModal]);
  const toggleCategory = (categoryId) => {
    const categoryRow = categoryRowRefs.current.get(Number(categoryId));
    if (categoryRow) {
      categoryToggleAnchorRef.current = {
        categoryId: Number(categoryId),
        top: categoryRow.getBoundingClientRect().top,
      };
    } else {
      preserveScrollPosition();
    }
    setCollapsedCategories((previous) => {
      const nextValue = !previous[categoryId];
      if (!nextValue) {
        return { ...previous, [categoryId]: false };
      }

      const next = { ...previous, [categoryId]: true };
      const category = categoryById.get(Number(categoryId));
      collectCategoryDescendantIds(category).forEach((descendantId) => {
        next[descendantId] = true;
      });
      return next;
    });
  };

  const handleBpmnSave = async (bpmnXml) => {
    if (!bpmnTarget) throw new Error('No process selected');
    const response = await fetch(`${API}/processes/${bpmnTarget.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: bpmnTarget.name,
        description: bpmnTarget.description || '',
        status: bpmnTarget.status,
        category_id: bpmnTarget.category_id || null,
        bpmn_xml: bpmnXml,
        change_description: 'Updated via BPMN editor',
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Save failed');
    }
    const updated = await response.json();
    setBpmnTarget((previous) => ({ ...previous, bpmn_xml: bpmnXml, version: updated.version }));
    loadProcesses();
  };

  const handleBpmnImportExisting = async (processId) => {
    const response = await fetch(`${API}/processes/${processId}`);
    if (!response.ok) {
      throw new Error('Failed to load the selected process diagram.');
    }

    const detail = await response.json();
    return {
      xml: detail?.bpmn_xml || '',
      name: detail?.name || 'Process',
    };
  };

  const buildDuplicateProcessName = (sourceProcess) => {
    const sourceName = String(sourceProcess?.name || 'Process').trim() || 'Process';
    const baseName = sourceName
      .replace(/^duplicata\s+/iu, '')
      .replace(/\s*\((\d+)\)\s*$/u, '')
      .trim() || sourceName;
    return `Duplicata ${baseName}`;
  };

  const handleDuplicateProcess = async (process, event = null) => {
    event?.stopPropagation?.();
    preserveScrollPosition();

    try {
      const response = await fetch(`${API}/processes/${process.id}`);
      if (!response.ok) {
        throw new Error('Failed to load the process to duplicate.');
      }

      const detail = await response.json();
      const duplicatePayload = {
        name: buildDuplicateProcessName(detail),
        description: detail.description || '',
        bpmn_xml: detail.bpmn_xml || '',
        category_id: detail.category_id || process.category_id,
        status: 'draft',
        assigned_designer_id: getAssignedDesignerIds(detail)[0] || null,
        assigned_validator_id: getAssignedValidatorIds(detail)[0] || null,
        assigned_designer_ids: getAssignedDesignerIds(detail),
        assigned_validator_ids: getAssignedValidatorIds(detail),
      };

      const createResponse = await fetch(`${API}/processes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(duplicatePayload),
      });

      const payload = await readApiPayload(createResponse, 'Failed to duplicate process.');
      await loadProcesses();
      showMsg(`Process "${payload.name}" created from duplicate.`);
    } catch (error) {
      showMsg(error.message || 'Failed to duplicate process.', 'danger');
    }
  };

  const openImportModal = () => {
    setImportForm({
      name: '',
      description: '',
      category_id: categoryOptions.length === 1 ? String(categoryOptions[0].id) : '',
      status: 'draft',
    });
    setImportFile(null);
    setImportError('');
    setImportSuccess('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setShowImport(true);
  };

  const dismissCategoryModal = () => {
    preserveScrollPosition();
    setShowCategoryModal(false);
    setEditingCategory(null);
    setCategoryError('');
  };

  const openCategoryModal = (parentId = '', preferredSection = DEFAULT_PROCESS_SECTION) => {
    preserveScrollPosition();
    const parentCategory = parentId ? categoryById.get(Number(parentId)) : null;
    setEditingCategory(null);
    setCategoryError('');
    setCategoryForm({
      name: '',
      description: '',
      parent_id: parentId ? String(parentId) : '',
      section: normalizeCategorySection(parentCategory?.section, normalizeCategorySection(preferredSection)),
    });
    setShowCategoryModal(true);
  };

  const openEditCategoryModal = (category) => {
    preserveScrollPosition();
    const parentCategory = category?.parent_id ? categoryById.get(Number(category.parent_id)) : null;
    setEditingCategory(category);
    setCategoryError('');
    setCategoryForm({
      name: category?.name || '',
      description: category?.description || '',
      parent_id: toFormId(category?.parent_id || ''),
      section: normalizeCategorySection(parentCategory?.section, category?.section),
    });
    setShowCategoryModal(true);
  };

  const handleProcessCategoryChange = (nextCategoryId) => {
    setFormData((previous) => ({
      ...previous,
      category_id: nextCategoryId,
    }));
  };

  const handleCategoryParentChange = (nextParentId) => {
    const parentCategory = nextParentId ? categoryById.get(Number(nextParentId)) : null;
    setCategoryForm((previous) => ({
      ...previous,
      parent_id: nextParentId,
      section: parentCategory
        ? normalizeCategorySection(parentCategory.section)
        : normalizeCategorySection(previous.section),
    }));
  };

  const handleCategorySubmit = async (event) => {
    event.preventDefault();
    setCategoryError('');
    if (!categoryForm.name.trim()) {
      setCategoryError('Category name is required.');
      return;
    }
    if (!categoryForm.parent_id && !categoryForm.section) {
      setCategoryError('A section is required for a root category.');
      return;
    }

    setCategoryBusy(true);
    preserveScrollPosition();
    try {
      const response = await fetch(editingCategory ? `${API}/process-categories/${editingCategory.id}` : `${API}/process-categories`, {
        method: editingCategory ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: categoryForm.name.trim(),
          description: categoryForm.description.trim() || null,
          parent_id: categoryForm.parent_id || null,
          section: categoryForm.section,
        }),
      });
      const payload = await readApiPayload(response, editingCategory ? 'Failed to update category.' : 'Failed to create category.');
      await Promise.all([loadCategories(), loadProcesses()]);
      showMsg(`Category "${payload.name}" ${editingCategory ? 'updated' : 'created'}.`);
      dismissCategoryModal();
    } catch (error) {
      setCategoryError(error.message || (editingCategory ? 'Failed to update category.' : 'Failed to create category.'));
    } finally {
      setCategoryBusy(false);
    }
  };

  const handleDeleteCategory = async (category) => {
    const confirmed = await confirmAction({
      title: 'Delete category',
      message: `Delete category "${category.name}"?`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) {
      return;
    }

    preserveScrollPosition();
    try {
      const response = await fetch(`${API}/process-categories/${category.id}`, { method: 'DELETE' });
      await readApiPayload(response, 'Failed to delete category.');
      await loadCategories();
      await loadProcesses();
      showMsg(`Category "${category.name}" deleted.`);
    } catch (error) {
      showMsg(error.message || 'Failed to delete category.', 'danger');
    }
  };

  const handleApplyTemplate = async (template) => {
    const resolvedCategoryId = template.category_id || categoryOptions[0]?.id || null;
    if (!resolvedCategoryId) {
      showMsg('Create a category first. Every process must belong to a category.', 'danger');
      return;
    }

    const proposedName = window.prompt('Process name', template.name);
    if (!proposedName) {
      return;
    }

    setApplyingTemplateId(template.id);
    try {
      const response = await fetch(`${API}/process-templates/${template.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: proposedName.trim(),
          category_id: resolvedCategoryId,
          create_simulation: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to apply template.');
      }

      await loadProcesses();
      setShowTemplates(false);
      showMsg(`Template "${template.name}" applied successfully.`);
      if (payload?.process?.id) {
        openEditDetails(payload.process);
      }
    } catch (error) {
      showMsg(error.message || 'Failed to apply template.', 'danger');
    } finally {
      setApplyingTemplateId(null);
    }
  };

  const closeProcessModal = () => {
    preserveScrollPosition();
    const closingProcessId = Number(processDetail?.id || editingProcess?.id || searchParams.get('processId') || 0);
    closingProcessRef.current = Number.isInteger(closingProcessId) && closingProcessId > 0 ? closingProcessId : null;
    setShowModal(false);
    setEditingProcess(null);
    setProcessDetail(null);
    setWorkflowInfo(null);
    setWorkflowComment('');
    setVersionDiff(null);
    setVersionSelection({ fromVersion: '', toVersion: '' });
    syncProcessSearchParam(null, { replace: true });
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.(bpmn|xml)$/i)) {
      setImportError('Invalid format. Only .bpmn and .xml files are accepted.');
      setImportFile(null);
      return;
    }
    setImportError('');
    setImportFile(file);
    setImportForm((previous) => ({ ...previous, name: previous.name || file.name.replace(/\.(bpmn|xml)$/i, '').replace(/[-_]/g, ' ') }));
  };

  const handleImportSubmit = async (event) => {
    event.preventDefault();
    setImportError('');
    setImportSuccess('');
    if (!importForm.name.trim()) return setImportError('Process name is required.');
    if (!importForm.category_id) return setImportError('Category is required.');
    if (!importFile) return setImportError('Please choose a BPMN or XML file.');
    setImporting(true);
    preserveScrollPosition();
    try {
      const form = new FormData();
      form.append('bpmnFile', importFile);
      form.append('name', importForm.name.trim());
      form.append('description', importForm.description || '');
      form.append('category_id', importForm.category_id);
      form.append('status', importForm.status);
      const response = await fetch(`${API}/processes/import`, { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Server error (${response.status})`);
      setImportSuccess(`"${data.name}" imported successfully (v${data.version || 1}).`);
      loadProcesses();
      setTimeout(() => setShowImport(false), 1800);
    } catch (error) {
      setImportError(error.message);
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirmAction({
      title: 'Delete process',
      message: 'Delete this process?',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    preserveScrollPosition();
    try {
      const response = await fetch(`${API}/processes/${id}`, { method: 'DELETE' });
      if (response.ok) {
        showMsg('Process deleted');
        loadProcesses();
      } else {
        const error = await response.json();
        showMsg(error.error || 'Delete failed', 'danger');
      }
    } catch {
      showMsg('Network error', 'danger');
    }
  };

  const handleBulkDelete = async () => {
    const deletableIds = selectedProcessIds.filter((selectedId) => {
      const process = processes.find((entry) => Number(entry.id) === Number(selectedId));
      return canDeleteProcessDefinition(process);
    });

    if (deletableIds.length === 0) {
      showMsg('Select at least one deletable process.', 'danger');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Delete processes',
      message: `Delete ${deletableIds.length} selected process${deletableIds.length > 1 ? 'es' : ''}?`,
      confirmLabel: 'Delete selected',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    preserveScrollPosition();
    try {
      const results = await Promise.all(
        deletableIds.map(async (processId) => {
          const response = await fetch(`${API}/processes/${processId}`, { method: 'DELETE' });
          const payload = await response.json().catch(() => ({}));
          return {
            id: processId,
            ok: response.ok,
            error: payload?.error || 'Delete failed',
          };
        })
      );

      const failures = results.filter((result) => !result.ok);
      const deletedCount = results.length - failures.length;

      if (deletedCount > 0) {
        showMsg(`${deletedCount} process${deletedCount > 1 ? 'es' : ''} deleted.`);
      }

      if (failures.length > 0) {
        showMsg(failures[0].error || 'Some processes could not be deleted.', 'danger');
      }

      await loadProcesses();
      setSelectedProcessIds((current) => current.filter((id) => failures.some((failure) => Number(failure.id) === Number(id))));
    } catch {
      showMsg('Network error', 'danger');
    }
  };

  const handleBulkArchive = async () => {
    const archivableIds = selectedProcessIds.filter((selectedId) => {
      const process = processes.find((entry) => Number(entry.id) === Number(selectedId));
      return canArchiveProcess(process);
    });

    if (archivableIds.length === 0) {
      showMsg('Select at least one archivable process.', 'danger');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Archive processes',
      message: `Archive ${archivableIds.length} selected process${archivableIds.length > 1 ? 'es' : ''}?`,
      confirmLabel: 'Archive selected',
      confirmVariant: 'warning',
    });
    if (!confirmed) return;

    preserveScrollPosition();
    try {
      const results = await Promise.all(
        archivableIds.map(async (processId) => {
          const response = await fetch(`${API}/processes/${processId}/workflow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'archive', comment: '' }),
          });
          const payload = await response.json().catch(() => ({}));
          return {
            id: processId,
            ok: response.ok,
            error: payload?.error || 'Archive failed',
          };
        })
      );

      const failures = results.filter((result) => !result.ok);
      const archivedCount = results.length - failures.length;

      if (archivedCount > 0) {
        showMsg(`${archivedCount} process${archivedCount > 1 ? 'es' : ''} archived.`, 'warning');
      }

      if (failures.length > 0) {
        showMsg(failures[0].error || 'Some processes could not be archived.', 'danger');
      }

      await loadProcesses();
      setSelectedProcessIds((current) => current.filter((id) => failures.some((failure) => Number(failure.id) === Number(id))));
    } catch {
      showMsg('Network error', 'danger');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData.name) return showMsg('Process name is required', 'danger');
    if (!formData.category_id) return showMsg('Category is required.', 'danger');
    if (formData.assigned_validator_ids.length === 0) return showMsg('At least one assigned process manager is required.', 'danger');
    preserveScrollPosition();
    try {
      const url = editingProcess ? `${API}/processes/${editingProcess.id}` : `${API}/processes`;
      const method = editingProcess ? 'PUT' : 'POST';
      const payload = {
        ...formData,
        assigned_designer_id: formData.assigned_designer_ids[0] || null,
        assigned_validator_id: formData.assigned_validator_ids[0] || null,
        assigned_designer_ids: formData.assigned_designer_ids,
        assigned_validator_ids: formData.assigned_validator_ids,
      };
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (response.ok) {
        await response.json();
        showMsg(`Process ${editingProcess ? 'updated' : 'created'}`);
        await loadProcesses();
        closeProcessModal();
      } else {
        const error = await response.json();
        showMsg(error.error || 'Save failed', 'danger');
      }
    } catch {
      showMsg('Network error', 'danger');
    }
  };

  const handleWorkflowAction = async (action, targetProcess = editingProcess) => {
    if (!targetProcess) return;
    if (['request_change', 'return_draft'].includes(action) && !workflowComment.trim()) {
      showMsg('Please add a comment for this workflow action.', 'danger');
      return;
    }
    setWorkflowBusy(action);
    try {
      const response = await fetch(`${API}/processes/${targetProcess.id}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment: workflowComment }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Workflow update failed');
      }

      setWorkflowInfo(payload.workflow);
      setProcessDetail(payload.process);
      setEditingProcess(payload.process);
      setFormData((previous) => ({ ...previous, status: normalizeUiStatus(payload.process.status) }));
      setWorkflowComment('');
      setVersionDiff(null);
      await hydrateProcessDetail(payload.process.id);
      await loadProcesses();
      showMsg('Workflow updated');
    } catch (error) {
      showMsg(error.message || 'Workflow update failed', 'danger');
    } finally {
      setWorkflowBusy('');
    }
  };

  const loadVersionDiff = async () => {
    if (!editingProcess || !versionSelection.fromVersion || !versionSelection.toVersion) {
      return;
    }

    setDiffLoading(true);
    try {
      const response = await fetch(
        `${API}/processes/${editingProcess.id}/diff?fromVersion=${versionSelection.fromVersion}&toVersion=${versionSelection.toVersion}`
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to compare versions');
      }
      setVersionDiff(payload);
    } catch (error) {
      showMsg(error.message || 'Failed to compare versions', 'danger');
    } finally {
      setDiffLoading(false);
    }
  };

  const handleExport = async (id, version = null) => {
    try {
      const suffix = version ? `?version=${version}` : '';
      const response = await fetchProtectedProcessAsset(`${API}/processes/${id}/export${suffix}`);
      if (!response.ok) {
        await readApiPayload(response, 'Export failed');
        return;
      }
      const blob = await response.blob();
      const filename = parseFilenameFromDisposition(response.headers.get('Content-Disposition'), 'process.bpmn');
      downloadBlob(blob, filename);
    } catch (error) {
      showMsg(error.message || 'Network error', 'danger');
    }
  };

  const renderProcessDiagramImage = async (id, { version = null, mimeType = 'image/png', quality = 0.92 } = {}) => {
    let viewer;
    let mountNode;
    let svgUrl;

    const suffix = version ? `?version=${version}` : '';
    const response = await fetchProtectedProcessAsset(`${API}/processes/${id}/export${suffix}`);
    if (!response.ok) {
      await readApiPayload(response, 'Image export failed');
      return null;
    }

    try {
      const xml = await response.text();
      const sourceFilename = parseFilenameFromDisposition(response.headers.get('Content-Disposition'), `process-${id}.bpmn`);
      const { default: NavigatedViewer } = await import('bpmn-js/lib/NavigatedViewer');

      mountNode = document.createElement('div');
      mountNode.style.cssText = 'position:fixed;left:-20000px;top:0;width:1800px;height:1200px;pointer-events:none;opacity:0;';
      document.body.appendChild(mountNode);

      viewer = new NavigatedViewer({
        container: mountNode,
        width: 1800,
        height: 1200,
      });

      await viewer.importXML(xml);
      viewer.get('canvas')?.zoom('fit-viewport');

      const { svg } = await viewer.saveSVG();
      const viewBox = svg.match(/viewBox="([^"]+)"/i)?.[1]?.split(/\s+/).map(Number) || [];
      const width = Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? Math.ceil(viewBox[2]) : 1800;
      const height = Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? Math.ceil(viewBox[3]) : 1200;
      const scale = 2;

      svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const image = await new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new Error('Unable to render BPMN diagram as image.'));
        candidate.src = svgUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext('2d');
      context.scale(scale, scale);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      const imageBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Unable to create a diagram image.'));
          }
        }, mimeType, quality);
      });

      return {
        blob: imageBlob,
        filename: replaceExtension(sourceFilename, mimeType === 'image/png' ? '.png' : '.jpg'),
      };
    } catch (error) {
      throw error;
    } finally {
      if (viewer) {
        viewer.destroy();
      }
      if (mountNode?.parentNode) {
        mountNode.parentNode.removeChild(mountNode);
      }
      if (svgUrl) {
        URL.revokeObjectURL(svgUrl);
      }
    }
  };

  const handleImageExport = async (id, version = null) => {
    try {
      const rendered = await renderProcessDiagramImage(id, { version, mimeType: 'image/png' });
      if (!rendered) {
        return;
      }

      downloadBlob(rendered.blob, rendered.filename);
    } catch (error) {
      showMsg(error.message || 'Image export failed', 'danger');
    }
  };

  const handleProcessReportDownload = async (id, format = 'pdf') => {
    setProcessReportBusy(format);
    try {
      let diagramImageDataUrl = null;
      if (format === 'pdf') {
        const rendered = await renderProcessDiagramImage(id, { mimeType: 'image/jpeg', quality: 0.9 });
        if (!rendered?.blob) {
          throw new Error('Diagram preview could not be rendered for the PDF export.');
        }
        diagramImageDataUrl = await blobToDataUrl(rendered.blob);
      }

      const requestOptions =
        format === 'pdf'
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                format,
                diagramImageDataUrl,
              }),
            }
          : undefined;

      const response = await fetchProtectedProcessAsset(
        format === 'pdf' ? `${API}/processes/${id}/report` : `${API}/processes/${id}/report?format=${format}`,
        requestOptions
      );
      if (!response.ok) {
        await readApiPayload(response, 'Export failed');
        return;
      }
      const blob = await response.blob();
      const filename =
        response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') ||
        `process-${id}-explanation.${format === 'pdf' ? 'pdf' : 'html'}`;
      const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: filename,
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      showMsg(error.message || 'Export failed', 'danger');
    } finally {
      setProcessReportBusy('');
    }
  };

  const categoryTree = useMemo(() => buildCategoryTree(categories), [categories]);
  const categoryOptions = useMemo(() => flattenCategoryTree(categories), [categories]);
  const categoryById = categoryTree.byId;
  const editingCategoryDescendantIds = useMemo(
    () => collectCategoryDescendantIds(categoryById.get(Number(editingCategory?.id || 0)) || null),
    [categoryById, editingCategory?.id]
  );
  const categoryParentOptions = useMemo(
    () => categoryOptions.filter((categoryOption) => {
      if (!editingCategory) {
        return true;
      }

      const categoryId = Number(categoryOption.id);
      return categoryId !== Number(editingCategory.id) && !editingCategoryDescendantIds.has(categoryId);
    }),
    [categoryOptions, editingCategory, editingCategoryDescendantIds]
  );
  const categoryRootsBySection = useMemo(() => {
    const grouped = Object.fromEntries(PROCESS_SECTION_CONFIG.map((section) => [section.key, []]));
    categoryTree.roots.forEach((category) => {
      grouped[normalizeCategorySection(category.section)].push(category);
    });
    return grouped;
  }, [categoryTree]);
  const processesByCategory = useMemo(() => {
    const next = new Map();
    processes.forEach((process) => {
      const key = String(process.category_id || '');
      if (!next.has(key)) {
        next.set(key, []);
      }
      next.get(key).push(process);
    });
    return next;
  }, [processes]);
  const getCategoryLabel = (process) => {
    const category = categoryById.get(Number(process.category_id));
    return category?.path?.join(' > ') || process.category_name || null;
  };
  const uncategorised = processes.filter((process) => !process.category_id);
  const countProcessesInCategoryBranch = (category) => {
    const directProcesses = processesByCategory.get(String(category.id)) || [];
    return directProcesses.length + category.children.reduce((total, childCategory) => total + countProcessesInCategoryBranch(childCategory), 0);
  };
  const selectedProcessCount = selectedProcessIds.length;
  const selectableProcesses = processes.filter((process) => canDeleteProcessDefinition(process));
  const selectableProcessIds = selectableProcesses.map((process) => Number(process.id));
  const areAllSelectableProcessesSelected =
    selectableProcessIds.length > 0 && selectableProcessIds.every((processId) => selectedProcessIds.includes(processId));
  const toggleSelectAllProcesses = (checked) => {
    if (checked) {
      setSelectedProcessIds(selectableProcessIds);
      return;
    }
    clearProcessSelection();
  };
  const toggleSection = (sectionKey) => {
    preserveScrollPosition();
    setCollapsedSections((previous) => {
      const nextValue = !previous[sectionKey];
      return {
        ...previous,
        [sectionKey]: nextValue,
      };
    });
    setCollapsedCategories((previous) => {
      const isClosing = !collapsedSections[sectionKey];
      if (!isClosing) {
        return previous;
      }

      const next = { ...previous };
      const sectionCategories = categoryRootsBySection[sectionKey] || [];
      sectionCategories.forEach((category) => {
        next[category.id] = true;
        collectCategoryDescendantIds(category).forEach((descendantId) => {
          next[descendantId] = true;
        });
      });
      return next;
    });
  };
  const availableVersions = processDetail?.versions || [];
  const selectedProcessRecord = processDetail || editingProcess || null;
  const currentWorkflowStatus = normalizeUiStatus(workflowInfo?.status || formData.status);
  const workflowFlags = getWorkflowFlags(workflowInfo, currentWorkflowStatus);
  const workflowJourney = buildWorkflowJourney(workflowInfo, currentWorkflowStatus);
  const previewBpmnXml = processDetail?.bpmn_xml || editingProcess?.bpmn_xml || formData.bpmn_xml || '';
  const previewSubprocesses = useMemo(() => getBpmnSubprocesses(previewBpmnXml), [previewBpmnXml]);
  const previewSubprocessTrail = useMemo(
    () => buildBpmnSubprocessTrail(previewSubprocesses, previewRootElementId),
    [previewSubprocesses, previewRootElementId]
  );
  const activePreviewSubprocess = previewSubprocessTrail.length
    ? previewSubprocessTrail[previewSubprocessTrail.length - 1]
    : null;
  const canEditSelectedProcess = editingProcess ? canEditProcessDefinition(selectedProcessRecord) : canCreateDefinitions;

  useEffect(() => {
    setPreviewRootElementId(null);
  }, [editingProcess?.id, processDetail?.id, previewBpmnXml]);

  useEffect(() => {
    if (previewRootElementId && !previewSubprocesses.some((subprocess) => subprocess.id === previewRootElementId)) {
      setPreviewRootElementId(null);
    }
  }, [previewRootElementId, previewSubprocesses]);

  if (bpmnTarget) {
    return (
      <Suspense fallback={<ModelerFallback />}>
        <BpmnEditorModeler
          process={bpmnTarget}
          onClose={() => {
            setBpmnTarget(null);
            loadProcesses();
          }}
          onSave={handleBpmnSave}
          importOptions={processes
            .filter((process) => Number(process.id) !== Number(bpmnTarget.id))
            .map((process) => ({ id: process.id, name: process.name }))}
          onImportExisting={handleBpmnImportExisting}
          initialSubprocessId={bpmnTarget.initialSubprocessId}
        />
      </Suspense>
    );
  }

  if (!canViewWorkspace) {
    return <Container fluid className="py-4"><Alert variant="danger">You do not have permission to access processes.</Alert></Container>;
  }

  const CreateMenu = ({ defaultCategoryId = '', compact = false }) => (
    <Dropdown align="end" onClick={(event) => event.stopPropagation()}>
      <Dropdown.Toggle variant={compact ? 'outline-success' : 'success'} size="sm" style={compact ? { padding: '3px 7px' } : undefined}>
        <i className="bi bi-plus-lg" />
        {!compact ? <span className="ms-1">Add</span> : null}
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => openCategoryModal(defaultCategoryId)}>
          <i className="bi bi-diagram-2 me-2" />
          New category
        </Dropdown.Item>
        <Dropdown.Item onClick={() => openCreate(defaultCategoryId)}>
          <i className="bi bi-bezier2 me-2" />
          New process
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );

  const categoryIndentBase = 24;
  const categoryIndentStep = 34;
  const processContentOffset = 48;
  const processIndentForLevel = (indentLevel = 0) => (
    indentLevel > 0
      ? categoryIndentBase + ((indentLevel - 1) * categoryIndentStep) + processContentOffset
      : 16
  );
  const processSpacerWidthForLevel = (indentLevel = 0) => (
    indentLevel > 0 ? Math.max(processIndentForLevel(indentLevel) - 16, 0) : 0
  );

  const ProcessRow = ({ process, indentLevel = 0 }) => (
    <div
      className="d-flex align-items-center gap-2 py-2 pe-3"
      style={{
        borderBottom: '1px solid #f1f5f9',
        paddingLeft: 16,
        background: indentLevel > 0 ? '#fff7f7' : 'white',
        boxShadow: indentLevel > 0 ? 'inset 4px 0 0 #fecdd3' : 'none',
        cursor: 'pointer',
      }}
      role="button"
      tabIndex={0}
      onClick={() => openEditDetails(process)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openEditDetails(process);
        }
      }}
    >
      {selectionMode ? (
        canDeleteProcessDefinition(process) ? (
          <Form.Check
            type="checkbox"
            className="me-1"
            checked={selectedProcessIds.includes(Number(process.id))}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => toggleProcessSelection(process.id, event.target.checked)}
          />
        ) : (
          <div style={{ width: 22, flexShrink: 0 }} />
        )
      ) : null}
      {indentLevel > 0 ? <div style={{ width: processSpacerWidthForLevel(indentLevel), flexShrink: 0 }} /> : null}
      <i className="bi bi-bezier2 text-muted" style={{ fontSize: 15, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: '#1e293b', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{process.name}</span>
      <Badge bg={statusVariant(process.status)} style={{ fontSize: 10, flexShrink: 0 }}>{statusLabel(process.status)}</Badge>
      <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>v{process.version}</span>
      <div className="d-flex gap-1 ms-1" style={{ flexShrink: 0 }}>
        {canApproveProcess(process) ? (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); handleWorkflowAction('approve', process); }}
            title="Approve diagram"
            style={{ width: 30, height: 30, background: '#16a34a', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
          >
            <i className="bi bi-check-lg" />
          </button>
        ) : null}
        {canEditProcessDefinition(process) ? (
          <button type="button" onClick={(event) => { event.stopPropagation(); openBpmnEditor(process); }} title="Edit BPMN diagram" style={{ width: 30, height: 30, background: '#2563eb', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-pencil-fill" /></button>
        ) : null}
        {canCreateDefinitions ? (
          <button type="button" onClick={(event) => handleDuplicateProcess(process, event)} title="Duplicate process" style={{ width: 30, height: 30, background: '#0f766e', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-copy" /></button>
        ) : null}
        <button type="button" onClick={(event) => { event.stopPropagation(); openEditDetails(process); }} title="Open details and diagram" style={{ width: 30, height: 30, background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-info-circle" /></button>
        {canDeleteProcessDefinition(process) ? (
          <button type="button" onClick={(event) => { event.stopPropagation(); handleDelete(process.id); }} title="Delete" style={{ width: 30, height: 30, background: '#dc2626', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-trash" /></button>
        ) : null}
        <ExportMenu process={process} compact />
      </div>
    </div>
  );

  const ExportMenu = ({ process, version = null, compact = false }) => {
    if (publicView) {
      return null;
    }

    return (
    <Dropdown align="end" onClick={(event) => event.stopPropagation()}>
      <Dropdown.Toggle
        variant="outline-secondary"
        size="sm"
        style={compact ? { padding: '3px 7px' } : undefined}
      >
        <i className="bi bi-download" />
        {!compact ? <span className="ms-1">Export</span> : null}
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => handleExport(process.id, version)}>
          <i className="bi bi-filetype-xml me-2" />
          BPMN
        </Dropdown.Item>
        {!version ? (
          <Dropdown.Item onClick={() => handleImageExport(process.id)}>
            <i className="bi bi-image me-2" />
            Image (PNG)
          </Dropdown.Item>
        ) : null}
        {!version ? (
          <Dropdown.Item onClick={() => handleProcessReportDownload(process.id, 'pdf')}>
            <i className="bi bi-file-earmark-pdf me-2" />
            PDF
          </Dropdown.Item>
        ) : null}
      </Dropdown.Menu>
    </Dropdown>
    );
  };

  const CategoryBranch = ({ category, level = 0 }) => {
    const isCollapsed = !!collapsedCategories[category.id];
    const directProcesses = processesByCategory.get(String(category.id)) || [];
    const childCount = category.children.length;
    const totalCount = directProcesses.length + childCount;

    return (
      <div key={category.id}>
        <div
          ref={(element) => registerCategoryRowRef(category.id, element)}
          className="d-flex align-items-center gap-2 py-2"
          style={{
            paddingLeft: categoryIndentBase + (level * categoryIndentStep),
            borderBottom: '1px solid #f1f5f9',
            background: level === 0 ? 'white' : '#fffaf5',
          }}
        >
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleCategory(category.id)}
            className="d-flex align-items-center gap-2 flex-grow-1 text-start"
            style={{ background: 'none', border: 'none', padding: 0 }}
          >
            <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-down'}`} style={{ color: '#6c757d', fontSize: 12 }} />
            <i className={`bi ${level === 0 ? 'bi-diagram-3' : 'bi-diagram-2'} text-muted`} />
            <span style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>{category.name}</span>
            <Badge bg="light" text="dark" pill className="ms-auto">{totalCount}</Badge>
          </button>
          {canCreateDefinitions ? (
            <>
              <div className="me-1">
                <CreateMenu defaultCategoryId={String(category.id)} compact />
              </div>
              <button
                type="button"
                className="me-1"
                title="Edit category"
                onClick={() => openEditCategoryModal(category)}
                style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 15, padding: '0 4px' }}
              >
                <i className="bi bi-pencil" />
              </button>
              {canDeleteCategoryDefinition(category) ? (
                <button
                  type="button"
                  className="me-2"
                  title="Delete category"
                  onClick={() => handleDeleteCategory(category)}
                  style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 15, padding: '0 4px' }}
                >
                  <i className="bi bi-trash" />
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        {!isCollapsed && (
          <>
            {category.children.map((childCategory) => (
              <CategoryBranch key={childCategory.id} category={childCategory} level={level + 1} />
            ))}
            {directProcesses.length === 0 && childCount === 0 ? (
              <div style={{ padding: `6px 16px 6px ${processIndentForLevel(level + 1)}px`, fontSize: 11, color: '#94a3b8', borderBottom: '1px solid #f8fafc', background: '#fff7f7', boxShadow: 'inset 4px 0 0 #fecdd3' }}>
                No processes
              </div>
            ) : (
              directProcesses.map((process) => <ProcessRow key={process.id} process={process} indentLevel={level + 1} />)
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <Container fluid className="py-4">
      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <h4 className="mb-0 fw-bold">{publicView ? 'Cartographie des processus' : 'Processus'}</h4>
              {publicView ? <div className="text-muted small mt-1">Mode consultation publique</div> : null}
            </div>
            <div className="d-flex gap-2">
              {!publicView ? (
                <Button
                  variant={filterStatus === 'archived' ? 'dark' : 'outline-secondary'}
                  size="sm"
                  onClick={() => {
                    setFilterStatus((previous) => (previous === 'archived' ? '' : 'approved'));
                    setViewMode('list');
                  }}
                >
                  <i className="bi bi-archive me-1" />
                  {filterStatus === 'archived' ? 'Back To Live' : 'Archived Processes'}
                </Button>
              ) : null}
              {canCreateDefinitions ? (
                <>
                  <Button variant="outline-primary" size="sm" onClick={() => setShowTemplates(true)}>
                    <i className="bi bi-grid me-1" />Templates
                  </Button>
                  <Button variant="outline-success" size="sm" onClick={openImportModal}><i className="bi bi-upload me-1" />Import</Button>
                  <CreateMenu />
                </>
              ) : (
                <Badge bg="light" text="dark" className="align-self-center">{publicView ? 'Portail public' : 'Read only'}</Badge>
              )}
            </div>
          </div>
        </Col>
      </Row>

      <Row className="mb-3">
        <Col>
          <Card className="border-0 shadow-sm">
            <Card.Body className="py-2 px-3">
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <div className="btn-group btn-group-sm">
                  <button type="button" className={`btn ${viewMode === 'hierarchy' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setViewMode('hierarchy')}><i className="bi bi-diagram-3 me-1" />Hierarchie</button>
                  <button type="button" className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setViewMode('list')}><i className="bi bi-list-ul me-1" />Liste</button>
                </div>
                <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />
                <InputGroup size="sm" style={{ maxWidth: 280 }}>
                  <InputGroup.Text className="bg-white"><i className="bi bi-search text-muted" /></InputGroup.Text>
                  <FormControl placeholder="Rechercher..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className="border-start-0" />
                </InputGroup>
                <Form.Select size="sm" style={{ maxWidth: 180 }} value={filterCat} onChange={(event) => setFilterCat(event.target.value)}>
                  <option value="">Toutes categories</option>
                  {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.pathLabel}</option>)}
                </Form.Select>
                {!publicView ? (
                  <Form.Select size="sm" style={{ maxWidth: 140 }} value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
                    <option value="">Tous statuts</option>
                    <option value="draft">Draft</option>
                    <option value="review">In Review</option>
                    <option value="approved">Approved</option>
                    <option value="archived">Archived</option>
                  </Form.Select>
                ) : (
                  <Badge bg="success">Approved only</Badge>
                )}
                {filterStatus === 'archived' ? (
                  <Badge bg="dark">Archive view</Badge>
                ) : null}
                {!publicView && selectableProcessIds.length > 0 ? (
                  <>
                    {!selectionMode ? (
                      <Button size="sm" variant="outline-danger" onClick={() => setSelectionMode(true)}>
                        <i className="bi bi-check2-square me-1" />
                        Select processes
                      </Button>
                    ) : (
                      <>
                        <Form.Check
                          type="checkbox"
                          label="Select all"
                          checked={areAllSelectableProcessesSelected}
                          onChange={(event) => toggleSelectAllProcesses(event.target.checked)}
                        />
                        <Badge bg="primary">{selectedProcessCount} selected</Badge>
                        <Button size="sm" variant="warning" onClick={handleBulkArchive}>
                          <i className="bi bi-archive me-1" />
                          Archive selected
                        </Button>
                        <Button size="sm" variant="danger" onClick={handleBulkDelete}>
                          <i className="bi bi-trash me-1" />
                          Delete selected
                        </Button>
                        <Button size="sm" variant="outline-secondary" onClick={disableSelectionMode}>
                          Cancel
                        </Button>
                      </>
                    )}
                  </>
                ) : null}
                <Badge bg="secondary" className="ms-auto">{processes.length} processus</Badge>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {filterStatus === 'archived' ? (
        <Row className="mb-3">
          <Col>
            <Alert variant="dark" className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-0">
              <span>You are viewing archived processes only.</span>
              <Button size="sm" variant="outline-light" onClick={() => setFilterStatus('')}>
                Return to active workspace
              </Button>
            </Alert>
          </Col>
        </Row>
      ) : null}

      {loading ? (
        <div className="text-center py-5"><div className="spinner-border text-danger" role="status" /><p className="mt-2 text-muted small">Chargement...</p></div>
      ) : viewMode === 'hierarchy' ? (
        <Row>
          <Col>
            {uncategorised.length > 0 ? (
              <Alert variant="warning" className="mb-3">
                <div className="fw-semibold mb-2">Legacy processes still need a category</div>
                <div className="small mb-2">Every process now has to live under a category. Open these items and assign one:</div>
                <div className="d-flex flex-wrap gap-2">
                  {uncategorised.map((process) => (
                    <Button key={process.id} size="sm" variant="outline-dark" onClick={() => openEditDetails(process)}>
                      {process.name}
                    </Button>
                  ))}
                </div>
              </Alert>
            ) : null}

            <div className="d-flex flex-column gap-3">
              {PROCESS_SECTION_CONFIG.map((section) => {
                const sectionCategories = categoryRootsBySection[section.key] || [];
                const sectionProcessCount = sectionCategories.reduce(
                  (total, category) => total + countProcessesInCategoryBranch(category),
                  0
                );
                const isSectionCollapsed = !!collapsedSections[section.key];

                return (
                  <div key={section.key}>
                    <Card className="border-0 shadow-sm">
                      <Card.Header className="bg-light border-0 d-flex justify-content-between align-items-center flex-wrap gap-2 py-3">
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => toggleSection(section.key)}
                          className="d-flex align-items-center gap-2 text-start flex-grow-1"
                          style={{ background: 'none', border: 'none', padding: 0 }}
                        >
                          <i className={`bi ${isSectionCollapsed ? 'bi-chevron-right' : 'bi-chevron-down'} text-muted`} style={{ fontSize: 12 }} />
                          <i className={`bi ${section.icon} text-danger`} />
                          <div>
                            <div className="fw-semibold">{section.label}</div>
                            <div className="text-muted small">
                              {sectionCategories.length} categorie(s) - {sectionProcessCount} processus
                            </div>
                          </div>
                        </button>
                        {canCreateDefinitions ? (
                          <Button size="sm" variant="outline-success" onClick={() => openCategoryModal('', section.key)}>
                            <i className="bi bi-plus-lg me-1" />
                            New category
                          </Button>
                        ) : null}
                      </Card.Header>
                      {!isSectionCollapsed ? (
                      <Card.Body className="p-0">
                        {sectionCategories.length === 0 ? (
                          <div className="text-muted small px-3 py-4">
                            No categories in this section yet.
                          </div>
                        ) : (
                          sectionCategories.map((category) => (
                            <CategoryBranch key={category.id} category={category} />
                          ))
                        )}
                      </Card.Body>
                      ) : null}
                    </Card>
                  </div>
                );
              })}
            </div>
          </Col>
        </Row>
      ) : (
        <Row><Col><Card className="border-0 shadow-sm"><div style={{ overflowX: 'auto' }}>
          <table className="table table-hover mb-0" style={{ minWidth: 650 }}>
            <thead className="table-light"><tr>{selectionMode ? <th style={{ width: 48 }}><Form.Check type="checkbox" checked={areAllSelectableProcessesSelected} onChange={(event) => toggleSelectAllProcesses(event.target.checked)} disabled={selectableProcessIds.length === 0} /></th> : null}<th>Name</th><th>Category</th><th>Status</th><th>Version</th><th>Updated</th><th style={{ width: 150 }}>Actions</th></tr></thead>
            <tbody>
              {processes.length === 0 ? <tr><td colSpan={selectionMode ? 7 : 6} className="text-center py-4 text-muted">No processes found</td></tr> : processes.map((process) => (
                <tr
                  key={process.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openEditDetails(process)}
                >
                  {selectionMode ? (
                    <td onClick={(event) => event.stopPropagation()}>
                      {canDeleteProcessDefinition(process) ? (
                        <Form.Check
                          type="checkbox"
                          checked={selectedProcessIds.includes(Number(process.id))}
                          onChange={(event) => toggleProcessSelection(process.id, event.target.checked)}
                        />
                      ) : null}
                    </td>
                  ) : null}
                  <td><strong>{process.name}</strong></td>
                  <td>{getCategoryLabel(process) || <span className="text-muted">-</span>}</td>
                  <td><Badge bg={statusVariant(process.status)}>{statusLabel(process.status)}</Badge></td>
                  <td>v{process.version}</td>
                  <td>{process.updated_at ? new Date(process.updated_at).toLocaleDateString() : '-'}</td>
                  <td><div className="d-flex gap-1">
                    {canApproveProcess(process) ? (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); handleWorkflowAction('approve', process); }}
                        className="btn btn-success btn-sm"
                        style={{ padding: '3px 7px' }}
                        title="Approve diagram"
                      >
                        <i className="bi bi-check-lg" />
                      </button>
                    ) : null}
                    {canEditProcessDefinition(process) ? (
                      <button type="button" onClick={(event) => { event.stopPropagation(); openBpmnEditor(process); }} className="btn btn-primary btn-sm" style={{ padding: '3px 7px' }}><i className="bi bi-pencil-fill" /></button>
                    ) : null}
                    {canCreateDefinitions ? (
                      <button type="button" onClick={(event) => handleDuplicateProcess(process, event)} className="btn btn-success btn-sm" style={{ padding: '3px 7px' }} title="Duplicate process"><i className="bi bi-copy" /></button>
                    ) : null}
                    <button type="button" onClick={(event) => { event.stopPropagation(); openEditDetails(process); }} className="btn btn-outline-primary btn-sm" style={{ padding: '3px 7px' }}><i className="bi bi-info-circle" /></button>
                    <ExportMenu process={process} compact />
                    {canDeleteProcessDefinition(process) ? (
                      <button type="button" onClick={(event) => { event.stopPropagation(); handleDelete(process.id); }} className="btn btn-danger btn-sm" style={{ padding: '3px 7px' }}><i className="bi bi-trash" /></button>
                    ) : null}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></Card></Col></Row>
      )}

      <Modal show={showModal} onHide={closeProcessModal} size="xl">
        <Modal.Header closeButton>
          <Modal.Title>{editingProcess ? 'Process Details' : 'New Process'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleSubmit}>
            {editingProcess && (
              <Row className="g-4 mb-1">
                <Col lg={12}>
                  <Card className="border-0 shadow-sm">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                        <div>
                          <h6 className="mb-1">Diagram preview</h6>
                          <div className="text-muted small">The BPMN diagram is shown as an image snapshot at the top of the process sheet.</div>
                        </div>
                        <div className="d-flex gap-2 flex-wrap">
                          {canApproveProcess(selectedProcessRecord) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="success"
                              onClick={() => handleWorkflowAction('approve', editingProcess)}
                              disabled={workflowBusy === 'approve'}
                            >
                              {workflowBusy === 'approve' ? 'Approving...' : 'Approve diagram'}
                            </Button>
                          ) : null}
                          {!publicView ? (
                            <>
                              <Button type="button" size="sm" variant="outline-secondary" onClick={() => handleImageExport(editingProcess.id)}>
                                PNG
                              </Button>
                              <Button type="button" size="sm" variant="outline-dark" onClick={() => handleExport(editingProcess.id)}>
                                BPMN
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline-dark"
                                onClick={() => handleProcessReportDownload(editingProcess.id, 'html')}
                                disabled={processReportBusy === 'html'}
                              >
                                {processReportBusy === 'html' ? 'Exporting...' : 'HTML'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline-secondary"
                                onClick={() => handleProcessReportDownload(editingProcess.id, 'pdf')}
                                disabled={processReportBusy === 'pdf'}
                              >
                                {processReportBusy === 'pdf' ? 'Exporting...' : 'PDF'}
                              </Button>
                            </>
                          ) : null}
                          {canEditSelectedProcess ? (
                            <Button type="button" size="sm" variant="primary" onClick={() => openBpmnEditor(editingProcess)}>
                              Edit diagram
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <Suspense fallback={<div className="text-muted small">Loading BPMN preview...</div>}>
                        <BpmnProcessPreview xml={previewBpmnXml} rootElementId={previewRootElementId} />
                      </Suspense>
                      {previewSubprocesses.length ? (
                        <div className="border rounded-4 p-3 mt-3" style={{ background: '#fffdfa' }}>
                          <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-3">
                            <div>
                              <h6 className="mb-1">Embedded sous-processes</h6>
                              <div className="text-muted small">Open the same internal BPMN level that the drilldown arrow opens inside the editor.</div>
                            </div>
                            {canEditSelectedProcess ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline-primary"
                                onClick={() => openBpmnEditor(editingProcess, previewRootElementId)}
                              >
                                {activePreviewSubprocess ? 'Edit this sous-process' : 'Edit main diagram'}
                              </Button>
                            ) : null}
                          </div>

                          <div className="d-flex flex-wrap gap-2 mb-3">
                            <Button
                              type="button"
                              size="sm"
                              variant={previewRootElementId ? 'outline-secondary' : 'danger'}
                              onClick={() => setPreviewRootElementId(null)}
                            >
                              Main diagram
                            </Button>
                            {previewSubprocessTrail.map((subprocess) => (
                              <Button
                                key={subprocess.id}
                                type="button"
                                size="sm"
                                variant={previewRootElementId === subprocess.id ? 'danger' : 'outline-secondary'}
                                onClick={() => setPreviewRootElementId(subprocess.id)}
                              >
                                {subprocess.name}
                              </Button>
                            ))}
                          </div>

                          <div className="d-flex flex-column gap-2">
                            {previewSubprocesses.map((subprocess) => (
                              <button
                                key={subprocess.id}
                                type="button"
                                onClick={() => setPreviewRootElementId(subprocess.id)}
                                className="text-start border rounded-3 px-3 py-2 bg-white"
                                style={{
                                  borderColor: previewRootElementId === subprocess.id ? '#ef4444' : '#e2e8f0',
                                  boxShadow: previewRootElementId === subprocess.id ? 'inset 3px 0 0 #ef4444' : 'none',
                                }}
                              >
                                <div className="d-flex justify-content-between gap-3 align-items-start">
                                  <div>
                                    <div className="fw-semibold text-dark">{subprocess.name}</div>
                                    <div className="text-muted small">{subprocess.pathLabel}</div>
                                  </div>
                                  <span className="text-muted small">
                                    {subprocess.childCount > 0 ? `${subprocess.childCount} child view(s)` : 'Final view'}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            )}

            <Row className="g-4">
              <Col lg={editingProcess ? 6 : 12}>
                <Card className="border-0 bg-light-subtle">
                  <Card.Body>
                    {publicView && editingProcess ? (
                      <>
                        <div className="d-flex justify-content-between align-items-center mb-3">
                          <div>
                            <h6 className="mb-1">Description</h6>
                            <div className="text-muted small">Viewer mode only shows the process description with the diagram.</div>
                          </div>
                          <Badge bg={statusVariant(currentWorkflowStatus)}>{statusLabel(currentWorkflowStatus)}</Badge>
                        </div>
                        <Form.Group className="mb-0">
                          <Form.Label>Description</Form.Label>
                          <Form.Control as="textarea" rows={8} readOnly value={formData.description || 'No description available for this process.'} />
                        </Form.Group>
                      </>
                    ) : (
                      <>
                        <div className="d-flex justify-content-between align-items-center mb-3">
                          <div>
                            <h6 className="mb-1">Metadata</h6>
                            <div className="text-muted small">Name, category, description, and workflow status.</div>
                          </div>
                          {editingProcess && <Badge bg={statusVariant(currentWorkflowStatus)}>{statusLabel(currentWorkflowStatus)}</Badge>}
                        </div>

                        <Form.Group className="mb-3">
                          <Form.Label>Name *</Form.Label>
                          <Form.Control required disabled={!canEditSelectedProcess} value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} />
                        </Form.Group>
                        <Form.Group className="mb-3">
                          <Form.Label>Description</Form.Label>
                          <Form.Control as="textarea" rows={3} disabled={!canEditSelectedProcess} value={formData.description} onChange={(event) => setFormData({ ...formData, description: event.target.value })} />
                        </Form.Group>
                        <Row>
                          <Col md={6}>
                            <Form.Group className="mb-3">
                              <Form.Label>Category *</Form.Label>
                              <Form.Select required disabled={!canEditSelectedProcess} value={formData.category_id} onChange={(event) => handleProcessCategoryChange(event.target.value)}>
                                <option value="">Select category</option>
                                {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.pathLabel}</option>)}
                              </Form.Select>
                            </Form.Group>
                          </Col>
                          <Col md={6}>
                            <Form.Group className="mb-3">
                              <Form.Label>Status</Form.Label>
                              <Form.Control value={statusLabel(currentWorkflowStatus)} readOnly />
                            </Form.Group>
                          </Col>
                        </Row>
                        <Row>
                          <Col md={6}>
                            <Form.Group className="mb-3">
                              <Form.Label>Assigned process designer</Form.Label>
                              {renderGovernanceChecklist({
                                options: governanceOptions.designers,
                                selectedIds: formData.assigned_designer_ids,
                                disabled: !canManageProcessAssignments,
                                onToggle: (assigned_designer_ids) => setFormData({ ...formData, assigned_designer_ids }),
                                emptyLabel: 'No process designers are available yet.',
                                inputPrefix: 'process-designer',
                              })}
                              <div className="text-muted small mt-1">
                                Choose one or more people who can edit the process while it is in draft.
                              </div>
                            </Form.Group>
                          </Col>
                          <Col md={6}>
                            <Form.Group className="mb-3">
                              <Form.Label>Assigned process manager *</Form.Label>
                              {renderGovernanceChecklist({
                                options: governanceOptions.validators,
                                selectedIds: formData.assigned_validator_ids,
                                disabled: !canManageProcessAssignments,
                                onToggle: (assigned_validator_ids) => setFormData({ ...formData, assigned_validator_ids }),
                                emptyLabel: 'No process managers are available yet.',
                                inputPrefix: 'process-manager',
                              })}
                              <div className="text-muted small mt-1">
                                Choose one or more people who can validate, reopen, archive, and edit the process.
                              </div>
                            </Form.Group>
                          </Col>
                        </Row>
                        {governanceLoading ? <div className="text-muted small">Loading governance options...</div> : null}
                      </>
                    )}
                  </Card.Body>
                </Card>
              </Col>

              {editingProcess && !publicView && (
                <Col lg={6}>
                  <Card className="border-0 shadow-sm h-100">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-center mb-3">
                        <div>
                          <h6 className="mb-1">Approval Workflow</h6>
                          <div className="text-muted small">Submit, approve, archive, and keep review comments with timestamps.</div>
                        </div>
                        {detailLoading && <div className="spinner-border spinner-border-sm text-danger" role="status" />}
                      </div>

                      <div className="d-flex flex-wrap gap-2 mb-3">
                        <Badge bg={statusVariant(currentWorkflowStatus)}>{statusLabel(currentWorkflowStatus)}</Badge>
                        {workflowInfo?.submitted_at && <Badge bg="light" text="dark">Submitted {new Date(workflowInfo.submitted_at).toLocaleDateString()}</Badge>}
                        {workflowInfo?.approved_by_name && <Badge bg="success-subtle" text="dark">Approved by {workflowInfo.approved_by_name}</Badge>}
                        {workflowInfo?.archived_at && <Badge bg="warning" text="dark">Archived {new Date(workflowInfo.archived_at).toLocaleDateString()}</Badge>}
                      </div>

                      <div className="border rounded-3 p-3 bg-light mb-3">
                        <div className="small text-uppercase text-muted fw-semibold mb-2">Workflow path</div>
                        <div className="d-flex flex-wrap gap-2">
                          {workflowJourney.map((step) => (
                            <Badge key={step.key} bg={step.current ? 'danger' : step.reached ? 'dark' : 'light'} text={step.reached || step.current ? undefined : 'dark'}>
                              {step.label}
                            </Badge>
                          ))}
                        </div>
                        <div className="text-muted small mt-2">
                          Current step: {workflowJourney.find((step) => step.current)?.label || statusLabel(currentWorkflowStatus)}
                        </div>
                      </div>

                      {!publicView ? (
                        <Form.Group className="mb-3">
                          <Form.Label>Workflow comment</Form.Label>
                          <Form.Control
                            as="textarea"
                            rows={3}
                            placeholder="Add the governance note that accompanies this workflow action."
                            value={workflowComment}
                            onChange={(event) => setWorkflowComment(event.target.value)}
                          />
                          <div className="text-muted small mt-1">
                            Required when requesting a reopen or reopening the process to draft.
                          </div>
                        </Form.Group>
                      ) : null}

                      <div className="d-flex flex-wrap gap-2 mb-3">
                        {canSubmitForReview(selectedProcessRecord) && (
                          <Button variant="info" onClick={() => handleWorkflowAction('submit_review')} disabled={!!workflowBusy}>
                            {workflowBusy === 'submit_review' ? 'Submitting...' : 'Submit for review'}
                          </Button>
                        )}
                        {canApproveProcess(selectedProcessRecord) && (
                          <>
                            <Button variant="success" onClick={() => handleWorkflowAction('approve')} disabled={!!workflowBusy}>
                              {workflowBusy === 'approve' ? 'Approving...' : 'Approve'}
                            </Button>
                          </>
                        )}
                        {canReturnToDraft(selectedProcessRecord) && (
                          <>
                            <Button variant="outline-secondary" onClick={() => handleWorkflowAction('return_draft')} disabled={!!workflowBusy}>
                              {currentWorkflowStatus === 'approved' ? 'Reopen to draft' : 'Return to draft'}
                            </Button>
                          </>
                        )}
                        {canArchiveProcess(selectedProcessRecord) && (
                          <>
                            <Button variant="warning" onClick={() => handleWorkflowAction('archive')} disabled={!!workflowBusy}>
                              Archive
                            </Button>
                          </>
                        )}
                        {canRequestChange(selectedProcessRecord, workflowFlags) && (
                          <Button variant="outline-danger" onClick={() => handleWorkflowAction('request_change')} disabled={!!workflowBusy}>
                            {workflowBusy === 'request_change' ? 'Sending...' : 'Request reopen'}
                          </Button>
                        )}
                        {canRestoreProcess(selectedProcessRecord) && (
                          <Button variant="outline-primary" onClick={() => handleWorkflowAction('restore')} disabled={!!workflowBusy}>
                            Restore
                          </Button>
                        )}
                      </div>

                      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                        {(workflowInfo?.comments || []).length === 0 ? (
                          <div className="text-muted small">No workflow comments yet.</div>
                        ) : (
                          workflowInfo.comments.map((commentEntry) => (
                            <div key={commentEntry.id} className="border rounded-3 p-2 mb-2 bg-light">
                              <div className="d-flex justify-content-between gap-2">
                                <strong style={{ fontSize: 13 }}>{commentEntry.created_by_name || 'System'}</strong>
                                <span className="text-muted small">{new Date(commentEntry.created_at).toLocaleString()}</span>
                              </div>
                              <div className="text-muted small text-uppercase mt-1">{formatWorkflowActionLabel(commentEntry.action)}</div>
                              {commentEntry.comment && <div className="mt-1" style={{ fontSize: 13 }}>{commentEntry.comment}</div>}
                            </div>
                          ))
                        )}
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              )}
            </Row>

            {editingProcess && !publicView && (
              <Row className="g-4 mt-1">
                <Col lg={12}>
                  <Card className="border-0 shadow-sm">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                        <div>
                          <h6 className="mb-1">Version Diff</h6>
                          <div className="text-muted small">Compare metadata, BPMN structure, and task-level changes between any two saved versions.</div>
                        </div>
                        <div className="d-flex gap-2 flex-wrap">
                          <Form.Select
                            size="sm"
                            value={versionSelection.fromVersion}
                            onChange={(event) => setVersionSelection((previous) => ({ ...previous, fromVersion: event.target.value }))}
                          >
                            <option value="">From version</option>
                            {availableVersions.map((version) => (
                              <option key={`from-${version.version_number}`} value={version.version_number}>v{version.version_number}</option>
                            ))}
                          </Form.Select>
                          <Form.Select
                            size="sm"
                            value={versionSelection.toVersion}
                            onChange={(event) => setVersionSelection((previous) => ({ ...previous, toVersion: event.target.value }))}
                          >
                            <option value="">To version</option>
                            {availableVersions.map((version) => (
                              <option key={`to-${version.version_number}`} value={version.version_number}>v{version.version_number}</option>
                            ))}
                          </Form.Select>
                          <Button size="sm" variant="outline-dark" onClick={loadVersionDiff} disabled={diffLoading || !versionSelection.fromVersion || !versionSelection.toVersion}>
                            {diffLoading ? 'Comparing...' : 'Compare'}
                          </Button>
                        </div>
                      </div>

                      <div className="row g-3">
                        <div className="col-xl-4">
                          <div className="border rounded-3 p-3 h-100 bg-light">
                            <div className="fw-semibold mb-2">Version history</div>
                            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                              {availableVersions.map((version) => (
                                <div key={version.version_number} className="border rounded-3 bg-white p-2 mb-2">
                                  <div className="d-flex justify-content-between gap-2">
                                    <strong>v{version.version_number}</strong>
                                    <ExportMenu process={editingProcess} version={version.version_number} compact />
                                  </div>
                                  <div className="text-muted small mt-1">{version.change_description || 'Snapshot'}</div>
                                  <div className="small mt-2">{version.created_by_name || 'Unknown author'}</div>
                                  <div className="text-muted small">{version.created_at ? new Date(version.created_at).toLocaleString() : '-'}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="col-xl-8">
                          {!versionDiff ? (
                            <div className="border rounded-3 p-4 h-100 d-flex align-items-center justify-content-center text-muted bg-light">
                              Choose two versions to see the diff.
                            </div>
                          ) : (
                            <div className="border rounded-3 p-3 h-100">
                              <div className="d-flex flex-wrap gap-2 mb-3">
                                <Badge bg="dark">v{versionDiff.from.version_number}</Badge>
                                <span className="text-muted">to</span>
                                <Badge bg="danger">v{versionDiff.to.version_number}</Badge>
                                <Badge bg="secondary">{versionDiff.change_count} change(s)</Badge>
                              </div>

                              <div className="mb-3">
                                <div className="fw-semibold mb-2">Metadata changes</div>
                                {versionDiff.metadata_changes.length === 0 ? (
                                  <div className="text-muted small">No metadata changes.</div>
                                ) : (
                                  versionDiff.metadata_changes.map((change) => (
                                    <div key={change.field} className="small mb-1">
                                      <strong>{change.label}:</strong> <span className="text-muted">{String(change.from || '—')}</span> → <span>{String(change.to || '—')}</span>
                                    </div>
                                  ))
                                )}
                              </div>

                              <div className="mb-3">
                                <div className="fw-semibold mb-2">Task changes</div>
                                <div className="small text-muted mb-1">Added: {versionDiff.task_changes.added.length} · Removed: {versionDiff.task_changes.removed.length} · Renamed: {versionDiff.task_changes.renamed.length}</div>
                                {[...versionDiff.task_changes.added.slice(0, 4).map((task) => `+ ${task.task_name || task.task_id}`), ...versionDiff.task_changes.removed.slice(0, 4).map((task) => `- ${task.task_name || task.task_id}`), ...versionDiff.task_changes.renamed.slice(0, 4).map((task) => `~ ${task.from} → ${task.to}`)].map((line) => (
                                  <div key={line} className="small">{line}</div>
                                ))}
                              </div>

                              <div>
                                <div className="fw-semibold mb-2">BPMN structure</div>
                                <div className="small text-muted mb-1">
                                  XML changed: {versionDiff.bpmn_changes.xml_changed ? 'yes' : 'no'}
                                </div>
                                {versionDiff.bpmn_changes.changes.length === 0 ? (
                                  <div className="text-muted small">No BPMN structural changes detected.</div>
                                ) : (
                                  versionDiff.bpmn_changes.changes.map((change) => (
                                    <div key={change.metric} className="small">
                                      <strong>{change.metric}:</strong> {change.from} → {change.to}
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            )}

            <div className="d-flex justify-content-end gap-2 mt-4">
              <Button variant="secondary" onClick={closeProcessModal}>Close</Button>
              {canEditSelectedProcess ? (
                <Button type="submit" variant={editingProcess ? 'primary' : 'success'}>{editingProcess ? 'Save metadata' : 'Create'}</Button>
              ) : null}
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      <Modal show={showImport} onHide={() => !importing && setShowImport(false)} size="lg">
        <Modal.Header closeButton={!importing}><Modal.Title><i className="bi bi-upload me-2 text-primary" />Import BPMN file</Modal.Title></Modal.Header>
        <Modal.Body>
          {importError && <Alert variant="danger" dismissible onClose={() => setImportError('')}>{importError}</Alert>}
          {importSuccess && <Alert variant="success">{importSuccess}</Alert>}
          {!importSuccess && (
            <Form onSubmit={handleImportSubmit}>
              <div className="mb-4 text-center p-4 rounded-3" style={{ border: `2px dashed ${importFile ? '#198754' : '#dee2e6'}`, background: importFile ? '#f0fdf4' : '#f8f9fa', cursor: 'pointer', transition: 'all .2s' }} onClick={() => fileInputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); event.currentTarget.style.borderColor = '#0d6efd'; }} onDragLeave={(event) => { event.currentTarget.style.borderColor = importFile ? '#198754' : '#dee2e6'; }} onDrop={(event) => { event.preventDefault(); event.currentTarget.style.borderColor = importFile ? '#198754' : '#dee2e6'; handleFileChange({ target: { files: event.dataTransfer.files } }); }}>
                {importFile ? <><i className="bi bi-file-earmark-check text-success" style={{ fontSize: 40 }} /><p className="mt-2 mb-0 fw-bold text-success">{importFile.name}</p><p className="text-muted small mb-0">{(importFile.size / 1024).toFixed(1)} KB - click to change</p></> : <><i className="bi bi-cloud-upload text-muted" style={{ fontSize: 40 }} /><p className="mt-2 mb-1 fw-semibold">Drop a file here or click to browse</p><p className="text-muted small mb-0">Accepted formats: <code>.bpmn</code> and <code>.xml</code></p></>}
                <input ref={fileInputRef} type="file" accept=".bpmn,.xml" style={{ display: 'none' }} onChange={handleFileChange} />
              </div>
              <Row>
                <Col md={8}><Form.Group className="mb-3"><Form.Label>Process name *</Form.Label><Form.Control value={importForm.name} onChange={(event) => setImportForm((previous) => ({ ...previous, name: event.target.value }))} placeholder="Displayed name in the process list" /></Form.Group></Col>
                <Col md={4}><Form.Group className="mb-3"><Form.Label>Initial status</Form.Label><Form.Select value={importForm.status} onChange={(event) => setImportForm((previous) => ({ ...previous, status: event.target.value }))}><option value="draft">Draft</option><option value="review">In Review</option><option value="approved">Approved</option><option value="archived">Archived</option></Form.Select></Form.Group></Col>
              </Row>
              <Form.Group className="mb-3"><Form.Label>Description</Form.Label><Form.Control as="textarea" rows={2} value={importForm.description} onChange={(event) => setImportForm((previous) => ({ ...previous, description: event.target.value }))} placeholder="Optional" /></Form.Group>
              <Form.Group className="mb-3"><Form.Label>Category *</Form.Label><Form.Select required value={importForm.category_id} onChange={(event) => setImportForm((previous) => ({ ...previous, category_id: event.target.value }))}><option value="">Select category</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.pathLabel}</option>)}</Form.Select></Form.Group>
              {importing && <ProgressBar animated now={100} label="Importing..." className="mb-3" />}
              <div className="d-flex justify-content-end gap-2">
                <Button variant="secondary" onClick={() => setShowImport(false)} disabled={importing}>Cancel</Button>
                <Button type="submit" variant="success" disabled={importing || !importFile}>{importing ? <><span className="spinner-border spinner-border-sm me-2" />Importing...</> : <><i className="bi bi-upload me-2" />Import</>}</Button>
              </div>
            </Form>
          )}
        </Modal.Body>
      </Modal>

      <Modal show={showCategoryModal} onHide={() => !categoryBusy && dismissCategoryModal()} size="lg">
        <Modal.Header closeButton={!categoryBusy}>
          <Modal.Title><i className="bi bi-diagram-2 me-2 text-danger" />{editingCategory ? 'Edit category' : 'New category'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {categoryError ? <Alert variant="danger" dismissible onClose={() => setCategoryError('')}>{categoryError}</Alert> : null}
          <Form onSubmit={handleCategorySubmit}>
            <Row className="g-3">
              <Col md={7}>
                <Form.Group>
                  <Form.Label>Name *</Form.Label>
                  <Form.Control
                    required
                    value={categoryForm.name}
                    onChange={(event) => setCategoryForm((previous) => ({ ...previous, name: event.target.value }))}
                    placeholder="Ex: Retail Banking"
                  />
                </Form.Group>
              </Col>
              <Col md={5}>
                <Form.Group>
                  <Form.Label>Parent category</Form.Label>
                  <Form.Select
                    value={categoryForm.parent_id}
                    onChange={(event) => handleCategoryParentChange(event.target.value)}
                  >
                    <option value="">Root category</option>
                    {categoryParentOptions.map((category) => (
                      <option key={category.id} value={category.id}>{category.pathLabel}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Row className="g-3 mt-1">
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Section *</Form.Label>
                  <Form.Select
                    required
                    disabled={Boolean(categoryForm.parent_id)}
                    value={categoryForm.section}
                    onChange={(event) => setCategoryForm((previous) => ({ ...previous, section: event.target.value }))}
                  >
                    {PROCESS_SECTION_CONFIG.map((section) => (
                      <option key={section.key} value={section.key}>{section.label}</option>
                    ))}
                  </Form.Select>
                  <div className="text-muted small mt-1">
                    {categoryForm.parent_id
                      ? 'Child categories automatically inherit the section of their parent category.'
                      : 'Choose where this root category appears on the process management page.'}
                  </div>
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mt-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={categoryForm.description}
                onChange={(event) => setCategoryForm((previous) => ({ ...previous, description: event.target.value }))}
                placeholder="Optional description to explain the category purpose."
              />
            </Form.Group>
            <div className="d-flex justify-content-end gap-2 mt-4">
              <Button variant="secondary" onClick={dismissCategoryModal} disabled={categoryBusy}>Cancel</Button>
              <Button type="submit" variant={editingCategory ? 'primary' : 'success'} disabled={categoryBusy}>
                {categoryBusy ? (editingCategory ? 'Saving...' : 'Creating...') : (editingCategory ? 'Save category' : 'Create category')}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      <Modal show={showTemplates} onHide={() => !applyingTemplateId && setShowTemplates(false)} size="xl">
        <Modal.Header closeButton={!applyingTemplateId}>
          <Modal.Title><i className="bi bi-grid me-2 text-danger" />Process templates</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {templates.length === 0 ? (
            <div className="text-muted">No templates available yet.</div>
          ) : (
            <Row className="g-3">
              {templates.map((template) => (
                <Col md={6} xl={4} key={template.id}>
                  <Card className="border-0 shadow-sm h-100">
                    <Card.Body className="d-flex flex-column">
                      <div className="d-flex align-items-start gap-2 mb-2">
                        <div>
                          <h6 className="mb-1">{template.name}</h6>
                          <div className="text-muted small">{template.description || 'Reusable starter process'}</div>
                        </div>
                      </div>
                      <div className="small text-muted mb-3">
                        {(template.simulation_defaults?.resources || []).length} starter resource(s)
                        {' · '}
                        Monte Carlo {template.simulation_defaults?.monte_carlo_runs || 1}x
                      </div>
                      <div className="mt-auto d-flex justify-content-end">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleApplyTemplate(template)}
                          disabled={applyingTemplateId === template.id}
                        >
                          {applyingTemplateId === template.id ? 'Applying...' : 'Use template'}
                        </Button>
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>
          )}
        </Modal.Body>
      </Modal>
    </Container>
  );
}

export default ProcessManagement;
