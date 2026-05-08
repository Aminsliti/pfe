import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal } from 'react-bootstrap';
import { buildBpmnSubprocessTrail, getBpmnSubprocesses } from '../utils/bpmnSubprocesses';

import { API_BASE } from '../utils/api';
import { useAuth, ROLES } from '../contexts/AuthContext';
import { useSnackbar } from '../components/SnackbarProvider';

const API = API_BASE;
const BpmnProcessPreview = lazy(() => import('../components/BpmnEditor/BpmnProcessPreview'));
const BpmnEditorModeler = lazy(() => import('../components/BpmnEditor/BpmnEditorModeler'));

const SECTION_CONFIG = {
  pilotage: {
    title: 'Processus de pilotage',
    accent: '#991b1b',
    background: '#fff7f5',
  },
  metiers: {
    title: 'Processus metiers',
    accent: '#0f766e',
    background: '#f2fbfa',
  },
  support: {
    title: 'Processus support',
    accent: '#92400e',
    background: '#fff9f0',
  },
};

const CATEGORY_CARD_THEME = {
  background: 'linear-gradient(135deg,#0f766e 0%,#14b8a6 100%)',
  color: '#ffffff',
  border: '#5eead4',
};

const STATUS_META = {
  active: { label: 'Actif', bg: '#dcfce7', color: '#166534' },
  approved: { label: 'Approuve', bg: '#dcfce7', color: '#166534' },
  review: { label: 'En revue', bg: '#dbeafe', color: '#1d4ed8' },
  draft: { label: 'Brouillon', bg: '#fef3c7', color: '#92400e' },
  archived: { label: 'Archive', bg: '#e2e8f0', color: '#475569' },
};

const DEFAULT_SECTION = 'metiers';
const SECTION_IDS = Object.keys(SECTION_CONFIG);

function parseNavigationParam(value = '') {
  return String(value || '')
    .split(',')
    .map((entry) => {
      const [type, rawId] = entry.split(':');
      const id = Number(rawId);
      if (!['category', 'process'].includes(type) || !Number.isInteger(id) || id <= 0) {
        return null;
      }
      return { type, id };
    })
    .filter(Boolean);
}

function serializeNavigationParam(entries = []) {
  return entries
    .filter((entry) => entry && ['category', 'process'].includes(entry.type) && Number.isInteger(Number(entry.id)))
    .map((entry) => `${entry.type}:${Number(entry.id)}`)
    .join(',');
}

function normalizeText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function formatDate(value) {
  try {
    return value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value)) : '-';
  } catch {
    return '-';
  }
}

function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.draft;
}

function statusMatches(status, filter) {
  if (filter === 'all') return true;
  if (filter === 'approved') return status === 'approved' || status === 'active';
  return status === filter;
}

function normalizeSection(value, fallbackValue = DEFAULT_SECTION) {
  const normalized = normalizeText(value);
  return SECTION_IDS.includes(normalized) ? normalized : fallbackValue;
}

function matchesProcessSearch(process, searchValue) {
  if (!searchValue) return true;
  const haystack = normalizeText(`${process.name} ${process.description || ''} ${process.category_name || ''} ${process.created_by_name || ''}`);
  return haystack.includes(searchValue);
}

function matchesCategorySearch(category, searchValue) {
  if (!searchValue) return true;
  return normalizeText(`${category.name} ${category.description || ''}`).includes(searchValue);
}

function buildProcessTree(processes = []) {
  const byId = new Map();
  const roots = [];

  processes.forEach((process) => {
    byId.set(process.id, { ...process, children: [], childCount: 0, descendantCount: 0 });
  });

  byId.forEach((process) => {
    const parent = process.parent_id ? byId.get(process.parent_id) : null;
    if (parent) parent.children.push(process);
    else roots.push(process);
  });

  const sortBranch = (items) => {
    items.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    items.forEach((item) => sortBranch(item.children));
  };

  const decorate = (node) => {
    node.childCount = node.children.length;
    node.descendantCount = node.children.reduce((sum, child) => sum + 1 + decorate(child), 0);
    return node.descendantCount;
  };

  sortBranch(roots);
  roots.forEach((root) => decorate(root));
  return { roots, byId };
}

function buildCategoryTree(categories = [], rootProcesses = []) {
  const byId = new Map();
  const roots = [];

  categories.forEach((category) => {
    byId.set(category.id, {
      ...category,
      children: [],
      processes: [],
      section: normalizeSection(category.section),
      totalProcessCount: 0,
    });
  });

  byId.forEach((category) => {
    const parent = category.parent_id ? byId.get(category.parent_id) : null;
    if (parent) parent.children.push(category);
    else roots.push(category);
  });

  rootProcesses.forEach((process) => {
    const category = process.category_id ? byId.get(Number(process.category_id)) : null;
    if (category) category.processes.push(process);
  });

  const sortBranch = (items) => {
    items.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    items.forEach((item) => {
      item.processes.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
      sortBranch(item.children);
    });
  };

  const decorate = (node, inheritedSection = null) => {
    node.section = normalizeSection(node.section, inheritedSection || DEFAULT_SECTION);
    node.children.forEach((child) => decorate(child, node.section));
    node.totalProcessCount = node.processes.reduce((sum, process) => sum + 1 + process.descendantCount, 0) + node.children.reduce((sum, child) => sum + child.totalProcessCount, 0);
  };

  sortBranch(roots);
  roots.forEach((root) => decorate(root));
  return { roots, byId };
}

