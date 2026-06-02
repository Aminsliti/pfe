# Server Architecture

The server is organized by responsibility:

- `routes/` exposes thin Express route entry points.
- `controllers/` owns HTTP request and response handling.
- `services/` owns reusable domain logic, grouped by feature.
- `migrations/` stores database migration scripts.
- `db.js` contains the shared database connection pool.

The intended flow is:

```text
routes -> controllers -> services -> db
```

As the project grows, keep new business logic in `services/<domain>/` and let
route files stay as small adapters.
