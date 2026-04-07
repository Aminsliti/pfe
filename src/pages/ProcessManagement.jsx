import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Container, Row, Col, Card, Button, Modal, Form, Alert, Badge, InputGroup, FormControl, ProgressBar, Dropdown } from 'react-bootstrap';

const API = 'http://localhost:3001/api';
const BpmnEditorModeler = lazy(() => import('../components/BpmnEditor/BpmnEditorModeler'));
const BpmnProcessPreview = lazy(() => import('../components/BpmnEditor/BpmnProcessPreview'));

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

export function ProcessManagement() {
  const { company, hasPermission, isGlobalAdmin, hasRole, ROLES } = useAuth();
  const globalAdmin = isGlobalAdmin();
  const canViewWorkspace = hasPermission('view_dashboard') || hasPermission('manage_processes');
  const canManage = hasPermission('manage_processes');
  const isAdmin = hasRole(ROLES.ADMIN);
  const isDesigner = hasRole(ROLES.DESIGNER);
  const isValidator = hasRole(ROLES.VALIDATOR);
  const [processes, setProcesses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingProcess, setEditingProcess] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [message, setMessage] = useState({ text: '', type: 'success' });
  const [viewMode, setViewMode] = useState('hierarchy');
  const [bpmnTarget, setBpmnTarget] = useState(null);
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [uncategorisedExpanded, setUncategorisedExpanded] = useState(true);
  const [importForm, setImportForm] = useState({ name: '', description: '', category_id: '', company_id: globalAdmin ? '' : String(company?.id || ''), status: 'draft' });
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [formData, setFormData] = useState({ name: '', description: '', bpmn_xml: '', category_id: '', company_id: globalAdmin ? '' : String(company?.id || ''), status: 'draft' });
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', parent_id: '', company_id: globalAdmin ? '' : String(company?.id || '') });
  const [categoryError, setCategoryError] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
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
  const fileInputRef = useRef(null);

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: 'success' }), 4000);
  };

  const normalizeGovernedStatus = (status) => (status === 'active' ? 'approved' : status || 'draft');

  const canCreateDefinitions = isAdmin || isDesigner;
  const canEditProcessDefinition = (process) => {
    if (!process) {
      return canCreateDefinitions;
    }

    return isAdmin || (isDesigner && normalizeGovernedStatus(process.status) === 'draft');
  };
  const canDeleteProcessDefinition = (process) =>
    Boolean(process) && (isAdmin || (isDesigner && normalizeGovernedStatus(process.status) === 'draft'));
  const canSubmitForReview = (status) =>
    normalizeGovernedStatus(status) === 'draft' && (isAdmin || isDesigner);
  const canApproveProcess = (status) =>
    normalizeGovernedStatus(status) === 'review' && (isAdmin || isValidator);
  const canReturnToDraft = (status) =>
    ['review', 'approved'].includes(normalizeGovernedStatus(status)) && (isAdmin || isValidator);
  const canArchiveProcess = (status) =>
    normalizeGovernedStatus(status) === 'approved' && (isAdmin || isValidator);
  const canRestoreProcess = (status) =>
    normalizeGovernedStatus(status) === 'archived' && (isAdmin || isValidator);
  const canRequestChange = (status) =>
    normalizeGovernedStatus(status) === 'approved' && (isAdmin || isDesigner);

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

  useEffect(() => {
    if (canViewWorkspace) {
      loadCategories();
      loadTemplates();
    }
  }, [canViewWorkspace]);
  useEffect(() => { if (canViewWorkspace) loadProcesses(); }, [canViewWorkspace, searchTerm, filterCat, filterStatus]);
  useEffect(() => {
    setCollapsedCategories((previous) => {
      const next = { ...previous };
      let changed = false;
      categories.forEach((category) => {
        if (!(category.id in next)) {
          next[category.id] = false;
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
  }, [categories]);
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

  const openBpmnEditor = (process) => setBpmnTarget(process);
  const openCreate = (defaultCategoryId = '') => {
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
      category_id: defaultCategoryId,
      company_id: globalAdmin ? '' : String(company?.id || ''),
      status: 'draft',
    });
    setShowModal(true);
  };
  const openEditDetails = async (process) => {
    setEditingProcess(process);
    setFormData({
      name: process.name,
      description: process.description || '',
      bpmn_xml: process.bpmn_xml || '',
      category_id: process.category_id || '',
      company_id: process.company_id || (globalAdmin ? '' : String(company?.id || '')),
      status: normalizeUiStatus(process.status),
    });
    setWorkflowComment('');
    setVersionDiff(null);
    setWorkflowInfo(null);
    setProcessDetail(null);
    setShowModal(true);
    try {
      const detail = await hydrateProcessDetail(process.id);
      setFormData({
        name: detail.name,
        description: detail.description || '',
        bpmn_xml: detail.bpmn_xml || '',
        category_id: detail.category_id || '',
        company_id: detail.company_id || (globalAdmin ? '' : String(company?.id || '')),
        status: normalizeUiStatus(detail.status),
      });
      setEditingProcess(detail);
    } catch {
      showMsg('Failed to load process details', 'danger');
    }
  };
  const toggleCategory = (categoryId) => setCollapsedCategories((previous) => ({ ...previous, [categoryId]: !previous[categoryId] }));

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

  const openImportModal = () => {
    setImportForm({
      name: '',
      description: '',
      category_id: '',
      company_id: globalAdmin ? '' : String(company?.id || ''),
      status: 'draft',
    });
    setImportFile(null);
    setImportError('');
    setImportSuccess('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setShowImport(true);
  };

  const openCategoryModal = (parentId = '') => {
    setCategoryError('');
    setCategoryForm({
      name: '',
      description: '',
      parent_id: parentId ? String(parentId) : '',
      company_id: globalAdmin ? '' : String(company?.id || ''),
    });
    setShowCategoryModal(true);
  };

  const handleCategorySubmit = async (event) => {
    event.preventDefault();
    setCategoryError('');
    if (!categoryForm.name.trim()) {
      setCategoryError('Category name is required.');
      return;
    }

    setCategoryBusy(true);
    try {
      const response = await fetch(`${API}/process-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: categoryForm.name.trim(),
          description: categoryForm.description.trim() || null,
          parent_id: categoryForm.parent_id || null,
          company_id: categoryForm.company_id || null,
        }),
      });
      const payload = await readApiPayload(response, 'Failed to create category.');
      await loadCategories();
      showMsg(`Category "${payload.name}" created.`);
      setShowCategoryModal(false);
    } catch (error) {
      setCategoryError(error.message || 'Failed to create category.');
    } finally {
      setCategoryBusy(false);
    }
  };

  const handleDeleteCategory = async (category) => {
    if (!window.confirm(`Delete category "${category.name}"?`)) {
      return;
    }

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
          company_id: globalAdmin ? undefined : String(company?.id || ''),
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
    setShowModal(false);
    setEditingProcess(null);
    setProcessDetail(null);
    setWorkflowInfo(null);
    setWorkflowComment('');
    setVersionDiff(null);
    setVersionSelection({ fromVersion: '', toVersion: '' });
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
    if (!importFile) return setImportError('Please choose a BPMN or XML file.');
    setImporting(true);
    try {
      const form = new FormData();
      form.append('bpmnFile', importFile);
      form.append('name', importForm.name.trim());
      form.append('description', importForm.description || '');
      form.append('category_id', importForm.category_id || '');
      form.append('company_id', importForm.company_id || '');
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
    if (!window.confirm('Delete this process?')) return;
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData.name) return showMsg('Process name is required', 'danger');
    try {
      const url = editingProcess ? `${API}/processes/${editingProcess.id}` : `${API}/processes`;
      const method = editingProcess ? 'PUT' : 'POST';
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
      if (response.ok) {
        const saved = await response.json();
        showMsg(`Process ${editingProcess ? 'updated' : 'created'}`);
        await loadProcesses();
        if (editingProcess) {
          setEditingProcess(saved);
          await hydrateProcessDetail(saved.id);
        } else {
          setShowModal(false);
        }
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
      const response = await fetch(`${API}/processes/${id}/export${suffix}`);
      if (!response.ok) return showMsg('Export failed', 'danger');
      const blob = await response.blob();
      const filename = parseFilenameFromDisposition(response.headers.get('Content-Disposition'), 'process.bpmn');
      downloadBlob(blob, filename);
    } catch {
      showMsg('Network error', 'danger');
    }
  };

  const renderProcessDiagramImage = async (id, { version = null, mimeType = 'image/png', quality = 0.92 } = {}) => {
    let viewer;
    let mountNode;
    let svgUrl;

    const suffix = version ? `?version=${version}` : '';
    const response = await fetch(`${API}/processes/${id}/export${suffix}`);
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

      const response = await fetch(
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
  const availableVersions = processDetail?.versions || [];
  const currentWorkflowStatus = normalizeUiStatus(workflowInfo?.status || formData.status);
  const previewBpmnXml = processDetail?.bpmn_xml || editingProcess?.bpmn_xml || formData.bpmn_xml || '';
  const canEditSelectedProcess = editingProcess ? canEditProcessDefinition(editingProcess) : canCreateDefinitions;

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
        />
      </Suspense>
    );
  }

  if (!canViewWorkspace) {
    return <Container fluid className="py-4"><Alert variant="danger">You do not have permission to access processes.</Alert></Container>;
  }

  const ProcessRow = ({ process, indentLevel = 0 }) => (
    <div
      className="d-flex align-items-center gap-2 px-3 py-2"
      style={{
        borderBottom: '1px solid #f1f5f9',
        paddingLeft: indentLevel > 0 ? 132 + (indentLevel * 58) : 16,
        background: indentLevel > 0 ? '#fff1f2' : 'white',
        boxShadow: indentLevel > 0 ? 'inset 8px 0 0 #fca5a5' : 'none',
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
      {indentLevel > 0 && (
        <span style={{ color: '#ef4444', fontSize: 18, flexShrink: 0, marginRight: 10 }}>
          <i className="bi bi-arrow-return-right" />
        </span>
      )}
      <i className="bi bi-bezier2 text-muted" style={{ fontSize: 15, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: '#1e293b', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{process.name}</span>
      {process.description && <span className="text-muted d-none d-lg-inline" style={{ fontSize: 11, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{process.description}</span>}
      <Badge bg={statusVariant(process.status)} style={{ fontSize: 10, flexShrink: 0 }}>{statusLabel(process.status)}</Badge>
      <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>v{process.version}</span>
      <div className="d-flex gap-1 ms-1" style={{ flexShrink: 0 }}>
        {canApproveProcess(process.status) ? (
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
          <button type="button" onClick={(event) => { event.stopPropagation(); openBpmnEditor(process); }} title="Edit BPMN diagram" style={{ width: 30, height: 30, background: '#ef4444', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-pencil-fill" /></button>
        ) : null}
        <button type="button" onClick={(event) => { event.stopPropagation(); openEditDetails(process); }} title="Open details and diagram" style={{ width: 30, height: 30, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-info-circle" /></button>
        {canDeleteProcessDefinition(process) ? (
          <button type="button" onClick={(event) => { event.stopPropagation(); handleDelete(process.id); }} title="Delete" style={{ width: 30, height: 30, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-trash" /></button>
        ) : null}
        <ExportMenu process={process} compact />
      </div>
    </div>
  );

  const ExportMenu = ({ process, version = null, compact = false }) => (
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

  const CategoryBranch = ({ category, level = 0 }) => {
    const isCollapsed = !!collapsedCategories[category.id];
    const directProcesses = processesByCategory.get(String(category.id)) || [];
    const childCount = category.children.length;
    const totalCount = directProcesses.length + childCount;

    return (
      <div key={category.id}>
        <div
          className="d-flex align-items-center gap-2 py-2"
          style={{
            paddingLeft: 24 + (level * 34),
            borderBottom: '1px solid #f1f5f9',
            background: level === 0 ? 'white' : '#fffaf5',
          }}
        >
          <button
            type="button"
            onClick={() => toggleCategory(category.id)}
            className="d-flex align-items-center gap-2 flex-grow-1 text-start"
            style={{ background: 'none', border: 'none', padding: 0 }}
          >
            <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-down'}`} style={{ color: '#6c757d', fontSize: 12 }} />
            <i className={`bi ${level === 0 ? 'bi-diagram-3' : 'bi-diagram-2'} text-muted`} />
            <span style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>{category.name}</span>
            {category.description && <span className="text-muted ms-2" style={{ fontSize: 11 }}>{category.description}</span>}
            <Badge bg="light" text="dark" pill className="ms-auto">{totalCount}</Badge>
          </button>
          {canCreateDefinitions ? (
            <>
              <button
                type="button"
                className="me-1"
                title="Add sub-category"
                onClick={() => openCategoryModal(category.id)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 15, padding: '0 4px' }}
              >
                <i className="bi bi-node-plus" />
              </button>
              <button
                type="button"
                className="me-1"
                title="Add process"
                onClick={() => openCreate(String(category.id))}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
              >
                <i className="bi bi-plus-lg" />
              </button>
              <button
                type="button"
                className="me-2"
                title="Delete category"
                onClick={() => handleDeleteCategory(category)}
                style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 15, padding: '0 4px' }}
              >
                <i className="bi bi-trash" />
              </button>
            </>
          ) : null}
        </div>
        {!isCollapsed && (
          <>
            {category.children.map((childCategory) => (
              <CategoryBranch key={childCategory.id} category={childCategory} level={level + 1} />
            ))}
            {directProcesses.length === 0 && childCount === 0 ? (
              <div style={{ padding: `6px 16px 6px ${132 + ((level + 1) * 58)}px`, fontSize: 11, color: '#94a3b8', borderBottom: '1px solid #f8fafc', background: '#fff1f2', boxShadow: 'inset 8px 0 0 #fca5a5' }}>
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
            <h4 className="mb-0 fw-bold">Processus</h4>
            <div className="d-flex gap-2">
              {canCreateDefinitions ? (
                <>
                  <Button variant="outline-secondary" size="sm" onClick={() => openCategoryModal()}>
                    <i className="bi bi-diagram-2 me-1" />Categories
                  </Button>
                  <Button variant="outline-dark" size="sm" onClick={() => setShowTemplates(true)}>
                    <i className="bi bi-grid me-1" />Templates
                  </Button>
                  <Button variant="outline-secondary" size="sm" onClick={openImportModal}><i className="bi bi-upload me-1" />Import</Button>
                  <Button variant="danger" size="sm" onClick={() => openCreate()}><i className="bi bi-plus-lg me-1" />Nouveau</Button>
                </>
              ) : (
                <Badge bg="light" text="dark" className="align-self-center">Read only</Badge>
              )}
            </div>
          </div>
        </Col>
      </Row>

      {message.text && <Row className="mb-3"><Col><Alert variant={message.type} dismissible onClose={() => setMessage({ text: '', type: 'success' })}>{message.text}</Alert></Col></Row>}

      <Row className="mb-3">
        <Col>
          <Card className="border-0 shadow-sm">
            <Card.Body className="py-2 px-3">
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <div className="btn-group btn-group-sm">
                  <button type="button" className={`btn ${viewMode === 'hierarchy' ? 'btn-danger' : 'btn-outline-secondary'}`} onClick={() => setViewMode('hierarchy')}><i className="bi bi-diagram-3 me-1" />Hierarchie</button>
                  <button type="button" className={`btn ${viewMode === 'list' ? 'btn-danger' : 'btn-outline-secondary'}`} onClick={() => setViewMode('list')}><i className="bi bi-list-ul me-1" />Liste</button>
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
                <Form.Select size="sm" style={{ maxWidth: 140 }} value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
                  <option value="">Tous statuts</option>
                  <option value="draft">Draft</option>
                  <option value="review">In Review</option>
                  <option value="approved">Approved</option>
                  <option value="archived">Archived</option>
                </Form.Select>
                <Badge bg="secondary" className="ms-auto">{processes.length} processus</Badge>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {loading ? (
        <div className="text-center py-5"><div className="spinner-border text-danger" role="status" /><p className="mt-2 text-muted small">Chargement...</p></div>
      ) : viewMode === 'hierarchy' ? (
        <Row><Col><Card className="border-0 shadow-sm">
          <button type="button" onClick={() => setCategoriesExpanded((previous) => !previous)} className="d-flex align-items-center px-3 py-2 gap-2 w-100 text-start" style={{ background: '#f8f9fa', border: 'none', borderBottom: '1px solid #e2e8f0' }}>
            <i className={`bi ${categoriesExpanded ? 'bi-chevron-down' : 'bi-chevron-right'}`} style={{ color: '#6c757d', fontSize: 13 }} />
            <i className="bi bi-diagram-3 text-muted" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>Categories de processus</span>
            <Badge bg="light" text="dark" pill className="ms-auto">{categoryTree.roots.length}</Badge>
          </button>
          {categoriesExpanded && categoryTree.roots.map((category) => (
            <CategoryBranch key={category.id} category={category} />
          ))}
          {categoriesExpanded && uncategorised.length > 0 && (
            <div>
              <button type="button" onClick={() => setUncategorisedExpanded((previous) => !previous)} className="d-flex align-items-center gap-2 py-2 w-100 text-start" style={{ paddingLeft: 24, border: 'none', borderBottom: '1px solid #f1f5f9', background: 'white' }}>
                <i className={`bi ${uncategorisedExpanded ? 'bi-chevron-down' : 'bi-chevron-right'}`} style={{ color: '#6c757d', fontSize: 12 }} />
                <i className="bi bi-diagram-2 text-muted" />
                <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>Sans categorie</span>
                <Badge bg="light" text="dark" pill className="ms-auto me-3">{uncategorised.length}</Badge>
              </button>
              {uncategorisedExpanded && uncategorised.map((process) => <ProcessRow key={process.id} process={process} />)}
            </div>
          )}
          {categoryTree.roots.length === 0 && uncategorised.length === 0 && <div className="text-center py-5 text-muted"><i className="bi bi-diagram-3 display-5 d-block mb-2 opacity-25" /><p className="mb-0">No processes yet.</p><Button variant="danger" size="sm" className="mt-3" onClick={() => openCreate()}><i className="bi bi-plus-lg me-1" />Create first process</Button></div>}
        </Card></Col></Row>
      ) : (
        <Row><Col><Card className="border-0 shadow-sm"><div style={{ overflowX: 'auto' }}>
          <table className="table table-hover mb-0" style={{ minWidth: 650 }}>
            <thead className="table-light"><tr><th>Name</th><th>Category</th><th>Status</th><th>Version</th><th>Updated</th><th style={{ width: 150 }}>Actions</th></tr></thead>
            <tbody>
              {processes.length === 0 ? <tr><td colSpan={6} className="text-center py-4 text-muted">No processes found</td></tr> : processes.map((process) => (
                <tr
                  key={process.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openEditDetails(process)}
                >
                  <td><strong>{process.name}</strong>{process.description && <div className="text-muted" style={{ fontSize: 11 }}>{process.description}</div>}</td>
                  <td>{getCategoryLabel(process) || <span className="text-muted">-</span>}</td>
                  <td><Badge bg={statusVariant(process.status)}>{statusLabel(process.status)}</Badge></td>
                  <td>v{process.version}</td>
                  <td>{process.updated_at ? new Date(process.updated_at).toLocaleDateString() : '-'}</td>
                  <td><div className="d-flex gap-1">
                    {canApproveProcess(process.status) ? (
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
                      <button type="button" onClick={(event) => { event.stopPropagation(); openBpmnEditor(process); }} className="btn btn-danger btn-sm" style={{ padding: '3px 7px' }}><i className="bi bi-pencil-fill" /></button>
                    ) : null}
                    <button type="button" onClick={(event) => { event.stopPropagation(); openEditDetails(process); }} className="btn btn-outline-secondary btn-sm" style={{ padding: '3px 7px' }}><i className="bi bi-info-circle" /></button>
                    <ExportMenu process={process} compact />
                    {canDeleteProcessDefinition(process) ? (
                      <button type="button" onClick={(event) => { event.stopPropagation(); handleDelete(process.id); }} className="btn btn-outline-danger btn-sm" style={{ padding: '3px 7px' }}><i className="bi bi-trash" /></button>
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
                          {canApproveProcess(currentWorkflowStatus) ? (
                            <Button
                              size="sm"
                              variant="success"
                              onClick={() => handleWorkflowAction('approve', editingProcess)}
                              disabled={workflowBusy === 'approve'}
                            >
                              {workflowBusy === 'approve' ? 'Approving...' : 'Approve diagram'}
                            </Button>
                          ) : null}
                          <Button size="sm" variant="outline-secondary" onClick={() => handleImageExport(editingProcess.id)}>
                            PNG
                          </Button>
                          <Button size="sm" variant="outline-dark" onClick={() => handleExport(editingProcess.id)}>
                            BPMN
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-dark"
                            onClick={() => handleProcessReportDownload(editingProcess.id, 'html')}
                            disabled={processReportBusy === 'html'}
                          >
                            {processReportBusy === 'html' ? 'Exporting...' : 'HTML'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => handleProcessReportDownload(editingProcess.id, 'pdf')}
                            disabled={processReportBusy === 'pdf'}
                          >
                            {processReportBusy === 'pdf' ? 'Exporting...' : 'PDF'}
                          </Button>
                          {canEditSelectedProcess ? (
                            <Button size="sm" variant="danger" onClick={() => openBpmnEditor(editingProcess)}>
                              Edit diagram
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <Suspense fallback={<div className="text-muted small">Loading BPMN preview...</div>}>
                        <BpmnProcessPreview xml={previewBpmnXml} />
                      </Suspense>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            )}

            <Row className="g-4">
              <Col lg={editingProcess ? 6 : 12}>
                <Card className="border-0 bg-light-subtle">
                  <Card.Body>
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
                          <Form.Label>Category</Form.Label>
                          <Form.Select disabled={!canEditSelectedProcess} value={formData.category_id} onChange={(event) => setFormData({ ...formData, category_id: event.target.value })}>
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
                  </Card.Body>
                </Card>
              </Col>

              {editingProcess && (
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

                      <Form.Group className="mb-3">
                        <Form.Label>Workflow comment</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={3}
                          placeholder="Add the governance note that accompanies this workflow action."
                          value={workflowComment}
                          onChange={(event) => setWorkflowComment(event.target.value)}
                        />
                      </Form.Group>

                      <div className="d-flex flex-wrap gap-2 mb-3">
                        {canSubmitForReview(currentWorkflowStatus) && (
                          <Button variant="info" onClick={() => handleWorkflowAction('submit_review')} disabled={!!workflowBusy}>
                            {workflowBusy === 'submit_review' ? 'Submitting...' : 'Submit for review'}
                          </Button>
                        )}
                        {canApproveProcess(currentWorkflowStatus) && (
                          <>
                            <Button variant="success" onClick={() => handleWorkflowAction('approve')} disabled={!!workflowBusy}>
                              {workflowBusy === 'approve' ? 'Approving...' : 'Approve'}
                            </Button>
                          </>
                        )}
                        {canReturnToDraft(currentWorkflowStatus) && (
                          <>
                            <Button variant="outline-secondary" onClick={() => handleWorkflowAction('return_draft')} disabled={!!workflowBusy}>
                              {currentWorkflowStatus === 'approved' ? 'Reopen as draft' : 'Return to draft'}
                            </Button>
                          </>
                        )}
                        {canArchiveProcess(currentWorkflowStatus) && (
                          <>
                            <Button variant="warning" onClick={() => handleWorkflowAction('archive')} disabled={!!workflowBusy}>
                              Archive
                            </Button>
                          </>
                        )}
                        {canRequestChange(currentWorkflowStatus) && (
                          <Button variant="outline-danger" onClick={() => handleWorkflowAction('request_change')} disabled={!!workflowBusy}>
                            {workflowBusy === 'request_change' ? 'Sending...' : 'Request change'}
                          </Button>
                        )}
                        {canRestoreProcess(currentWorkflowStatus) && (
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
                              <div className="text-muted small text-uppercase mt-1">{commentEntry.action.replace(/_/g, ' ')}</div>
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

            {editingProcess && (
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
                <Button type="submit" variant="danger">{editingProcess ? 'Save metadata' : 'Create'}</Button>
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
              <Form.Group className="mb-3"><Form.Label>Category</Form.Label><Form.Select value={importForm.category_id} onChange={(event) => setImportForm((previous) => ({ ...previous, category_id: event.target.value }))}><option value="">No category</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.pathLabel}</option>)}</Form.Select></Form.Group>
              {importing && <ProgressBar animated now={100} label="Importing..." className="mb-3" />}
              <div className="d-flex justify-content-end gap-2">
                <Button variant="secondary" onClick={() => setShowImport(false)} disabled={importing}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={importing || !importFile}>{importing ? <><span className="spinner-border spinner-border-sm me-2" />Importing...</> : <><i className="bi bi-upload me-2" />Import</>}</Button>
              </div>
            </Form>
          )}
        </Modal.Body>
      </Modal>

      <Modal show={showCategoryModal} onHide={() => !categoryBusy && setShowCategoryModal(false)} size="lg">
        <Modal.Header closeButton={!categoryBusy}>
          <Modal.Title><i className="bi bi-diagram-2 me-2 text-danger" />New category</Modal.Title>
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
                    onChange={(event) => setCategoryForm((previous) => ({ ...previous, parent_id: event.target.value }))}
                  >
                    <option value="">Root category</option>
                    {categoryOptions.map((category) => (
                      <option key={category.id} value={category.id}>{category.pathLabel}</option>
                    ))}
                  </Form.Select>
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
              <Button variant="secondary" onClick={() => setShowCategoryModal(false)} disabled={categoryBusy}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={categoryBusy}>{categoryBusy ? 'Creating...' : 'Create category'}</Button>
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
