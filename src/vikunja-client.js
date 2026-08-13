export class VikunjaApiError extends Error {
  constructor(status, operation) {
    super(`Vikunja ${operation} failed with HTTP ${status}`);
    this.status = status;
    this.operation = operation;
  }
}

export class VikunjaScopeError extends Error {
  constructor() {
    super('The requested project or task is outside the configured MCP scope.');
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function positiveHeader(headers, name) {
  const value = headers.get(name);
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

export class VikunjaClient {
  constructor({
    baseUrl,
    apiToken,
    allowedProjectIds,
    requestTimeoutMs = 10000,
    pageSize = 50,
    maxPages = 20,
    maxResults = 1000,
    fetchImpl = fetch,
  }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiToken = apiToken;
    this.allowedProjectIds = allowedProjectIds === null ? null : new Set(allowedProjectIds || []);
    this.requestTimeoutMs = requestTimeoutMs;
    this.pageSize = pageSize;
    this.maxPages = maxPages;
    this.maxResults = maxResults;
    this.fetchImpl = fetchImpl;
  }

  assertAllowedProject(projectId) {
    if (this.allowedProjectIds && !this.allowedProjectIds.has(projectId)) throw new VikunjaScopeError();
  }

  assertTaskInAllowedProject(task) {
    if (!task || !Number.isInteger(task.project_id)) throw new VikunjaScopeError();
    this.assertAllowedProject(task.project_id);
    return task;
  }

  async request(operation, method, path, body) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new VikunjaApiError(504, operation);
      }
      throw new VikunjaApiError(503, operation);
    }

    if (!response.ok) throw new VikunjaApiError(response.status, operation);
    return {
      data: response.status === 204 ? undefined : await response.json(),
      headers: response.headers,
    };
  }

  async listPaginated(operation, path) {
    const items = [];
    let truncated = false;
    for (let page = 1; page <= this.maxPages; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const { data, headers } = await this.request(operation, 'GET', `${path}${separator}page=${page}&per_page=${this.pageSize}`);
      const pageItems = asArray(data);
      const remaining = this.maxResults - items.length;
      if (pageItems.length > remaining) {
        items.push(...pageItems.slice(0, remaining));
        truncated = true;
        break;
      }
      items.push(...pageItems);

      const totalPages = positiveHeader(headers, 'x-pagination-total-pages');
      if ((totalPages && page >= totalPages) || pageItems.length < this.pageSize) break;
      if (page === this.maxPages) truncated = true;
    }
    return { items, truncated };
  }

  async getInfo() {
    return (await this.request('get_info', 'GET', '/info')).data;
  }

  async listProjects() {
    const result = await this.listPaginated('list_projects', '/projects');
    return {
      ...result,
      items: this.allowedProjectIds ? result.items.filter((project) => this.allowedProjectIds.has(project.id)) : result.items,
    };
  }

  async listProjectTasks(projectId) {
    this.assertAllowedProject(projectId);
    return this.listPaginated('list_tasks', `/projects/${projectId}/tasks`);
  }

  async getTask(taskId) {
    return this.assertTaskInAllowedProject((await this.request('get_task', 'GET', `/tasks/${taskId}`)).data);
  }

  async listLabels() {
    return this.listPaginated('list_labels', '/labels');
  }

  async listTaskLabels(taskId) {
    await this.getTask(taskId);
    return this.listPaginated('list_task_labels', `/tasks/${taskId}/labels`);
  }

  async createTask(projectId, task) {
    this.assertAllowedProject(projectId);
    return (await this.request('create_task', 'PUT', `/projects/${projectId}/tasks`, task)).data;
  }

  async createProject(project) {
    return (await this.request('create_project', 'PUT', '/projects', project)).data;
  }

  async addProjectUser(projectId, userId, permission) {
    return (await this.request('add_project_user', 'PUT', `/projects/${projectId}/users`, { id: userId, permission })).data;
  }

  async listProjectUsers(projectId) {
    return this.listPaginated('list_project_users', `/projects/${projectId}/users`);
  }

  async updateTask(taskId, task) {
    await this.getTask(taskId);
    return (await this.request('update_task', 'POST', `/tasks/${taskId}`, task)).data;
  }

  async addLabel(taskId, labelId) {
    await this.getTask(taskId);
    return (await this.request('add_label', 'PUT', `/tasks/${taskId}/labels`, { label_id: labelId })).data;
  }

  async removeLabel(taskId, labelId) {
    await this.getTask(taskId);
    return (await this.request('remove_label', 'DELETE', `/tasks/${taskId}/labels/${labelId}`)).data;
  }
}
