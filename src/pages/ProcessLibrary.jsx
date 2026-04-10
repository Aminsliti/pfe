import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';

const API = 'http://localhost:3001/api';
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
    <div className="border rounded-4 bg-white px-3 py-3 shadow-sm">
      <div className="small text-uppercase text-muted fw-bold">{label}</div>
      <div className="fs-4 fw-bold text-dark">{value}</div>
    </div>
  );
}

function CategoryCard({ category, onOpen }) {
  return (
    <button type="button" className="card border-0 shadow-sm text-start h-100" onClick={() => onOpen(category)} style={{ background: 'linear-gradient(135deg,#4a1326 0%,#8f1d3d 55%,#d4551e 100%)', color: 'white', borderRadius: 24 }}>
      <div className="card-body d-flex flex-column gap-3 p-4">
        <div className="small text-uppercase fw-bold opacity-75"><i className="bi bi-diagram-3 me-2" />Categorie</div>
        <div className="fs-4 fw-bold lh-sm">{category.name}</div>
        <div className="small opacity-75">{category.description || 'Entrez dans cette categorie pour afficher ses sous-categories et ses processus.'}</div>
        <div className="mt-auto d-flex flex-wrap gap-2">
          <span className="badge text-bg-light">{category.children.length} sous-categorie(s)</span>
          <span className="badge text-bg-light">{category.processes.length} processus directs</span>
          <span className="badge text-bg-light">{category.totalProcessCount} total</span>
        </div>
      </div>
    </button>
  );
}

