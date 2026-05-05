# V-BPM Platform - Technical Documentation

## 1. Purpose

V-BPM is a full-stack business process management platform for:

- governed BPMN process design and review
- structured process library navigation
- simulation scenario modeling and analysis
- organizational chart management
- user and role administration
- collaboration, notifications, and auditability

This document reflects the current implementation in `C:\Users\msi\Desktop\pfe-anas-v2`.

## 2. Technology Stack

### Frontend

- React 19
- React Router DOM 7
- React Bootstrap + Bootstrap 5
- Bootstrap Icons
- `bpmn-js` / `bpmn-moddle`
- Vite

### Backend

- Node.js
- Express 5
- PostgreSQL via `pg`
- `bcryptjs`
- `multer`
- `cors`
- `dotenv`

### Test and Build Tooling

- Jest
- React Testing Library
- Supertest
- Babel Jest
- ESLint

## 3. Repository Structure

```text
pfe-anas-v2/
|-- src/
|   |-- App.jsx
|   |-- main.jsx
|   |-- contexts/
|   |   `-- AuthContext.jsx
|   |-- components/
|   |   |-- Layout.jsx
|   |   |-- NotificationCenter.jsx
|   |   |-- EntityCollaborationPanel.jsx
|   |   |-- ProtectedRoute.jsx
|   |   `-- BpmnEditor/
|   `-- pages/
|       |-- Login.jsx
|       |-- ProcessManagement.jsx
|       |-- ProcessLibrary.jsx
|       |-- SimulationWorkbench.jsx
|       |-- OrgChart.jsx
|       |-- UserManagement.jsx
|       |-- RoleManagement.jsx
|       |-- AuditLogs.jsx
|       `-- Unauthorized.jsx
|
|-- server/
|   |-- app.js
|   |-- index.js
|   |-- db.js
|   |-- init-db.js
|   |-- routes/
|   |   |-- auth.js
|   |   |-- audit.js
|   |   |-- collaboration.js
|   |   |-- orgchart.js
|   |   |-- processes.js
|   |   `-- simulations.js
|   |-- utils/
|   |   |-- access.js
|   |   |-- auditLog.js
|   |   |-- collaboration.js
|   |   |-- processDiff.js
|   |   |-- processNarrative.js
|   |   |-- simulationEngine.js
|   |   |-- simulationReport.js
|   |   `-- simulationSchema.js
|   `-- migrations/
|       `-- simulation_tables.sql
|
|-- test/
|-- README.md
|-- USER_GUIDE.md
`-- PROJECT_DOCUMENTATION.md
```

## 4. Runtime Architecture

### 4.1 Frontend

The frontend is a React single-page application.

Main characteristics:

- route-level lazy loading through `React.lazy`
- global authentication state in `AuthContext`
- role-guarded screens via `ProtectedRoute`
- a single shell component (`Layout`) that filters navigation by permission
- BPMN viewing/editing and simulation panels loaded only when needed

### 4.2 Backend

The backend is a modular Express API.

Main characteristics:

- `server/app.js` creates the Express app
- `server/index.js` starts the HTTP server and handles graceful shutdown
- routes are grouped by business domain
- cross-cutting authorization rules live in `server/utils/access.js`
- schema bootstrap for some modules is lazy and route-driven

### 4.3 Persistence

All business data is stored in PostgreSQL.

Important note:

- legacy `company_id` columns still exist in the database for compatibility
- active product flows no longer expose company management as a live feature
- `/api/companies*` is retired and now returns `404`

## 5. Frontend Design

## 5.1 Routing

The current route tree is defined in `src/App.jsx`.

Active routes:

- `/login`
- `/unauthorized`
- `/`
- `/dashboard` -> redirects to the home path
- `/process-library`
- `/processes`
- `/simulations`
- `/orgchart`
- `/users`
- `/roles`
- `/audit-logs`

Access is role-based:

- all authenticated roles can open the process library and org chart
- admins, process designers, and process managers can use process management
- admins, process designers, and process managers can use simulations
- admins manage users, roles, and audit logs

## 5.2 Authentication Context

`src/contexts/AuthContext.jsx` is the client-side session layer.

Responsibilities:

- stores the authenticated user and resolved permission list
- persists session data in `localStorage`
- injects `x-user-id` automatically into API requests
- exposes role helpers such as `hasRole`, `hasAnyRole`, and `hasPermission`
- exposes CRUD helpers for users and roles

Implementation detail:

- authentication is not token-based
- the app trusts the backend user-context header model
- public endpoints such as login and password reset bypass user-header injection

## 5.3 Main UI Modules

### `Layout.jsx`

- left navigation
- mobile off-canvas navigation
- current-user summary
- logout entry point
- notification center access

### `Login.jsx`

- username/email login
- forgot-password flow
- reset code verification
- reset-password submission
- password show/hide interaction

### `ProcessManagement.jsx`

Core governance screen for managed processes.

Main capabilities:

- browse processes and categories
- create categories and processes
- edit BPMN content and metadata
- assign multiple process designers and process managers
- submit for review, approve, request reopen, reopen to draft, archive, and restore
- inspect workflow history and version history
- import/export BPMN
- generate explanation and report artifacts

### `ProcessLibrary.jsx`

Read-oriented navigation layer built on the same data as process management.

Main capabilities:

- section-based browsing: `pilotage`, `metiers`, `support`
- breadcrumb navigation
- category drill-down
- process discovery
- archived/live filtering

### `SimulationWorkbench.jsx`

Dedicated workspace for scenario analysis.

Main capabilities:

- create and edit simulation scenarios
- manage arrivals, resources, tasks, and flow probabilities
- run simulations
- compare scenarios
- inspect results, sensitivity, what-if, and resource planning
- export reports

### `OrgChart.jsx`

- view and edit an organizational tree
- create, update, move, and delete nodes
- assign users to positions

### `UserManagement.jsx`

- create, edit, and delete users
- assign a primary role
- assign additional roles with start and end dates
- manage temporary access windows

### `RoleManagement.jsx`

- inspect roles
- inspect permissions
- create and rename roles
- attach permissions to roles

### `AuditLogs.jsx`

- filter by entity type and action
- search entries by summary, actor, or entity id
- inspect JSON details for operational traceability

## 6. Backend Design

## 6.1 Application Boot

### `server/index.js`

- loads environment variables
- starts the HTTP server
- tracks open sockets
- performs graceful shutdown on `SIGINT`, `SIGTERM`, and `SIGHUP`

### `server/app.js`

- enables CORS for the Vite frontend
- installs JSON parsing
- serves uploaded files
- attaches the current request user
- mounts all route modules under `/api`

Mounted route modules:

- `auth.js`
- `audit.js`
- `collaboration.js`
- `processes.js`
- `orgchart.js`
- `simulations.js`

## 6.2 Authorization Model

Authorization logic is centralized in `server/utils/access.js`.

Canonical roles:

- `Admin`
- `Designer`
- `Validator`
- `Process Observer`

Display labels used in the UI:

- `Admin`
- `Process Designer`
- `Process Manager`
- `Viewer`

Permissions:

- `user_management`
- `role_management`
- `view_dashboard`
- `view_reports`
- `manage_processes`
- `manage_risks`

Additional role assignments:

- stored in `user_role_assignments`
- support `starts_on` and `expires_on`
- active roles are computed dynamically

Current platform behavior:

- company-based access control has been flattened at the application level
- admin flows are no longer organized around company scope
- the compatibility columns remain in storage and some internal joins still read them

## 6.3 Route Modules

### `server/routes/auth.js`

Main responsibilities:

- login and session refresh
- user CRUD
- role CRUD
- permission reads and role-permission updates
- password reset flow

Main endpoints:

- `POST /api/login`
- `GET /api/session`
- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:id`
- `DELETE /api/users/:id`
- `GET /api/roles`
- `GET /api/permissions`
- `GET /api/roles/:roleId/permissions`
- `GET /api/roles-with-permissions`
- `PUT /api/roles/:roleId/permissions`
- `POST /api/roles`
- `PUT /api/roles/:id`
- `DELETE /api/roles/:id`
- `POST /api/forgot-password`
- `POST /api/verify-reset-code`
- `POST /api/reset-password`

