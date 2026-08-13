import assert from 'node:assert/strict';
import test from 'node:test';
import { VikunjaApiError, VikunjaClient, VikunjaScopeError } from '../src/vikunja-client.js';

test('client encapsulates the v1 API and sends its token only as a bearer header', async () => {
  let request;
  const client = new VikunjaClient({
    baseUrl: 'http://vikunja:3456',
    apiToken: 'test-only-token',
    allowedProjectIds: [7],
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify([{ id: 7, title: 'Example project' }]), { status: 200 });
    },
  });
  const projects = await client.listProjects();
  assert.equal(request.url, 'http://vikunja:3456/api/v1/projects?page=1&per_page=50');
  assert.equal(request.init.headers.Authorization, 'Bearer test-only-token');
  assert.equal(projects.items[0].title, 'Example project');
});

test('client filters default projects outside the configured MCP scope', async () => {
  const client = new VikunjaClient({
    baseUrl: 'http://vikunja:3456',
    apiToken: 'test-only-token',
    allowedProjectIds: [7],
    fetchImpl: async () => new Response(JSON.stringify([
      { id: 1, title: 'Service inbox' },
      { id: 7, title: 'Example project' },
    ]), { status: 200 }),
  });
  assert.deepEqual(await client.listProjects(), { items: [{ id: 7, title: 'Example project' }], truncated: false });
});

test('client permits all projects only when configured with the all scope', async () => {
  const client = new VikunjaClient({
    baseUrl: 'http://vikunja:3456', apiToken: 'test-only-token', allowedProjectIds: null,
    fetchImpl: async () => new Response(JSON.stringify([{ id: 1, title: 'Service inbox' }, { id: 7, title: 'Example project' }]), { status: 200 }),
  });
  assert.deepEqual(await client.listProjects(), { items: [{ id: 1, title: 'Service inbox' }, { id: 7, title: 'Example project' }], truncated: false });
});

test('client creates a project and grants owner access through the v1 boundary', async () => {
  const requests = [];
  const client = new VikunjaClient({
    baseUrl: 'http://vikunja:3456', apiToken: 'test-only-token', allowedProjectIds: null,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ id: 12, title: 'New project' }), { status: 200 });
    },
  });
  await client.createProject({ title: 'New project' });
  await client.addProjectUser(12, 1, 2);
  assert.equal(requests[0].url, 'http://vikunja:3456/api/v1/projects');
  assert.equal(requests[0].init.method, 'PUT');
  assert.equal(requests[1].url, 'http://vikunja:3456/api/v1/projects/12/users');
  assert.deepEqual(JSON.parse(requests[1].init.body), { id: 1, permission: 2 });
});

test('client follows pagination headers and reports a configured result limit', async () => {
  const urls = [];
  const client = new VikunjaClient({
    baseUrl: 'http://vikunja:3456', apiToken: 'test-only-token', allowedProjectIds: [7],
    pageSize: 2, maxPages: 4, maxResults: 3,
    fetchImpl: async (url) => {
      urls.push(url);
      const page = new URL(url).searchParams.get('page');
      const payload = page === '1'
        ? [{ id: 7, title: 'First' }, { id: 7, title: 'Second' }]
        : [{ id: 7, title: 'Third' }, { id: 7, title: 'Fourth' }];
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'x-pagination-total-pages': '2' } });
    },
  });
  assert.deepEqual(await client.listProjects(), {
    items: [{ id: 7, title: 'First' }, { id: 7, title: 'Second' }, { id: 7, title: 'Third' }],
    truncated: true,
  });
  assert.equal(urls.length, 2);
});

test('client does not retry failed writes', async () => {
  let calls = 0;
  const client = new VikunjaClient({
    baseUrl: 'http://vikunja:3456', apiToken: 'test-only-token', allowedProjectIds: [7],
    fetchImpl: async () => { calls += 1; throw new Error('network unavailable'); },
  });
  await assert.rejects(client.createTask(7, { title: 'not created' }), VikunjaApiError);
  assert.equal(calls, 1);
});

test('client prevents task calls outside the configured MCP project scope', async () => {
  const client = new VikunjaClient({
    baseUrl: 'http://vikunja:3456',
    apiToken: 'test-only-token',
    allowedProjectIds: [7],
    fetchImpl: async () => new Response(JSON.stringify({ id: 3, project_id: 1 }), { status: 200 }),
  });
  await assert.rejects(client.getTask(3), VikunjaScopeError);
  await assert.rejects(client.listProjectTasks(1), VikunjaScopeError);
});

test('client errors expose only operation and status, never response bodies', async () => {
  const client = new VikunjaClient({
    baseUrl: 'http://vikunja:3456',
    apiToken: 'test-only-token',
    allowedProjectIds: [7],
    fetchImpl: async () => new Response('sensitive response body', { status: 403 }),
  });
  await assert.rejects(client.listProjects(), (error) => {
    assert.ok(error instanceof VikunjaApiError);
    assert.equal(error.status, 403);
    assert.equal(error.message.includes('sensitive response body'), false);
    return true;
  });
});
