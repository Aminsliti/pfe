import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';

const API = 'http://localhost:3001/api';

const SECTION_CONFIG = {
  pilotage: {
    title: 'Processus de Pilotage',
    subtitle: 'Gouvernance, controle, planification et conformite.',
    accent: '#b42318',
    bg: '#fff3f1',
    layout: 'grid',
  },
  metier: {
    title: 'Processus Metiers',
    subtitle: 'Parcours client et operations au coeur de l activite.',
    accent: '#0f7c90',
    bg: '#eefafc',
    layout: 'stack',
  },
  support: {
    title: 'Processus Support',
    subtitle: 'Fonctions transverses qui outillent le reste de l organisation.',
    accent: '#8a5a00',
    bg: '#fff7ea',
    layout: 'grid',
  },
};

const STATUS_META = {
  active: { label: 'Actif', bg: '#dcfce7', color: '#166534', border: '#86efac' },
  draft: { label: 'Brouillon', bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  archived: { label: 'Archive', bg: '#e2e8f0', color: '#475569', border: '#cbd5e1' },
  published: { label: 'Publie', bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
};

const CATEGORY_SECTIONS = {
  Compliance: 'pilotage',
  'Customer Service': 'metier',
  Operations: 'metier',
  HR: 'support',
  IT: 'support',
};

const KEYWORDS = {
  pilotage: [
    'pilotage',
    'strategie',
    'strategic',
    'governance',
    'planification',
    'planning',
    'budget',
    'reporting',
    'finance',
    'financial reporting',
    'conformite',
    'compliance',
    'risk',
    'risque',
    'control',
    'controle',
    'audit',
    'quality',
    'qualite',
  ],
  metier: [
    'business',
    'client',
    'customer',
    'order',
    'commande',
    'invoice',
    'facture',
    'payment',
    'paiement',
    'placement',
    'compte',
    'account',
    'recouvrement',
    'engagement',
    'tresorerie',
    'cash',
    'coffre',
    'compartiment',
    'banque',
    'credit',
    'monetique',
    'operation',
    'service',
    'fulfillment',
    'onboarding',
  ],
  support: [
    'support',
    'system',
    'systeme',
    'monitoring',
    'deployment',
    'deploiement',
    'software',
    'it ',
    'rh',
    'human resources',
    'resource',
    'ressource',
    'administration',
    'administratif',
    'marketing',
    'communication',
    'procedure',
    'comptabilite',
  ],
};

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.draft;
}

function resolveSection(process) {
  const category = process.category_name || '';
  if (CATEGORY_SECTIONS[category]) {
    return CATEGORY_SECTIONS[category];
  }

  const haystack = normalizeText(`${process.name} ${process.description || ''} ${category}`);

  if (category === 'Finance') {
    if (KEYWORDS.metier.some((keyword) => haystack.includes(keyword))) return 'metier';
    if (KEYWORDS.support.some((keyword) => haystack.includes(keyword))) return 'support';
    return 'pilotage';
  }

  if (KEYWORDS.pilotage.some((keyword) => haystack.includes(keyword))) return 'pilotage';
  if (KEYWORDS.metier.some((keyword) => haystack.includes(keyword))) return 'metier';
  if (KEYWORDS.support.some((keyword) => haystack.includes(keyword))) return 'support';

  return 'support';
}

function matchesSearch(process, searchValue) {
  if (!searchValue) return true;
  const haystack = normalizeText(
    `${process.name} ${process.description || ''} ${process.category_name || ''} ${process.created_by_name || ''}`
  );
  return haystack.includes(searchValue);
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value));
  } catch {
    return '-';
  }
}