### `server/routes/processes.js`

Main responsibilities:

- process CRUD
- governance rules and workflow actions
- process category CRUD
- BPMN import/export
- process explanation/report generation
- version diff generation
- governance recipient resolution

Main endpoints:

- `GET /api/processes`
- `GET /api/process-governance-options`
- `GET /api/processes/:id`
- `POST /api/processes`
- `PUT /api/processes/:id`
- `DELETE /api/processes/:id`
- `POST /api/processes/import`
- `GET /api/processes/:id/export`
- `GET /api/processes/:id/explanation`
- `GET /api/processes/:id/report`
- `POST /api/processes/:id/report`
- `GET /api/processes/:id/workflow`
- `POST /api/processes/:id/workflow`
- `GET /api/processes/:id/diff`
- `GET /api/process-categories`
- `POST /api/process-categories`
- `PUT /api/process-categories/:id`
- `DELETE /api/process-categories/:id`
- `GET|POST|PUT|DELETE /api/companies...` -> retired, returns `404`

### `server/routes/collaboration.js`

Main responsibilities:

- entity comments
- entity attachments
- notifications
- process templates
- template application into a live process and optional scenario

Main endpoints:

- `GET /api/entities/:entityType/:entityId/comments`
- `POST /api/entities/:entityType/:entityId/comments`
- `GET /api/entities/:entityType/:entityId/attachments`
- `POST /api/entities/:entityType/:entityId/attachments`
- `DELETE /api/entities/:entityType/:entityId/attachments/:attachmentId`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `GET /api/process-templates`
- `POST /api/process-templates`
- `PUT /api/process-templates/:id`
- `DELETE /api/process-templates/:id`
- `POST /api/process-templates/:id/apply`

