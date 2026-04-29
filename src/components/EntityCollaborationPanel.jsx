import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Form, ListGroup } from 'react-bootstrap';
import { useSnackbar } from './SnackbarProvider';

import { API_BASE } from '../utils/api';

const API = API_BASE;

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('fr-FR');
}

export function EntityCollaborationPanel({
  entityType,
  entityId,
  title = 'Commentaires',
}) {
  const { showSnackbar } = useSnackbar();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const resetFlash = (nextError = '') => {
    setError(nextError);
  };

  const load = async () => {
    if (!entityType || !entityId) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/entities/${entityType}/${entityId}/comments`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Impossible de charger les commentaires.');
      }

      setComments(Array.isArray(payload) ? payload : []);
    } catch (loadError) {
      setError(loadError.message || 'Impossible de charger la collaboration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [entityType, entityId]);

  const submitComment = async (event) => {
    event?.preventDefault?.();
    if (!commentBody.trim()) {
      return;
    }

    setBusy('comment');
    resetFlash();
    try {
      const response = await fetch(`${API}/entities/${entityType}/${entityId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Impossible d ajouter le commentaire.');
      }

      setCommentBody('');
      setComments((current) => [payload, ...current]);
      showSnackbar('Commentaire ajoute.');
    } catch (submitError) {
      setError(submitError.message || 'Impossible d ajouter le commentaire.');
      showSnackbar(submitError.message || 'Impossible d ajouter le commentaire.', 'danger');
    } finally {
      setBusy('');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div>
            <h6 className="mb-1">{title}</h6>
            <div className="text-muted small">Centralisez les echanges sur cet element.</div>
          </div>
          <Badge bg="light" text="dark">{comments.length} commentaire(s)</Badge>
        </div>

        {!entityId ? (
          <Alert variant="secondary" className="mb-0">
            Enregistrez d abord cet element pour ajouter des commentaires.
          </Alert>
        ) : (
          <>
            {error && <Alert variant="danger">{error}</Alert>}

            <div>
              <Form.Group className="mb-3">
                <Form.Label>Ajouter un commentaire</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="Partagez une decision, une remarque ou un point de blocage..."
                />
              </Form.Group>
              <div className="d-flex justify-content-end">
                <Button
                  type="button"
                  onClick={submitComment}
                  variant="danger"
                  disabled={busy === 'comment' || !commentBody.trim()}
                >
                  {busy === 'comment' ? 'Envoi...' : 'Publier'}
                </Button>
              </div>
            </div>

            <div className="mt-3">
              {loading ? (
                <div className="text-muted small">Chargement des commentaires...</div>
              ) : comments.length === 0 ? (
                <div className="text-muted small">Aucun commentaire pour le moment.</div>
              ) : (
                <ListGroup variant="flush">
                  {comments.map((comment) => (
                    <ListGroup.Item key={comment.id} className="px-0">
                      <div className="d-flex justify-content-between gap-3">
                        <div>
                          <strong>{comment.author_name || 'Utilisateur'}</strong>
                          <div className="text-muted small">{formatDate(comment.created_at)}</div>
                        </div>
                      </div>
                      <div className="mt-2" style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </div>
          </>
        )}
      </Card.Body>
    </Card>
  );
}

export default EntityCollaborationPanel;