function StatCard({ label, value, tone }) {
  return (
    <div className={`process-library-stat process-library-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProcessTile({ process, selected, onSelect }) {
  const status = getStatusMeta(process.status);

  return (
    <button
      type="button"
      className={`process-library-tile${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(process)}
    >
      <span className="process-library-tile-top">
        <span className="process-library-tile-category">{process.category_name || 'Sans categorie'}</span>
        <span className="process-library-tile-arrow">
          <i className="bi bi-arrow-up-right" />
        </span>
      </span>
      <span className="process-library-tile-name">{process.name}</span>
      <span className="process-library-tile-meta">
        <span
          className="process-library-status"
          style={{ backgroundColor: status.bg, color: status.color, borderColor: status.border }}
        >
          {status.label}
        </span>
        <span className="process-library-tile-owner">{process.created_by_name || 'Equipe BPM'}</span>
      </span>
    </button>
  );
}

function ProcessRibbon({ process, selected, onSelect }) {
  const status = getStatusMeta(process.status);

  return (
    <button
      type="button"
      className={`process-library-ribbon${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(process)}
    >
      <span className="process-library-ribbon-body">
        <span className="process-library-ribbon-title">{process.name}</span>
        <span className="process-library-ribbon-details">
          <span>{process.category_name || 'Sans categorie'}</span>
          <span className="process-library-ribbon-divider" />
          <span>{process.created_by_name || 'Equipe BPM'}</span>
        </span>
      </span>
      <span
        className="process-library-status"
        style={{ backgroundColor: status.bg, color: status.color, borderColor: status.border }}
      >
        {status.label}
      </span>
    </button>
  );
}

function LibrarySection({ sectionId, items, selectedId, onSelect }) {
  const section = SECTION_CONFIG[sectionId];

  return (
    <section className="process-library-section" style={{ background: section.bg }}>
      <div className="process-library-section-head">
        <div>
          <h2 style={{ color: section.accent }}>{section.title}</h2>
          <p>{section.subtitle}</p>
        </div>
        <span className="process-library-section-count">{items.length} processus</span>
      </div>

      {items.length === 0 ? (
        <div className="process-library-empty">
          Aucun processus ne correspond aux filtres dans cette section.
        </div>
      ) : section.layout === 'stack' ? (
        <div className="process-library-ribbons">
          {items.map((process) => (
            <ProcessRibbon
              key={process.id}
              process={process}
              selected={selectedId === process.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <div className="process-library-grid">
          {items.map((process) => (
            <ProcessTile
              key={process.id}
              process={process}
              selected={selectedId === process.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProcessDetails({ process, onClose }) {
  if (!process) return null;

  const status = getStatusMeta(process.status);
  const section = SECTION_CONFIG[process.section];
  const hasDiagram = typeof process.bpmn_xml === 'string' && process.bpmn_xml.trim().length > 0;

  return (
    <>
      <div className="process-library-overlay" onClick={onClose} />
      <aside className="process-library-drawer">
        <div className="process-library-drawer-head">
          <div>
            <span className="process-library-drawer-kicker">{section.title}</span>
            <h3>{process.name}</h3>
          </div>
          <button type="button" className="process-library-close" onClick={onClose} aria-label="Fermer">
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <div className="process-library-drawer-body">
          <div className="process-library-detail-grid">
            <div className="process-library-detail-card">
              <span>Statut</span>
              <strong
                className="process-library-status"
                style={{ backgroundColor: status.bg, color: status.color, borderColor: status.border }}
              >
                {status.label}
              </strong>
            </div>
            <div className="process-library-detail-card">
              <span>Categorie</span>
              <strong>{process.category_name || 'Sans categorie'}</strong>
            </div>
            <div className="process-library-detail-card">
              <span>Version</span>
              <strong>v{process.version || 1}</strong>
            </div>
            <div className="process-library-detail-card">
              <span>Diagramme BPMN</span>
              <strong>{hasDiagram ? 'Disponible' : 'Non renseigne'}</strong>
            </div>
          </div>

          <div className="process-library-copy">
            <h4>Description</h4>
            <p>{process.description || 'Aucune description fournie pour ce processus.'}</p>
          </div>

          <div className="process-library-copy">
            <h4>Informations</h4>
            <ul>
              <li>Responsable ou createur: {process.created_by_name || 'Equipe BPM'}</li>
              <li>Societe: {process.company_name || 'Societe par defaut'}</li>
              <li>Creation: {formatDate(process.created_at)}</li>
              <li>Derniere mise a jour: {formatDate(process.updated_at)}</li>
            </ul>
          </div>
        </div>
      </aside>
    </>
  );
}

export function ProcessLibrary() {
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const deferredSearch = useDeferredValue(search);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [processResponse, categoryResponse] = await Promise.all([
        fetch(`${API}/processes`),
        fetch(`${API}/process-categories`),
      ]);

      if (!processResponse.ok || !categoryResponse.ok) {
        throw new Error('Impossible de charger la bibliotheque.');
      }

      const processList = await processResponse.json();
      const categoryList = await categoryResponse.json();
      const categoryById = new Map(categoryList.map((category) => [category.id, category.name]));

      const enriched = (Array.isArray(processList) ? processList : []).map((process) => {
        const categoryName = process.category_name || categoryById.get(process.category_id) || null;
        const withCategory = { ...process, category_name: categoryName };
        return { ...withCategory, section: resolveSection(withCategory) };
      });

      setProcesses(enriched);
      setSelected((current) => {
        if (!current) return null;
        return enriched.find((process) => process.id === current.id) || null;
      });
    } catch (loadError) {
      console.error(loadError);
      setError('La bibliotheque des processus est indisponible pour le moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const visibleProcesses = useMemo(() => {
    const searchValue = normalizeText(deferredSearch);

    return processes
      .filter((process) => matchesSearch(process, searchValue))
      .filter((process) => statusFilter === 'all' || process.status === statusFilter)
      .sort((left, right) => left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' }));
  }, [deferredSearch, processes, statusFilter]);

  const grouped = useMemo(() => {
    const initial = { pilotage: [], metier: [], support: [] };
    visibleProcesses.forEach((process) => {
      initial[process.section].push(process);
    });
    return initial;
  }, [visibleProcesses]);

  const totalActive = useMemo(
    () => processes.filter((process) => process.status === 'active').length,
    [processes]
  );
  const totalCategories = useMemo(
    () => new Set(processes.map((process) => process.category_name).filter(Boolean)).size,
    [processes]
  );

  return (
    <div className="process-library-page">
      <style>{`
        .process-library-page {
          min-height: calc(100vh - 108px);
          color: #17202b;
        }
        .process-library-shell {
          max-width: 1380px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .process-library-hero,
        .process-library-section {
          border: 1px solid #eadacc;
          border-radius: 28px;
          box-shadow: 0 18px 40px rgba(113, 77, 34, 0.08);
        }
        .process-library-hero {
          background:
            radial-gradient(circle at top left, rgba(180, 35, 24, 0.08), transparent 38%),
            linear-gradient(180deg, #fffcf8 0%, #ffffff 100%);
          padding: 28px;
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.9fr);
          gap: 24px;
        }
        .process-library-breadcrumb {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid #eadacc;
          color: #7b5b35;
          font-size: 0.84rem;
          font-weight: 600;
          width: fit-content;
        }
        .process-library-hero h1 {
          margin: 18px 0 12px;
          font-size: clamp(2rem, 3vw, 3rem);
          line-height: 1.05;
          color: #991b1b;
        }
        .process-library-hero p {
          margin: 0;
          color: #5b6470;
          line-height: 1.6;
          max-width: 62ch;
        }
        .process-library-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-top: 22px;
        }
        .process-library-stat {
          border-radius: 20px;
          padding: 16px 18px;
          border: 1px solid transparent;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .process-library-stat span {
          color: #6b7280;
          font-size: 0.8rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .process-library-stat strong {
          color: #111827;
          font-size: 1.65rem;
          line-height: 1;
        }
        .process-library-stat-neutral { background: #fff; border-color: #eadacc; }
        .process-library-stat-mint { background: #eefbf5; border-color: #b7ebcf; }
        .process-library-stat-gold { background: #fff7ea; border-color: #f0d7a7; }
        .process-library-toolbar {
          background: #fff;
          border: 1px solid #eadacc;
          border-radius: 24px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .process-library-toolbar-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .process-library-toolbar h2 {
          margin: 0;
          font-size: 1.05rem;
          color: #0f172a;
        }
        .process-library-toolbar p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 0.95rem;
        }
        .process-library-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: center;
        }
        .process-library-search {
          position: relative;
          min-width: min(100%, 320px);
          flex: 1 1 320px;
        }
        .process-library-search i {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }
        .process-library-search input {
          width: 100%;
          height: 48px;
          border-radius: 16px;
          border: 1px solid #d7c6b7;
          background: #fffdf9;
          padding: 0 16px 0 42px;
          color: #0f172a;
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .process-library-search input:focus {
          border-color: #0f7c90;
          box-shadow: 0 0 0 3px rgba(15, 124, 144, 0.12);
        }
        .process-library-filter-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .process-library-filter-row button {
          height: 38px;
          border-radius: 999px;
          border: 1px solid #d8cabd;
          background: #fff;
          padding: 0 14px;
          color: #475569;
          font-weight: 600;
          transition: all 0.15s ease;
        }
        .process-library-filter-row button.active {
          background: #b42318;
          border-color: #b42318;
          color: #fff;
          box-shadow: 0 10px 18px rgba(180, 35, 24, 0.16);
        }
        .process-library-section {
          padding: 22px;
        }
        .process-library-section-head {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          margin-bottom: 18px;
        }
        .process-library-section-head h2 {
          margin: 0;
          font-size: 1.55rem;
          line-height: 1.05;
        }
        .process-library-section-head p {
          margin: 8px 0 0;
          color: #64748b;
        }
        .process-library-section-count {
          white-space: nowrap;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.1);
          background: rgba(255, 255, 255, 0.85);
          padding: 8px 12px;
          font-size: 0.85rem;
          font-weight: 700;
          color: #475569;
        }
        .process-library-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 14px;
        }
        .process-library-tile,
        .process-library-ribbon {
          width: 100%;
          border: none;
          color: #fff;
          cursor: pointer;
          background: linear-gradient(135deg, #10abc3 0%, #0f8ea3 100%);
          transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
          text-align: left;
        }
        .process-library-tile:hover,
        .process-library-ribbon:hover,
        .process-library-tile.is-selected,
        .process-library-ribbon.is-selected {
          transform: translateY(-2px);
          filter: brightness(1.02);
          box-shadow: 0 18px 24px rgba(15, 124, 144, 0.22);
        }
        .process-library-tile {
          min-height: 144px;
          padding: 16px 18px;
          clip-path: polygon(0 0, 89% 0, 100% 50%, 89% 100%, 0 100%);
        }
        .process-library-tile-top,
        .process-library-tile-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .process-library-tile-category,
        .process-library-tile-owner {
          font-size: 0.74rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.84);
          font-weight: 700;
        }
        .process-library-tile-arrow {
          width: 26px;
          height: 26px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.16);
        }
        .process-library-tile-name {
          display: block;
          margin: 18px 0 20px;
          font-size: 1rem;
          font-weight: 800;
          line-height: 1.25;
          max-width: 18ch;
        }
        .process-library-status {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: fit-content;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid transparent;
          font-size: 0.75rem;
          font-weight: 800;
        }
        .process-library-ribbons {
          max-width: 860px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .process-library-ribbon {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-height: 66px;
          padding: 0 24px;
          clip-path: polygon(0 50%, 9% 0, 89% 0, 100% 50%, 89% 100%, 9% 100%);
        }
        .process-library-ribbon-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .process-library-ribbon-title {
          font-size: 1rem;
          font-weight: 800;
          line-height: 1.2;
        }
        .process-library-ribbon-details {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          color: rgba(255, 255, 255, 0.85);
          font-size: 0.8rem;
          font-weight: 600;
        }
        .process-library-ribbon-divider {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.75);
        }
        .process-library-empty {
          border-radius: 20px;
          border: 1px dashed rgba(15, 23, 42, 0.16);
          padding: 30px 18px;
          text-align: center;
          color: #64748b;
          background: rgba(255, 255, 255, 0.75);
        }
        .process-library-state {
          border-radius: 28px;
          border: 1px solid #eadacc;
          background: #fff;
          padding: 56px 24px;
          text-align: center;
          color: #64748b;
        }
        .process-library-state i {
          font-size: 2.2rem;
          color: #c2410c;
          display: block;
          margin-bottom: 14px;
        }
        .process-library-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.36);
          backdrop-filter: blur(4px);
          z-index: 1040;
        }
        .process-library-drawer {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: min(460px, 100vw);
          background: #fffdf8;
          border-left: 1px solid #eadacc;
          z-index: 1050;
          box-shadow: -16px 0 32px rgba(15, 23, 42, 0.16);
          display: flex;
          flex-direction: column;
        }
        .process-library-drawer-head {
          padding: 24px 24px 18px;
          border-bottom: 1px solid #eadacc;
          display: flex;
          justify-content: space-between;
          gap: 16px;
        }
        .process-library-drawer-kicker {
          display: inline-block;
          margin-bottom: 10px;
          color: #0f7c90;
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .process-library-drawer-head h3 {
          margin: 0;
          color: #0f172a;
          font-size: 1.5rem;
          line-height: 1.1;
        }
        .process-library-close {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid #d8cabd;
          background: #fff;
          color: #334155;
          flex-shrink: 0;
        }
        .process-library-drawer-body {
          padding: 24px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .process-library-detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .process-library-detail-card {
          background: #fff;
          border-radius: 18px;
          border: 1px solid #eadacc;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .process-library-detail-card span {
          color: #64748b;
          font-size: 0.82rem;
          font-weight: 700;
        }
        .process-library-detail-card strong {
          color: #0f172a;
          font-size: 0.98rem;
        }
        .process-library-copy h4 {
          margin: 0 0 10px;
          color: #0f172a;
          font-size: 1rem;
        }
        .process-library-copy p,
        .process-library-copy ul {
          margin: 0;
          color: #475569;
          line-height: 1.7;
        }
        .process-library-copy ul {
          padding-left: 18px;
        }
        @media (max-width: 960px) {
          .process-library-hero {
            grid-template-columns: 1fr;
          }
          .process-library-stats {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 720px) {
          .process-library-page {
            padding-bottom: 24px;
          }
          .process-library-hero,
          .process-library-section,
          .process-library-toolbar {
            border-radius: 22px;
          }
          .process-library-ribbon {
            padding: 14px 18px;
            min-height: 0;
            align-items: flex-start;
            clip-path: none;
            border-radius: 20px;
          }
          .process-library-tile {
            clip-path: none;
            border-radius: 20px;
          }
          .process-library-detail-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="process-library-shell">
        <section className="process-library-hero">
          <div>
            <span className="process-library-breadcrumb">
              <i className="bi bi-collection" />
              Bibliotheque des processus
            </span>
            <h1>Vue d ensemble des processus de l organisation</h1>
            <p>
              Une cartographie lisible, inspiree de votre modele de bibliotheque, pour parcourir les
              processus de pilotage, metiers et support a partir des donnees deja gerees dans v-bpm.
            </p>
            <div className="process-library-stats">
              <StatCard label="Total" value={processes.length} tone="neutral" />
              <StatCard label="Actifs" value={totalActive} tone="mint" />
              <StatCard label="Categories" value={totalCategories} tone="gold" />
            </div>
          </div>

          <div className="process-library-toolbar">
            <div className="process-library-toolbar-top">
              <div>
                <h2>Explorer la bibliotheque</h2>
                <p>Filtrez rapidement, puis ouvrez un processus pour voir ses details.</p>
              </div>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={loadLibrary}>
                <i className="bi bi-arrow-clockwise me-2" />
                Actualiser
              </button>
            </div>

            <div className="process-library-actions">
              <label className="process-library-search">
                <i className="bi bi-search" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Rechercher un processus, une categorie, un responsable..."
                />
              </label>
            </div>

            <div className="process-library-filter-row">
              {[
                ['all', 'Tous'],
                ['active', 'Actifs'],
                ['draft', 'Brouillons'],
                ['archived', 'Archives'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={statusFilter === value ? 'active' : ''}
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {loading ? (
          <div className="process-library-state">
            <i className="bi bi-hourglass-split" />
            Chargement de la bibliotheque des processus...
          </div>
        ) : error ? (
          <div className="process-library-state">
            <i className="bi bi-exclamation-triangle" />
            {error}
          </div>
        ) : visibleProcesses.length === 0 ? (
          <div className="process-library-state">
            <i className="bi bi-search" />
            Aucun processus ne correspond aux filtres actuels.
          </div>
        ) : (
          <>
            <LibrarySection
              sectionId="pilotage"
              items={grouped.pilotage}
              selectedId={selected?.id}
              onSelect={setSelected}
            />
            <LibrarySection
              sectionId="metier"
              items={grouped.metier}
              selectedId={selected?.id}
              onSelect={setSelected}
            />
            <LibrarySection
              sectionId="support"
              items={grouped.support}
              selectedId={selected?.id}
              onSelect={setSelected}
            />
          </>
        )}
      </div>

      <ProcessDetails process={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export default ProcessLibrary;
