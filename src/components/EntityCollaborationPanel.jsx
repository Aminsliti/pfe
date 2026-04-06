import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Form, ListGroup } from 'react-bootstrap';

const API = 'http://localhost:3001/api';
const FILES = 'http://localhost:3001';

function formatBytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('fr-FR');
}

export function EntityCollaborationPanel({
  entityType,
  entityId,
  title = 'Commentaires et pieces jointes',
}) {
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  const resetFlash = (nextMessage = '', nextError = '') => {
    setMessage(nextMessage);
    setError(nextError);
  };

  const load = async () => {
    if (!entityType || !entityId) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [commentsResponse, attachmentsResponse] = await Promise.all([
        fetch(`${API}/entities/${entityType}/${entityId}/comments`),
        fetch(`${API}/entities/${entityType}/${entityId}/attachments`),
      ]);

      const commentsPayload = await commentsResponse.json();
      const attachmentsPayload = await attachmentsResponse.json();

      if (!commentsResponse.ok) {
        throw new Error(commentsPayload.error || 'Impossible de charger les commentaires.');
      }

      if (!attachmentsResponse.ok) {
        throw new Error(attachmentsPayload.error || 'Impossible de charger les pieces jointes.');
      }

      setComments(Array.isArray(commentsPayload) ? commentsPayload : []);
      setAttachments(Array.isArray(attachmentsPayload) ? attachmentsPayload : []);
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
    event.preventDefault();
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
      setMessage('Commentaire ajoute.');
    } catch (submitError) {
      setError(submitError.message || 'Impossible d ajouter le commentaire.');
    } finally {
      setBusy('');
    }
  };

  const uploadFile = async () => {
    if (!file) {
      return;
    }

    setBusy('file');
    resetFlash();
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${API}/entities/${entityType}/${entityId}/attachments`, {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Impossible de televerser le fichier.');
      }

      setFile(null);
      setAttachments((current) => [payload, ...current]);
      setMessage('Fichier ajoute.');
    } catch (uploadError) {
      setError(uploadError.message || 'Impossible de televerser le fichier.');
    } finally {
      setBusy('');
    }
  };

  const removeAttachment = async (attachmentId) => {
    setBusy(`delete-${attachmentId}`);
    resetFlash();
    try {
      const response = await fetch(
        `${API}/entities/${entityType}/${entityId}/attachments/${attachmentId}`,
        { method: 'DELETE' }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Impossible de supprimer le fichier.');
      }

      setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
      setMessage('Fichier supprime.');
    } catch (removeError) {
      setError(removeError.message || 'Impossible de supprimer le fichier.');
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
            <div className="text-muted small">Centralisez les echanges et les fichiers sur cet element.</div>
          </div>
          <div className="d-flex gap-2">
            <Badge bg="light" text="dark">{comments.length} commentaire(s)</Badge>
            <Badge bg="light" text="dark">{attachments.length} fichier(s)</Badge>
          </div>
        </div>

        {!entityId ? (
          <Alert variant="secondary" className="mb-0">
            Enregistrez d abord cet element pour ajouter des commentaires ou des fichiers.
          </Alert>
        ) : (
          <>
            {error && <Alert variant="danger">{error}</Alert>}
            {message && <Alert variant="success">{message}</Alert>}

            <div className="row g-4">
              <div className="col-xl-6">
                <Form onSubmit={submitComment}>
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
                    <Button type="submit" variant="danger" disabled={busy === 'comment' || !commentBody.trim()}>
                      {busy === 'comment' ? 'Envoi...' : 'Publier'}
                    </Button>
                  </div>
                </Form>

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
              </div>

              <div className="col-xl-6">
                <Form.Group className="mb-3">
                  <Form.Label>Ajouter un fichier</Form.Label>
                  <Form.Control
                    type="file"
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                  />
                </Form.Group>
                <div className="d-flex justify-content-end mb-3">
                  <Button variant="outline-danger" onClick={uploadFile} disabled={busy === 'file' || !file}>
                    {busy === 'file' ? 'Televersement...' : 'Televerser'}
                  </Button>
                </div>

                {loading ? (
                  <div className="text-muted small">Chargement des pieces jointes...</div>
                ) : attachments.length === 0 ? (
                  <div className="text-muted small">Aucun fichier partage.</div>
                ) : (
                  <ListGroup variant="flush">
                    {attachments.map((attachment) => (
                      <ListGroup.Item key={attachment.id} className="px-0">
                        <div className="d-flex justify-content-between align-items-start gap-3">
                          <div>
                            <strong>{attachment.original_name}</strong>
                            <div className="text-muted small">
                              {formatBytes(attachment.size_bytes)} · {attachment.uploaded_by_name || 'Utilisateur'} · {formatDate(attachment.created_at)}
                            </div>
                          </div>
                          <div className="d-flex gap-2">
                            <Button
                              as="a"
                              href={`${FILES}${attachment.download_url}`}
                              target="_blank"
                              rel="noreferrer"
                              size="sm"
                              variant="outline-secondary"
                            >
                              Ouvrir
                            </Button>
                            <Button
                              size="sm"
                              variant="outline-danger"
                              onClick={() => removeAttachment(attachment.id)}
                              disabled={busy === `delete-${attachment.id}`}
                            >
                              Supprimer
                            </Button>
                          </div>
                        </div>
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                )}
              </div>
            </div>
          </>
        )}
      </Card.Body>
    </Card>
  );
}

export default EntityCollaborationPanel;
