import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, ListGroup, Offcanvas } from 'react-bootstrap';

const API = 'http://localhost:3001/api';

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('fr-FR');
}

function severityVariant(severity) {
  return (
    {
      danger: 'danger',
      warning: 'warning',
      success: 'success',
      info: 'primary',
    }[severity] || 'secondary'
  );
}

export function NotificationCenter() {
  const [show, setShow] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read_at).length,
    [notifications]
  );

  const loadNotifications = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const response = await fetch(`${API}/notifications`);
      const payload = await response.json();
      if (response.ok) {
        setNotifications(Array.isArray(payload) ? payload : []);
      }
    } catch {
      // Keep the UI quiet if notifications fail.
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadNotifications(true);
    const timer = setInterval(() => loadNotifications(true), 30000);
    return () => clearInterval(timer);
  }, []);

  const markRead = async (notification) => {
    setNotifications((current) =>
      current.map((entry) =>
        entry.id === notification.id ? { ...entry, read_at: entry.read_at || new Date().toISOString() } : entry
      )
    );

    if (String(notification.id).startsWith('draft-')) {
      return;
    }

    try {
      await fetch(`${API}/notifications/${notification.id}/read`, { method: 'POST' });
    } catch {
      // Best effort.
    }
  };

  const markAll = async () => {
    setNotifications((current) =>
      current.map((entry) => ({ ...entry, read_at: entry.read_at || new Date().toISOString() }))
    );

    try {
      await fetch(`${API}/notifications/read-all`, { method: 'POST' });
    } catch {
      // Best effort.
    }
  };

  return (
    <>
      <Button
        variant="light"
        className="border d-inline-flex align-items-center gap-2"
        onClick={() => {
          setShow(true);
          loadNotifications();
        }}
      >
        <i className="bi bi-bell"></i>
        <span>Alerts</span>
        {unreadCount > 0 && <Badge bg="danger">{unreadCount}</Badge>}
      </Button>

      <Offcanvas show={show} onHide={() => setShow(false)} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title className="d-flex align-items-center gap-2">
            <i className="bi bi-bell-fill text-danger"></i>
            Notifications
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
            <div className="text-muted small">{notifications.length} alert(s)</div>
            <div className="d-flex gap-2">
              <Button variant="outline-secondary" size="sm" onClick={() => loadNotifications()} disabled={loading}>
                Refresh
              </Button>
              <Button variant="outline-danger" size="sm" onClick={markAll} disabled={!notifications.length}>
                Mark all read
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="text-muted small">Loading notifications...</div>
          ) : notifications.length === 0 ? (
            <div className="text-muted small">No notifications right now.</div>
          ) : (
            <ListGroup variant="flush">
              {notifications.map((notification) => (
                <ListGroup.Item
                  key={notification.id}
                  className="px-0"
                  style={{ opacity: notification.read_at ? 0.7 : 1 }}
                >
                  <div className="d-flex justify-content-between gap-3">
                    <div>
                      <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                        <strong>{notification.title}</strong>
                        <Badge bg={severityVariant(notification.severity)}>{notification.type}</Badge>
                        {!notification.read_at && <Badge bg="dark">new</Badge>}
                      </div>
                      <div className="text-muted small">{notification.message}</div>
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                        {formatDate(notification.created_at)}
                      </div>
                    </div>
                    {!notification.read_at && (
                      <Button variant="outline-secondary" size="sm" onClick={() => markRead(notification)}>
                        Read
                      </Button>
                    )}
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}

export default NotificationCenter;
