import { useEffect, useRef, useState } from 'react';
import { toSubprocessPlaneId } from '../../utils/bpmnSubprocesses';

export default function BpmnProcessPreview({ xml, rootElementId = null }) {
  const containerRef = useRef(null);
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let viewer = null;
    let nextImageUrl = '';

    const mountViewer = async () => {
      if (!xml || !containerRef.current) {
        setImageUrl('');
        setError('');
        return;
      }

      try {
        const { default: NavigatedViewer } = await import('bpmn-js/lib/NavigatedViewer');
        if (cancelled || !containerRef.current) {
          return;
        }

        viewer = new NavigatedViewer({
          container: containerRef.current,
        });

        await viewer.importXML(xml);
        if (!cancelled) {
          const canvas = viewer.get('canvas');
          const targetRoot = rootElementId ? canvas.findRoot(toSubprocessPlaneId(rootElementId)) : null;

          if (targetRoot) {
            canvas.setRootElement(targetRoot);
          }

          canvas.zoom('fit-viewport');
          const { svg } = await viewer.saveSVG();
          nextImageUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
          setImageUrl(nextImageUrl);
          setError('');
        }
      } catch (mountError) {
        if (!cancelled) {
          setImageUrl('');
          setError(mountError?.message || 'Unable to render the BPMN diagram.');
        }
      }
    };

    mountViewer();

    return () => {
      cancelled = true;
      if (viewer) {
        viewer.destroy();
      }
      if (nextImageUrl) {
        URL.revokeObjectURL(nextImageUrl);
      }
    };
  }, [xml, rootElementId]);

  if (!xml) {
    return (
      <div
        className="d-flex align-items-center justify-content-center text-muted small"
        style={{ minHeight: 360, border: '1px dashed #dbe4ee', borderRadius: 20, background: '#f8fafc' }}
      >
        No BPMN diagram is available for this process yet.
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="d-flex align-items-center justify-content-center text-danger small text-center"
        style={{ minHeight: 360, border: '1px dashed #fecaca', borderRadius: 20, background: '#fff5f5', padding: 24 }}
      >
        {error}
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          left: -100000,
          top: 0,
          width: 1600,
          height: 900,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          minHeight: 420,
          borderRadius: 20,
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
          background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Process BPMN diagram"
            style={{
              display: 'block',
              width: '100%',
              maxHeight: 620,
              objectFit: 'contain',
            }}
          />
        ) : (
          <div className="text-muted small">Rendering BPMN preview...</div>
        )}
      </div>
    </>
  );
}
