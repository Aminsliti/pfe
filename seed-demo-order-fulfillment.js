const API = 'http://localhost:3001/api';

const PROCESS_NAME = 'Demo - E-commerce Order Fulfillment';
const SCENARIO_NAME = 'Demo - Standard Day (250 Orders)';

const bpmXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_OrderFulfillment" targetNamespace="http://example.com/order-fulfillment">
  <bpmn:process id="Process_OrderFulfillment" name="${PROCESS_NAME}" isExecutable="false">
    <bpmn:startEvent id="StartEvent_OrderReceived" name="Order Received">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_ReviewOrder" name="Review Order">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:serviceTask id="Task_ReserveInventory" name="Reserve Inventory">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:manualTask id="Task_PickItems" name="Pick Items">
      <bpmn:incoming>Flow_3</bpmn:incoming>
      <bpmn:outgoing>Flow_4</bpmn:outgoing>
    </bpmn:manualTask>
    <bpmn:manualTask id="Task_PackOrder" name="Pack Order">
      <bpmn:incoming>Flow_4</bpmn:incoming>
      <bpmn:outgoing>Flow_5</bpmn:outgoing>
    </bpmn:manualTask>
    <bpmn:serviceTask id="Task_GenerateInvoice" name="Generate Invoice">
      <bpmn:incoming>Flow_5</bpmn:incoming>
      <bpmn:outgoing>Flow_6</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:userTask id="Task_BookCarrier" name="Book Carrier Pickup">
      <bpmn:incoming>Flow_6</bpmn:incoming>
      <bpmn:outgoing>Flow_7</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="EndEvent_OrderReady" name="Order Ready to Ship">
      <bpmn:incoming>Flow_7</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_OrderReceived" targetRef="Task_ReviewOrder" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_ReviewOrder" targetRef="Task_ReserveInventory" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_ReserveInventory" targetRef="Task_PickItems" />
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_PickItems" targetRef="Task_PackOrder" />
    <bpmn:sequenceFlow id="Flow_5" sourceRef="Task_PackOrder" targetRef="Task_GenerateInvoice" />
    <bpmn:sequenceFlow id="Flow_6" sourceRef="Task_GenerateInvoice" targetRef="Task_BookCarrier" />
    <bpmn:sequenceFlow id="Flow_7" sourceRef="Task_BookCarrier" targetRef="EndEvent_OrderReady" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_OrderFulfillment">
    <bpmndi:BPMNPlane id="BPMNPlane_OrderFulfillment" bpmnElement="Process_OrderFulfillment">
      <bpmndi:BPMNShape id="StartEvent_OrderReceived_di" bpmnElement="StartEvent_OrderReceived">
        <dc:Bounds x="120" y="142" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ReviewOrder_di" bpmnElement="Task_ReviewOrder">
        <dc:Bounds x="210" y="120" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ReserveInventory_di" bpmnElement="Task_ReserveInventory">
        <dc:Bounds x="380" y="120" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_PickItems_di" bpmnElement="Task_PickItems">
        <dc:Bounds x="550" y="120" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_PackOrder_di" bpmnElement="Task_PackOrder">
        <dc:Bounds x="720" y="120" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_GenerateInvoice_di" bpmnElement="Task_GenerateInvoice">
        <dc:Bounds x="890" y="120" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_BookCarrier_di" bpmnElement="Task_BookCarrier">
        <dc:Bounds x="1060" y="120" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_OrderReady_di" bpmnElement="EndEvent_OrderReady">
        <dc:Bounds x="1240" y="142" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="156" y="160" />
        <di:waypoint x="210" y="160" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="330" y="160" />
        <di:waypoint x="380" y="160" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3">
        <di:waypoint x="500" y="160" />
        <di:waypoint x="550" y="160" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_4_di" bpmnElement="Flow_4">
        <di:waypoint x="670" y="160" />
        <di:waypoint x="720" y="160" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_5_di" bpmnElement="Flow_5">
        <di:waypoint x="840" y="160" />
        <di:waypoint x="890" y="160" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_6_di" bpmnElement="Flow_6">
        <di:waypoint x="1010" y="160" />
        <di:waypoint x="1060" y="160" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_7_di" bpmnElement="Flow_7">
        <di:waypoint x="1180" y="160" />
        <di:waypoint x="1240" y="160" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const resources = [
  { key: 'salesOps', name: 'Sales Operations Coordinator', resource_type: 'human', quantity: 3, cost_per_hour: 36, availability: 92 },
  { key: 'erp', name: 'ERP / WMS System', resource_type: 'system', quantity: 1, cost_per_hour: 8, availability: 99 },
  { key: 'picker', name: 'Warehouse Picker', resource_type: 'human', quantity: 6, cost_per_hour: 22, availability: 94 },
  { key: 'packing', name: 'Packing Station', resource_type: 'machine', quantity: 4, cost_per_hour: 20, availability: 96 },
  { key: 'billing', name: 'Billing Service', resource_type: 'system', quantity: 1, cost_per_hour: 10, availability: 99 },
  { key: 'logistics', name: 'Logistics Coordinator', resource_type: 'human', quantity: 2, cost_per_hour: 30, availability: 90 },
];

