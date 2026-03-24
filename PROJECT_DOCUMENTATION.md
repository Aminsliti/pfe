# V-BPM Platform - Full Project Documentation

## 1. Project Summary

V-BPM is a full-stack Business Process Management platform built around four major domains:

1. Authentication, RBAC, and multi-company access control
2. BPMN process management and versioning
3. Process simulation and scenario analysis
4. Organization structure management through an interactive org chart

The project uses a React frontend, an Express backend, and PostgreSQL for persistence.

This document is written from the current codebase state in `C:\Users\user\CascadeProjects\pfe-main`.

## 2. Technology Stack

### Frontend

- React 19
- React Router DOM 7
- React Bootstrap + Bootstrap 5
- Bootstrap Icons
- bpmn-js / bpmn-moddle
- Vite

### Backend

- Node.js
- Express 5
- PostgreSQL via `pg`
- bcryptjs
- multer
- cors
- dotenv

### Testing and Tooling

- Jest
- Supertest
- Testing Library
- Babel Jest
- ESLint

## 3. Repository Layout

```text
pfe-main/
|-- src/                       Frontend app
|   |-- App.jsx                Main router and lazy-loaded pages
|   |-- main.jsx               React entrypoint
|   |-- contexts/
|   |   `-- AuthContext.jsx    Auth state + fetch header injection
|   |-- components/
|   |   |-- Layout.jsx         Main app shell
|   |   |-- ProtectedRoute.jsx Route guards
|   |   `-- BpmnEditor/        BPMN editing components
|   `-- pages/                 Main screens
|
|-- server/                    Backend app
|   |-- app.js                 Express app factory
|   |-- index.js               Server startup
|   |-- db.js                  PostgreSQL pool
|   |-- init-db.js             Development bootstrap script
|   |-- migrate-simulations.js Simulation migration runner
|   |-- migrations/
|   |   `-- simulation_tables.sql
|   |-- routes/
|   |   |-- auth.js
|   |   |-- processes.js
|   |   |-- simulations.js
|   |   `-- orgchart.js
|   `-- utils/
|       |-- access.js
|       `-- simulationEngine.js
|
|-- test/                      Jest/Supertest support and route tests
|-- dist/                      Production frontend build output
|-- README.md
`-- PROJECT_DOCUMENTATION.md
```

## 4. System Architecture

### 4.1 Frontend architecture

The frontend is a single-page React application. The current route tree is defined in [src/App.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/App.jsx).

Main characteristics:

- Authentication is managed globally through `AuthContext`
- Protected routes enforce role access in `ProtectedRoute`
- The application shell is provided by `Layout`
- Major pages are lazy loaded with `React.lazy`
- The BPMN modeler is also lazy loaded only when editing a process

This means users do not load all admin and modeling code on first paint.

### 4.2 Backend architecture

The backend uses a simple modular Express structure:

- [server/app.js](/C:/Users/user/CascadeProjects/pfe-main/server/app.js) creates the Express app
- [server/index.js](/C:/Users/user/CascadeProjects/pfe-main/server/index.js) starts the HTTP server
- routes are grouped by domain in `server/routes`
- cross-cutting permission and company scoping behavior lives in [server/utils/access.js](/C:/Users/user/CascadeProjects/pfe-main/server/utils/access.js)

### 4.3 Request lifecycle

The most important request flow in the project is the authenticated API flow:

1. A user logs in through `POST /api/login`
2. The backend returns the user profile and resolved permissions
3. The frontend stores `currentUser` and `permissions` in `localStorage`
4. `AuthContext` replaces `globalThis.fetch` with an authenticated wrapper
5. Any request to `/api/*` gets an `x-user-id` header injected automatically
6. `attachRequestUser` on the backend reads `x-user-id`
7. The backend resolves the current user, role, company, and permissions
8. Routes authorize the request through permission checks and company scoping checks

This is not token-based auth. It is user-context-header-based auth inside the current app architecture.

## 5. Frontend Modules

### 5.1 App shell and routing

#### [src/App.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/App.jsx)

Responsibilities:

- defines all application routes
- lazy loads route modules
- wraps everything in `AuthProvider`
- uses `ProtectedRoute` to enforce role access

