# V-BPM Platform

V-BPM is a business process management platform built with React, Express, and PostgreSQL. It supports BPMN-based process modeling, governed review workflows, simulation scenarios, role-based access control, and an interactive organigram editor.

## Main Capabilities

- BPMN process management with import/export, versioning, approval workflow, version diffing, human-readable diagram explanations, and PDF/HTML explanation reports
- Process simulation workbench with working calendars, resource availability windows, task SLA rules, CSV arrival imports, Monte Carlo analysis, what-if analysis, sensitivity analysis, resource planning, status tracking, BPMN heatmaps, scenario explanations, and CSV/Excel/PDF reporting
- Cross-module collaboration with comments, attachments, in-app notifications, and reusable process templates
- Interactive organization chart editor with drag-and-drop re-parenting
- User and role administration with audit logging
- Jest + Supertest test suite for frontend and backend flows

## Documentation

- Full project documentation: [PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md)
- End-user guide: [USER_GUIDE.md](./USER_GUIDE.md)

That document covers:

- architecture and request flow
- frontend modules and pages
- backend modules and API endpoints
- RBAC and additional role windows
- temporary additional user roles with expiration dates
- process approval, version diff, and audit-log workflows
- process and simulation explanation/report generation
- database schema and bootstrap behavior
- simulation engine behavior
- end-user workflows for login, simulations, and org chart editing
- test suite and build pipeline
- deployment, troubleshooting, and known limitations

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create or update `.env` in the project root:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=maintest
DB_USER=postgres
DB_PASSWORD=vitalis
PORT=3001
```

### 3. Initialize the base database

```bash
npm run init:db
```

Important:

- `server/init-db.js` is a development bootstrap script.
- It recreates the `processes` and `process_versions` tables.
- Do not run it against production data without reviewing it first.

### 4. Create simulation tables

```bash
node server/migrate-simulations.js
```

### 5. Start the backend

```bash
npm run dev:server
```

### 6. Start the frontend

```bash
npm run dev
```

Default URLs:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001/api`

## Demo Accounts

These are created by `server/init-db.js`:

| Username | Password   | Role               |
|----------|------------|--------------------|
| `admin`  | `admin123` | Administrator      |
| `analyst`| `analyst123` | Business Analyst |
| `owner`  | `owner123` | Process Owner      |
| `risk`   | `risk123`  | Risk Manager       |
| `viewer` | `viewer123`| Viewer             |

## Available Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the Vite frontend dev server |
| `npm run dev:server` | Start the Express backend |
| `npm run init:db` | Bootstrap the base schema and demo data |
| `npm run build` | Create a production frontend build |
| `npm run preview` | Preview the production frontend build |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Jest test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage output |

## Quality Status

Current local verification:

- Jest suites: passing
- Production build: passing
- Scenario comparison and BPMN heatmap: enabled
- Simulation workbench with SLA, Monte Carlo, what-if, sensitivity, planning, and polished reports: enabled
- Diagram and simulation explanation with PDF/HTML reports: enabled
- Comments, attachments, notifications, and process templates: enabled
- Process approval workflow and version diff: enabled
- Audit log route and admin page: enabled
- Frontend route-level lazy loading: enabled
- BPMN editor lazy loading: enabled

## Notes

- All non-public backend routes require an `x-user-id` header.
- The frontend injects that automatically after login through `AuthContext`.
- The org chart schema is created lazily the first time the org chart API is used.
- Legacy company columns still exist in the schema for compatibility, but company management is no longer part of the active product surface.
