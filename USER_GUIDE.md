# V-BPM User Guide

## 1. Overview

V-BPM helps users manage BPMN processes, run process simulations, and maintain a shared organization chart for the workspace.

What you can do depends on your role:

- `Admin`: access all administration features and governance actions
- `Process Manager`, `Process Designer`, and `Viewer`: access the features granted to their active roles

## 2. Login

1. Open the application.
2. Enter your username or email and password.
3. After login, the system loads your workspace permissions and active roles.

Important:

- only actions allowed by your current role set are enabled
- `Admin` can work across the whole workspace

## 3. Main Navigation

The left sidebar gives access to the main modules:

- `Dashboard`
- `Process Management`
- `Process Library`
- `Simulations`
- `Org Chart`
- `Administration` pages when your role allows them
- the notification center in the app shell for failed simulations, approvals waiting, overdue drafts, and admin actions

## 4. Process Management

Use `Process Management` to:

- create a new BPMN process
- edit an existing process in the BPMN modeler
- import a BPMN file
- apply reusable process templates with starter BPMN and simulation defaults
- move a process through `Draft`, `In Review`, `Approved`, and `Archived`
- add approval comments with timestamps and approver name
- attach files and discussion comments to the process record
- compare two saved versions to see metadata, BPMN, and task changes
- generate a readable explanation of the BPMN diagram, participants, lanes, routing, and workflow lifecycle
- export that explanation as `PDF` or `HTML`
- organize processes by category and hierarchy
- export or archive a process

Tips:

- older legacy processes are normalized so they can still open in the modeler
- hierarchy mode shows parent and child processes inside categories
- open the process details panel to manage approval workflow and compare versions
- open the process details panel to read the auto-generated diagram explanation and export it

## 5. Process Library

Use `Process Library` for a read-oriented view of your process map.

It is designed for browsing rather than editing:

- group processes by business family
- search by name
- open process details quickly

## 6. Simulations

The `Simulations` page is now a full simulation workbench for configuring, running, comparing, and reporting scenarios.

### 6.1 Create a scenario

1. Open `Simulations`.
2. Click `Nouveau scenario`.
3. Choose the linked process.
4. Set the number of instances, dates, Monte Carlo runs, and notification options.
5. Save the scenario.

Each scenario also includes a discussion and attachments panel in the `Overview` tab for sharing notes and source files with your team.

### 6.2 Configure the working calendar

In the `Overview` tab you can define:

- business start and end times
- weekend days
- holiday dates
- optional shift windows
- whether notifications are enabled for that scenario

Use this when the process should follow business hours instead of running continuously.

### 6.3 Configure resources

In the `Resources` tab you can define:

- resource name
- type
- quantity
- hourly cost
- availability rate
- per-resource availability windows

These values are used to calculate utilisation and waiting times.

### 6.4 Configure task data and SLA rules

In the `Task data` tab you can define:

- task duration
- duration distribution
- standard deviation where relevant
- assigned resource
- task cost
- SLA target duration per task

Late tasks and late instances are reported automatically after the run.

### 6.5 Configure gateway probabilities

In the `Flow probabilities` tab you can define probability splits for BPMN gateway exits.

### 6.6 Import exact arrival times from CSV

Use the `Overview` tab when you need exact instance arrival times.

Steps:

1. Enable CSV arrival import.
2. Save the scenario.
3. In the `Exact arrivals (CSV)` section, paste or upload the CSV content.
4. Click `Import arrivals`.

Supported arrival formats:

- minute offsets like `0`, `15`, `42.5`
- times like `08:00` or `08:15:30`
- ISO timestamps like `2026-03-31T08:00:00`

The system stores the imported arrivals and uses them during the next run.

### 6.7 Run a simulation

Open the `Results` tab and click `Run simulation`.

Scenario status is managed automatically:

- `Running`: a run is in progress
- `Completed`: the run finished and results are stored
- `Failed`: the run ended with an error

If a simulation fails, the page shows the error message directly.

### 6.8 Read the results

The results tab shows:

- cycle time KPIs
- BPMN heatmap directly on the diagram
- a narrative explanation of what the scenario means, what slowed it down, and what resources are most constrained
- histogram of cycle times
- average cost and total cost
- simulation horizon
- resource utilisation rates
- queue wait and calendar wait per resource
- bottlenecks
- task-by-task performance with SLA breach rates
- Monte Carlo confidence ranges
- what-if analysis
- sensitivity analysis
- resource planning recommendations
- side-by-side scenario comparison for duration, cost, utilisation, and bottlenecks

You can also export:

- `CSV` for raw analysis data
- `Excel` for a management-friendly workbook
- `PDF` for a polished report snapshot including the scenario explanation

Use these outputs to identify:

- overloaded resources
- tasks with high queue delays
- tasks that breach SLA targets
- expensive steps
- unstable or long-running scenarios

### 6.9 Run what-if analysis and planning

Inside the `Results` tab you can:

- compare the current scenario against another completed scenario
- reduce or increase one task duration and rerun instantly
- change one resource quantity and see the delta immediately
- view sensitivity analysis to see what affects cycle time most
- ask the planner how many extra units are needed to hit a target cycle time

Use this when you want to test:

- extra staffing
- different task durations
- different arrival patterns
- different gateway probabilities
- stronger or weaker SLA targets

## 7. Org Chart

The `Org Chart` page supports real organigram editing.

You can:

- create root nodes
- create child nodes
- edit titles and departments
- assign people
- mark positions as vacant
- drag nodes to change reporting lines
- attach files and discussion comments to each organigram node

Changes are saved to the backend for the shared workspace organigram.

## 8. User Administration

Depending on your permissions, you can:

- create users
- assign a primary role
- grant additional roles at the same time
- make an additional role temporary by setting its start and end dates
- review the audit log of admin, process, org chart, and simulation changes

Important:

- role assignments should match the responsibilities of each user
- use temporary role windows when a permission should only apply for a limited period

## 9. Audit Log

Open `Audit Log` from the administration section to review:

- who changed a user, process, role, organigram node, or simulation
- what action was performed
- when it happened
- extra details captured for that event

Admins can review the full audit history, while other users only see what their permissions allow.

## 10. Notifications

Use the notification bell in the application shell to review:

- failed simulations
- process approvals waiting for action
- overdue drafts
- important admin and template actions

You can mark one notification or all notifications as read.

## 11. Troubleshooting

### Simulation says CSV arrivals are enabled but none are imported

- go back to `Caracteristiques`
- import the CSV file again
- rerun the scenario

### Simulation status shows `Failed`

- open the `Resultats` tab
- read the error alert
- verify task data, resources, and imported arrivals

### A page shows outdated data

- refresh the page
- if backend changes were just deployed locally, restart the backend server once

## 12. Best Practices

- assign the correct roles before users start working
- use the approval workflow instead of editing approved processes silently
- keep task durations realistic before comparing scenarios
- import CSV arrivals only when you need real arrival schedules
- compare resource utilisation and bottlenecks together, not in isolation
- use scenario comparison after every major simulation assumption change
- rerun scenarios after changing tasks, resources, or probabilities