function ProcessCard({ process, onOpen }) {
  const status = getStatusMeta(process.status);
  return (
    <button type="button" className="card border-0 shadow-sm text-start h-100" onClick={() => onOpen(process)} style={{ background: 'linear-gradient(135deg,#4a1326 0%,#8f1d3d 55%,#d4551e 100%)', color: 'white', borderRadius: 24 }}>
      <div className="card-body d-flex flex-column gap-3 p-4">
        <div className="small text-uppercase fw-bold opacity-75"><i className="bi bi-bezier2 me-2" />{process.childCount > 0 ? 'Macro-processus' : 'Processus'}</div>
        <div className="fs-4 fw-bold lh-sm">{process.name}</div>
        <div className="small opacity-75">{process.description || 'Ouvrez ce processus pour continuer la navigation jusqu au diagramme BPMN.'}</div>
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

function RootSection({ sectionId, categories, looseProcesses, onOpenCategory, onOpenProcess }) {
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
          <div className="row g-3">
            {categories.map((category) => (
              <div key={category.id} className="col-12 col-md-6 col-xl-4">
                <CategoryCard category={category} onOpen={onOpenCategory} />
              </div>
            ))}
          </div>
        ) : null}

        {looseProcesses.length ? (
          <div className="d-flex flex-column gap-3">
            <h3 className="h5 mb-0">Processus sans categorie</h3>
            <div className="row g-3">
              {looseProcesses.map((process) => (
                <div key={process.id} className="col-12 col-md-6 col-xl-4">
                  <ProcessCard process={process} onOpen={onOpenProcess} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CategoryView({ category, childCategories, directProcesses, onOpenCategory, onOpenProcess, onBack }) {
  return (
    <section className="card border-0 shadow-sm bg-white" style={{ borderRadius: 28 }}>
      <div className="card-body p-4 d-flex flex-column gap-4">
        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
          <div>
            <div className="small text-uppercase fw-bold text-danger mb-2"><i className="bi bi-diagram-2 me-2" />Categorie</div>
            <h2 className="mb-2">{category.name}</h2>
            <p className="mb-0 text-muted">{category.description || 'Descendez dans les sous-categories ou ouvrez un processus de cette branche.'}</p>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <span className="badge rounded-pill text-bg-light">{childCategories.length} sous-categorie(s)</span>
            <span className="badge rounded-pill text-bg-light">{directProcesses.length} processus</span>
            <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill" onClick={onBack}>
              <i className="bi bi-arrow-left me-2" />Retour
            </button>
          </div>
        </div>

        <div className="d-flex flex-column gap-3">
          <h3 className="h5 mb-0">Sous-categories</h3>
          {childCategories.length ? (
            <div className="row g-3">
              {childCategories.map((child) => (
                <div key={child.id} className="col-12 col-md-6 col-xl-4">
                  <CategoryCard category={child} onOpen={onOpenCategory} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyBox title="Aucune sous-categorie visible" text="Passez directement aux processus de cette categorie ou ajustez vos filtres." />
          )}
        </div>

        <div className="d-flex flex-column gap-3">
          <h3 className="h5 mb-0">Processus de cette categorie</h3>
          {directProcesses.length ? (
            <div className="row g-3">
              {directProcesses.map((process) => (
                <div key={process.id} className="col-12 col-md-6 col-xl-4">
                  <ProcessCard process={process} onOpen={onOpenProcess} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyBox title="Aucun processus direct visible" text="Les processus peuvent etre classes dans une sous-categorie plus bas dans la hierarchie." />
          )}
        </div>
      </div>
    </section>
  );
}

function ProcessBranchView({ process, children, onOpenProcess, onBack }) {
  return (
    <section className="card border-0 shadow-sm bg-white" style={{ borderRadius: 28 }}>
      <div className="card-body p-4 d-flex flex-column gap-4">
        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
          <div>
            <div className="small text-uppercase fw-bold text-danger mb-2"><i className="bi bi-bezier2 me-2" />Macro-processus</div>
            <h2 className="mb-2">{process.name}</h2>
            <p className="mb-0 text-muted">{process.description || 'Ouvrez un sous-processus pour continuer jusqu au diagramme detaille.'}</p>
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
          <div className="row g-3">
            {children.map((child) => (
              <div key={child.id} className="col-12 col-md-6 col-xl-4">
                <ProcessCard process={child} onOpen={onOpenProcess} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyBox title="Aucun sous-processus visible" text="Ajustez vos filtres ou revenez en arriere pour choisir une autre branche." />
        )}
      </div>
    </section>
  );
}

function ProcessLeafView({ process, onBack }) {
  const status = getStatusMeta(process.status);

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
                <BpmnProcessPreview xml={process.bpmn_xml} />
              </Suspense>
            </div>
          </div>
          <div className="col-xl-4">
            <div className="card border-0 shadow-sm h-100" style={{ background: '#fffdfa', borderRadius: 24 }}>
              <div className="card-body d-flex flex-column gap-3">
                <h3 className="h5 mb-0">Informations</h3>
                <div className="d-flex justify-content-between gap-3 border-bottom pb-2"><span className="text-muted">Categorie</span><strong className="text-end">{process.category_name || 'Sans categorie'}</strong></div>
                <div className="d-flex justify-content-between gap-3 border-bottom pb-2"><span className="text-muted">Responsable</span><strong className="text-end">{process.created_by_name || 'Equipe BPM'}</strong></div>
                <div className="d-flex justify-content-between gap-3 border-bottom pb-2"><span className="text-muted">Creation</span><strong className="text-end">{formatDate(process.created_at)}</strong></div>
                <div className="d-flex justify-content-between gap-3"><span className="text-muted">Mise a jour</span><strong className="text-end">{formatDate(process.updated_at)}</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ProcessLibrary() {
  const [processes, setProcesses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [navigation, setNavigation] = useState([]);
  const deferredSearch = useDeferredValue(search);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const processUrl = statusFilter === 'archived'
        ? `${API}/processes?status=archived`
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
  }, [statusFilter]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

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

  const enterCategory = (category) => {
    setNavigation((current) => [...current, { type: 'category', id: category.id }]);
  };

  const enterProcess = (process) => {
    setNavigation((current) => [...current, { type: 'process', id: process.id }]);
  };

  const goBack = () => {
    setNavigation((current) => current.slice(0, -1));
  };

  const jumpTo = (index) => {
    if (index < 0) {
      setNavigation([]);
      return;
    }

    setNavigation((current) => current.slice(0, index + 1));
  };

  return (
    <div className="container-fluid py-4">
      <div className="mx-auto d-flex flex-column gap-4" style={{ maxWidth: 1520 }}>
        <div className="d-flex flex-wrap align-items-center gap-2">
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

        {showLibraryOverview ? (
          <section className="card border-0 shadow-sm" style={{ borderRadius: 28, background: 'radial-gradient(circle at top left,rgba(153,27,27,.08),transparent 32%),linear-gradient(180deg,#fffdfa 0%,#fff 100%)' }}>
            <div className="card-body p-4">
              <div className="d-flex flex-column gap-4">
                <div className="row g-4 align-items-start">
                  <div className="col-xl-7">
                    <h1 className="display-4 fw-bold mb-3 text-danger-emphasis">
                      Naviguez de categorie en sous-categorie jusqu au diagramme
                    </h1>
                    <p className="lead text-muted mb-0">
                      Le Process Library devient une vraie porte d entree visuelle vers Process Management: categories, sous-categories, macro-processus, puis diagramme.
                    </p>
                  </div>

                  <div className="col-xl-5">
                    <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 24, background: '#fffdfa' }}>
                      <div className="card-body d-flex flex-column gap-3">
                        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                          <div>
                            <h2 className="h4 mb-1">Exploration</h2>
                            <p className="text-muted mb-0">Filtrez, puis avancez niveau par niveau.</p>
                          </div>
                          <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill" onClick={loadLibrary}>
                            <i className="bi bi-arrow-clockwise me-2" />Actualiser
                          </button>
                        </div>

                        <div className="position-relative">
                          <i className="bi bi-search position-absolute top-50 start-0 translate-middle-y text-muted ms-3" />
                          <input
                            type="search"
                            className="form-control rounded-4 ps-5"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Rechercher une categorie ou un processus..."
                          />
                        </div>

                        <div className="d-flex gap-2 flex-wrap">
                          {[
                            ['all', 'Tous'],
                            ['approved', 'Approuves'],
                            ['review', 'En revue'],
                            ['draft', 'Brouillons'],
                            ['archived', 'Archives'],
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              className={`btn btn-sm rounded-pill ${statusFilter === value ? 'btn-danger' : 'btn-outline-secondary'}`}
                              onClick={() => setStatusFilter(value)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        <div className="row g-3">
                          <div className="col-md-4"><HeroStat label="Categories racines" value={totalRootCategories} /></div>
                          <div className="col-md-4"><HeroStat label="Sous-categories" value={totalSubcategories} /></div>
                          <div className="col-md-4"><HeroStat label="Processus visibles" value={rootVisibleProcessCount} /></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

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
          />
        ) : currentProcess ? (
          currentProcess.childCount > 0 ? (
            <ProcessBranchView
              process={currentProcess}
              children={visibleProcessChildren}
              onOpenProcess={enterProcess}
              onBack={goBack}
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
          <>
            <RootSection
              sectionId="pilotage"
              categories={rootCategoriesBySection.pilotage}
              looseProcesses={rootLooseProcesses.pilotage}
              onOpenCategory={enterCategory}
              onOpenProcess={enterProcess}
            />
            <RootSection
              sectionId="metiers"
              categories={rootCategoriesBySection.metiers}
              looseProcesses={rootLooseProcesses.metiers}
              onOpenCategory={enterCategory}
              onOpenProcess={enterProcess}
            />
            <RootSection
              sectionId="support"
              categories={rootCategoriesBySection.support}
              looseProcesses={rootLooseProcesses.support}
              onOpenCategory={enterCategory}
              onOpenProcess={enterProcess}
            />
          </>
        )}
      </div>
    </div>
  );
}
