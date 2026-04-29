import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Button, Modal, Toast, ToastContainer } from 'react-bootstrap';

const SnackbarContext = createContext(null);

const VARIANT_META = {
  add: {
    bg: '#14532d',
    border: '#22c55e',
    title: 'Add',
  },
  edit: {
    bg: '#172554',
    border: '#3b82f6',
    title: 'Edit',
  },
  archive: {
    bg: '#78350f',
    border: '#f59e0b',
    title: 'Archive',
  },
  delete: {
    bg: '#7f1d1d',
    border: '#ef4444',
    title: 'Delete',
  },
  success: {
    bg: '#14532d',
    border: '#22c55e',
    title: 'Success',
  },
  danger: {
    bg: '#7f1d1d',
    border: '#ef4444',
    title: 'Error',
  },
  warning: {
    bg: '#78350f',
    border: '#f59e0b',
    title: 'Warning',
  },
  info: {
    bg: '#172554',
    border: '#3b82f6',
    title: 'Info',
  },
  secondary: {
    bg: '#334155',
    border: '#94a3b8',
    title: 'Notice',
  },
};

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function inferVariant(text = '', variant = 'success') {
  const normalizedText = normalizeText(text);

  if (variant === 'danger') {
    return 'delete';
  }

  if (variant === 'warning') {
    return 'archive';
  }

  if (variant === 'info') {
    return 'edit';
  }

  if (/\b(delete|deleted|remove|removed|supprim|supprime)\b/.test(normalizedText)) {
    return 'delete';
  }

  if (/\b(archive|archived|restore|restored)\b/.test(normalizedText)) {
    return 'archive';
  }

  if (/\b(add|added|create|created|import|imported|publish|published|ajout|ajoute|cree)\b/.test(normalizedText)) {
    return 'add';
  }

  if (/\b(edit|edited|update|updated|save|saved|apply|applied|modif|updated)\b/.test(normalizedText)) {
    return 'edit';
  }

  return variant;
}

let snackbarId = 0;

export function SnackbarProvider({ children }) {
  const [items, setItems] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const dismissSnackbar = useCallback((id) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const showSnackbar = useCallback((text, variant = 'success', options = {}) => {
    if (!text) {
      return;
    }

    snackbarId += 1;
    const id = snackbarId;
    const resolvedVariant = inferVariant(text, variant);
    const nextItem = {
      id,
      text,
      variant: resolvedVariant,
      title: options.title || VARIANT_META[resolvedVariant]?.title || 'Notice',
      delay: Number.isFinite(options.delay) ? options.delay : 4200,
    };

    setItems((current) => [...current, nextItem]);
    return id;
  }, []);

  const closeConfirm = useCallback((confirmed) => {
    setConfirmState((current) => {
      if (current?.resolver) {
        current.resolver(Boolean(confirmed));
      }
      return null;
    });
  }, []);

  const confirmAction = useCallback((options = {}) => new Promise((resolve) => {
    const config = typeof options === 'string' ? { message: options } : options;
    setConfirmState({
      title: config.title || 'Confirm action',
      message: config.message || 'Are you sure you want to continue?',
      confirmLabel: config.confirmLabel || 'Confirm',
      cancelLabel: config.cancelLabel || 'Cancel',
      confirmVariant: config.confirmVariant || 'danger',
      resolver: resolve,
    });
  }), []);

  const value = useMemo(
    () => ({
      showSnackbar,
      dismissSnackbar,
      confirmAction,
    }),
    [confirmAction, dismissSnackbar, showSnackbar]
  );

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <Modal show={Boolean(confirmState)} onHide={() => closeConfirm(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{confirmState?.title || 'Confirm action'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{confirmState?.message}</Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => closeConfirm(false)}>
            {confirmState?.cancelLabel || 'Cancel'}
          </Button>
          <Button variant={confirmState?.confirmVariant || 'danger'} onClick={() => closeConfirm(true)}>
            {confirmState?.confirmLabel || 'Confirm'}
          </Button>
        </Modal.Footer>
      </Modal>
      <ToastContainer position="bottom-end" className="p-3" style={{ zIndex: 2000 }}>
        {items.map((item) => {
          const meta = VARIANT_META[item.variant] || VARIANT_META.secondary;
          return (
            <Toast
              key={item.id}
              onClose={() => dismissSnackbar(item.id)}
              autohide
              delay={item.delay}
              bg="dark"
              style={{
                minWidth: 320,
                background: meta.bg,
                color: '#fff',
                borderLeft: `4px solid ${meta.border}`,
                boxShadow: '0 16px 40px rgba(15, 23, 42, 0.22)',
              }}
            >
              <Toast.Header closeButton className="text-white" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff' }}>
                <strong className="me-auto">{item.title}</strong>
                <small className="text-white-50">now</small>
              </Toast.Header>
              <Toast.Body>{item.text}</Toast.Body>
            </Toast>
          );
        })}
      </ToastContainer>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar() {
  const context = useContext(SnackbarContext);

  if (!context) {
    throw new Error('useSnackbar must be used within a SnackbarProvider');
  }

  return context;
}

export default SnackbarProvider;
