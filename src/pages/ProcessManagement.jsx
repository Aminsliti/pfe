import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSnackbar } from '../components/SnackbarProvider';
import { Container, Row, Col, Card, Button, Modal, Form, Alert, Badge, InputGroup, FormControl, ProgressBar, Dropdown, Accordion } from 'react-bootstrap';
import { buildBpmnSubprocessTrail, getBpmnSubprocesses } from '../utils/bpmnSubprocesses';
import { translateEntityToEnglish } from '../utils/englishTranslations';

import { API_BASE } from '../utils/api';

const API = API_BASE;
const BpmnEditorModeler = lazy(() => import('../components/BpmnEditor/BpmnEditorModeler'));
const BpmnProcessPreview = lazy(() => import('../components/BpmnEditor/BpmnProcessPreview'));
const PROCESS_SECTION_CONFIG = [
  { key: 'pilotage', label: 'Management Processes', icon: 'bi-compass' },
  { key: 'metiers', label: 'Business Processes', icon: 'bi-briefcase' },
  { key: 'support', label: 'Support Processes', icon: 'bi-life-preserver' },
];
const DEFAULT_PROCESS_SECTION = 'metiers';
const DEFAULT_MANUAL_DATA = {
  code: '',
  objective: '',
  owner: '',
  scope: '',
  trigger: '',
  expected_result: '',
  frequency: '',
  context: '',
  kpis: [],
  controls: [],
  support_systems: [],
  support_documents: [],
  support_data: [],
  workflow_notes: [],
  raci_responsible: [],
  raci_accountable: [],
  raci_consulted: [],
  raci_informed: [],
  kpi_details: [],
  support_data_details: [],
  support_document_details: [],
  support_system_details: [],
  risk_details: [],
};
const MANUAL_RECORD_FACTORIES = {
  kpi_details: () => ({ name: '', target: '', source: '' }),
  support_data_details: () => ({ name: '', description: '', format: '', source: '', destination: '', criticality: '' }),
  support_document_details: () => ({ name: '', type: '', generated_by: '', output_of: '', version: '' }),
  support_system_details: () => ({ name: '', role: '' }),
  risk_details: () => ({ title: '', severity: '', status: '', category: '', element: '', description: '', mitigation: '' }),
};
const MANUAL_SECTION_CHOICES = [
  { key: 'identity', label: '1. Process Identity' },
  { key: 'whatWhoWhenWhy', label: '2. What / Who / When / Why Matrix' },
  { key: 'activities', label: '3. Activity Matrix' },
  { key: 'workflow', label: 'Workflow Notes' },
  { key: 'raci', label: 'RACI' },
  { key: 'supportObjects', label: '4. Support Objects Layer' },
  { key: 'kpis', label: '5.1 KPI Matrix' },
  { key: 'risks', label: '5.2 Risk Matrix' },
];

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

function buildProcessDownloadBase(process, fallbackValue = 'process') {
  const resolved = String(process?.name || fallbackValue || 'process')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return resolved || fallbackValue || 'process';
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

function normalizeManualList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
  }

  if (typeof value === 'string') {
    return [...new Set(value.split(/[\r\n;,]+/u).map((entry) => entry.trim()).filter(Boolean))];
  }

  return [];
}

function normalizeManualRecordList(value, fields = []) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const source = entry && typeof entry === 'object' ? entry : {};
      const normalized = {};
      let hasValue = false;

      fields.forEach((field) => {
        const resolved = String(source[field] || '').trim();
        normalized[field] = resolved;
        if (resolved) {
          hasValue = true;
        }
      });

      return hasValue ? normalized : null;
    })
    .filter(Boolean);
}

function normalizeManualDataForForm(value = null) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    code: String(source.code || '').trim(),
    objective: String(source.objective || '').trim(),
    owner: String(source.owner || '').trim(),
    scope: String(source.scope || '').trim(),
    trigger: String(source.trigger || '').trim(),
    expected_result: String(source.expected_result || source.expectedResult || '').trim(),
    frequency: String(source.frequency || '').trim(),
    context: String(source.context || '').trim(),
    kpis: normalizeManualList(source.kpis),
    controls: normalizeManualList(source.controls),
    support_systems: normalizeManualList(source.support_systems || source.supportSystems),
    support_documents: normalizeManualList(source.support_documents || source.supportDocuments),
    support_data: normalizeManualList(source.support_data || source.supportData),
    workflow_notes: normalizeManualList(source.workflow_notes || source.workflowNotes),
    raci_responsible: normalizeManualList(source.raci_responsible || source.raciResponsible),
    raci_accountable: normalizeManualList(source.raci_accountable || source.raciAccountable),
    raci_consulted: normalizeManualList(source.raci_consulted || source.raciConsulted),
    raci_informed: normalizeManualList(source.raci_informed || source.raciInformed),
    kpi_details: normalizeManualRecordList(source.kpi_details || source.kpiDetails, ['name', 'target', 'source']),
    support_data_details: normalizeManualRecordList(source.support_data_details || source.supportDataDetails, ['name', 'description', 'format', 'source', 'destination', 'criticality']),
    support_document_details: normalizeManualRecordList(source.support_document_details || source.supportDocumentDetails, ['name', 'type', 'generated_by', 'output_of', 'version']),
    support_system_details: normalizeManualRecordList(source.support_system_details || source.supportSystemDetails, ['name', 'role']),
    risk_details: normalizeManualRecordList(source.risk_details || source.riskDetails, ['title', 'severity', 'status', 'category', 'element', 'description', 'mitigation']),
  };
}

function manualListToTextarea(value) {
  return normalizeManualList(value).join('\n');
}

function formatManualPreviewCellValue(value) {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return String(value);
}