Current route paths:

- `/login`
- `/unauthorized`
- `/`
- `/dashboard`
- `/processes`
- `/process-library`
- `/simulations`
- `/orgchart`
- `/companies`
- `/users`
- `/roles`

#### [src/components/Layout.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/components/Layout.jsx)

Responsibilities:

- renders the left-side navigation
- filters visible navigation items by permission
- provides desktop sidebar + mobile offcanvas behavior
- shows the current user card and logout control

#### [src/components/ProtectedRoute.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/components/ProtectedRoute.jsx)

Responsibilities:

- blocks unauthenticated access
- redirects to `/login`
- redirects unauthorized roles to `/unauthorized`

### 5.2 Authentication context

#### [src/contexts/AuthContext.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/contexts/AuthContext.jsx)

This is one of the most important frontend files.

Responsibilities:

- stores `user`, `permissions`, `company`, and `loading`
- performs login
- clears local session on logout
- wraps `fetch` so backend requests automatically include `x-user-id`
- exposes role helpers such as:
  - `hasPermission`
  - `hasRole`
  - `hasAnyRole`
  - `isGlobalAdmin`
  - `isCompanyAdmin`
- exposes admin helper methods for users and roles

Important implementation detail:

- Only URLs that look like API calls get the user header attached.
- Public endpoints like login and password reset do not rely on that header.

### 5.3 Main pages

#### [src/pages/Login.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/Login.jsx)

- login form
- password reset flow UI
- receives the backend login payload and initializes the session

#### [src/pages/Dashboard.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/Dashboard.jsx)

- welcome/profile dashboard
- permission summary
- feature visibility overview

#### [src/pages/ProcessManagement.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/ProcessManagement.jsx)

This is the main process administration screen.

Responsibilities:

- list processes in hierarchy or list mode
- filter by search, category, and status
- create, edit, delete, import, and export processes
- open the BPMN editor for process modeling

Important implementation details:

- the production editing path now uses the BPMN modeler
- the BPMN modeler is lazy loaded
- process import uses multipart file upload

#### [src/pages/ProcessLibrary.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/ProcessLibrary.jsx)

- read-oriented process library view
- grouped, browsable overview of process families

#### [src/pages/SimulationScenarios.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/SimulationScenarios.jsx)

Responsibilities:

- create simulation scenarios
- edit scenario settings
- manage simulation resources
- manage task timings and distributions
- manage gateway flow probabilities
- run simulations and display results

#### [src/pages/OrgChart.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/OrgChart.jsx)

Responsibilities:

- render a true organigram editor
- create root nodes and child nodes
- edit node metadata
- assign people to positions
- mark positions as vacant
- move nodes by drag and drop
- persist the structure through backend APIs

#### [src/pages/CompanyManagement.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/CompanyManagement.jsx)

- list companies
- create companies
- edit company metadata
- company-scoped editing for company admins

#### [src/pages/UserManagement.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/UserManagement.jsx)

- list users
- create/update/delete users
- assign users to companies
- company admin sees only their own company users

#### [src/pages/RoleManagement.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/RoleManagement.jsx)

- global-admin-only role management
- permission assignment per role

#### [src/pages/Unauthorized.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/Unauthorized.jsx)

- fallback screen for blocked route access

### 5.4 BPMN components

#### [src/components/BpmnEditor/BpmnEditorModeler.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/components/BpmnEditor/BpmnEditorModeler.jsx)

Current production modeler used by process editing.

Responsibilities:

- render BPMN diagrams
- load BPMN XML
- normalize older/legacy definitions where needed
- allow diagram editing and saving

#### [src/components/BpmnEditor/BpmnEditor.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/components/BpmnEditor/BpmnEditor.jsx)

Legacy custom BPMN-like editor still present in the repository.

Current status:

- still covered by unit tests
- not the main editing flow used by `ProcessManagement`

## 6. Backend Modules

### 6.1 App bootstrap

#### [server/app.js](/C:/Users/user/CascadeProjects/pfe-main/server/app.js)

Responsibilities:

