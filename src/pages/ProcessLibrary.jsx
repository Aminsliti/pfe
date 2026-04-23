import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { buildBpmnSubprocessTrail, getBpmnSubprocesses } from '../utils/bpmnSubprocesses';

import { API_BASE } from '../utils/api';

const API = API_BASE;
const BpmnProcessPreview = lazy(() => import('../components/BpmnEditor/BpmnProcessPreview'));

const SECTION_CONFIG = {
  pilotage: {
    title: 'Processus de pilotage',
    subtitle: 'Gouvernance, controle et orientation strategique.',
    accent: '#991b1b',
    background: '#fff7f5',
  },
  metiers: {
    title: 'Metiers',
    subtitle: 'Parcours client et execution bancaire.',
    accent: '#0f766e',
    background: '#f2fbfa',
  },
  support: {
    title: 'Support',
    subtitle: 'Fonctions de support et moyens transverses.',
    accent: '#92400e',
    background: '#fff9f0',
  },
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

function VerticalLane({ children }) {
  return (
    <div className="d-flex flex-column gap-3">
      {children}
    </div>
  );
}

function CategoryCard({ category, onOpen }) {
  return (
    <button
      type="button"
      className="card border-0 shadow-sm text-start"
      onClick={() => onOpen(category)}
      style={{ width: '100%', minHeight: 132, background: 'linear-gradient(135deg,#6b1722 0%,#9f1239 55%,#be123c 100%)', color: 'white', borderRadius: 20 }}
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

function ProcessCard({ process, onOpen, publicView = false }) {
  const status = getStatusMeta(process.status);
  return (
    <button
      type="button"
      className="card border-0 shadow-sm text-start"
      onClick={() => onOpen(process)}
      style={{ width: '100%', minHeight: 132, background: 'linear-gradient(135deg,#0f4c5c 0%,#0f766e 100%)', color: 'white', borderRadius: 20 }}
    >
      <div className="card-body d-flex flex-column gap-2 p-3">
        <div className="small text-uppercase fw-bold opacity-75"><i className="bi bi-bezier2 me-2" />{process.childCount > 0 ? 'Macro-processus' : 'Processus'}</div>
        <div className="fs-6 fw-bold lh-sm">{process.name}</div>
        {!publicView ? <div className="small opacity-75">{process.description || 'Ouvrez ce processus pour continuer la navigation jusqu au diagramme BPMN.'}</div> : null}
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

function RootSection({ sectionId, categories, looseProcesses, onOpenCategory, onOpenProcess, publicView = false }) {
  const section = SECTION_CONFIG[sectionId];
  if (!categories.length && !looseProcesses.length) return null;

  return (
    <section className="card border-0 shadow-sm" style={{ background: section.background, borderRadius: 28 }}>
      <div className="card-body p-4 d-flex flex-column gap-4">
        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
          <div>
            <h2 className="mb-1" style={{ color: section.accent }}>{section.title}</h2>
            <p className="mb-0 text-muted">{section.subtitle}</p>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <span className="badge rounded-pill text-bg-light">{categories.length} categories</span>
            {looseProcesses.length ? <span className="badge rounded-pill text-bg-light">{looseProcesses.length} sans categorie</span> : null}
          </div>
        </div>

        {categories.length ? (
          <VerticalLane>
            {categories.map((category) => (
              <CategoryCard key={category.id} category={category} onOpen={onOpenCategory} />
            ))}
          </VerticalLane>
        ) : null}

        {looseProcesses.length ? (
          <div className="d-flex flex-column gap-3">
            <h3 className="h5 mb-0">Processus sans categorie</h3>
            <VerticalLane>
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
        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
          <div>
            <div className="small text-uppercase fw-bold text-danger mb-2"><i className="bi bi-diagram-2 me-2" />Categorie</div>
            <h2 className="mb-2">{category.name}</h2>
            <p className="mb-0 text-muted">{category.description || 'Descendez niveau par niveau dans cette branche.'}</p>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <span className="badge rounded-pill text-bg-light">{childCategories.length} sous-categorie(s)</span>
            <span className="badge rounded-pill text-bg-light">{visibleProcesses.length} processus</span>
            <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill" onClick={onBack}>
              <i className="bi bi-arrow-left me-2" />Retour
            </button>
          </div>
        </div>

        {showsCategoriesOnly ? (
          <div className="d-flex flex-column gap-3">
            <h3 className="h5 mb-0">Sous-categories</h3>
            <VerticalLane>
              {childCategories.map((child) => (
                <CategoryCard key={child.id} category={child} onOpen={onOpenCategory} />
              ))}
            </VerticalLane>
          </div>
        ) : (
          <div className="d-flex flex-column gap-3">
            <h3 className="h5 mb-0">Processus</h3>
            {visibleProcesses.length ? (
              <VerticalLane>
                {visibleProcesses.map((process) => (
                  <ProcessCard key={process.id} process={process} onOpen={onOpenProcess} publicView={publicView} />
                ))}
              </VerticalLane>
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
        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
          <div>
            <div className="small text-uppercase fw-bold text-danger mb-2"><i className="bi bi-bezier2 me-2" />Macro-processus</div>
            <h2 className="mb-2">{process.name}</h2>
            <p className="mb-0 text-muted">{publicView ? 'Ouvrez un sous-processus pour continuer jusqu au detail du diagramme.' : (process.description || 'Ouvrez un sous-processus pour continuer jusqu au diagramme detaille.')}</p>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <span className="badge rounded-pill text-bg-light">{children.length} sous-processus visible(s)</span>
            <span className="badge rounded-pill text-bg-light">{process.descendantCount} niveau(x) en profondeur</span>
            <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill" onClick={onBack}>
              <i className="bi bi-arrow-left me-2" />Retour
            </button>
          </div>
        </div>

        {children.length ? (
          <VerticalLane>
            {children.map((child) => (
              <ProcessCard key={child.id} process={child} onOpen={onOpenProcess} publicView={publicView} />
            ))}
          </VerticalLane>
        ) : (
          <EmptyBox title="Aucun sous-processus visible" text="Ajustez vos filtres ou revenez en arriere pour choisir une autre branche." />
        )}
      </div>
    </section>
  );
}

function ProcessLeafView({ process, onBack }) {
  const status = getStatusMeta(process.status);
  const [previewRootElementId, setPreviewRootElementId] = useState(null);
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

  return (
    <section className="card border-0 shadow-sm bg-white" style={{ borderRadius: 28 }}>
      <div className="card-body p-4 d-flex flex-column gap-4">
        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
          <div>
            <div className="small text-uppercase fw-bold text-danger mb-2"><i className="bi bi-image me-2" />Diagramme BPMN final</div>
            <h2 className="mb-2">{process.name}</h2>
            <p className="mb-0 text-muted">{process.description || 'Vous avez atteint le dernier niveau de navigation: le diagramme du processus detaille.'}</p>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <span className="badge rounded-pill" style={{ background: status.bg, color: status.color }}>{status.label}</span>
            <span className="badge rounded-pill text-bg-light">v{process.version || 1}</span>
            <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill" onClick={onBack}>
              <i className="bi bi-arrow-left me-2" />Retour
            </button>
          </div>
        </div>

        <div className="row g-4">
          <div className="col-xl-8">
            <div className="border rounded-4 bg-white p-3 shadow-sm">
              <Suspense fallback={<div className="text-center py-5 text-muted">Rendu du diagramme BPMN...</div>}>
                <BpmnProcessPreview xml={process.bpmn_xml} rootElementId={previewRootElementId} />
              </Suspense>
            </div>
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

  return (
    <div className="container-fluid py-4">
      <div className="mx-auto d-flex flex-column gap-4" style={{ maxWidth: 1520 }}>
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
            <ProcessLeafView process={currentProcess} onBack={goBack} />
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
            <div className="col-12 col-lg-4">
              <RootSection
                sectionId="pilotage"
                categories={rootCategoriesBySection.pilotage}
                looseProcesses={rootLooseProcesses.pilotage}
                onOpenCategory={enterCategory}
                onOpenProcess={enterProcess}
                publicView={publicView}
              />
            </div>
            <div className="col-12 col-lg-4">
              <RootSection
                sectionId="metiers"
                categories={rootCategoriesBySection.metiers}
                looseProcesses={rootLooseProcesses.metiers}
                onOpenCategory={enterCategory}
                onOpenProcess={enterProcess}
                publicView={publicView}
              />
            </div>
            <div className="col-12 col-lg-4">
              <RootSection
                sectionId="support"
                categories={rootCategoriesBySection.support}
                looseProcesses={rootLooseProcesses.support}
                onOpenCategory={enterCategory}
                onOpenProcess={enterProcess}
                publicView={publicView}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
