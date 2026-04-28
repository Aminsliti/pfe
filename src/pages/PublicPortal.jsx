import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ProcessManagement from './ProcessManagement';
import ProcessLibrary from './ProcessLibrary';
import OrgChart from './OrgChart';

const PORTAL_VIEWS = [
  {
    key: 'library',
    label: 'Cartographie de process',
    description: 'Explorez la bibliotheque visuelle jusqu au diagramme BPMN.',
  },
  {
    key: 'tree',
    label: 'Liste de processus',
    description: 'Consultez la structure categories > sous-categories > processus.',
  },
  {
    key: 'orgchart',
    label: 'Organigramme',
    description: 'Consultez l organigramme complet sans mode edition.',
  },
];

function resolvePortalView(value) {
  return PORTAL_VIEWS.some((entry) => entry.key === value) ? value : 'library';
}

export default function PublicPortal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = resolvePortalView(searchParams.get('view'));
  const [headerCollapsed, setHeaderCollapsed] = useState(activeView === 'library');
  const activeMeta = useMemo(
    () => PORTAL_VIEWS.find((entry) => entry.key === activeView) || PORTAL_VIEWS[0],
    [activeView]
  );

  const switchView = (nextView) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', nextView);
    setSearchParams(nextParams, { replace: true });
    setHeaderCollapsed(nextView === 'library');
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #fffdf8 0%, #f8fafc 100%)' }}>
      <div className="container-fluid py-3">
        <div className="mx-auto d-flex flex-column gap-3" style={{ maxWidth: 1600 }}>
          <section
            className="card border-0 shadow-sm"
            style={{
              borderRadius: 22,
              background: 'radial-gradient(circle at top left, rgba(153,27,27,.08), transparent 35%), linear-gradient(180deg, #fffdfa 0%, #ffffff 100%)',
            }}
          >
            <div className="card-body p-2 p-xl-3 d-flex flex-column gap-2">
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <div className="small text-uppercase fw-bold text-danger">Portail public</div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary rounded-pill"
                    onClick={() => setHeaderCollapsed((current) => !current)}
                  >
                    <i className={`bi ${headerCollapsed ? 'bi-chevron-down' : 'bi-chevron-up'} me-2`} />
                    {headerCollapsed ? 'Afficher' : 'Masquer'}
                  </button>
                </div>
                <div className="d-flex gap-2 flex-wrap">
                  <Link to="/login" className="btn btn-sm btn-outline-secondary rounded-pill">
                    Se connecter
                  </Link>
                  <Link to="/portal" className="btn btn-sm btn-danger rounded-pill">
                    Lien du portail
                  </Link>
                </div>
              </div>

              {!headerCollapsed ? (
                <div style={{ maxWidth: 860 }}>
                  <h1 className="fw-bold mb-1" style={{ letterSpacing: '-0.03em', fontSize: 'clamp(1.05rem, 1.5vw, 1.45rem)', lineHeight: 1.08 }}>
                    Consultation libre de la cartographie des processus et de l organigramme
                  </h1>
                  <div className="text-muted small">{activeMeta.description}</div>
                </div>
              ) : null}

              <div className="d-flex flex-column gap-1">
                <div className="d-flex gap-2 flex-wrap">
                  {PORTAL_VIEWS.map((view) => (
                    <button
                      key={view.key}
                      type="button"
                      className={`btn btn-sm rounded-pill ${activeView === view.key ? 'btn-danger' : 'btn-outline-secondary'}`}
                      onClick={() => switchView(view.key)}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="card border-0 shadow-sm bg-white" style={{ borderRadius: 22 }}>
            <div className="card-body p-0">
              {activeView === 'tree' ? <ProcessManagement publicView /> : null}
              {activeView === 'library' ? <ProcessLibrary publicView /> : null}
              {activeView === 'orgchart' ? <OrgChart publicView /> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