- configures CORS and JSON parsing
- applies request-user middleware
- mounts all API route groups
- serves the frontend in production from `dist`
- provides a central error handler

#### [server/index.js](/C:/Users/user/CascadeProjects/pfe-main/server/index.js)

Responsibilities:

- loads environment variables
- starts the server on `PORT`
- handles shutdown and crash logging

### 6.2 Database connection

#### [server/db.js](/C:/Users/user/CascadeProjects/pfe-main/server/db.js)

Creates a PostgreSQL connection pool using:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

Defaults are provided in code, but `.env` should be treated as the source of truth.

### 6.3 Access control and request scoping

#### [server/utils/access.js](/C:/Users/user/CascadeProjects/pfe-main/server/utils/access.js)

This file defines the security model of the application.

Responsibilities:

- declares roles and permissions
- resolves the current request user from `x-user-id`
- loads permissions for a role from the database
- bootstraps the `Company Administrator` role if missing
- centralizes authorization helpers
- centralizes company-scope access checks

Important helpers:

- `ensureAuthenticated`
- `ensurePermission`
- `ensureCompanyAccess`
- `sanitizeUserPayloadForRole`
- `buildRequestUser`
- `attachRequestUser`

### 6.4 Route groups

#### [server/routes/auth.js](/C:/Users/user/CascadeProjects/pfe-main/server/routes/auth.js)

Responsibilities:

- login
- password reset flow
- user CRUD
- role CRUD
- permission reads

Important behavior:

- `POST /api/login` accepts username or email
- password reset codes are stored on the `users` table
- the reset code is logged server-side rather than actually emailed in the current implementation
- role management is global-admin-only
- user CRUD is permission-based and company-scoped

#### [server/routes/processes.js](/C:/Users/user/CascadeProjects/pfe-main/server/routes/processes.js)

Responsibilities:

- process CRUD
- process import/export
- category CRUD
- company CRUD

Important behavior:

- `GET /api/processes` supports query filters
- create/update process actions create version entries
- BPMN import uses `multer`
- company writes are constrained by global-admin or company-admin permissions

#### [server/routes/simulations.js](/C:/Users/user/CascadeProjects/pfe-main/server/routes/simulations.js)

Responsibilities:

- simulation scenario CRUD
- scenario resource CRUD
- task data CRUD
- flow probability CRUD
- running the simulation engine

Important behavior:

- simulation scenarios are tied to a process
- task data may be auto-generated from BPMN XML or legacy JSON diagrams
- results are stored on the scenario row as JSON

#### [server/routes/orgchart.js](/C:/Users/user/CascadeProjects/pfe-main/server/routes/orgchart.js)

Responsibilities:

- metadata loading for the org chart editor
- organigram node CRUD
- re-parenting nodes
- lazy schema creation and initial seeding

Important behavior:

- the `org_chart_nodes` table is not created by `init-db.js`
- it is created on first org chart API access
- the route can seed an initial structure from existing companies and users

## 7. Database Model

This section describes the effective application model. The schema is initialized through a combination of:

- [server/init-db.js](/C:/Users/user/CascadeProjects/pfe-main/server/init-db.js)
- [server/migrate-simulations.js](/C:/Users/user/CascadeProjects/pfe-main/server/migrate-simulations.js)
- lazy org chart schema bootstrap in [server/routes/orgchart.js](/C:/Users/user/CascadeProjects/pfe-main/server/routes/orgchart.js)

### 7.1 Core business tables

#### companies

Purpose:

- tenant boundary for most business data

Key columns:

- `id`
- `name`
- `description`
- `logo_url`
- `created_at`
- `updated_at`

#### users

Purpose:

- user identity, password, role, and company association

Key columns:

- `username`
- `password`
- `email`
- `full_name`
- `role`
- `company_id`
- `reset_code`
- `reset_code_expires`

#### roles

Purpose:

- named roles for RBAC

#### permissions

Purpose:

- named permissions used by backend authorization helpers

#### role_permissions

Purpose:

- many-to-many mapping from roles to permissions

### 7.2 Process tables

#### process_categories

Purpose:

- process grouping

#### processes

Purpose:

- main process entity

Key columns:

