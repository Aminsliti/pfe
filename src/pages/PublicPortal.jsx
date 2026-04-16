import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ProcessManagement from './ProcessManagement';
import ProcessLibrary from './ProcessLibrary';
import OrgChart from './OrgChart';

const PORTAL_VIEWS = [
  {
    key: 'tree',
    label: 'Cartographie arborescente',
    description: 'Consultez la structure categories > sous-categories > processus.',
  },
  {
    key: 'library',
    label: 'Navigation graphique',
    description: 'Explorez la bibliotheque visuelle jusqu au diagramme BPMN.',
  },
  {
    key: 'orgchart',
    label: 'Organigramme',
    description: 'Consultez l organigramme complet sans mode edition.',
  },
];

function resolvePortalView(value) {
  return PORTAL_VIEWS.some((entry) => entry.key === value) ? value : 'tree';
}

export default function PublicPortal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = resolvePortalView(searchParams.get('view'));
  const activeMeta = useMemo(
    () => PORTAL_VIEWS.find((entry) => entry.key === activeView) || PORTAL_VIEWS[0],
    [activeView]
  );

  const switchView = (nextView) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', nextView);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #fffdf8 0%, #f8fafc 100%)' }}>
      <div className="container-fluid py-4">
        <div className="mx-auto d-flex flex-column gap-4" style={{ maxWidth: 1600 }}>
          <section
            className="card border-0 shadow-sm"
            style={{
              borderRadius: 28,
              background: 'radial-gradient(circle at top left, rgba(153,27,27,.08), transparent 35%), linear-gradient(180deg, #fffdfa 0%, #ffffff 100%)',
            }}
          >
            <div className="card-body p-4 p-xl-5 d-flex flex-column gap-4">
              <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
                <div style={{ maxWidth: 860 }}>
                  <div className="small text-uppercase fw-bold text-danger mb-2">Portail public</div>
                  <h1 className="fw-bold mb-2" style={{ letterSpacing: '-0.03em' }}>
                    Consultation libre de la cartographie des processus et de l organigramme
                  </h1>
                  <p className="text-muted mb-0" style={{ maxWidth: 760 }}>
                    Cette interface est accessible sans login. Elle regroupe la vue arborescente de la cartographie,
                    la navigation graphique de la bibliotheque des processus et l organigramme en mode lecture seule.
                  </p>
                </div>

                <div className="d-flex gap-2 flex-wrap">
                  <Link to="/login" className="btn btn-outline-secondary rounded-pill">
                    Se connecter
                  </Link>
                  <Link to="/portal" className="btn btn-danger rounded-pill">
                    Lien du portail
                  </Link>
                </div>
              </div>

              <div className="d-flex flex-column gap-3">
                <div className="d-flex gap-2 flex-wrap">
                  {PORTAL_VIEWS.map((view) => (
                    <button
                      key={view.key}
                      type="button"
                      className={`btn rounded-pill ${activeView === view.key ? 'btn-danger' : 'btn-outline-secondary'}`}
                      onClick={() => switchView(view.key)}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>

                <div className="text-muted small">{activeMeta.description}</div>
              </div>
            </div>
          </section>

          <section className="card border-0 shadow-sm bg-white" style={{ borderRadius: 28 }}>
            <div className="card-body p-0">
              {activeView === 'tree' ? <ProcessManagement publicView /> : null}
              {activeView === 'library' ? <ProcessLibrary /> : null}
              {activeView === 'orgchart' ? <OrgChart publicView /> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
