import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolHandlers, WriteDisabledError } from '../src/tools.js';

function fakeClient() {
  const writableTask = (task) => ({
    description: '', due_date: null, reminders: [], project_id: 7, repeat_after: 0, repeat_mode: 0,
    priority: 0, start_date: null, end_date: null, assignees: [], hex_color: '', percent_done: 0,
    bucket_id: 0, cover_image_attachment_id: 0, ...task,
  });
  const tasks = new Map([[10, writableTask({ id: 10, title: 'Existing task', done: false, priority: 2, description: 'context' })]]);
  const labels = [{ id: 1, title: 'source:repo' }, { id: 2, title: 'type:implementation' }];
  const projectUsers = [];
  return {
    async listProjects() { return [{ id: 7, title: 'Example project', is_archived: false }]; },
    async listProjectTasks() { return [...tasks.values()]; },
    async getTask(id) { return { ...tasks.get(id) }; },
    async listLabels() { return labels; },
    async listTaskLabels() { return [labels[0]]; },
    async createTask(_, input) { const task = writableTask({ id: 11, done: false, priority: input.priority || 0, description: input.description || '', due_date: input.due_date || null, title: input.title }); tasks.set(11, task); return task; },
    async createProject(input) { return { id: 12, title: input.title, description: input.description || '', is_archived: false }; },
    async addProjectUser(_, userId, permission) { projectUsers.push({ id: userId, permission }); },
    async listProjectUsers() { return projectUsers; },
    async updateTask(id, input) { tasks.set(id, { ...tasks.get(id), ...input }); },
    async addLabel() {},
    async removeLabel() {},
  };
}

function handlers(options = {}) {
  return createToolHandlers({
    client: fakeClient(),
    logger: { event() {} },
    requestIdentity: { email: 'owner@example.test' },
    writeEnabled: false,
    writeAllowedEmails: new Set(['owner@example.test']),
    projectOwnerUserId: 1,
    ...options,
  });
}

test('list_tasks resolves a project and returns open tasks without descriptions', async () => {
  const result = await handlers().listTasks({ project_name: 'example project', status: 'open', limit: 20 });
  assert.equal(result.project.title, 'Example project');
  assert.deepEqual(result.tasks.map((task) => task.id), [10]);
  assert.equal('description' in result.tasks[0], false);
});

test('write tools remain disabled unless explicitly enabled', async () => {
  await assert.rejects(
    handlers().createTask({ project_id: 7, title: 'must not be created' }),
    WriteDisabledError,
  );
  await assert.rejects(
    handlers().createProject({ title: 'must not be created' }),
    WriteDisabledError,
  );
});

test('create_project grants only the configured owner admin access', async () => {
  const result = await handlers({ writeEnabled: true }).createProject({ title: 'New MCP project' });
  assert.deepEqual(result, {
    project: { id: 12, title: 'New MCP project', is_archived: false },
    owner_access: 'admin',
  });
});

test('create_project verifies owner access after a lost sharing response without retrying the write', async () => {
  const client = fakeClient();
  const addProjectUser = client.addProjectUser.bind(client);
  let shareAttempts = 0;
  client.addProjectUser = async (...args) => {
    shareAttempts += 1;
    await addProjectUser(...args);
    throw new Error('sharing response lost');
  };
  const writer = createToolHandlers({
    client, logger: { event() {} }, requestIdentity: { email: 'owner@example.test' },
    writeEnabled: true, writeAllowedEmails: new Set(['owner@example.test']), projectOwnerUserId: 1,
  });
  const result = await writer.createProject({ title: 'Verified after timeout' });
  assert.equal(shareAttempts, 1);
  assert.equal(result.owner_access, 'admin');
});

test('create_project reports a partial completion if owner sharing cannot be verified', async () => {
  const client = fakeClient();
  client.listProjectUsers = async () => [];
  const writer = createToolHandlers({
    client, logger: { event() {} }, requestIdentity: { email: 'owner@example.test' },
    writeEnabled: true, writeAllowedEmails: new Set(['owner@example.test']), projectOwnerUserId: 1,
  });
  await assert.rejects(writer.createProject({ title: 'Recover access' }), /owner access could not be verified/);
});

test('create_task only accepts existing labels and verifies the result', async () => {
  const result = await handlers({ writeEnabled: true }).createTask({
    project_id: 7,
    title: 'Add MCP acceptance tests',
    labels: ['source:repo'],
  });
  assert.equal(result.task.id, 11);
  assert.equal(result.task.title, 'Add MCP acceptance tests');
});

test('label title collisions require IDs and failed label assignment reports partial success', async () => {
  const client = fakeClient();
  client.listLabels = async () => [{ id: 1, title: 'duplicate' }, { id: 2, title: 'duplicate' }];
  const writer = createToolHandlers({
    client, logger: { event() {} }, requestIdentity: { email: 'owner@example.test' },
    writeEnabled: true, writeAllowedEmails: new Set(['owner@example.test']),
  });
  await assert.rejects(writer.createTask({ project_id: 7, title: 'No ambiguous labels', labels: ['duplicate'] }), /ambiguous/);

  client.listLabels = async () => [{ id: 1, title: 'one' }, { id: 2, title: 'two' }];
  client.addLabel = async (_, id) => { if (id === 2) throw new Error('denied'); };
  const result = await writer.createTask({ project_id: 7, title: 'Report assignment status', label_ids: [1, 2] });
  assert.equal(result.labels.partial_success, true);
  assert.deepEqual(result.labels.assigned.map((label) => label.id), [1]);
  assert.deepEqual(result.labels.failed.map((label) => label.id), [2]);
});

test('update_task sends a complete Vikunja v1 representation and permits clearing due_date', async () => {
  const client = fakeClient();
  client.getTask = async (id) => ({ ...await fakeClient().getTask(id), percent_done: 0.5, reminders: [{ reminder: '2026-08-20T12:00:00Z', relative_period: -3600, relative_to: 'due_date' }] });
  const update = [];
  client.updateTask = async (_, task) => { update.push(task); };
  await createToolHandlers({
    client, logger: { event() {} }, requestIdentity: { email: 'owner@example.test' },
    writeEnabled: true, writeAllowedEmails: new Set(['owner@example.test']),
  }).updateTask({ task_id: 10, due_date: null });
  assert.equal(update.length, 1);
  assert.equal(update[0].due_date, null);
  assert.equal(update[0].repeat_after, 0);
  assert.equal(update[0].percent_done, 0.5);
  assert.deepEqual(update[0].reminders, [{ reminder: '2026-08-20T12:00:00Z', relative_period: -3600, relative_to: 'due_date' }]);
  assert.deepEqual(update[0].assignees, []);
  assert.equal(update[0].project_id, 7);
});

test('complete_task refuses recurring tasks before issuing a write', async () => {
  const client = fakeClient();
  client.getTask = async () => ({ ...await fakeClient().getTask(10), repeat_after: 86400 });
  let writes = 0;
  client.updateTask = async () => { writes += 1; };
  const writer = createToolHandlers({
    client, logger: { event() {} }, requestIdentity: { email: 'owner@example.test' },
    writeEnabled: true, writeAllowedEmails: new Set(['owner@example.test']),
  });
  await assert.rejects(writer.completeTask({ task_id: 10 }), /recurring tasks/);
  assert.equal(writes, 0);
});