- `name`
- `description`
- `bpmn_xml`
- `category_id`
- `parent_id`
- `company_id`
- `created_by`
- `version`
- `status`

Important note:

- `server/init-db.js` contains legacy bootstrap behavior and recreates process tables.
- Treat it as a development initializer, not a safe production migration tool.

#### process_versions

Purpose:

- immutable version snapshots of BPMN content per process

### 7.3 Simulation tables

Defined in [server/migrations/simulation_tables.sql](/C:/Users/user/CascadeProjects/pfe-main/server/migrations/simulation_tables.sql).

#### simulation_scenarios

- scenario metadata and result JSON

#### simulation_resources

- scenario resources

#### simulation_task_data

- task timing, distribution, cost, and optional resource link

#### simulation_flow_probabilities

- probability configuration for gateway paths

### 7.4 Org chart table

#### org_chart_nodes

Created lazily inside [server/routes/orgchart.js](/C:/Users/user/CascadeProjects/pfe-main/server/routes/orgchart.js).

Key columns:

- `parent_id`
- `company_id`
- `user_id`
- `name`
- `title`
- `node_type`
- `description`
- `color`
- `sort_order`
- `is_vacant`

Supported node types:

- `company`
- `division`
- `department`
- `team`
- `position`

## 8. Roles, Permissions, and Multi-Company Rules

### 8.1 Roles

Current roles:

- Administrator
- Company Administrator
- Business Analyst
- Process Owner
- Risk Manager
- Viewer

### 8.2 Permissions

Current permissions:

- `user_management`
- `role_management`
- `view_dashboard`
- `view_reports`
- `manage_processes`
- `manage_risks`

### 8.3 Effective access rules

#### Administrator

- global scope
- can manage roles
- can manage companies
- can access all company data

#### Company Administrator

- scoped to their own company
- can manage users inside that company
- can manage processes and simulations in that company
- can manage their company org chart
- cannot manage global roles

#### Other non-admin roles

- access is permission-based and company-scoped

### 8.4 Company scoping model

The backend is the source of truth for scoping.

Rules:

- if the user is a global admin, cross-company access is allowed
- otherwise, the backend checks the target company against `req.user.companyId`
- requests for data without a company may be rejected for non-global admins

This is enforced in [server/utils/access.js](/C:/Users/user/CascadeProjects/pfe-main/server/utils/access.js), not only in the UI.

## 9. API Reference

All non-public endpoints are mounted under `/api` and expect `x-user-id`.

### 9.1 Public endpoints

#### Authentication and password recovery

- `POST /api/login`
- `POST /api/forgot-password`
- `POST /api/verify-reset-code`
- `POST /api/reset-password`

### 9.2 User and role administration

#### Users

- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:id`
- `DELETE /api/users/:id`

#### Roles and permissions

- `GET /api/roles`
- `GET /api/permissions`
- `GET /api/roles/:roleId/permissions`
- `GET /api/roles-with-permissions`
- `PUT /api/roles/:roleId/permissions`
- `POST /api/roles`
- `PUT /api/roles/:id`
- `DELETE /api/roles/:id`

### 9.3 Process and company management

#### Processes

- `GET /api/processes`
- `GET /api/processes/:id`
- `POST /api/processes`
- `PUT /api/processes/:id`
- `DELETE /api/processes/:id`
- `POST /api/processes/import`
- `GET /api/processes/:id/export`

Useful query params for `GET /api/processes`:

- `search`
- `category`
- `status`
- `company`
- `hierarchical`

#### Process categories

- `GET /api/process-categories`
- `POST /api/process-categories`

#### Companies

- `GET /api/companies`
- `POST /api/companies`
- `PUT /api/companies/:id`
- `DELETE /api/companies/:id`

### 9.4 Org chart

- `GET /api/orgchart/meta`
- `GET /api/orgchart/nodes`
- `POST /api/orgchart/nodes`
- `PUT /api/orgchart/nodes/:id`
- `PATCH /api/orgchart/nodes/:id/move`
- `DELETE /api/orgchart/nodes/:id`

### 9.5 Simulations

#### Scenario CRUD

- `GET /api/simulations`
- `GET /api/simulations/:id`
- `POST /api/simulations`
- `PUT /api/simulations/:id`
- `DELETE /api/simulations/:id`

#### Scenario resources

- `GET /api/simulations/:id/resources`
- `POST /api/simulations/:id/resources`
- `PUT /api/simulations/:id/resources/:rid`
- `DELETE /api/simulations/:id/resources/:rid`

#### Task data

- `GET /api/simulations/:id/tasks`
- `PUT /api/simulations/:id/tasks/:taskId`

#### Flow probabilities

- `GET /api/simulations/:id/flows`
- `PUT /api/simulations/:id/flows/:flowId`

#### Run simulation

- `POST /api/simulations/:id/run`

## 10. Simulation Engine

#### [server/utils/simulationEngine.js](/C:/Users/user/CascadeProjects/pfe-main/server/utils/simulationEngine.js)

Responsibilities:

- detect tasks from legacy JSON diagrams
- detect tasks from BPMN XML
- build result histograms
- run simulation calculations

#### Supported task extraction sources

- legacy custom JSON diagrams
- BPMN XML

#### Supported duration models

- `fixed`
- `normal`
- `uniform`
- `exponential`

#### Result metrics

- total instances
- active instances
- average duration
- minimum duration
- maximum duration
- P95 duration
- P99 duration
- total cost
- per-task metrics
- histogram

## 11. Testing and Quality

The project now includes an automated test suite.

### 11.1 Tooling

- Jest
- Supertest
- Testing Library
- jsdom test environment for frontend tests
- node test environment for backend route tests

### 11.2 Test files

#### Frontend tests

- [src/components/BpmnEditor/BpmnEditor.test.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/components/BpmnEditor/BpmnEditor.test.jsx)
- [src/pages/Dashboard.test.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/Dashboard.test.jsx)
- [src/contexts/AuthContext.test.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/contexts/AuthContext.test.jsx)

#### Backend and integration tests

- [server/utils/simulationEngine.test.js](/C:/Users/user/CascadeProjects/pfe-main/server/utils/simulationEngine.test.js)
- [test/server/auth.routes.test.js](/C:/Users/user/CascadeProjects/pfe-main/test/server/auth.routes.test.js)
- [test/server/processes.routes.test.js](/C:/Users/user/CascadeProjects/pfe-main/test/server/processes.routes.test.js)
- [test/server/simulations.routes.test.js](/C:/Users/user/CascadeProjects/pfe-main/test/server/simulations.routes.test.js)
- [test/server/orgchart.routes.test.js](/C:/Users/user/CascadeProjects/pfe-main/test/server/orgchart.routes.test.js)
- [test/server/database-crud.test.js](/C:/Users/user/CascadeProjects/pfe-main/test/server/database-crud.test.js)

### 11.3 Commands

- `npm test`
- `npm run test:watch`
- `npm run test:coverage`

### 11.4 Current verification baseline

Latest verification completed during development:

- test suites passing
- production build passing

## 12. Build, Performance, and Bundling

The frontend was optimized to reduce initial load size.

### 12.1 Current optimization approach

#### Route-level lazy loading

Implemented in [src/App.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/App.jsx).

Effect:

- heavy pages load only when visited
- startup payload is smaller

#### BPMN modeler lazy loading

Implemented in [src/pages/ProcessManagement.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/ProcessManagement.jsx).

Effect:

- the BPMN modeling stack is loaded only when editing a process

#### Manual chunk splitting

Implemented in [vite.config.js](/C:/Users/user/CascadeProjects/pfe-main/vite.config.js).

Current vendor chunk strategy separates:

- router-related code
- bootstrap-related code
- BPMN-related code
- generic vendor code

### 12.2 Operational interpretation

The build still contains a large BPMN chunk, but that is now isolated from the initial app load. This is acceptable for a feature-heavy editor because most users do not need the modeler immediately on the first route render.

## 13. Local Setup and Developer Workflow

### 13.1 Prerequisites

- Node.js 18+
- PostgreSQL

### 13.2 Environment variables

The project expects `.env` in the repository root.

Supported keys:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=maintest
DB_USER=postgres
DB_PASSWORD=vitalis
PORT=3001
```