function isProcessVisible(process, searchValue, statusFilter) {
  const selfVisible = matchesProcessSearch(process, searchValue) && statusMatches(process.status, statusFilter);
  return selfVisible || process.children.some((child) => isProcessVisible(child, searchValue, statusFilter));
}

function isCategoryVisible(category, searchValue, statusFilter) {
  const selfVisible = matchesCategorySearch(category, searchValue);
  const hasProcess = category.processes.some((process) => isProcessVisible(process, searchValue, statusFilter));
  const hasChild = category.children.some((child) => isCategoryVisible(child, searchValue, statusFilter));
  return selfVisible || hasProcess || hasChild;
}

function HeroStat({ label, value }) {
  return (
    <div className="border rounded-4 bg-white px-3 py-2 shadow-sm h-100">
      <div className="small text-uppercase text-muted fw-bold mb-1" style={{ fontSize: 10.5 }}>{label}</div>
      <div className="fw-bold text-dark lh-1" style={{ fontSize: '1.55rem' }}>{value}</div>
    </div>
  );
}

function VerticalLane({ children, compact = false }) {
  return (
    <div className={`d-flex flex-column ${compact ? 'gap-2' : 'gap-3'}`}>
      {children}
    </div>
  );
}

function CategoryCard({ category, onOpen, compact = false }) {
  const compactStyle = {
    width: '100%',
    minHeight: 96,
    height: 96,
    background: CATEGORY_CARD_THEME.background,
    color: CATEGORY_CARD_THEME.color,
    borderRadius: 14,
    border: `1px solid ${CATEGORY_CARD_THEME.border}`,
  };

  if (compact) {
    return (
      <button
        type="button"
        className="card border-0 shadow-sm text-start"
        onClick={() => onOpen(category)}
        style={compactStyle}
      >
        <div className="card-body p-2 d-flex align-items-center justify-content-between gap-2 h-100">
          <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
            <span className="small opacity-75"><i className="bi bi-diagram-3" /></span>
            <div
              className="fw-semibold lh-sm"
              style={{ minWidth: 0, fontSize: '0.92rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {category.name}
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap justify-content-end flex-shrink-0">
            <span className="badge text-bg-light">{category.children.length}</span>
            <span className="badge text-bg-light">{category.totalProcessCount}</span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="card border-0 shadow-sm text-start"
      onClick={() => onOpen(category)}
      style={{
        width: '100%',
        minHeight: compact ? 100 : 132,
        background: CATEGORY_CARD_THEME.background,
        color: CATEGORY_CARD_THEME.color,
        borderRadius: 20,
        border: `1px solid ${CATEGORY_CARD_THEME.border}`,
      }}
    >
      <div className="card-body d-flex flex-column gap-2 p-3">
        <div className="small text-uppercase fw-bold opacity-75"><i className="bi bi-diagram-3 me-2" />Categorie</div>
        <div className="fs-6 fw-bold lh-sm">{category.name}</div>
        <div className="mt-auto d-flex flex-wrap gap-2">
          <span className="badge text-bg-light">{category.children.length} sous-categorie(s)</span>
          <span className="badge text-bg-light">{category.totalProcessCount} total</span>
        </div>
      </div>
    </button>
  );
}

function ProcessCard({ process, onOpen, publicView = false, compact = false }) {
  const status = getStatusMeta(process.status);
  const cardStyle = compact
    ? {
        width: '100%',
        minHeight: 118,
        height: 118,
        background: 'linear-gradient(135deg,#0f4c5c 0%,#0f766e 100%)',
        color: 'white',
        borderRadius: 16,
      }
    : {
        width: '100%',
        minHeight: 132,
        height: 132,
        background: 'linear-gradient(135deg,#0f4c5c 0%,#0f766e 100%)',
        color: 'white',
        borderRadius: 20,
      };

  if (compact) {
    return (
      <button
        type="button"
        className="card border-0 shadow-sm text-start"
        onClick={() => onOpen(process)}
        style={cardStyle}
      >
        <div className="card-body p-2 d-flex flex-column gap-2 h-100">
          <div className="small text-uppercase fw-bold opacity-75">
            <i className="bi bi-bezier2 me-2" />
            {process.childCount > 0 ? 'Macro-processus' : 'Processus'}
          </div>
          <div
            className="fw-semibold lh-sm"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {process.name}
          </div>
          <div className="d-flex flex-wrap gap-2 mt-1">
            <span className="badge" style={{ background: status.bg, color: status.color }}>{status.label}</span>
            <span className="badge text-bg-light">v{process.version || 1}</span>
          </div>
        </div>
      </button>
    );
  }

  return (
      <button
        type="button"
        className="card border-0 shadow-sm text-start"
        onClick={() => onOpen(process)}
        style={cardStyle}
      >
      <div className="card-body d-flex flex-column gap-2 p-3 h-100">
        <div className="small text-uppercase fw-bold opacity-75"><i className="bi bi-bezier2 me-2" />{process.childCount > 0 ? 'Macro-processus' : 'Processus'}</div>
        <div className="fs-6 fw-bold lh-sm" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{process.name}</div>
        {!publicView ? (
          <div className="small opacity-75" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {process.description || 'Ouvrez ce processus pour continuer la navigation jusqu au diagramme BPMN.'}
          </div>
        ) : null}
        <div className="mt-auto d-flex flex-wrap gap-2">
          <span className="badge" style={{ background: status.bg, color: status.color }}>{status.label}</span>
          <span className="badge text-bg-light">v{process.version || 1}</span>
          <span className="badge text-bg-light">{process.childCount > 0 ? `${process.childCount} sous-processus` : 'Diagramme final'}</span>
        </div>
      </div>
    </button>
  );
}

function EmptyBox({ title, text }) {
  return (
    <div className="border border-dashed rounded-4 bg-white px-4 py-4 text-muted">
      <div className="fw-bold text-dark mb-2">{title}</div>
      <div>{text}</div>
    </div>
  );
}

function RootSection({ sectionId, categories, looseProcesses, onOpenCategory, onOpenProcess, publicView = false, collapsed = false, onToggle }) {
  const section = SECTION_CONFIG[sectionId];
  if (!categories.length && !looseProcesses.length) return null;

  return (
    <section className="card border-0 shadow-sm" style={{ background: section.background, borderRadius: publicView ? 22 : 28 }}>
      <div className={`card-body d-flex flex-column ${publicView ? 'p-3 gap-3' : 'p-4 gap-4'}`}>
        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
          <div>
            <h2 className="mb-0" style={{ color: section.accent, fontSize: publicView ? '1.15rem' : undefined }}>{section.title}</h2>
          </div>
          <div className="d-flex gap-2 flex-wrap align-items-center">
            <span className="badge rounded-pill text-bg-light">{categories.length} categories</span>
            {looseProcesses.length ? <span className="badge rounded-pill text-bg-light">{looseProcesses.length} sans categorie</span> : null}
            {onToggle ? (
              <button type="button" className="btn btn-sm btn-outline-secondary rounded-pill" onClick={onToggle}>
                <i className={`bi ${collapsed ? 'bi-chevron-down' : 'bi-chevron-up'} me-2`} />
                {collapsed ? 'Ouvrir' : 'Reduire'}
              </button>
            ) : null}
          </div>
        </div>

        {!collapsed && categories.length ? (
          <VerticalLane compact={publicView}>
            {categories.map((category) => (
              <CategoryCard key={category.id} category={category} onOpen={onOpenCategory} compact={publicView} />
            ))}
          </VerticalLane>
        ) : null}

        {!collapsed && looseProcesses.length ? (
          <div className={`d-flex flex-column ${publicView ? 'gap-2' : 'gap-3'}`}>
            <h3 className="h5 mb-0">Processus sans categorie</h3>
            <VerticalLane compact={publicView}>
              {looseProcesses.map((process) => (
                <ProcessCard key={process.id} process={process} onOpen={onOpenProcess} publicView={publicView} />
              ))}
            </VerticalLane>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CategoryView({ category, childCategories, directProcesses, onOpenCategory, onOpenProcess, onBack, publicView = false }) {
  const showsCategoriesOnly = childCategories.length > 0;
  const visibleProcesses = showsCategoriesOnly ? [] : directProcesses;
  return (
    <section className="card border-0 shadow-sm bg-white" style={{ borderRadius: 28 }}>
      <div className="card-body p-4 d-flex flex-column gap-4">
        <div className="d-flex justify-content-between align-items-start gap-3">
          <div>
            <div className="small text-uppercase fw-bold text-danger mb-2"><i className="bi bi-diagram-2 me-2" />Categorie</div>
            <h2 className="mb-2">{category.name}</h2>
            <p className="mb-0 text-muted">{category.description || 'Descendez niveau par niveau dans cette branche.'}</p>
          </div>
          <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill flex-shrink-0" onClick={onBack}>
            <i className="bi bi-arrow-left me-2" />Retour
          </button>
        </div>

        <div className="d-flex gap-2 flex-wrap">
          <span className="badge rounded-pill text-bg-light">{childCategories.length} sous-categorie(s)</span>
          <span className="badge rounded-pill text-bg-light">{visibleProcesses.length} processus</span>
        </div>

        {showsCategoriesOnly ? (
          <div className="d-flex flex-column gap-3">
            <h3 className="h5 mb-0">Sous-categories</h3>
            <div className="row g-3">
              {childCategories.map((child) => (
                <div className="col-md-6 col-xl-4" key={child.id}>
                  <CategoryCard category={child} onOpen={onOpenCategory} compact />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="d-flex flex-column gap-3">
            <h3 className="h5 mb-0">Processus</h3>
            {visibleProcesses.length ? (
              <div className="row g-3">
                  {visibleProcesses.map((process) => (
                    <div className="col-md-6 col-xl-4" key={process.id}>
                      <ProcessCard process={process} onOpen={onOpenProcess} publicView={publicView} compact />
                    </div>
                  ))}
                </div>
            ) : (
              <EmptyBox title="Aucun processus visible" text="Aucun processus approuve n est visible dans cette categorie." />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ProcessBranchView({ process, children, onOpenProcess, onBack, publicView = false }) {
  return (
    <section className="card border-0 shadow-sm bg-white" style={{ borderRadius: 28 }}>
      <div className="card-body p-4 d-flex flex-column gap-4">
        <div className="d-flex justify-content-between align-items-start gap-3">
          <div>
            <div className="small text-uppercase fw-bold text-danger mb-2"><i className="bi bi-bezier2 me-2" />Macro-processus</div>
            <h2 className="mb-2">{process.name}</h2>
            <p className="mb-0 text-muted">{publicView ? 'Ouvrez un sous-processus pour continuer jusqu au detail du diagramme.' : (process.description || 'Ouvrez un sous-processus pour continuer jusqu au diagramme detaille.')}</p>
          </div>
          <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill flex-shrink-0" onClick={onBack}>
            <i className="bi bi-arrow-left me-2" />Retour
          </button>
        </div>

        <div className="d-flex gap-2 flex-wrap">
          <span className="badge rounded-pill text-bg-light">{children.length} sous-processus visible(s)</span>
          <span className="badge rounded-pill text-bg-light">{process.descendantCount} niveau(x) en profondeur</span>
        </div>

        {children.length ? (
          publicView ? (
            <div className="row g-3">
              {children.map((child) => (
                <div className="col-md-6 col-xl-4" key={child.id}>
                  <ProcessCard process={child} onOpen={onOpenProcess} publicView compact />
                </div>
              ))}
            </div>
          ) : (
            <VerticalLane>
              {children.map((child) => (
                <ProcessCard key={child.id} process={child} onOpen={onOpenProcess} publicView={publicView} />
              ))}
            </VerticalLane>
          )
        ) : (
          <EmptyBox title="Aucun sous-processus visible" text="Ajustez vos filtres ou revenez en arriere pour choisir une autre branche." />
        )}
      </div>
    </section>
  );
}

function ProcessLeafView({ process, onBack, publicView = false, onRefresh = null }) {
  const { user, hasAnyRole } = useAuth();
  const { showSnackbar } = useSnackbar();
  const status = getStatusMeta(process.status);
  const [previewRootElementId, setPreviewRootElementId] = useState(null);
  const [showDiagramModal, setShowDiagramModal] = useState(false);
  const [bpmnTarget, setBpmnTarget] = useState(null);
  const [exportBusy, setExportBusy] = useState('');
  const subprocesses = useMemo(() => getBpmnSubprocesses(process.bpmn_xml), [process.bpmn_xml]);
  const previewTrail = useMemo(
    () => buildBpmnSubprocessTrail(subprocesses, previewRootElementId),
    [subprocesses, previewRootElementId]
  );

  useEffect(() => {
    setPreviewRootElementId(null);
  }, [process.id, process.bpmn_xml]);

  useEffect(() => {
    if (previewRootElementId && !subprocesses.some((subprocess) => subprocess.id === previewRootElementId)) {
      setPreviewRootElementId(null);
    }
  }, [previewRootElementId, subprocesses]);

  const buildEditorRootProcess = (p) => ({
    id: p?.id,
    name: p?.name || 'Process',
    bpmn_xml: p?.bpmn_xml || '',
    version: p?.version || null,
    category_id: p?.category_id ?? null,
    description: p?.description || '',
    status: p?.status || 'draft',
  });

  const mainProcessRootRef = useRef(null);

  const openBpmnEditor = (initialSubprocessId = null) => {
    if (publicView) return;
    const rootProcess = buildEditorRootProcess(process);
    mainProcessRootRef.current = rootProcess;
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

  const downloadBlob = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const parseFilenameFromDisposition = (disposition, fallback) => {
    const match = disposition?.match(/filename="?([^"]+)"?/i);
    return match?.[1] || fallback;
  };

  const replaceExtension = (filename, nextExtension) => {
    const safe = filename || 'process.bpmn';
    return safe.replace(/\.[^./\\]+$/i, nextExtension);
  };

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    if (!(blob instanceof Blob)) {
      reject(new Error('Unable to render the diagram image for this export.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read the rendered diagram image.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });

  const readApiPayload = async (response, fallbackError = 'Request failed') => {
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      throw new Error(
        contentType.includes('application/json')
          ? payload?.error || fallbackError
          : payload || fallbackError
      );
    }
    return payload;
  };

  const fetchProtectedProcessAsset = (url, init = undefined) => {
    if (!user?.id) {
      throw new Error('Your session expired. Please log in again.');
    }
    const headers = new Headers(init?.headers);
    headers.set('x-user-id', String(user.id));
    return fetch(url, { ...init, headers });
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

      viewer = new NavigatedViewer({ container: mountNode, width: 1800, height: 1200 });
      await viewer.importXML(xml);
      viewer.get('canvas')?.zoom('fit-viewport');

      const { svg } = await viewer.saveSVG();
      const viewBox = svg.match(/viewBox="([^"]+)"/i)?.[1]?.split(/\s+/).map(Number) || [];
      const width = Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? Math.ceil(viewBox[2]) : 1800;
      const height = Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? Math.ceil(viewBox[3] ) : 1200;
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
          if (blob) resolve(blob);
          else reject(new Error('Unable to create a diagram image.'));
        }, mimeType, quality);
      });

      return {
        blob: imageBlob,
        filename: replaceExtension(sourceFilename, mimeType === 'image/png' ? '.png' : '.jpg'),
      };
    } finally {
      if (viewer) viewer.destroy();
      if (mountNode?.parentNode) mountNode.parentNode.removeChild(mountNode);
      if (svgUrl) URL.revokeObjectURL(svgUrl);
    }
  };

  const handleImageExport = async (id) => {
    setExportBusy('png');
    try {
      const rendered = await renderProcessDiagramImage(id, { mimeType: 'image/png' });
      if (!rendered) return;
      downloadBlob(rendered.blob, rendered.filename);
    } catch (error) {
      showSnackbar(error.message || 'Image export failed', 'danger');
    } finally {
      setExportBusy('');
    }
  };

  const handleExport = async (id) => {
    setExportBusy('bpmn');
    try {
      const response = await fetchProtectedProcessAsset(`${API}/processes/${id}/export`);
      if (!response.ok) {
        await readApiPayload(response, 'Export failed');
        return;
      }
      const blob = await response.blob();
      const filename = parseFilenameFromDisposition(response.headers.get('Content-Disposition'), 'process.bpmn');
      downloadBlob(blob, filename);
    } catch (error) {
      showSnackbar(error.message || 'Export failed', 'danger');
    } finally {
      setExportBusy('');
    }
  };

  const handleProcessReportDownload = async (id, format = 'pdf') => {
    setExportBusy(format);
    try {
      const needsDiagramImage = ['pdf', 'docx', 'html'].includes(format);
      let diagramImageDataUrl = null;
      if (needsDiagramImage) {
        const rendered = await renderProcessDiagramImage(id, { mimeType: 'image/jpeg', quality: 0.9 });
        if (!rendered?.blob) throw new Error(`Diagram preview could not be rendered for the ${format.toUpperCase()} export.`);
        diagramImageDataUrl = await blobToDataUrl(rendered.blob);
      }

      const requestOptions = needsDiagramImage
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ format, diagramImageDataUrl }),
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
      const filename = parseFilenameFromDisposition(response.headers.get('Content-Disposition'), `process-${id}-manuel-de-procedure.${extension}`);
      downloadBlob(blob, filename);
    } catch (error) {
      showSnackbar(error.message || 'Export failed', 'danger');
    } finally {
      setExportBusy('');
    }
  };

  const canEdit = !publicView && hasAnyRole([ROLES.ADMIN, ROLES.DESIGNER, ROLES.VALIDATOR]);

  if (bpmnTarget) {
    return (
      <Suspense fallback={<div className="text-muted py-4">Loading BPMN editor...</div>}>
        <BpmnEditorModeler
          process={bpmnTarget}
          onClose={() => {
            setBpmnTarget(null);
            setShowDiagramModal(false);
            if (onRefresh) onRefresh();
          }}
          onSave={async (bpmnXml) => {
            const response = await fetch(`${API}/processes/${bpmnTarget.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: bpmnTarget.name,
                description: bpmnTarget.description || '',
                status: bpmnTarget.status,
                category_id: bpmnTarget.category_id || null,
                bpmn_xml: bpmnXml,
                change_description: 'Updated via BPMN editor (Process Library)',
              }),
            });
            if (!response.ok) {
              const payload = await response.json().catch(() => ({}));
              throw new Error(payload.error || 'Save failed');
            }
            setBpmnTarget(null);
            setShowDiagramModal(false);
            if (onRefresh) onRefresh();
          }}
          importOptions={[]}
          onImportExisting={async (processId) => {
            const response = await fetch(`${API}/processes/${processId}`);
            const detail = await response.json();
            return { xml: detail?.bpmn_xml || '', name: detail?.name || 'Process' };
          }}
          onOpenLinkedProcess={() => {}}
          onReturnToMainProcess={() => {}}
          initialSubprocessId={bpmnTarget.initialSubprocessId}
        />
      </Suspense>
    );
  }

  return (
    <section className="card border-0 shadow-sm bg-white" style={{ borderRadius: 28 }}>
      <div className="card-body p-4 d-flex flex-column gap-4">
        <div className="d-flex justify-content-between align-items-start gap-3">
          <div>
            <div className="small text-uppercase fw-bold text-danger mb-2"><i className="bi bi-image me-2" />Diagramme BPMN final</div>
            <h2 className="mb-2">{process.name}</h2>
            <p className="mb-0 text-muted">{process.description || 'Vous avez atteint le dernier niveau de navigation: le diagramme du processus detaille.'}</p>
          </div>
          <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill flex-shrink-0" onClick={onBack}>
            <i className="bi bi-arrow-left me-2" />Retour
          </button>
        </div>

        <div className="d-flex gap-2 flex-wrap">
          <span className="badge rounded-pill" style={{ background: status.bg, color: status.color }}>{status.label}</span>
          <span className="badge rounded-pill text-bg-light">v{process.version || 1}</span>
        </div>

        <div className="row g-4">
          <div className="col-xl-8">
            <button
              type="button"
              className="border rounded-4 bg-white p-3 shadow-sm w-100 text-start"
              style={{ cursor: 'zoom-in' }}
              onClick={() => setShowDiagramModal(true)}
            >
              <div className="small text-muted mb-2">Cliquez sur le diagramme pour l ouvrir.</div>
              <Suspense fallback={<div className="text-center py-5 text-muted">Rendu du diagramme BPMN...</div>}>
                <BpmnProcessPreview xml={process.bpmn_xml} rootElementId={previewRootElementId} />
              </Suspense>
            </button>
          </div>
          <div className="col-xl-4">
            <div className="d-flex flex-column gap-3 h-100">
              <div className="card border-0 shadow-sm" style={{ background: '#fffdfa', borderRadius: 24 }}>
                <div className="card-body d-flex flex-column gap-3">
                  <h3 className="h5 mb-0">Informations</h3>
                  <div className="d-flex justify-content-between gap-3 border-bottom pb-2"><span className="text-muted">Categorie</span><strong className="text-end">{process.category_name || 'Sans categorie'}</strong></div>
                  <div className="d-flex justify-content-between gap-3 border-bottom pb-2"><span className="text-muted">Responsable</span><strong className="text-end">{process.created_by_name || 'Equipe BPM'}</strong></div>
                  <div className="d-flex justify-content-between gap-3 border-bottom pb-2"><span className="text-muted">Creation</span><strong className="text-end">{formatDate(process.created_at)}</strong></div>
                  <div className="d-flex justify-content-between gap-3"><span className="text-muted">Mise a jour</span><strong className="text-end">{formatDate(process.updated_at)}</strong></div>
                </div>
              </div>

              {subprocesses.length ? (
                <div className="card border-0 shadow-sm" style={{ background: '#fffdfa', borderRadius: 24 }}>
                  <div className="card-body d-flex flex-column gap-3">
                    <div>
                      <h3 className="h5 mb-1">Sous-processus integres</h3>
                      <p className="text-muted small mb-0">Ouvrez depuis la bibliotheque le meme niveau interne que la fleche BPMN ouvre dans l editeur.</p>
                    </div>

                    <div className="d-flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`btn btn-sm rounded-pill ${previewRootElementId ? 'btn-outline-secondary' : 'btn-danger'}`}
                        onClick={() => setPreviewRootElementId(null)}
                      >
                        Diagramme principal
                      </button>
                      {previewTrail.map((subprocess) => (
                        <button
                          key={subprocess.id}
                          type="button"
                          className={`btn btn-sm rounded-pill ${previewRootElementId === subprocess.id ? 'btn-danger' : 'btn-outline-secondary'}`}
                          onClick={() => setPreviewRootElementId(subprocess.id)}
                        >
                          {subprocess.name}
                        </button>
                      ))}
                    </div>

                    <div className="d-flex flex-column gap-2">
                      {subprocesses.map((subprocess) => (
                        <button
                          key={subprocess.id}
                          type="button"
                          onClick={() => setPreviewRootElementId(subprocess.id)}
                          className="text-start border rounded-4 px-3 py-3 bg-white"
                          style={{
                            borderColor: previewRootElementId === subprocess.id ? '#991b1b' : '#e2e8f0',
                            boxShadow: previewRootElementId === subprocess.id ? 'inset 4px 0 0 #991b1b' : 'none',
                          }}
                        >
                          <div className="fw-semibold text-dark">{subprocess.name}</div>
                          <div className="small text-muted mt-1">{subprocess.pathLabel}</div>
                          <div className="small text-muted mt-2">
                            {subprocess.childCount > 0 ? `${subprocess.childCount} vue(s) imbriquee(s)` : 'Derniere vue du sous-processus'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <Modal show={showDiagramModal} onHide={() => setShowDiagramModal(false)} size="xl" centered>
        <Modal.Header closeButton>
          <Modal.Title>Process Details</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex flex-column gap-4">
            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                  <div>
                    <h6 className="mb-1">Diagram preview</h6>
                    <div className="text-muted small">The BPMN diagram is shown as an image snapshot at the top of the process sheet.</div>
                  </div>
                    {!publicView ? (
                      <div className="d-flex gap-2 flex-wrap">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => handleImageExport(process.id)}
                          disabled={exportBusy === 'png'}
                        >
                          {exportBusy === 'png' ? 'Exporting...' : 'PNG'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-dark"
                          onClick={() => handleExport(process.id)}
                          disabled={exportBusy === 'bpmn'}
                        >
                          {exportBusy === 'bpmn' ? 'Exporting...' : 'BPMN'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-dark"
                          onClick={() => handleProcessReportDownload(process.id, 'html')}
                          disabled={exportBusy === 'html'}
                        >
                          {exportBusy === 'html' ? 'Exporting...' : 'Manual HTML'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => handleProcessReportDownload(process.id, 'pdf')}
                          disabled={exportBusy === 'pdf'}
                        >
                          {exportBusy === 'pdf' ? 'Exporting...' : 'Manual PDF'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => handleProcessReportDownload(process.id, 'docx')}
                          disabled={exportBusy === 'docx'}
                        >
                          {exportBusy === 'docx' ? 'Exporting...' : 'Manual Word'}
                        </button>
                        {canEdit ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => openBpmnEditor(previewRootElementId)}
                          >
                            Edit diagram
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                </div>

                <Suspense fallback={<div className="text-muted small">Loading BPMN preview...</div>}>
                  <BpmnProcessPreview xml={process.bpmn_xml} rootElementId={previewRootElementId} />
                </Suspense>

                {subprocesses.length ? (
                  <div className="border rounded-4 p-3 mt-3" style={{ background: '#fffdfa' }}>
                    <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-3">
                      <div>
                        <h6 className="mb-1">Embedded sous-processes</h6>
                        <div className="text-muted small">
                          Open the same internal BPMN level that the drilldown arrow opens inside the editor.
                        </div>
                      </div>
                      {!publicView && canEdit ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => openBpmnEditor(previewRootElementId)}
                        >
                          {previewRootElementId ? 'Edit this sous-process' : 'Edit main diagram'}
                        </button>
                      ) : null}
                    </div>

                    <div className="d-flex flex-wrap gap-2 mb-3">
                      <button
                        type="button"
                        className={`btn btn-sm ${previewRootElementId ? 'btn-outline-secondary' : 'btn-danger'}`}
                        onClick={() => setPreviewRootElementId(null)}
                      >
                        Main diagram
                      </button>
                      {previewTrail.map((subprocess) => (
                        <button
                          key={subprocess.id}
                          type="button"
                          className={`btn btn-sm ${previewRootElementId === subprocess.id ? 'btn-danger' : 'btn-outline-secondary'}`}
                          onClick={() => setPreviewRootElementId(subprocess.id)}
                        >
                          {subprocess.name}
                        </button>
                      ))}
                    </div>

                    <div className="d-flex flex-column gap-2">
                      {subprocesses.map((subprocess) => (
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
              </div>
            </div>

            <div className="card border-0 bg-light-subtle">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <div>
                    <h6 className="mb-1">Metadata</h6>
                    <div className="text-muted small">Name, category, description, and workflow status.</div>
                  </div>
                  <span className="badge rounded-pill" style={{ background: status.bg, color: status.color }}>
                    {status.label}
                  </span>
                </div>

                <div className="mb-3">
                  <div className="text-muted small mb-1">Name</div>
                  <div className="fw-bold text-dark">{process.name}</div>
                </div>

                <div className="mb-3">
                  <div className="text-muted small mb-1">Category</div>
                  <div className="fw-semibold">{process.category_name || 'Sans categorie'}</div>
                </div>

                <div className="border rounded-4 bg-white p-3 shadow-sm">
                  <div className="text-muted small mb-2">Description</div>
                  <div className="text-dark" style={{ whiteSpace: 'pre-wrap' }}>
                    {process.description || 'No description available for this process.'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Modal.Body>
      </Modal>
    </section>
  );
}

export default function ProcessLibrary({ publicView = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [processes, setProcesses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(publicView ? 'approved' : 'all');
  const [collapsedRootSections, setCollapsedRootSections] = useState({ pilotage: false, metiers: false, support: false });
  const lastProcessNavigationRef = useRef({ id: null, at: 0 });
  const deferredSearch = useDeferredValue(search);
  const navigation = useMemo(() => parseNavigationParam(searchParams.get('nav')), [searchParams]);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const processUrl = publicView
        ? `${API}/processes?status=approved`
        : statusFilter === 'archived'
          ? `${API}/processes?status=archived`
          : statusFilter === 'approved'
            ? `${API}/processes?status=approved`
            : `${API}/processes`;
      const [processResponse, categoryResponse] = await Promise.all([
        fetch(processUrl),
        fetch(`${API}/process-categories`),
      ]);

      if (!processResponse.ok || !categoryResponse.ok) {
        throw new Error('Impossible de charger la bibliotheque.');
      }

      const processList = await processResponse.json();
      const categoryList = await categoryResponse.json();
      const normalizedCategories = Array.isArray(categoryList) ? categoryList : [];
      const categorySectionById = new Map(
        normalizedCategories.map((category) => [Number(category.id), normalizeSection(category.section)])
      );

      setProcesses((Array.isArray(processList) ? processList : []).map((process) => ({
        ...process,
        section: normalizeSection(categorySectionById.get(Number(process.category_id))),
      })));
      setCategories(normalizedCategories);
    } catch (loadError) {
      console.error(loadError);
      setError('La bibliotheque des processus est indisponible pour le moment.');
    } finally {
      setLoading(false);
    }
  }, [publicView, statusFilter]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    if (publicView && statusFilter !== 'approved') {
      setStatusFilter('approved');
    }
  }, [publicView, statusFilter]);

  const hierarchy = useMemo(() => buildProcessTree(processes), [processes]);
  const categoryTree = useMemo(() => buildCategoryTree(categories, hierarchy.roots), [categories, hierarchy.roots]);
  const normalizedSearch = normalizeText(deferredSearch);

  const rootCategoriesBySection = useMemo(() => {
    const groups = { pilotage: [], metiers: [], support: [] };
    categoryTree.roots.forEach((category) => {
      if (isCategoryVisible(category, normalizedSearch, statusFilter)) {
        groups[normalizeSection(category.section)].push(category);
      }
    });
    return groups;
  }, [categoryTree.roots, normalizedSearch, statusFilter]);

  const rootLooseProcesses = useMemo(() => {
    const groups = { pilotage: [], metiers: [], support: [] };
    hierarchy.roots
      .filter((process) => !process.category_id && isProcessVisible(process, normalizedSearch, statusFilter))
      .forEach((process) => {
        groups[normalizeSection(process.section)].push(process);
      });
    return groups;
  }, [hierarchy.roots, normalizedSearch, statusFilter]);

  const currentEntry = navigation.length ? navigation[navigation.length - 1] : null;
  const currentCategory = currentEntry?.type === 'category' ? categoryTree.byId.get(currentEntry.id) || null : null;
  const currentProcess = currentEntry?.type === 'process' ? hierarchy.byId.get(currentEntry.id) || null : null;

  const visibleChildCategories = useMemo(
    () => (currentCategory ? currentCategory.children.filter((category) => isCategoryVisible(category, normalizedSearch, statusFilter)) : []),
    [currentCategory, normalizedSearch, statusFilter]
  );

  const visibleDirectProcesses = useMemo(
    () => (currentCategory ? currentCategory.processes.filter((process) => isProcessVisible(process, normalizedSearch, statusFilter)) : []),
    [currentCategory, normalizedSearch, statusFilter]
  );

  const visibleProcessChildren = useMemo(
    () => (currentProcess ? currentProcess.children.filter((process) => isProcessVisible(process, normalizedSearch, statusFilter)) : []),
    [currentProcess, normalizedSearch, statusFilter]
  );

  const navigationLabels = navigation.map((entry) => {
    if (entry.type === 'category') {
      const category = categoryTree.byId.get(entry.id);
      return category ? { ...entry, label: category.name } : null;
    }
    const process = hierarchy.byId.get(entry.id);
    return process ? { ...entry, label: process.name } : null;
  }).filter(Boolean);

  const rootVisibleProcessCount = useMemo(
    () => hierarchy.roots.filter((process) => isProcessVisible(process, normalizedSearch, statusFilter)).length,
    [hierarchy.roots, normalizedSearch, statusFilter]
  );

  const totalRootCategories = categoryTree.roots.length;
  const totalSubcategories = categories.filter((category) => category.parent_id !== null && category.parent_id !== undefined).length;
  const hasRootContent = Object.values(rootCategoriesBySection).some((items) => items.length > 0) || Object.values(rootLooseProcesses).some((items) => items.length > 0);
  const showLibraryOverview = navigation.length === 0;

  const updateNavigation = (updater, options = {}) => {
    const nextNavigation = typeof updater === 'function' ? updater(navigation) : updater;
    const nextParams = new URLSearchParams(searchParams);
    const serialized = serializeNavigationParam(nextNavigation);

    if (serialized) {
      nextParams.set('nav', serialized);
    } else {
      nextParams.delete('nav');
    }

    setSearchParams(nextParams, { preventScrollReset: true, ...options });
  };

  const enterCategory = (category) => {
    updateNavigation((current) => [...current, { type: 'category', id: Number(category.id) }]);
  };

  const enterProcess = (process) => {
    const processId = Number(process?.id);
    if (!Number.isInteger(processId) || processId <= 0) {
      return;
    }

    updateNavigation((current) => {
      const lastEntry = current[current.length - 1] || null;
      const now = Date.now();

      if (lastEntry?.type === 'process' && Number(lastEntry.id) === processId) {
        return current;
      }

      if (
        Number(lastProcessNavigationRef.current.id) === processId &&
        now - Number(lastProcessNavigationRef.current.at || 0) < 400
      ) {
        return current;
      }

      lastProcessNavigationRef.current = { id: processId, at: now };
      return [...current, { type: 'process', id: processId }];
    });
  };

  const goBack = () => {
    updateNavigation((current) => current.slice(0, -1));
  };

  const jumpTo = (index) => {
    if (index < 0) {
      updateNavigation([]);
      return;
    }

    updateNavigation((current) => current.slice(0, index + 1));
  };

  const toggleRootSection = (sectionId) => {
    setCollapsedRootSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };

  return (
    <div className="container-fluid py-3">
      <div className="mx-auto d-flex flex-column gap-3" style={{ maxWidth: 1520 }}>
        <div className="d-flex flex-wrap align-items-center gap-2" style={{ paddingLeft: 12 }}>
          <button type="button" className="btn btn-sm rounded-pill btn-danger" onClick={() => jumpTo(-1)}>
            Bibliotheque
          </button>
          {navigationLabels.map((entry, index) => (
            <div key={`${entry.type}-${entry.id}`} className="d-flex align-items-center gap-2">
              <span className="text-muted small">/</span>
              <button
                type="button"
                className={`btn btn-sm rounded-pill ${index === navigationLabels.length - 1 ? 'btn-danger' : 'btn-outline-secondary'}`}
                onClick={() => jumpTo(index)}
              >
                {entry.label}
              </button>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="card border-0 shadow-sm text-center text-muted" style={{ borderRadius: 28 }}>
            <div className="card-body py-5">
              <i className="bi bi-hourglass-split fs-1 d-block mb-3 text-danger" />
              Chargement de la bibliotheque des processus...
            </div>
          </div>
        ) : error ? (
          <div className="card border-0 shadow-sm text-center text-muted" style={{ borderRadius: 28 }}>
            <div className="card-body py-5">
              <i className="bi bi-exclamation-triangle fs-1 d-block mb-3 text-danger" />
              {error}
            </div>
          </div>
        ) : currentCategory ? (
          <CategoryView
            category={currentCategory}
            childCategories={visibleChildCategories}
            directProcesses={visibleDirectProcesses}
            onOpenCategory={enterCategory}
            onOpenProcess={enterProcess}
            onBack={goBack}
            publicView={publicView}
          />
        ) : currentProcess ? (
          currentProcess.childCount > 0 ? (
            <ProcessBranchView
              process={currentProcess}
              children={visibleProcessChildren}
              onOpenProcess={enterProcess}
              onBack={goBack}
              publicView={publicView}
            />
          ) : (
            <ProcessLeafView process={currentProcess} onBack={goBack} publicView={publicView} onRefresh={loadLibrary} />
          )
        ) : !hasRootContent ? (
          <div className="card border-0 shadow-sm text-center text-muted" style={{ borderRadius: 28 }}>
            <div className="card-body py-5">
              <i className="bi bi-search fs-1 d-block mb-3 text-danger" />
              Aucune categorie ni aucun processus ne correspond aux filtres actuels.
            </div>
          </div>
        ) : (
          <div className="row g-3 align-items-start">
            {rootCategoriesBySection.pilotage.length || rootLooseProcesses.pilotage.length ? (
              <div className="col-12 col-lg-4">
                <RootSection
                  sectionId="pilotage"
                  categories={rootCategoriesBySection.pilotage}
                  looseProcesses={rootLooseProcesses.pilotage}
                  onOpenCategory={enterCategory}
                  onOpenProcess={enterProcess}
                  publicView={publicView}
                  collapsed={collapsedRootSections.pilotage}
                  onToggle={() => toggleRootSection('pilotage')}
                />
              </div>
            ) : null}
            {rootCategoriesBySection.metiers.length || rootLooseProcesses.metiers.length ? (
              <div className="col-12 col-lg-4">
                <RootSection
                  sectionId="metiers"
                  categories={rootCategoriesBySection.metiers}
                  looseProcesses={rootLooseProcesses.metiers}
                  onOpenCategory={enterCategory}
                  onOpenProcess={enterProcess}
                  publicView={publicView}
                  collapsed={collapsedRootSections.metiers}
                  onToggle={() => toggleRootSection('metiers')}
                />
              </div>
            ) : null}
            {rootCategoriesBySection.support.length || rootLooseProcesses.support.length ? (
              <div className="col-12 col-lg-4">
                <RootSection
                  sectionId="support"
                  categories={rootCategoriesBySection.support}
                  looseProcesses={rootLooseProcesses.support}
                  onOpenCategory={enterCategory}
                  onOpenProcess={enterProcess}
                  publicView={publicView}
                  collapsed={collapsedRootSections.support}
                  onToggle={() => toggleRootSection('support')}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