function ManualPreviewTable({ title, columns = [], rows = [], emptyLabel = 'No data available.', renderCell = null }) {
  const safeColumns = Array.isArray(columns) && columns.length
    ? columns
    : [{ key: 'value', label: 'Value' }];
  const safeRows = Array.isArray(rows) ? rows : [];

  return (
    <div className="border rounded-4 overflow-hidden bg-white">
      <div className="px-3 py-2 border-bottom bg-light fw-semibold" style={{ fontSize: 13 }}>
        {title}
      </div>
      <div className="table-responsive">
        <table className="table table-sm table-bordered align-middle mb-0">
          <thead className="table-light">
            <tr>
              {safeColumns.map((column) => (
                <th key={`${title}-${column.key}`} className="small text-uppercase text-muted">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeRows.length === 0 ? (
              <tr>
                {safeColumns.map((column, columnIndex) => (
                  <td key={`${title}-empty-${column.key}`} className="small text-muted" style={{ whiteSpace: 'pre-wrap' }}>
                    {columnIndex === 0 ? emptyLabel : '-'}
                  </td>
                ))}
              </tr>
            ) : safeRows.map((row, rowIndex) => (
              <tr key={`${title}-row-${rowIndex}`}>
                {safeColumns.map((column) => (
                  <td key={`${title}-${rowIndex}-${column.key}`} className="small" style={{ whiteSpace: 'pre-wrap' }}>
                    {typeof renderCell === 'function'
                      ? renderCell(row, column, rowIndex)
                      : formatManualPreviewCellValue(row?.[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManualStructuredRowsEditor({
  title,
  description = '',
  rows = [],
  columns = [],
  disabled = false,
  addLabel = 'Add row',
  emptyLabel = 'No rows added yet.',
  onAddRow,
  onRemoveRow,
  onUpdateRow,
}) {
  const safeRows = Array.isArray(rows) ? rows : [];

  return (
    <div className="border rounded-4 p-3 bg-white">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="fw-semibold">{title}</div>
          {description ? <div className="text-muted small">{description}</div> : null}
        </div>
        <Button type="button" size="sm" variant="outline-dark" disabled={disabled} onClick={onAddRow}>
          {addLabel}
        </Button>
      </div>

      {safeRows.length === 0 ? (
        <div className="text-muted small">{emptyLabel}</div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0">
            <thead className="table-light">
              <tr>
                {columns.map((column) => (
                  <th key={`${title}-${column.key}`} className="small text-uppercase text-muted">
                    {column.label}
                  </th>
                ))}
                <th className="small text-uppercase text-muted text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {safeRows.map((row, rowIndex) => (
                <tr key={`${title}-row-${rowIndex}`}>
                  {columns.map((column) => (
                    <td key={`${title}-${rowIndex}-${column.key}`}>
                      {column.input === 'select' ? (
                        <Form.Select
                          size="sm"
                          disabled={disabled}
                          value={row?.[column.key] || ''}
                          onChange={(event) => onUpdateRow(rowIndex, column.key, event.target.value)}
                        >
                          <option value="">{column.placeholder || 'Select'}</option>
                          {(column.options || []).map((option) => (
                            <option key={`${column.key}-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Form.Select>
                      ) : (
                        <Form.Control
                          size="sm"
                          as={column.input === 'textarea' ? 'textarea' : undefined}
                          rows={column.input === 'textarea' ? 2 : undefined}
                          disabled={disabled}
                          value={row?.[column.key] || ''}
                          onChange={(event) => onUpdateRow(rowIndex, column.key, event.target.value)}
                          placeholder={column.placeholder || ''}
                        />
                      )}
                    </td>
                  ))}
                  <td className="text-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline-danger"
                      disabled={disabled}
                      onClick={() => onRemoveRow(rowIndex)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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

function formatProcessMetaDate(value) {
  try {
    return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value)) : '-';
  } catch {
    return '-';
  }
}

export function ProcessManagement({ publicView = false }) {
  const { user, hasPermission, hasRole, ROLES } = useAuth();
  const { showSnackbar, confirmAction } = useSnackbar();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = String(searchParams.get('returnTo') || '').toLowerCase();
  const returnView = String(searchParams.get('returnView') || '').toLowerCase();
  const libraryNav = searchParams.get('libraryNav') || '';
  const requestedPanel = String(searchParams.get('panel') || '').toLowerCase();
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
    manual_data: DEFAULT_MANUAL_DATA,
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
  const [manualPreview, setManualPreview] = useState(null);
  const [manualPreviewLoading, setManualPreviewLoading] = useState(false);
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
  const [activeProcessDetailPanel, setActiveProcessDetailPanel] = useState('');
  const [expandedManualSections, setExpandedManualSections] = useState([]);
  const fileInputRef = useRef(null);
  const openingProcessRef = useRef(null);
  const syncedProcessParamRef = useRef(null);
  const closingProcessRef = useRef(null);
  const lastOpenedProcessRef = useRef({ id: null, at: 0 });
  const scrollRestoreRef = useRef(null);
  const categoryRowRefs = useRef(new Map());
  const categoryToggleAnchorRef = useRef(null);
  const manualSectionRef = useRef(null);

  const showMsg = (text, type = 'success') => {
    showSnackbar(text, type);
  };

  const fetchProtectedProcessAsset = (url, init = undefined) => {
    if (publicView) {
      return fetch(url, init);
    }

    if (!user?.id) {
      throw new Error('Your session expired. Please log in again.');
    }

    return fetch(url, init);
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

  const updateManualDataField = (key, value) => {
    setFormData((current) => ({
      ...current,
      manual_data: {
        ...normalizeManualDataForForm(current.manual_data),
        [key]: value,
      },
    }));
  };

  const updateManualDataListField = (key, value) => {
    updateManualDataField(key, normalizeManualList(value));
  };

  const updateManualDataRecordField = (key, rowIndex, field, value) => {
    setFormData((current) => {
      const manualData = normalizeManualDataForForm(current.manual_data);
      const rows = Array.isArray(manualData[key]) ? [...manualData[key]] : [];
      rows[rowIndex] = {
        ...(rows[rowIndex] || {}),
        [field]: value,
      };

      return {
        ...current,
        manual_data: {
          ...manualData,
          [key]: rows,
        },
      };
    });
  };

  const addManualDataRecord = (key) => {
    const createRow = MANUAL_RECORD_FACTORIES[key];
    if (typeof createRow !== 'function') {
      return;
    }

    setFormData((current) => {
      const manualData = normalizeManualDataForForm(current.manual_data);
      const rows = Array.isArray(manualData[key]) ? [...manualData[key]] : [];
      rows.push(createRow());

      return {
        ...current,
        manual_data: {
          ...manualData,
          [key]: rows,
        },
      };
    });
  };

  const removeManualDataRecord = (key, rowIndex) => {
    setFormData((current) => {
      const manualData = normalizeManualDataForForm(current.manual_data);
      const rows = Array.isArray(manualData[key]) ? [...manualData[key]] : [];
      rows.splice(rowIndex, 1);

      return {
        ...current,
        manual_data: {
          ...manualData,
          [key]: rows,
        },
      };
    });
  };

  const renderManualMetadataEditor = () => (
    <div className="border rounded-4 p-3 mb-3" style={{ background: '#fffdfa' }}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h6 className="mb-1">Procedure Manual</h6>
          <div className="text-muted small">Fill in the fields and tables below to replace any cells currently shown as "Not specified".</div>
        </div>
      </div>
      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label>Code</Form.Label>
            <Form.Control
              disabled={!canEditSelectedProcess}
              value={formData.manual_data?.code || ''}
              onChange={(event) => updateManualDataField('code', event.target.value)}
              placeholder="Ex: MP-CRT-001"
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label>Owner</Form.Label>
            <Form.Control
              disabled={!canEditSelectedProcess}
              value={formData.manual_data?.owner || ''}
              onChange={(event) => updateManualDataField('owner', event.target.value)}
              placeholder="Process owner"
            />
          </Form.Group>
        </Col>
      </Row>
      <Form.Group className="mb-3">
        <Form.Label>Objective</Form.Label>
        <Form.Control
          as="textarea"
          rows={2}
          disabled={!canEditSelectedProcess}
          value={formData.manual_data?.objective || ''}
          onChange={(event) => updateManualDataField('objective', event.target.value)}
              placeholder="Primary process objective"
        />
      </Form.Group>
      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label>Scope</Form.Label>
            <Form.Control
              disabled={!canEditSelectedProcess}
              value={formData.manual_data?.scope || ''}
              onChange={(event) => updateManualDataField('scope', event.target.value)}
              placeholder="Functional or organizational scope"
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label>Frequency</Form.Label>
            <Form.Control
              disabled={!canEditSelectedProcess}
              value={formData.manual_data?.frequency || ''}
              onChange={(event) => updateManualDataField('frequency', event.target.value)}
              placeholder="Ex: Daily / Weekly / On demand"
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label>Trigger</Form.Label>
            <Form.Control
              disabled={!canEditSelectedProcess}
              value={formData.manual_data?.trigger || ''}
              onChange={(event) => updateManualDataField('trigger', event.target.value)}
              placeholder="Process start event"
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label>Expected Result</Form.Label>
            <Form.Control
              disabled={!canEditSelectedProcess}
              value={formData.manual_data?.expected_result || ''}
              onChange={(event) => updateManualDataField('expected_result', event.target.value)}
              placeholder="Deliverable or final result"
            />
          </Form.Group>
        </Col>
      </Row>
      <Form.Group className="mb-3">
        <Form.Label>Context</Form.Label>
        <Form.Control
          as="textarea"
          rows={2}
          disabled={!canEditSelectedProcess}
          value={formData.manual_data?.context || ''}
          onChange={(event) => updateManualDataField('context', event.target.value)}
          placeholder="Context, limitations, or notes"
        />
      </Form.Group>
      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label>Key KPIs</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              disabled={!canEditSelectedProcess}
              value={manualListToTextarea(formData.manual_data?.kpis)}
              onChange={(event) => updateManualDataListField('kpis', event.target.value)}
              placeholder="One KPI per line"
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label>Key controls</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              disabled={!canEditSelectedProcess}
              value={manualListToTextarea(formData.manual_data?.controls)}
              onChange={(event) => updateManualDataListField('controls', event.target.value)}
              placeholder="One control per line"
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col md={4}>
          <Form.Group className="mb-3">
            <Form.Label>Supporting systems</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              disabled={!canEditSelectedProcess}
              value={manualListToTextarea(formData.manual_data?.support_systems)}
              onChange={(event) => updateManualDataListField('support_systems', event.target.value)}
              placeholder="One system per line"
            />
          </Form.Group>
        </Col>
        <Col md={4}>
          <Form.Group className="mb-3">
            <Form.Label>Supporting documents</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              disabled={!canEditSelectedProcess}
              value={manualListToTextarea(formData.manual_data?.support_documents)}
              onChange={(event) => updateManualDataListField('support_documents', event.target.value)}
              placeholder="One document per line"
            />
          </Form.Group>
        </Col>
        <Col md={4}>
          <Form.Group className="mb-3">
            <Form.Label>Supporting data</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              disabled={!canEditSelectedProcess}
              value={manualListToTextarea(formData.manual_data?.support_data)}
              onChange={(event) => updateManualDataListField('support_data', event.target.value)}
              placeholder="One data item per line"
            />
          </Form.Group>
        </Col>
      </Row>

      <Accordion alwaysOpen defaultActiveKey={['raci', 'kpis', 'support', 'risks']} className="mt-2">
        <Accordion.Item eventKey="raci" className="border rounded-4 overflow-hidden bg-white mb-2">
          <Accordion.Header>RACI and Workflow</Accordion.Header>
          <Accordion.Body>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Responsible</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    disabled={!canEditSelectedProcess}
                    value={manualListToTextarea(formData.manual_data?.raci_responsible)}
                    onChange={(event) => updateManualDataListField('raci_responsible', event.target.value)}
                    placeholder="One person per line"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Accountable</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    disabled={!canEditSelectedProcess}
                    value={manualListToTextarea(formData.manual_data?.raci_accountable)}
                    onChange={(event) => updateManualDataListField('raci_accountable', event.target.value)}
                    placeholder="One person per line"
                  />
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Consulted</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    disabled={!canEditSelectedProcess}
                    value={manualListToTextarea(formData.manual_data?.raci_consulted)}
                    onChange={(event) => updateManualDataListField('raci_consulted', event.target.value)}
                    placeholder="One person per line"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Informed</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    disabled={!canEditSelectedProcess}
                    value={manualListToTextarea(formData.manual_data?.raci_informed)}
                    onChange={(event) => updateManualDataListField('raci_informed', event.target.value)}
                    placeholder="One person per line"
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group>
              <Form.Label>Workflow notes</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                disabled={!canEditSelectedProcess}
                value={manualListToTextarea(formData.manual_data?.workflow_notes)}
                onChange={(event) => updateManualDataListField('workflow_notes', event.target.value)}
                placeholder="One note per line"
              />
            </Form.Group>
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item eventKey="kpis" className="border rounded-4 overflow-hidden bg-white mb-2">
          <Accordion.Header>KPI Details</Accordion.Header>
          <Accordion.Body>
            <ManualStructuredRowsEditor
              title="Detailed KPI Matrix"
              description="Use these rows to define the KPI, target, and source instead of leaving values as 'To be defined' or 'Not specified'."
              rows={formData.manual_data?.kpi_details}
              columns={[
                { key: 'name', label: 'KPI', placeholder: 'KPI name' },
                { key: 'target', label: 'Target', placeholder: 'Ex: 48h' },
                { key: 'source', label: 'Source', placeholder: 'Ex: Dashboard' },
              ]}
              disabled={!canEditSelectedProcess}
              addLabel="Add KPI"
              onAddRow={() => addManualDataRecord('kpi_details')}
              onRemoveRow={(rowIndex) => removeManualDataRecord('kpi_details', rowIndex)}
              onUpdateRow={(rowIndex, field, value) => updateManualDataRecordField('kpi_details', rowIndex, field, value)}
            />
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item eventKey="support" className="border rounded-4 overflow-hidden bg-white mb-2">
          <Accordion.Header>Detailed Support Objects</Accordion.Header>
          <Accordion.Body>
            <div className="d-flex flex-column gap-3">
              <ManualStructuredRowsEditor
                title="4.1 Data"
                description="Complete the Definition, Format, Source, Target, and Sensitivity columns."
                rows={formData.manual_data?.support_data_details}
                columns={[
                  { key: 'name', label: 'Name', placeholder: 'Data name' },
                  { key: 'description', label: 'Definition', input: 'textarea', placeholder: 'Data definition' },
                  { key: 'format', label: 'Format', placeholder: 'Ex: Decimal / Date / Text' },
                  { key: 'source', label: 'Source', placeholder: 'Data source' },
                  { key: 'destination', label: 'Target', placeholder: 'Data destination' },
                  { key: 'criticality', label: 'Sensitivity', placeholder: 'Ex: High' },
                ]}
                disabled={!canEditSelectedProcess}
                addLabel="Add data row"
                onAddRow={() => addManualDataRecord('support_data_details')}
                onRemoveRow={(rowIndex) => removeManualDataRecord('support_data_details', rowIndex)}
                onUpdateRow={(rowIndex, field, value) => updateManualDataRecordField('support_data_details', rowIndex, field, value)}
              />
              <ManualStructuredRowsEditor
                title="4.2 Documents"
                description="Complete the document rows to replace incomplete entries or unspecified versions."
                rows={formData.manual_data?.support_document_details}
                columns={[
                  { key: 'name', label: 'Name', placeholder: 'Document name' },
                  { key: 'type', label: 'Type', placeholder: 'Ex: Form / Supporting record' },
                  { key: 'generated_by', label: 'Generated by', placeholder: 'Actor or source activity' },
                  { key: 'output_of', label: 'Output of', placeholder: 'Destination activity' },
                  { key: 'version', label: 'Version', placeholder: 'Ex: V1.0' },
                ]}
                disabled={!canEditSelectedProcess}
                addLabel="Add document"
                onAddRow={() => addManualDataRecord('support_document_details')}
                onRemoveRow={(rowIndex) => removeManualDataRecord('support_document_details', rowIndex)}
                onUpdateRow={(rowIndex, field, value) => updateManualDataRecordField('support_document_details', rowIndex, field, value)}
              />
              <ManualStructuredRowsEditor
                title="4.3 Information Systems"
                description="Enter the application name and its role in the process."
                rows={formData.manual_data?.support_system_details}
                columns={[
                  { key: 'name', label: 'Application', placeholder: 'System name' },
                  { key: 'role', label: 'Role', input: 'textarea', placeholder: 'Role in the process' },
                ]}
                disabled={!canEditSelectedProcess}
                addLabel="Add system"
                onAddRow={() => addManualDataRecord('support_system_details')}
                onRemoveRow={(rowIndex) => removeManualDataRecord('support_system_details', rowIndex)}
                onUpdateRow={(rowIndex, field, value) => updateManualDataRecordField('support_system_details', rowIndex, field, value)}
              />
            </div>
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item eventKey="risks" className="border rounded-4 overflow-hidden bg-white">
          <Accordion.Header>Detailed Risks</Accordion.Header>
          <Accordion.Body>
            <ManualStructuredRowsEditor
              title="5.2 Risk Matrix"
              description="Add manual risks or complete the description and mitigation when the BPMN diagram does not capture them."
              rows={formData.manual_data?.risk_details}
              columns={[
                { key: 'title', label: 'Risk', placeholder: 'Risk title' },
                {
                  key: 'severity',
                  label: 'Severity',
                  input: 'select',
                  placeholder: 'Select severity',
                  options: [
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                    { value: 'critical', label: 'Very High' },
                  ],
                },
                {
                  key: 'status',
                  label: 'Status',
                  input: 'select',
                  placeholder: 'Select status',
                  options: [
                    { value: 'open', label: 'Open' },
                    { value: 'monitoring', label: 'Monitoring' },
                    { value: 'closed', label: 'Closed' },
                  ],
                },
                {
                  key: 'category',
                  label: 'Category',
                  input: 'select',
                  placeholder: 'Select category',
                  options: [
                    { value: 'operational', label: 'Operational' },
                    { value: 'compliance', label: 'Compliance' },
                    { value: 'financial', label: 'Financial' },
                    { value: 'quality', label: 'Quality' },
                  ],
                },
                { key: 'element', label: 'BPMN Element', placeholder: 'Related element' },
                { key: 'description', label: 'Description', input: 'textarea', placeholder: 'Risk description' },
                { key: 'mitigation', label: 'Mitigation', input: 'textarea', placeholder: 'Mitigation / control action' },
              ]}
              disabled={!canEditSelectedProcess}
              addLabel="Add risk"
              onAddRow={() => addManualDataRecord('risk_details')}
              onRemoveRow={(rowIndex) => removeManualDataRecord('risk_details', rowIndex)}
              onUpdateRow={(rowIndex, field, value) => updateManualDataRecordField('risk_details', rowIndex, field, value)}
            />
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
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
      else {
        const payload = await response.json();
        setProcesses(Array.isArray(payload) ? payload.map(translateEntityToEnglish) : []);
      }
    } catch {
      showMsg('Network error', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch(`${API}/process-categories`);
      if (response.ok) {
        const payload = await response.json();
        setCategories(Array.isArray(payload) ? payload.map(translateEntityToEnglish) : []);
      }
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
    setManualPreviewLoading(true);
    try {
      const [detailResponse, workflowResponse, manualResponse] = await Promise.all([
        fetch(`${API}/processes/${processId}`),
        fetch(`${API}/processes/${processId}/workflow`),
        fetch(`${API}/processes/${processId}/manual?format=json`),
      ]);

      if (!detailResponse.ok) {
        throw new Error('Failed to load process detail');
      }

      const [detail, workflow, manualPayload] = await Promise.all([
        detailResponse.json(),
        workflowResponse.ok ? workflowResponse.json() : Promise.resolve(null),
        manualResponse.ok ? manualResponse.json() : Promise.resolve(null),
      ]);
      setProcessDetail(detail);
      setWorkflowInfo(workflow);
      setManualPreview(manualPayload?.manual || null);
      setVersionSelection((previous) => ({
        fromVersion: previous.fromVersion || String(detail.versions?.[1]?.version_number || detail.versions?.[0]?.version_number || ''),
        toVersion: previous.toVersion || String(detail.versions?.[0]?.version_number || ''),
      }));
      return detail;
    } finally {
      setDetailLoading(false);
      setManualPreviewLoading(false);
    }
  };

  const buildEditorRootProcess = (process) => ({
    id: process?.id,
    name: process?.name || 'Process',
    bpmn_xml: process?.bpmn_xml || '',
    version: process?.version || null,
    category_id: process?.category_id ?? null,
    description: process?.description || '',
    status: process?.status || 'draft',
  });

  const openBpmnEditor = (process, initialSubprocessId = null, options = {}) => {
    if (publicView) {
      return;
    }

    const rootProcess = buildEditorRootProcess(options.rootProcess || process);
    setBpmnTarget({
      ...process,
      initialSubprocessId,
      rootProcessId: rootProcess.id,
      rootProcessName: rootProcess.name,
      rootProcessBpmnXml: rootProcess.bpmn_xml,
      rootProcessVersion: rootProcess.version,
      rootProcessCategoryId: rootProcess.category_id,
      rootProcessDescription: rootProcess.description,
      rootProcessStatus: rootProcess.status,
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
    setManualPreview(null);
    setManualPreviewLoading(false);
    setWorkflowInfo(null);
    setWorkflowComment('');
    setVersionDiff(null);
    setVersionSelection({ fromVersion: '', toVersion: '' });
    setActiveProcessDetailPanel('');
    setFormData({
      name: '',
      description: '',
      bpmn_xml: '',
      category_id: resolvedCategoryId,
      status: 'draft',
      manual_data: normalizeManualDataForForm(),
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
      manual_data: normalizeManualDataForForm(process?.manual_data),
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
    if (!showModal && activeProcessId === processId) {
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
    setManualPreview(null);
    setActiveProcessDetailPanel('');
    setShowModal(false);
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
    setBpmnTarget((previous) => {
      const next = { ...previous, bpmn_xml: bpmnXml, version: updated.version };
      if (Number(previous?.rootProcessId || 0) === Number(previous?.id || 0)) {
        next.rootProcessBpmnXml = bpmnXml;
        next.rootProcessVersion = updated.version;
      }
      return next;
    });
    loadProcesses();

    // Keep the manual preview in sync with BPMN edits (e.g., risks added/changed in the diagram).
    // Otherwise users must click "Save metadata" to see the regenerated matrices.
    try {
      if (Number(editingProcess?.id || processDetail?.id || bpmnTarget?.id) > 0) {
        const targetId = Number(editingProcess?.id || processDetail?.id || bpmnTarget?.id);
        await hydrateProcessDetail(targetId);
      }
    } catch {
      // Non-blocking: the diagram save succeeded; preview refresh failure should not break saving.
    }
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

  const fetchProcessRecord = async (processId) => {
    const response = await fetch(`${API}/processes/${processId}`);
    if (!response.ok) {
      throw new Error('Failed to load the selected process.');
    }

    return response.json();
  };

  const handleOpenLinkedProcessInEditor = async (processId, fallbackProcess = null) => {
    const normalizedProcessId = Number(processId || fallbackProcess?.id || 0);
    if (!Number.isInteger(normalizedProcessId) || normalizedProcessId <= 0) {
      return;
    }

    const detail =
      fallbackProcess &&
      Number(fallbackProcess.id) === normalizedProcessId &&
      typeof fallbackProcess.bpmn_xml === 'string'
        ? fallbackProcess
        : await fetchProcessRecord(normalizedProcessId);

    const rootProcess = bpmnTarget
      ? buildEditorRootProcess({
          id: bpmnTarget.rootProcessId || bpmnTarget.id,
          name: bpmnTarget.rootProcessName || bpmnTarget.name,
          bpmn_xml: bpmnTarget.rootProcessBpmnXml || bpmnTarget.bpmn_xml || '',
          version: bpmnTarget.rootProcessVersion || bpmnTarget.version || null,
          category_id: bpmnTarget.rootProcessCategoryId ?? bpmnTarget.category_id ?? null,
          description: bpmnTarget.rootProcessDescription || bpmnTarget.description || '',
          status: bpmnTarget.rootProcessStatus || bpmnTarget.status || 'draft',
        })
      : buildEditorRootProcess(selectedProcessRecord || detail);

    openBpmnEditor(detail, null, { rootProcess });
  };

  const handleReturnToMainProcessInEditor = () => {
    if (!bpmnTarget) {
      return;
    }

    const rootProcessId = Number(bpmnTarget.rootProcessId || bpmnTarget.id || 0);
    if (!Number.isInteger(rootProcessId) || rootProcessId <= 0) {
      return;
    }

    openBpmnEditor(
      {
        id: rootProcessId,
        name: bpmnTarget.rootProcessName || bpmnTarget.name,
        bpmn_xml: bpmnTarget.rootProcessBpmnXml || '',
        version: bpmnTarget.rootProcessVersion || null,
        category_id: bpmnTarget.rootProcessCategoryId ?? null,
        description: bpmnTarget.rootProcessDescription || '',
        status: bpmnTarget.rootProcessStatus || 'draft',
      },
      null,
      {
        rootProcess: {
          id: rootProcessId,
          name: bpmnTarget.rootProcessName || bpmnTarget.name,
          bpmn_xml: bpmnTarget.rootProcessBpmnXml || '',
          version: bpmnTarget.rootProcessVersion || null,
          category_id: bpmnTarget.rootProcessCategoryId ?? null,
          description: bpmnTarget.rootProcessDescription || '',
          status: bpmnTarget.rootProcessStatus || 'draft',
        },
      }
    );
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
        manual_data: normalizeManualDataForForm(detail.manual_data),
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
    setActiveProcessDetailPanel('');
    setEditingProcess(null);
    setProcessDetail(null);
    setManualPreview(null);
    setManualPreviewLoading(false);
    setWorkflowInfo(null);
    setWorkflowComment('');
    setVersionDiff(null);
    setVersionSelection({ fromVersion: '', toVersion: '' });

    if (!publicView && returnTo === 'process-library') {
      const nextSearch = new URLSearchParams();
      if (libraryNav) {
        nextSearch.set('nav', libraryNav);
      }
      navigate(`/process-library${nextSearch.toString() ? `?${nextSearch.toString()}` : ''}`, { replace: true });
      return;
    }

    if (publicView && returnView === 'library') {
      const nextSearch = new URLSearchParams(searchParams);
      nextSearch.set('view', 'library');
      nextSearch.delete('processId');
      nextSearch.delete('panel');
      nextSearch.delete('returnTo');
      nextSearch.delete('returnView');
      nextSearch.delete('libraryNav');
      if (libraryNav) {
        nextSearch.set('nav', libraryNav);
      } else {
        nextSearch.delete('nav');
      }
      setSearchParams(nextSearch, { replace: true, preventScrollReset: true });
      return;
    }

    const nextSearch = new URLSearchParams(searchParams);
    nextSearch.delete('processId');
    nextSearch.delete('panel');
    nextSearch.delete('returnTo');
    nextSearch.delete('returnView');
    nextSearch.delete('libraryNav');
    setSearchParams(nextSearch, { replace: true, preventScrollReset: true });
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
        manual_data: normalizeManualDataForForm(formData.manual_data),
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

  const handleExport = async (process, version = null) => {
    try {
      const id = Number(process?.id || 0);
      const suffix = version ? `?version=${version}` : '';
      const response = await fetchProtectedProcessAsset(`${API}/processes/${id}/export${suffix}`);
      if (!response.ok) {
        await readApiPayload(response, 'Export failed');
        return;
      }
      const blob = await response.blob();
      const fallbackBase = buildProcessDownloadBase(process, `process-${id}`);
      const fallbackFilename = version ? `${fallbackBase} v${version}.bpmn` : `${fallbackBase}.bpmn`;
      const filename = parseFilenameFromDisposition(response.headers.get('Content-Disposition'), fallbackFilename);
      downloadBlob(blob, filename);
    } catch (error) {
      showMsg(error.message || 'Network error', 'danger');
    }
  };

  const renderProcessDiagramImage = async (process, { version = null, mimeType = 'image/png', quality = 0.92 } = {}) => {
    let viewer;
    let mountNode;
    let svgUrl;
    const id = Number(process?.id || 0);

    const suffix = version ? `?version=${version}` : '';
    const response = await fetchProtectedProcessAsset(`${API}/processes/${id}/export${suffix}`);
    if (!response.ok) {
      await readApiPayload(response, 'Image export failed');
      return null;
    }

    try {
      const xml = await response.text();
      const fallbackBase = buildProcessDownloadBase(process, `process-${id}`);
      const sourceFilename = parseFilenameFromDisposition(
        response.headers.get('Content-Disposition'),
        version ? `${fallbackBase} v${version}.bpmn` : `${fallbackBase}.bpmn`
      );
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

  const handleImageExport = async (process, version = null) => {
    try {
      const rendered = await renderProcessDiagramImage(process, { version, mimeType: 'image/png' });
      if (!rendered) {
        return;
      }

      downloadBlob(rendered.blob, rendered.filename);
    } catch (error) {
      showMsg(error.message || 'Image export failed', 'danger');
    }
  };

  const handleProcessReportDownload = async (process, format = 'pdf') => {
    setProcessReportBusy(format);
    try {
      const id = Number(process?.id || 0);
      if (publicView) {
        const response = await fetchProtectedProcessAsset(`${API}/processes/${id}/manual?format=${format}`);
        if (!response.ok) {
          await readApiPayload(response, 'Export failed');
          return;
        }
        const blob = await response.blob();
        const extension = format === 'pdf' ? 'pdf' : format === 'docx' ? 'docx' : 'html';
        const fallbackBase = buildProcessDownloadBase(process, `process-${id}`);
        const filename = parseFilenameFromDisposition(
          response.headers.get('Content-Disposition'),
          `${fallbackBase} - manuel de procedure.${extension}`
        );
        downloadBlob(blob, filename);
        return;
      }

      const needsDiagramImage = format === 'pdf' || format === 'docx' || format === 'html';
      let diagramImageDataUrl = null;
      if (needsDiagramImage) {
        const rendered = await renderProcessDiagramImage(process, { mimeType: 'image/jpeg', quality: 0.9 });
        if (!rendered?.blob) {
          throw new Error(`Diagram preview could not be rendered for the ${format.toUpperCase()} export.`);
        }
        diagramImageDataUrl = await blobToDataUrl(rendered.blob);
      }

      const requestOptions =
        needsDiagramImage
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
        needsDiagramImage ? `${API}/processes/${id}/manual` : `${API}/processes/${id}/manual?format=${format}`,
        requestOptions
      );
      if (!response.ok) {
        await readApiPayload(response, 'Export failed');
        return;
      }
      const blob = await response.blob();
      const extension = format === 'pdf' ? 'pdf' : format === 'docx' ? 'docx' : 'html';
      const fallbackBase = buildProcessDownloadBase(process, `process-${id}`);
      const filename = parseFilenameFromDisposition(
        response.headers.get('Content-Disposition'),
        `${fallbackBase} - manuel de procedure.${extension}`
      );
      downloadBlob(blob, filename);
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
  const showExpandedProcessDownloadButton = processes.length <= 1;
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
  const manualWorkflowRows = Array.isArray(manualPreview?.workflowBullets)
    ? manualPreview.workflowBullets.map((value, index) => ({ label: `Note ${index + 1}`, value }))
    : [];
  const manualRaciRows = [
    { label: 'Responsible', value: Array.isArray(manualPreview?.raci?.responsible) ? manualPreview.raci.responsible.join(', ') : '-' },
    { label: 'Accountable', value: Array.isArray(manualPreview?.raci?.accountable) ? manualPreview.raci.accountable.join(', ') : '-' },
    { label: 'Consulted', value: Array.isArray(manualPreview?.raci?.consulted) ? manualPreview.raci.consulted.join(', ') : '-' },
    { label: 'Informed', value: Array.isArray(manualPreview?.raci?.informed) ? manualPreview.raci.informed.join(', ') : '-' },
  ];
  const previewSubprocesses = useMemo(() => getBpmnSubprocesses(previewBpmnXml), [previewBpmnXml]);
  const previewSubprocessTrail = useMemo(
    () => buildBpmnSubprocessTrail(previewSubprocesses, previewRootElementId),
    [previewSubprocesses, previewRootElementId]
  );
  const activePreviewSubprocess = previewSubprocessTrail.length
    ? previewSubprocessTrail[previewSubprocessTrail.length - 1]
    : null;
  const canEditSelectedProcess = editingProcess ? canEditProcessDefinition(selectedProcessRecord) : canCreateDefinitions;
  const showProcessDetailsPage = Boolean(selectedProcessRecord?.id) && !showModal;
  const selectedProcessStatus = normalizeUiStatus(selectedProcessRecord?.status);
  const processDetailsStatus = ({
    draft: { bg: '#e2e8f0', color: '#334155', label: 'Draft' },
    review: { bg: '#dbeafe', color: '#1d4ed8', label: 'In review' },
    approved: { bg: '#dcfce7', color: '#166534', label: 'Approved' },
    active: { bg: '#dcfce7', color: '#166534', label: 'Approved' },
    archived: { bg: '#fef3c7', color: '#92400e', label: 'Archived' },
  }[normalizeUiStatus(selectedProcessRecord?.status)] || { bg: '#e2e8f0', color: '#334155', label: statusLabel(selectedProcessRecord?.status) });
  const canSharePublicManual = publicView || ['approved', 'active'].includes(selectedProcessStatus);
  const processManualShareUrl = selectedProcessRecord?.id
    ? new URL(
      canSharePublicManual
        ? `/portal?view=tree&processId=${selectedProcessRecord.id}&panel=manual`
        : `/processes?processId=${selectedProcessRecord.id}&panel=manual`,
      window.location.origin,
    ).toString()
    : '';

  const handleCopyManualLink = async () => {
    if (!processManualShareUrl) {
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(processManualShareUrl);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = processManualShareUrl;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      showMsg(
        canSharePublicManual
          ? 'Public procedure manual link copied.'
          : 'Internal procedure manual link copied. Approve the process to share a public link.',
      );
    } catch (error) {
      console.error(error);
      showMsg('Failed to copy the procedure manual link.', 'danger');
    }
  };

  useEffect(() => {
    setPreviewRootElementId(null);
  }, [editingProcess?.id, processDetail?.id, previewBpmnXml]);

  useEffect(() => {
    if (previewRootElementId && !previewSubprocesses.some((subprocess) => subprocess.id === previewRootElementId)) {
      setPreviewRootElementId(null);
    }
  }, [previewRootElementId, previewSubprocesses]);

  useEffect(() => {
    if (requestedPanel !== 'manual' || !showProcessDetailsPage || !selectedProcessRecord?.id) {
      return;
    }

    setExpandedManualSections(MANUAL_SECTION_CHOICES.map((section) => section.key));
    window.requestAnimationFrame(() => {
      manualSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [manualPreview, requestedPanel, selectedProcessRecord?.id, showProcessDetailsPage]);

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
          onOpenLinkedProcess={handleOpenLinkedProcessInEditor}
          onReturnToMainProcess={handleReturnToMainProcessInEditor}
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
        <ExportMenu process={process} compact={!showExpandedProcessDownloadButton} />
      </div>
    </div>
  );

  const ExportMenu = ({ process, version = null, compact = false }) => {
    if (publicView) {
      return null;
    }

    const toggleStyle = compact ? { padding: '3px 7px' } : { minWidth: 110 };

    return (
    <Dropdown align="end" onClick={(event) => event.stopPropagation()}>
      <Dropdown.Toggle
        variant="outline-secondary"
        size="sm"
        style={toggleStyle}
        title="Download process files"
      >
        <i className="bi bi-download" />
        {!compact ? <span className="ms-1">Download</span> : null}
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => handleExport(process, version)}>
          <i className="bi bi-filetype-xml me-2" />
          BPMN
        </Dropdown.Item>
        {!version ? (
          <Dropdown.Item onClick={() => handleImageExport(process)}>
            <i className="bi bi-image me-2" />
            Image (PNG)
          </Dropdown.Item>
        ) : null}
        {!version ? (
          <Dropdown.Item onClick={() => handleProcessReportDownload(process, 'html')}>
            <i className="bi bi-file-earmark-text me-2" />
            Manual HTML
          </Dropdown.Item>
        ) : null}
        {!version ? (
          <Dropdown.Item onClick={() => handleProcessReportDownload(process, 'pdf')}>
            <i className="bi bi-file-earmark-pdf me-2" />
            Manual PDF
          </Dropdown.Item>
        ) : null}
        {!version ? (
          <Dropdown.Item onClick={() => handleProcessReportDownload(process, 'docx')}>
            <i className="bi bi-file-earmark-word me-2" />
            Manual Word
          </Dropdown.Item>
        ) : null}
      </Dropdown.Menu>
    </Dropdown>
    );
  };

  const supportObjectSections = Array.isArray(manualPreview?.matrices?.supportObjects?.sections)
    ? manualPreview.matrices.supportObjects.sections
    : [];
  const renderRiskSeverityCell = (row, column) => {
    if (column.key !== 'severity') {
      return formatManualPreviewCellValue(row?.[column.key]);
    }

    const severity = String(row?.severity || '').toLowerCase();
    const palette = {
      low: { bg: '#dcfce7', fg: '#166534', label: 'Low' },
      medium: { bg: '#fef9c3', fg: '#854d0e', label: 'Medium' },
      high: { bg: '#ffedd5', fg: '#9a3412', label: 'High' },
      critical: { bg: '#fee2e2', fg: '#991b1b', label: 'Very High' },
    };
    const resolved = palette[severity] || { bg: '#e5e7eb', fg: '#111827', label: severity || '-' };

    return (
      <span
        className="d-inline-flex align-items-center"
        style={{
          background: resolved.bg,
          color: resolved.fg,
          borderRadius: 999,
          padding: '2px 8px',
          fontWeight: 700,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {resolved.label}
      </span>
    );
  };
  const renderManualSection = (sectionKey) => {
    if (sectionKey === 'identity') {
      return (
        <ManualPreviewTable
          title="1. Process Identity"
          columns={[
            { key: 'label', label: 'Field' },
            { key: 'value', label: 'Value' },
          ]}
          rows={manualPreview?.matrices?.identity}
        />
      );
    }

    if (sectionKey === 'whatWhoWhenWhy') {
      return (
        <ManualPreviewTable
          title="2. What / Who / When / Why Matrix"
          columns={Array.isArray(manualPreview?.matrices?.whatWhoWhenWhy?.columns) ? manualPreview.matrices.whatWhoWhenWhy.columns : []}
          rows={manualPreview?.matrices?.whatWhoWhenWhy?.rows}
        />
      );
    }

    if (sectionKey === 'activities') {
      return (
        <ManualPreviewTable
          title="3. Activity Matrix"
          columns={[
            { key: 'activity', label: 'Activity' },
            { key: 'actor', label: 'Actor' },
            { key: 'description', label: 'Description' },
          ]}
          rows={manualPreview?.matrices?.activities}
        />
      );
    }

    if (sectionKey === 'workflow') {
      return (
        <ManualPreviewTable
          title="Workflow notes"
          columns={[
            { key: 'label', label: 'Note' },
            { key: 'value', label: 'Value' },
          ]}
          rows={manualWorkflowRows}
          emptyLabel="No workflow notes generated."
        />
      );
    }

    if (sectionKey === 'raci') {
      return (
        <ManualPreviewTable
          title="RACI"
          columns={[
            { key: 'label', label: 'Role' },
            { key: 'value', label: 'Value' },
          ]}
          rows={manualRaciRows}
        />
      );
    }

    if (sectionKey === 'supportObjects') {
      return (
        <div className="border rounded-4 p-3 bg-white">
          <div className="fw-semibold mb-2">4. Support Objects Layer</div>
          <div className="text-muted small mb-3">{manualPreview?.matrices?.supportObjects?.intro || 'No support-object introduction available.'}</div>
          <div className="d-flex flex-column gap-3">
            {supportObjectSections.length > 0 ? (
              supportObjectSections.map((section) => (
                <ManualPreviewTable
                  key={section.title}
                  title={section.title}
                  columns={Array.isArray(section.columns) ? section.columns : []}
                  rows={section.rows}
                />
              ))
            ) : (
              <div className="text-muted small">No support-object sections available.</div>
            )}
          </div>
        </div>
      );
    }

    if (sectionKey === 'kpis') {
      return (
        <ManualPreviewTable
          title="5.1 KPI Matrix"
          columns={[
            { key: 'name', label: 'KPI' },
            { key: 'target', label: 'Target' },
            { key: 'source', label: 'Source' },
          ]}
          rows={manualPreview?.matrices?.kpis}
        />
      );
    }

    if (sectionKey === 'risks') {
      return (
        <ManualPreviewTable
          title="5.2 Risk Matrix"
          columns={[
            { key: 'title', label: 'Risk' },
            { key: 'severity', label: 'Severity' },
            { key: 'status', label: 'Status' },
            { key: 'category', label: 'Category' },
            { key: 'element', label: 'BPMN Element' },
            { key: 'description', label: 'Description' },
            { key: 'mitigation', label: 'Mitigation / Control' },
          ]}
          rows={manualPreview?.matrices?.risks}
          renderCell={renderRiskSeverityCell}
        />
      );
    }

    return null;
  };

  const renderProcessDetailPanelContent = () => {
    if (!selectedProcessRecord) {
      return <div className="text-muted">No process selected.</div>;
    }

    if (activeProcessDetailPanel === 'info') {
      return (
        <div className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between gap-3 border-bottom pb-2">
            <span className="text-muted">Category</span>
            <strong className="text-end">{getCategoryLabel(selectedProcessRecord) || 'Uncategorized'}</strong>
          </div>
          <div className="d-flex justify-content-between gap-3 border-bottom pb-2">
            <span className="text-muted">Owner</span>
            <strong className="text-end">{selectedProcessRecord?.created_by_name || 'Equipe BPM'}</strong>
          </div>
          <div className="d-flex justify-content-between gap-3 border-bottom pb-2">
            <span className="text-muted">Created</span>
            <strong className="text-end">{formatProcessMetaDate(selectedProcessRecord?.created_at)}</strong>
          </div>
          <div className="d-flex justify-content-between gap-3 border-bottom pb-2">
            <span className="text-muted">Updated</span>
            <strong className="text-end">{formatProcessMetaDate(selectedProcessRecord?.updated_at)}</strong>
          </div>
          <div className="d-flex justify-content-between gap-3">
            <span className="text-muted">Status</span>
            <strong className="text-end">{statusLabel(selectedProcessRecord?.status)}</strong>
          </div>
        </div>
      );
    }

    if (activeProcessDetailPanel === 'subprocesses') {
      if (!previewSubprocesses.length) {
        return <div className="text-muted">This process does not contain embedded subprocesses.</div>;
      }

      return (
        <div className="d-flex flex-column gap-3">
          <div>
            <h6 className="mb-1">Embedded Sub-processes</h6>
            <div className="text-muted small">Open the same internal BPMN level that the BPMN drilldown arrow targets.</div>
          </div>

          <div className="d-flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={previewRootElementId ? 'outline-secondary' : 'danger'}
              className="rounded-pill"
              onClick={() => setPreviewRootElementId(null)}
            >
              Diagramme principal
            </Button>
            {previewSubprocessTrail.map((subprocess) => (
              <Button
                key={subprocess.id}
                type="button"
                size="sm"
                variant={previewRootElementId === subprocess.id ? 'danger' : 'outline-secondary'}
                className="rounded-pill"
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
                className="text-start border rounded-4 px-3 py-3 bg-white"
                style={{
                  borderColor: previewRootElementId === subprocess.id ? '#ef4444' : '#e2e8f0',
                  boxShadow: previewRootElementId === subprocess.id ? 'inset 3px 0 0 #ef4444' : 'none',
                }}
              >
                <div className="fw-semibold text-dark">{subprocess.name}</div>
                <div className="small text-muted mt-1">{subprocess.pathLabel}</div>
                <div className="small text-muted mt-2">
                  {subprocess.childCount > 0 ? `${subprocess.childCount} nested view(s)` : 'Final embedded subprocess view'}
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (activeProcessDetailPanel === 'workflow') {
      return (
        <div className="d-flex flex-column gap-3">
          <div className="d-flex flex-wrap gap-2">
            <Badge bg={statusVariant(currentWorkflowStatus)}>{statusLabel(currentWorkflowStatus)}</Badge>
            {workflowInfo?.submitted_at && <Badge bg="light" text="dark">Submitted {new Date(workflowInfo.submitted_at).toLocaleDateString()}</Badge>}
            {workflowInfo?.approved_by_name && <Badge bg="success-subtle" text="dark">Approved by {workflowInfo.approved_by_name}</Badge>}
            {workflowInfo?.archived_at && <Badge bg="warning" text="dark">Archived {new Date(workflowInfo.archived_at).toLocaleDateString()}</Badge>}
          </div>

          <div className="border rounded-3 p-3 bg-light">
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
            <Form.Group>
              <Form.Label>Workflow comment</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder="Add the governance note that accompanies this workflow action."
                value={workflowComment}
                onChange={(event) => setWorkflowComment(event.target.value)}
              />
              <div className="text-muted small mt-1">Required when requesting a reopen or reopening the process to draft.</div>
            </Form.Group>
          ) : null}

          {!publicView ? (
            <div className="d-flex flex-wrap gap-2">
              {canSubmitForReview(selectedProcessRecord) && (
                <Button variant="info" onClick={() => handleWorkflowAction('submit_review')} disabled={!!workflowBusy}>
                  {workflowBusy === 'submit_review' ? 'Submitting...' : 'Submit for review'}
                </Button>
              )}
              {canApproveProcess(selectedProcessRecord) && (
                <Button variant="success" onClick={() => handleWorkflowAction('approve')} disabled={!!workflowBusy}>
                  {workflowBusy === 'approve' ? 'Approving...' : 'Approve'}
                </Button>
              )}
              {canReturnToDraft(selectedProcessRecord) && (
                <Button variant="outline-secondary" onClick={() => handleWorkflowAction('return_draft')} disabled={!!workflowBusy}>
                  {currentWorkflowStatus === 'approved' ? 'Reopen to draft' : 'Return to draft'}
                </Button>
              )}
              {canArchiveProcess(selectedProcessRecord) && (
                <Button variant="warning" onClick={() => handleWorkflowAction('archive')} disabled={!!workflowBusy}>
                  Archive
                </Button>
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
          ) : null}

          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {(workflowInfo?.comments || []).length === 0 ? (
              <div className="text-muted small">No workflow comments yet.</div>
            ) : (
              workflowInfo.comments.map((commentEntry) => (
                <div key={commentEntry.id} className="border rounded-3 p-2 mb-2 bg-light">
                  <div className="d-flex justify-content-between gap-2">
                    <strong style={{ fontSize: 13 }}>{commentEntry.created_by_name || 'System'}</strong>
                    <span className="text-muted small">{new Date(commentEntry.created_at).toLocaleString('en-US')}</span>
                  </div>
                  <div className="text-muted small text-uppercase mt-1">{formatWorkflowActionLabel(commentEntry.action)}</div>
                  {commentEntry.comment ? <div className="mt-1" style={{ fontSize: 13 }}>{commentEntry.comment}</div> : null}
                </div>
              ))
            )}
          </div>
        </div>
      );
    }

    if (activeProcessDetailPanel === 'metadata') {
      return (
        <Form onSubmit={handleSubmit}>
          <div className="d-flex flex-column gap-3">
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <h6 className="mb-1">Metadata</h6>
                <div className="text-muted small">Name, category, description, assignments, and workflow status.</div>
              </div>
              <Badge bg={statusVariant(currentWorkflowStatus)}>{statusLabel(currentWorkflowStatus)}</Badge>
            </div>

            <Form.Group>
              <Form.Label>Name *</Form.Label>
              <Form.Control required disabled={!canEditSelectedProcess} value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} />
            </Form.Group>
            <Form.Group>
              <Form.Label>Description</Form.Label>
              <Form.Control as="textarea" rows={3} disabled={!canEditSelectedProcess} value={formData.description} onChange={(event) => setFormData({ ...formData, description: event.target.value })} />
            </Form.Group>
            <Row>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Category *</Form.Label>
                  <Form.Select required disabled={!canEditSelectedProcess} value={formData.category_id} onChange={(event) => handleProcessCategoryChange(event.target.value)}>
                    <option value="">Select category</option>
                    {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.pathLabel}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
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
                    inputPrefix: 'process-designer-panel',
                  })}
                  <div className="text-muted small mt-1">Choose one or more people who can edit the process while it is in draft.</div>
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
                    inputPrefix: 'process-manager-panel',
                  })}
                  <div className="text-muted small mt-1">Choose one or more people who can validate, reopen, archive, and edit the process.</div>
                </Form.Group>
              </Col>
            </Row>
            {governanceLoading ? <div className="text-muted small">Loading governance options...</div> : null}

            <div className="d-flex justify-content-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setActiveProcessDetailPanel('')}>Close</Button>
              {canEditSelectedProcess ? <Button type="submit" variant="primary">Save metadata</Button> : null}
            </div>
          </div>
        </Form>
      );
    }

    if (activeProcessDetailPanel === 'manual') {
      const supportObjectSections = Array.isArray(manualPreview?.matrices?.supportObjects?.sections)
        ? manualPreview.matrices.supportObjects.sections
        : [];
      const renderRiskSeverityCell = (row, column) => {
        if (column.key !== 'severity') {
          return formatManualPreviewCellValue(row?.[column.key]);
        }

        const severity = String(row?.severity || '').toLowerCase();
        const palette = {
          low: { bg: '#dcfce7', fg: '#166534', label: 'Low' },
          medium: { bg: '#fef9c3', fg: '#854d0e', label: 'Medium' },
          high: { bg: '#ffedd5', fg: '#9a3412', label: 'High' },
          critical: { bg: '#fee2e2', fg: '#991b1b', label: 'Very High' },
        };
        const resolved = palette[severity] || { bg: '#e5e7eb', fg: '#111827', label: severity || '-' };

        return (
          <span
            className="d-inline-flex align-items-center"
            style={{
              background: resolved.bg,
              color: resolved.fg,
              borderRadius: 999,
              padding: '2px 8px',
              fontWeight: 700,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {resolved.label}
          </span>
        );
      };
      const renderManualSection = (sectionKey) => {
        if (sectionKey === 'identity') {
          return (
            <ManualPreviewTable
              title="1. Process Identity"
              columns={[
                { key: 'label', label: 'Field' },
                { key: 'value', label: 'Value' },
              ]}
              rows={manualPreview?.matrices?.identity}
            />
          );
        }

        if (sectionKey === 'whatWhoWhenWhy') {
          return (
            <ManualPreviewTable
              title="2. What / Who / When / Why Matrix"
              columns={Array.isArray(manualPreview?.matrices?.whatWhoWhenWhy?.columns) ? manualPreview.matrices.whatWhoWhenWhy.columns : []}
              rows={manualPreview?.matrices?.whatWhoWhenWhy?.rows}
            />
          );
        }

        if (sectionKey === 'activities') {
          return (
            <ManualPreviewTable
              title="3. Activity Matrix"
              columns={[
                { key: 'activity', label: 'Activity' },
                { key: 'actor', label: 'Actor' },
                { key: 'description', label: 'Description' },
              ]}
              rows={manualPreview?.matrices?.activities}
            />
          );
        }

        if (sectionKey === 'workflow') {
          return (
            <ManualPreviewTable
              title="Workflow notes"
              columns={[
                { key: 'label', label: 'Note' },
                { key: 'value', label: 'Value' },
              ]}
              rows={manualWorkflowRows}
              emptyLabel="No workflow notes generated."
            />
          );
        }

        if (sectionKey === 'raci') {
          return (
            <ManualPreviewTable
              title="RACI"
              columns={[
                { key: 'label', label: 'Role' },
                { key: 'value', label: 'Value' },
              ]}
              rows={manualRaciRows}
            />
          );
        }

        if (sectionKey === 'supportObjects') {
          return (
            <div className="border rounded-4 p-3 bg-white">
              <div className="fw-semibold mb-2">4. Support Objects Layer</div>
              <div className="text-muted small mb-3">{manualPreview?.matrices?.supportObjects?.intro || 'No support-object introduction available.'}</div>
              <div className="d-flex flex-column gap-3">
                {supportObjectSections.length > 0 ? (
                  supportObjectSections.map((section) => (
                    <ManualPreviewTable
                      key={section.title}
                      title={section.title}
                      columns={Array.isArray(section.columns) ? section.columns : []}
                      rows={section.rows}
                    />
                  ))
                ) : (
                  <div className="text-muted small">No support-object sections available.</div>
                )}
              </div>
            </div>
          );
        }

        if (sectionKey === 'kpis') {
          return (
            <ManualPreviewTable
              title="5.1 KPI Matrix"
              columns={[
                { key: 'name', label: 'KPI' },
                { key: 'target', label: 'Target' },
                { key: 'source', label: 'Source' },
              ]}
              rows={manualPreview?.matrices?.kpis}
            />
          );
        }

        if (sectionKey === 'risks') {
          return (
            <ManualPreviewTable
              title="5.2 Risk Matrix"
              columns={[
                { key: 'title', label: 'Risk' },
                { key: 'severity', label: 'Severity' },
                { key: 'status', label: 'Status' },
                { key: 'category', label: 'Category' },
                { key: 'element', label: 'BPMN Element' },
                { key: 'description', label: 'Description' },
                { key: 'mitigation', label: 'Mitigation / Control' },
              ]}
              rows={manualPreview?.matrices?.risks}
              renderCell={renderRiskSeverityCell}
            />
          );
        }

        return null;
      };

      return (
        <div className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <h6 className="mb-1">Procedure Manual</h6>
              <div className="text-muted small">Read the generated procedure manual directly here without downloading it.</div>
            </div>
            {manualPreviewLoading ? <div className="spinner-border spinner-border-sm text-danger" role="status" /> : null}
          </div>

          {canEditSelectedProcess ? (
            <div className="text-muted small">
              Save metadata to refresh this preview after editing the process details or BPMN diagram.
            </div>
          ) : null}

          {!manualPreview ? (
            <div className="border rounded-4 px-3 py-4 text-muted small bg-light">
              {manualPreviewLoading ? 'Loading the procedure manual...' : 'The procedure manual is not available for this process yet.'}
            </div>
          ) : (
            <div className="d-flex flex-column gap-3">
              <div className="border rounded-4 p-3 bg-white">
                <div className="fw-semibold mb-3">Choose what to read</div>
                <div className="d-flex flex-wrap gap-2 mb-3">
                  <Button
                    type="button"
                    size="sm"
                    variant={manualPreviewMode === 'full' ? 'danger' : 'outline-secondary'}
                    onClick={() => setManualPreviewMode('full')}
                  >
                    Full manual
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={manualPreviewMode === 'section' ? 'danger' : 'outline-secondary'}
                    onClick={() => setManualPreviewMode('section')}
                  >
                    Specific section
                  </Button>
                </div>
                {manualPreviewMode === 'section' ? (
                  <Form.Select
                    size="sm"
                    value={manualPreviewSection}
                    onChange={(event) => setManualPreviewSection(event.target.value)}
                    style={{ maxWidth: 360 }}
                  >
                    {MANUAL_SECTION_CHOICES.map((section) => (
                      <option key={section.key} value={section.key}>
                        {section.label}
                      </option>
                    ))}
                  </Form.Select>
                ) : null}
              </div>

              <div className="border rounded-4 p-3 bg-light">
                <div className="small text-uppercase fw-bold text-danger mb-2">Procedure Manual</div>
                <div className="fw-semibold mb-2">{selectedProcessRecord?.name || 'Process'}</div>
                <div className="text-muted small">{manualPreview.diagramDescription || selectedProcessRecord?.description || 'No generated narrative is available yet.'}</div>
              </div>

              {manualPreviewMode === 'full' ? (
                <div className="d-flex flex-column gap-3">
                  {MANUAL_SECTION_CHOICES.map((section) => (
                    <div key={section.key}>
                      {renderManualSection(section.key)}
                    </div>
                  ))}
                </div>
              ) : (
                renderManualSection(manualPreviewSection)
              )}
            </div>
          )}
        </div>
      );
    }

    if (activeProcessDetailPanel === 'versions') {
      return (
        <div className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <h6 className="mb-1">Version Diff</h6>
              <div className="text-muted small">Compare metadata, BPMN structure, and task-level changes between saved versions.</div>
            </div>
            <div className="d-flex gap-2 flex-wrap">
              <Form.Select
                size="sm"
                value={versionSelection.fromVersion}
                onChange={(event) => setVersionSelection((previous) => ({ ...previous, fromVersion: event.target.value }))}
              >
                <option value="">From version</option>
                {availableVersions.map((version) => (
                  <option key={`from-panel-${version.version_number}`} value={version.version_number}>v{version.version_number}</option>
                ))}
              </Form.Select>
              <Form.Select
                size="sm"
                value={versionSelection.toVersion}
                onChange={(event) => setVersionSelection((previous) => ({ ...previous, toVersion: event.target.value }))}
              >
                <option value="">To version</option>
                {availableVersions.map((version) => (
                  <option key={`to-panel-${version.version_number}`} value={version.version_number}>v{version.version_number}</option>
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
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {availableVersions.map((version) => (
                    <div key={version.version_number} className="border rounded-3 bg-white p-2 mb-2">
                      <div className="d-flex justify-content-between gap-2">
                        <strong>v{version.version_number}</strong>
                        <ExportMenu process={selectedProcessRecord} version={version.version_number} compact />
                      </div>
                      <div className="text-muted small mt-1">{version.change_description || 'Snapshot'}</div>
                      <div className="small mt-2">{version.created_by_name || 'Unknown author'}</div>
                      <div className="text-muted small">{version.created_at ? new Date(version.created_at).toLocaleString('en-US') : '-'}</div>
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
                          <strong>{change.label}:</strong> <span className="text-muted">{String(change.from || '-')}</span> to <span>{String(change.to || '-')}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mb-3">
                    <div className="fw-semibold mb-2">Task changes</div>
                    <div className="small text-muted mb-1">Added: {versionDiff.task_changes.added.length} | Removed: {versionDiff.task_changes.removed.length} | Renamed: {versionDiff.task_changes.renamed.length}</div>
                    {[...versionDiff.task_changes.added.slice(0, 4).map((task) => `+ ${task.task_name || task.task_id}`), ...versionDiff.task_changes.removed.slice(0, 4).map((task) => `- ${task.task_name || task.task_id}`), ...versionDiff.task_changes.renamed.slice(0, 4).map((task) => `~ ${task.from} to ${task.to}`)].map((line) => (
                      <div key={line} className="small">{line}</div>
                    ))}
                  </div>

                  <div>
                    <div className="fw-semibold mb-2">BPMN structure</div>
                    <div className="small text-muted mb-1">XML changed: {versionDiff.bpmn_changes.xml_changed ? 'yes' : 'no'}</div>
                    {versionDiff.bpmn_changes.changes.length === 0 ? (
                      <div className="text-muted small">No BPMN structural changes detected.</div>
                    ) : (
                      versionDiff.bpmn_changes.changes.map((change) => (
                        <div key={change.metric} className="small">
                          <strong>{change.metric}:</strong> {change.from} to {change.to}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  if (showProcessDetailsPage) {
    return (
      <Container fluid className="py-4">
        <Card className="border-0 shadow-sm bg-white" style={{ borderRadius: 28 }}>
          <Card.Body className="p-4 p-xl-5 d-flex flex-column gap-4">
            <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
              <div>
                <div className="small text-uppercase fw-bold text-danger mb-2">
                  <i className="bi bi-image me-2" />
                  Final BPMN Diagram
                </div>
                <h2 className="mb-2">{selectedProcessRecord?.name || (detailLoading ? 'Loading process...' : 'Process')}</h2>
                <p className="mb-0 text-muted">
                  {selectedProcessRecord?.description || 'Open the process diagram and review its current publication details here.'}
                </p>
              </div>
              <Button type="button" variant="outline-secondary" size="sm" className="rounded-pill flex-shrink-0" onClick={closeProcessModal}>
                <i className="bi bi-arrow-left me-2" />
                Back
              </Button>
            </div>

            <div className="d-flex flex-wrap align-items-center gap-2">
              <span className="badge rounded-pill" style={{ background: processDetailsStatus.bg, color: processDetailsStatus.color, fontSize: 14 }}>
                {processDetailsStatus.label}
              </span>
              <span className="badge rounded-pill text-bg-light" style={{ fontSize: 14 }}>
                v{selectedProcessRecord?.version || 1}
              </span>
              {detailLoading ? <div className="spinner-border spinner-border-sm text-danger ms-1" role="status" /> : null}
            </div>

            <div className="d-flex flex-wrap gap-2">
              {!publicView ? (
                <>
                {canApproveProcess(selectedProcessRecord) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="success"
                    onClick={() => handleWorkflowAction('approve', selectedProcessRecord)}
                    disabled={workflowBusy === 'approve'}
                  >
                    {workflowBusy === 'approve' ? 'Approving...' : 'Approve diagram'}
                  </Button>
                ) : null}
                {canEditSelectedProcess ? (
                  <Button type="button" size="sm" variant="primary" onClick={() => openBpmnEditor(selectedProcessRecord, previewRootElementId || null)}>
                    Edit diagram
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline-secondary" onClick={() => handleImageExport(selectedProcessRecord)}>
                  PNG
                </Button>
                <Button type="button" size="sm" variant="outline-dark" onClick={() => handleExport(selectedProcessRecord)}>
                  BPMN
                </Button>
                </>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline-dark"
                onClick={() => handleProcessReportDownload(selectedProcessRecord, 'html')}
                disabled={processReportBusy === 'html'}
              >
                {processReportBusy === 'html' ? 'Exporting...' : 'Manual HTML'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline-secondary"
                onClick={() => handleProcessReportDownload(selectedProcessRecord, 'pdf')}
                disabled={processReportBusy === 'pdf'}
              >
                {processReportBusy === 'pdf' ? 'Exporting...' : 'Manual PDF'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline-primary"
                onClick={() => handleProcessReportDownload(selectedProcessRecord, 'docx')}
                disabled={processReportBusy === 'docx'}
              >
                {processReportBusy === 'docx' ? 'Exporting...' : 'Manual Word'}
              </Button>
              <Button type="button" size="sm" variant="outline-danger" onClick={handleCopyManualLink}>
                <i className="bi bi-link-45deg me-2" />
                Copy Manual Link
              </Button>
            </div>

            <Row className="g-4">
              <Col xl={8}>
                <div className="border rounded-4 bg-white p-3 shadow-sm h-100">
                  <div className="small text-muted mb-2">
                    {canEditSelectedProcess ? 'Click the diagram to open it in the BPMN editor.' : 'Diagram preview'}
                  </div>
                  <button
                    type="button"
                    className="w-100 text-start p-0"
                    onClick={() => {
                      if (canEditSelectedProcess) {
                        openBpmnEditor(selectedProcessRecord, previewRootElementId || null);
                      }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: canEditSelectedProcess ? 'pointer' : 'default',
                    }}
                  >
                    {detailLoading && !previewBpmnXml ? (
                      <div className="text-center py-5 text-muted">
                        <div className="spinner-border text-danger mb-3" role="status" />
                        <div>Loading BPMN preview...</div>
                      </div>
                    ) : (
                      <Suspense fallback={<div className="text-center py-5 text-muted">Loading BPMN preview...</div>}>
                        <BpmnProcessPreview xml={previewBpmnXml} rootElementId={previewRootElementId} />
                      </Suspense>
                    )}
                  </button>
                </div>
              </Col>
              <Col xl={4}>
                <Card className="border-0 shadow-sm h-100" style={{ background: '#fffdfa', borderRadius: 24 }}>
                  <Card.Body className="d-flex flex-column gap-3">
                    <div>
                      <h3 className="h5 mb-1">Detail Panels</h3>
                      <p className="text-muted small mb-0">Open the process detail popups here, and read the procedure manual below.</p>
                    </div>

                    <div className="d-grid gap-2">
                      <Button type="button" variant="outline-dark" onClick={() => setActiveProcessDetailPanel('info')}>
                        Information
                      </Button>
                      <Button type="button" variant="outline-danger" onClick={() => setActiveProcessDetailPanel('subprocesses')} disabled={!previewSubprocesses.length}>
                        Sub-processes
                      </Button>
                      {!publicView ? (
                        <>
                          <Button type="button" variant="outline-primary" onClick={() => setActiveProcessDetailPanel('metadata')}>
                            Metadata
                          </Button>
                          <Button type="button" variant="outline-secondary" onClick={() => setActiveProcessDetailPanel('workflow')}>
                            Workflow
                          </Button>
                          <Button type="button" variant="outline-warning" onClick={() => setActiveProcessDetailPanel('versions')}>
                            Version diff
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
            <Card ref={manualSectionRef} className="border-0 shadow-sm" style={{ background: '#fffdfa', borderRadius: 24 }}>
              <Card.Body className="d-flex flex-column gap-3">
                <div className="small text-uppercase fw-bold text-danger">Procedure Manual</div>
                {manualPreviewLoading ? (
                  <div className="d-flex justify-content-end">
                    <div className="spinner-border spinner-border-sm text-danger" role="status" />
                  </div>
                ) : null}

                {!manualPreview ? (
                  <div className="border rounded-4 px-3 py-4 text-muted small bg-light">
                    {manualPreviewLoading ? 'Loading the procedure manual...' : 'The procedure manual is not available for this process yet.'}
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    <Accordion
                      activeKey={expandedManualSections}
                      onSelect={(eventKey) => {
                        if (Array.isArray(eventKey)) {
                          setExpandedManualSections(eventKey.filter(Boolean));
                          return;
                        }

                        const normalizedKey = String(eventKey || '');
                        if (!normalizedKey) {
                          return;
                        }

                        setExpandedManualSections((current) => (
                          current.includes(normalizedKey)
                            ? current.filter((entry) => entry !== normalizedKey)
                            : [...current, normalizedKey]
                        ));
                      }}
                      alwaysOpen
                    >
                      {MANUAL_SECTION_CHOICES.map((section) => (
                        <Accordion.Item key={section.key} eventKey={section.key} className="border rounded-4 overflow-hidden bg-white mb-2">
                          <Accordion.Header>{section.label}</Accordion.Header>
                          <Accordion.Body>
                            {renderManualSection(section.key)}
                          </Accordion.Body>
                        </Accordion.Item>
                      ))}
                    </Accordion>
                  </div>
                )}
              </Card.Body>
            </Card>
            <Modal show={!!activeProcessDetailPanel} onHide={() => setActiveProcessDetailPanel('')} size={['metadata', 'manual', 'versions'].includes(activeProcessDetailPanel) ? 'xl' : 'lg'} centered>
              <Modal.Header closeButton>
                <Modal.Title>
                  {{
                    info: 'Information',
                    subprocesses: 'Embedded Sub-processes',
                    workflow: 'Approval Workflow',
                    metadata: 'Metadata',
                    manual: 'Procedure Manual',
                    versions: 'Version Diff',
                  }[activeProcessDetailPanel] || 'Details'}
                </Modal.Title>
              </Modal.Header>
              <Modal.Body>
                {renderProcessDetailPanelContent()}
              </Modal.Body>
            </Modal>
          </Card.Body>
        </Card>
      </Container>
    );
  }

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
              <h4 className="mb-0 fw-bold">{publicView ? 'Process Map' : 'Processes'}</h4>
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
                <Badge bg="light" text="dark" className="align-self-center">{publicView ? 'Public Portal' : 'Read only'}</Badge>
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
                  <button type="button" className={`btn ${viewMode === 'hierarchy' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setViewMode('hierarchy')}><i className="bi bi-diagram-3 me-1" />Hierarchy</button>
                  <button type="button" className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setViewMode('list')}><i className="bi bi-list-ul me-1" />List</button>
                </div>
                <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />
                <InputGroup size="sm" style={{ maxWidth: 280 }}>
                  <InputGroup.Text className="bg-white"><i className="bi bi-search text-muted" /></InputGroup.Text>
                  <FormControl placeholder="Search..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className="border-start-0" />
                </InputGroup>
                <Form.Select size="sm" style={{ maxWidth: 180 }} value={filterCat} onChange={(event) => setFilterCat(event.target.value)}>
                  <option value="">All categories</option>
                  {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.pathLabel}</option>)}
                </Form.Select>
                {!publicView ? (
                  <Form.Select size="sm" style={{ maxWidth: 140 }} value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
                    <option value="">All statuses</option>                    <option value="draft">Draft</option>
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
                <Badge bg="secondary" className="ms-auto">{processes.length} process{processes.length === 1 ? '' : 'es'}</Badge>
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
        <div className="text-center py-5"><div className="spinner-border text-danger" role="status" /><p className="mt-2 text-muted small">Loading...</p></div>
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
                              {sectionCategories.length} categor{sectionCategories.length === 1 ? 'y' : 'ies'} - {sectionProcessCount} process{sectionProcessCount === 1 ? '' : 'es'}
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
                    <ExportMenu process={process} compact={!showExpandedProcessDownloadButton} />
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
                              <Button type="button" size="sm" variant="outline-secondary" onClick={() => handleImageExport(editingProcess)}>
                                PNG
                              </Button>
                              <Button type="button" size="sm" variant="outline-dark" onClick={() => handleExport(editingProcess)}>
                                BPMN
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline-dark"
                                onClick={() => handleProcessReportDownload(editingProcess, 'html')}
                                disabled={processReportBusy === 'html'}
                              >
                                {processReportBusy === 'html' ? 'Exporting...' : 'Manual HTML'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline-secondary"
                                onClick={() => handleProcessReportDownload(editingProcess, 'pdf')}
                                disabled={processReportBusy === 'pdf'}
                              >
                                {processReportBusy === 'pdf' ? 'Exporting...' : 'Manual PDF'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline-primary"
                                onClick={() => handleProcessReportDownload(editingProcess, 'docx')}
                                disabled={processReportBusy === 'docx'}
                              >
                                {processReportBusy === 'docx' ? 'Exporting...' : 'Manual Word'}
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
                                <span className="text-muted small">{new Date(commentEntry.created_at).toLocaleString('en-US')}</span>
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

            {editingProcess ? (
              <Row className="g-4 mt-1">
                <Col lg={12}>
                  <Card className="border-0 shadow-sm">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                        <div>
                          <h6 className="mb-1">Manual preview</h6>
                          <div className="text-muted small">
                            The popup now shows every generated manual section for the latest saved process version.
                          </div>
                        </div>
                        {manualPreviewLoading ? <div className="spinner-border spinner-border-sm text-danger" role="status" /> : null}
                      </div>

                      {canEditSelectedProcess ? (
                        <div className="text-muted small mb-3">
                          Save metadata to refresh this preview after editing the process details or BPMN diagram.
                        </div>
                      ) : null}

                      {!manualPreview ? (
                        <div className="border rounded-4 px-3 py-4 text-muted small bg-light">
                          {manualPreviewLoading ? 'Loading manual preview...' : 'Manual preview is not available for this process yet.'}
                        </div>
                      ) : (
                        <div className="d-flex flex-column gap-3">
                          {MANUAL_SECTION_CHOICES.map((section) => (
                            <div key={section.key}>
                              {renderManualSection(section.key)}
                            </div>
                          ))}
                        </div>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            ) : null}

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
                                  <div className="text-muted small">{version.created_at ? new Date(version.created_at).toLocaleString('en-US') : '-'}</div>
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