### 13.3 Install

```bash
npm install
```

### 13.4 Database bootstrap

#### Base schema and seed

```bash
npm run init:db
```

Important:

- this is a development bootstrap script
- it recreates process tables
- it also seeds roles, permissions, companies, demo users, and demo processes

#### Simulation tables

```bash
node server/migrate-simulations.js
```

#### Org chart table

No separate migration is required in the current implementation.

The table is created automatically on the first successful call to the org chart endpoints.

### 13.5 Run locally

#### Backend

```bash
npm run dev:server
```

#### Frontend

```bash
npm run dev
```

### 13.6 Production frontend build

```bash
npm run build
```

## 14. Seed Data and Demo Utilities

#### [server/init-db.js](/C:/Users/user/CascadeProjects/pfe-main/server/init-db.js)

Seeds:

- base roles
- base permissions
- process categories
- sample companies
- demo users
- demo processes

#### [seed-demo-order-fulfillment.js](/C:/Users/user/CascadeProjects/pfe-main/seed-demo-order-fulfillment.js)

Adds a realistic demo process and simulation data for testing the simulation feature set.

## 15. Known Limitations and Technical Notes

### 15.1 Authentication model

The current auth model is based on local storage and a user ID request header. This is sufficient for local development and internal tooling, but it is not equivalent to a production-grade token/session security model.

### 15.2 Password reset

Password reset codes are generated and stored, but the code is logged server-side instead of being sent through a real email provider.

### 15.3 Database bootstrap script

`server/init-db.js` contains legacy bootstrap behavior and is not a formal migration system. A future improvement would be to replace it with versioned migrations for all tables.

### 15.4 Mixed legacy/editor support

The repository still contains both the legacy custom BPMN editor and the current BPMN modeler. The modeler is the primary production editing path.

### 15.5 CSS size

The build is now code-split, but CSS remains relatively large because Bootstrap and BPMN styles are global. Additional CSS optimization is possible later if needed.

## 16. Recommended Next Improvements

Recommended future improvements:

1. Replace the bootstrap script with a real migration system for all tables
2. Introduce token- or session-based authentication
3. Add request validation middleware for route payloads
4. Add coverage thresholds and CI automation
5. Split or trim global CSS further
6. Add real email delivery for password reset
7. Add formal API request/response examples for external integrators

## 17. File Reference Index

Core files worth knowing first:

- [src/App.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/App.jsx)
- [src/contexts/AuthContext.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/contexts/AuthContext.jsx)
- [src/components/Layout.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/components/Layout.jsx)
- [src/pages/ProcessManagement.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/ProcessManagement.jsx)
- [src/pages/SimulationScenarios.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/SimulationScenarios.jsx)
- [src/pages/OrgChart.jsx](/C:/Users/user/CascadeProjects/pfe-main/src/pages/OrgChart.jsx)
- [server/app.js](/C:/Users/user/CascadeProjects/pfe-main/server/app.js)
- [server/index.js](/C:/Users/user/CascadeProjects/pfe-main/server/index.js)
- [server/utils/access.js](/C:/Users/user/CascadeProjects/pfe-main/server/utils/access.js)
- [server/routes/auth.js](/C:/Users/user/CascadeProjects/pfe-main/server/routes/auth.js)
- [server/routes/processes.js](/C:/Users/user/CascadeProjects/pfe-main/server/routes/processes.js)
- [server/routes/simulations.js](/C:/Users/user/CascadeProjects/pfe-main/server/routes/simulations.js)
- [server/routes/orgchart.js](/C:/Users/user/CascadeProjects/pfe-main/server/routes/orgchart.js)
- [server/utils/simulationEngine.js](/C:/Users/user/CascadeProjects/pfe-main/server/utils/simulationEngine.js)
- [server/init-db.js](/C:/Users/user/CascadeProjects/pfe-main/server/init-db.js)
- [server/migrations/simulation_tables.sql](/C:/Users/user/CascadeProjects/pfe-main/server/migrations/simulation_tables.sql)

---

Last updated: 2026-03-24
