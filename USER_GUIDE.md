# V-BPM User Guide

## 1. Overview

V-BPM helps users manage BPMN processes, run process simulations, and maintain an organization chart inside their assigned company scope.

What you can do depends on your role:

- `Administrator`: access all companies and all administration features
- `Company Administrator`: manage users, processes, simulations, and organigram data for one company
- other business roles: access only the features and data granted to their role

## 2. Login

1. Open the application.
2. Enter your username or email and password.
3. After login, the system automatically applies your company scope.

Important:

- non-admin users only see data for their assigned company
- company administrators manage only their own company

## 3. Main Navigation

The left sidebar gives access to the main modules:

- `Dashboard`
- `Process Management`
- `Process Library`
- `Simulations`
- `Org Chart`
- `Administration` pages when your role allows them

## 4. Process Management

Use `Process Management` to:

- create a new BPMN process
- edit an existing process in the BPMN modeler
- import a BPMN file
- organize processes by category and hierarchy
- export or archive a process

Tips:

- older legacy processes are normalized so they can still open in the modeler
- hierarchy mode shows parent and child processes inside categories

## 5. Process Library

Use `Process Library` for a read-oriented view of your process map.

It is designed for browsing rather than editing:

- group processes by business family
- search by name
- open process details quickly

## 6. Simulations

The `Simulations` page is the main place to configure and run scenarios.

### 6.1 Create a scenario

1. Open `Simulations`.
2. Click `Nouveau scenario`.
3. Choose the linked process.
4. Set the number of instances and the scenario dates/options.
5. Save the scenario.

### 6.2 Configure resources

In the `Ressources` tab you can define:

- resource name
- type
- quantity
- hourly cost
- availability rate

These values are used to calculate utilisation and waiting times.

### 6.3 Configure task data

In the `Donnees des taches` tab you can define:

- task duration
- duration distribution
- standard deviation where relevant
- assigned resource
- task cost

### 6.4 Configure gateway probabilities

In the `Probabilites enchainements` tab you can define probability splits for BPMN gateway exits.

### 6.5 Import exact arrival times from CSV

Use the `Caracteristiques` tab when you need exact instance arrival times.

Steps:

1. Enable CSV arrival import.
2. Save the scenario.
3. In the `Arrivees exactes (CSV)` section, choose a `.csv` file.
4. Click `Importer`.

Supported arrival formats:

- minute offsets like `0`, `15`, `42.5`
- times like `08:00` or `08:15:30`
- ISO timestamps like `2026-03-31T08:00:00`

The system stores the imported arrivals and uses them during the next run.

### 6.6 Run a simulation

Open the `Resultats` tab and click `Simuler`.

Scenario status is managed automatically:

- `Running`: a run is in progress
- `Completed`: the run finished and results are stored
- `Failed`: the run ended with an error

If a simulation fails, the page shows the error message directly.

### 6.7 Read the results

The results tab shows:

- cycle time KPIs
- histogram of cycle times
- average cost and total cost
- simulation horizon
- resource utilisation rates
- average waiting time per resource
- bottlenecks
- task-by-task performance

Use these outputs to identify:

- overloaded resources
- tasks with high queue delays
- expensive steps
- unstable or long-running scenarios

## 7. Org Chart

The `Org Chart` page supports real organigram editing.

You can:

- create root nodes
- create child nodes
- edit titles and departments
- assign people
- mark positions as vacant
- drag nodes to change reporting lines

Changes are saved to the backend and scoped to the visible company.

## 8. Company and User Administration

Depending on your permissions, you can:

- create or edit companies
- create users
- assign each user to a company
- assign roles

Important:

- each user should belong to a company unless they are a global admin
- company admins should be used as sub-admins for each tenant/company

## 9. Troubleshooting

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

## 10. Best Practices

- assign users to the correct company before they start working
- keep task durations realistic before comparing scenarios
- import CSV arrivals only when you need real arrival schedules
- compare resource utilisation and bottlenecks together, not in isolation
- rerun scenarios after changing tasks, resources, or probabilities