### `server/routes/orgchart.js`

Main responsibilities:

- org chart metadata
- org chart node CRUD
- node movement between parents

Main endpoints:

- `GET /api/orgchart/meta`
- `GET /api/orgchart/nodes`
- `POST /api/orgchart/nodes`
- `PUT /api/orgchart/nodes/:id`
- `PATCH /api/orgchart/nodes/:id/move`
- `DELETE /api/orgchart/nodes/:id`

### `server/routes/simulations.js`

Main responsibilities:

- scenario CRUD
- arrivals import/export
- resources CRUD
- task parameter editing
- flow probability editing
- simulation execution
- scenario comparison and reporting

Main endpoints:

- `GET /api/simulations`
- `GET /api/simulations/:id`
- `POST /api/simulations`
- `PUT /api/simulations/:id`
- `DELETE /api/simulations/:id`
- `GET /api/simulations/:id/compare/:otherId`
- `GET /api/simulations/:id/arrival-times`
- `POST /api/simulations/:id/arrival-times/import`
- `DELETE /api/simulations/:id/arrival-times`
- `GET /api/simulations/:id/export`
- `GET /api/simulations/:id/sensitivity`
- `POST /api/simulations/:id/what-if`
- `POST /api/simulations/:id/resource-plan`
- `GET /api/simulations/:id/report`
- `GET /api/simulations/:id/explanation`
- `GET /api/simulations/:id/resources`
- `POST /api/simulations/:id/resources`
- `PUT /api/simulations/:id/resources/:rid`
- `DELETE /api/simulations/:id/resources/:rid`
- `GET /api/simulations/:id/tasks`
- `PUT /api/simulations/:id/tasks/:taskId`
- `GET /api/simulations/:id/flows`
- `PUT /api/simulations/:id/flows/:flowId`
- `POST /api/simulations/:id/run`

### `server/routes/audit.js`

Main responsibilities:

- read-only audit log listing
- filtering by action and entity type

Main endpoint:

- `GET /api/audit-logs`

## 7. Database Model Summary

Core tables used by the current product:

### Identity and authorization

- `users`
- `roles`
- `permissions`
- `role_permissions`
- `user_role_assignments`

### Process governance

- `process_categories`
- `processes`
- `process_versions`
- `process_workflow_comments`

### Collaboration

- `entity_comments`
- `entity_attachments`
- `notifications`
- `process_templates`