const tasks = [
  { task_id: 'Task_ReviewOrder', task_name: 'Review Order', duration_min: 8, duration_type: 'normal', duration_std: 2, resource: 'salesOps', cost: 36 },
  { task_id: 'Task_ReserveInventory', task_name: 'Reserve Inventory', duration_min: 2, duration_type: 'fixed', duration_std: 0, resource: 'erp', cost: 8 },
  { task_id: 'Task_PickItems', task_name: 'Pick Items', duration_min: 15, duration_type: 'normal', duration_std: 4, resource: 'picker', cost: 22 },
  { task_id: 'Task_PackOrder', task_name: 'Pack Order', duration_min: 9, duration_type: 'normal', duration_std: 2, resource: 'packing', cost: 20 },
  { task_id: 'Task_GenerateInvoice', task_name: 'Generate Invoice', duration_min: 3, duration_type: 'fixed', duration_std: 0, resource: 'billing', cost: 10 },
  { task_id: 'Task_BookCarrier', task_name: 'Book Carrier Pickup', duration_min: 6, duration_type: 'uniform', duration_std: 0, resource: 'logistics', cost: 30 },
];

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${response.status} ${data?.error || response.statusText}`);
  }

  return data;
}

const findByName = (items, name) => items.filter(item => item.name === name);

async function main() {
  const [existingProcesses, existingScenarios] = await Promise.all([
    request('/processes'),
    request('/simulations'),
  ]);

  for (const scenario of findByName(existingScenarios, SCENARIO_NAME)) {
    await request(`/simulations/${scenario.id}`, { method: 'DELETE' });
  }

  for (const process of findByName(existingProcesses, PROCESS_NAME)) {
    await request(`/processes/${process.id}`, { method: 'DELETE' });
  }

  const process = await request('/processes', {
    method: 'POST',
    body: {
      name: PROCESS_NAME,
      description: 'End-to-end fulfillment of a standard e-commerce order, from order review through shipment handoff.',
      bpmn_xml: bpmXml,
      category_id: 4,
      status: 'active',
    },
  });

  const scenario = await request('/simulations', {
    method: 'POST',
    body: {
      name: SCENARIO_NAME,
      description: 'Baseline weekday volume with realistic manual and system task durations.',
      process_id: process.id,
      status: 'draft',
      process_instances: 250,
      warmup_percent: 5,
      cooldown_percent: 10,
      infinite_resources: false,
      simulate_all_levels: false,
      import_csv_arrivals: false,
    },
  });

  const resourceIds = {};
  for (const resource of resources) {
    const created = await request(`/simulations/${scenario.id}/resources`, {
      method: 'POST',
      body: resource,
    });
    resourceIds[resource.key] = created.id;
  }

  for (const task of tasks) {
    await request(`/simulations/${scenario.id}/tasks/${task.task_id}`, {
      method: 'PUT',
      body: {
        task_name: task.task_name,
        duration_min: task.duration_min,
        duration_type: task.duration_type,
        duration_std: task.duration_std,
        resource_id: resourceIds[task.resource],
        cost: task.cost,
      },
    });
  }

  const run = await request(`/simulations/${scenario.id}/run`, {
    method: 'POST',
  });

  console.log(JSON.stringify({
    process: {
      id: process.id,
      name: process.name,
    },
    scenario: {
      id: scenario.id,
      name: scenario.name,
    },
    results: {
      avg_duration_min: run.results?.avg_duration_min,
      total_cost: run.results?.total_cost,
      instances: run.results?.instances,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});