### Org chart

- `org_chart_nodes`

### Simulation

- `simulation_scenarios`
- `simulation_resources`
- `simulation_task_data`
- `simulation_flow_probabilities`
- `simulation_arrival_times`

### Audit

- `audit_logs`

Legacy compatibility note:

- `companies` and `company_id` fields are still present in the schema
- they are not part of the active product surface anymore

## 8. Key Business Workflows

## 8.1 Login and session resolution

1. User submits credentials to `POST /api/login`.
2. Backend validates the password with `bcryptjs`.
3. Backend resolves the request user through `buildRequestUser`.
4. Frontend stores `currentUser` and `permissions` in `localStorage`.
5. Future API requests automatically receive the `x-user-id` header.

## 8.2 Process lifecycle

Supported primary states:

- `draft`
- `review`
- `approved`
- `archived`

Workflow actions:

- submit for review
- approve
- request reopen
- reopen/return to draft
- archive
- restore

Important rules:

- only assigned process managers or admins can approve, reopen, archive, or restore
- only assigned process designers or admins can request reopen on approved processes
- version snapshots are created on approval, not on every save
- workflow comments store governance notes and timestamps

## 8.3 Additional role windows

Each user may have:

- one primary role in `users.role`
- zero or more additional roles in `user_role_assignments`

Each additional role may include:

- `starts_on`
- `expires_on`

This allows temporary elevations or parallel responsibilities.

## 8.4 Collaboration and alerts

The platform supports:

- comments on processes, simulations, and org chart nodes
- attachments on supported entities
- notification delivery with deep links to the related item
- read / read-all state transitions

## 8.5 Simulation lifecycle

1. A scenario is linked to a process.
2. The user configures arrivals, resources, tasks, and flow probabilities.
3. The scenario is executed through `POST /api/simulations/:id/run`.
4. Results are stored as JSON on the scenario row.
5. Analysis endpoints expose reporting, comparison, explanation, what-if, sensitivity, and resource planning views.

## 9. Setup and Local Run

## 9.1 Prerequisites

- Node.js
- PostgreSQL
- npm

## 9.2 Environment variables

The backend reads:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=maintest
DB_USER=vitalis
DB_PASSWORD=vitalis
PORT=3001
HOST=0.0.0.0
```

## 9.3 Install

```bash
npm install
```

## 9.4 Start the backend

```bash
npm run dev:server
```

## 9.5 Start the frontend

```bash
npm run dev
```

Default local URLs:

- frontend: `http://localhost:5174` in the current local setup
- backend: `http://localhost:3001`

## 9.6 Important bootstrap notes

- `server/init-db.js` is a development bootstrap script
- it is not safe for production data because it recreates some process tables
- additional seed scripts in the repository are for demo data preparation

## 10. Scripts

Available npm scripts from `package.json`:

- `npm run dev`
- `npm run dev:server`
- `npm run init:db`
- `npm run seed:tunisian-bank`
- `npm run build`
- `npm run lint`
- `npm test`
- `npm run test:watch`
- `npm run test:coverage`
- `npm run preview`
- `npm run start`

## 11. Testing and Verification

Automated coverage currently exists for:

- auth context behavior
- dashboard rendering
- backend route behavior
- process workflow behavior

Recommended local verification after changes:

```bash
npm test -- --runInBand
npm run build
```

## 12. Technical Notes and Hotspots

- `AuthContext` replaces global `fetch`, so API behavior is tightly coupled to the frontend session model.
- The backend relies on `x-user-id`; there is no JWT or cookie session layer.
- `server/routes/processes.js` is a large, central module and is the highest-complexity route file in the project.
- Simulation storage is partly structured relational data and partly JSON results payloads.
- Some schema setup is lazy, especially for collaboration, audit, org chart, and simulation support tables.
- Legacy company columns remain in the schema and in some joins for backward compatibility, even though company management is retired from the active product.

## 13. Documentation Inventory

Project documentation files:

- `README.md` -> project overview and quick start
- `USER_GUIDE.md` -> end-user guidance
- `PROJECT_DOCUMENTATION.md` -> technical architecture and implementation reference
