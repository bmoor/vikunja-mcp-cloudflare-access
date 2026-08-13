import { TaskSerializationError, isRecurringTask, serializeVikunjaV1Task } from './task-serializer.js';
import { VikunjaApiError } from './vikunja-client.js';

export class ToolInputError extends Error {}
export class WriteDisabledError extends Error {}
export class ProjectOwnerShareError extends Error {
  constructor(projectId) {
    super(`Project ${projectId} was created, but owner access could not be verified.`);
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function listResult(value) {
  return Array.isArray(value) ? { items: value, truncated: false } : value;
}

function taskSummary(task, labels = []) {
  return {
    id: task.id,
    title: task.title,
    done: Boolean(task.done),
    priority: task.priority,
    due_date: task.due_date || null,
    labels: labels.map((label) => ({ id: label.id, title: label.title })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

function projectSummary(project) {
  return { id: project.id, title: project.title, is_archived: Boolean(project.is_archived) };
}

function labelSummary(label) {
  return { id: label.id, title: label.title, hex_color: label.hex_color || '' };
}

function exactProject(projects, { project_id, project_name }) {
  if (Boolean(project_id) === Boolean(project_name)) throw new ToolInputError('Provide exactly one of project_id or project_name.');
  const matches = project_id
    ? projects.filter((project) => project.id === project_id)
    : projects.filter((project) => project.title.toLocaleLowerCase() === project_name.trim().toLocaleLowerCase());
  if (matches.length !== 1) throw new ToolInputError(project_id ? 'Project was not found.' : 'Project title is ambiguous or was not found.');
  return matches[0];
}

function noDuplicates(values = [], label = 'Labels') {
  const normalised = values.map((value) => value.trim().toLocaleLowerCase());
  if (new Set(normalised).size !== normalised.length) throw new ToolInputError(`${label} must not contain duplicates.`);
}

function exactLabels(labels, { titles = [], ids = [] }) {
  noDuplicates(titles);
  if (new Set(ids).size !== ids.length) throw new ToolInputError('Label IDs must not contain duplicates.');
  const byTitle = new Map();
  for (const label of labels) {
    const key = label.title.toLocaleLowerCase();
    byTitle.set(key, [...(byTitle.get(key) || []), label]);
  }
  const byId = new Map(labels.map((label) => [label.id, label]));
  const selected = [];
  for (const title of titles) {
    const matches = byTitle.get(title.trim().toLocaleLowerCase()) || [];
    if (matches.length === 0) throw new ToolInputError(`Label is not available: ${title}`);
    if (matches.length !== 1) throw new ToolInputError(`Label title is ambiguous: ${title}. Use label_ids instead.`);
    selected.push(matches[0]);
  }
  for (const id of ids) {
    const label = byId.get(id);
    if (!label) throw new ToolInputError(`Label is not available: ${id}`);
    selected.push(label);
  }
  if (new Set(selected.map((label) => label.id)).size !== selected.length) {
    throw new ToolInputError('A label may be selected only once.');
  }
  return selected;
}

function ensureWriter({ requestIdentity, writeEnabled, writeAllowedEmails }) {
  if (!writeEnabled) throw new WriteDisabledError('Write operations are disabled by MCP_WRITE_ENABLED.');
  if (!writeAllowedEmails.has(requestIdentity.email)) throw new WriteDisabledError('The authenticated user is not allowed to perform write operations.');
}

async function taskLabels(client, task) {
  if (Array.isArray(task.labels)) return { items: task.labels, truncated: false };
  return listResult(await client.listTaskLabels(task.id));
}

async function applyLabels(client, taskId, labels, operation) {
  const assigned = [];
  const failed = [];
  for (const label of labels) {
    try {
      await operation(label);
      assigned.push(labelSummary(label));
    } catch (error) {
      failed.push(labelSummary(label));
    }
  }
  return { assigned, failed, partial_success: failed.length > 0 };
}

export function createToolHandlers({ client, logger, requestIdentity, writeEnabled, writeAllowedEmails, projectOwnerUserId }) {
  async function listProjects() {
    const result = listResult(await client.listProjects());
    return {
      projects: result.items.map(projectSummary).sort((a, b) => a.title.localeCompare(b.title)),
      truncated: Boolean(result.truncated),
    };
  }

  async function listLabels() {
    const result = listResult(await client.listLabels());
    return {
      labels: result.items.map(labelSummary).sort((a, b) => a.title.localeCompare(b.title)),
      truncated: Boolean(result.truncated),
    };
  }

  async function listTasks(input) {
    const projects = listResult(await client.listProjects());
    const project = exactProject(projects.items, input);
    const tasks = listResult(await client.listProjectTasks(project.id));
    noDuplicates(input.labels || []);
    const requestedLabels = new Set((input.labels || []).map((label) => label.trim().toLocaleLowerCase()));
    const rows = [];
    let labelTruncated = false;
    for (const task of tasks.items) {
      if (input.status === 'open' && task.done) continue;
      if (input.status === 'done' && !task.done) continue;
      const labels = await taskLabels(client, task);
      labelTruncated ||= Boolean(labels.truncated);
      const titles = new Set(labels.items.map((label) => label.title.toLocaleLowerCase()));
      if ([...requestedLabels].some((label) => !titles.has(label))) continue;
      rows.push(taskSummary(task, labels.items));
      if (rows.length >= input.limit) break;
    }
    return {
      project: projectSummary(project),
      tasks: rows,
      truncated: Boolean(tasks.truncated || labelTruncated || rows.length >= input.limit),
    };
  }

  async function getTask({ task_id }) {
    const task = await client.getTask(task_id);
    const labels = await taskLabels(client, task);
    return {
      task: { ...taskSummary(task, labels.items), description: task.description || '', reminders: Array.isArray(task.reminders) ? task.reminders : [] },
      labels_truncated: Boolean(labels.truncated),
    };
  }

  async function createTask(input) {
    ensureWriter({ requestIdentity, writeEnabled, writeAllowedEmails });
    const projects = listResult(await client.listProjects());
    const project = exactProject(projects.items, input);
    const labels = exactLabels((listResult(await client.listLabels())).items, { titles: input.labels || [], ids: input.label_ids || [] });
    const task = await client.createTask(project.id, {
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.due_date === undefined ? {} : { due_date: input.due_date }),
    });
    const labelResult = await applyLabels(client, task.id, labels, (label) => client.addLabel(task.id, label.id));
    const verified = await client.getTask(task.id);
    const verifiedLabels = await taskLabels(client, verified);
    logger.event('tool_completed', { tool: 'create_task', task_id: verified.id, project_id: project.id, partial_success: labelResult.partial_success });
    return {
      project: projectSummary(project),
      task: taskSummary(verified, verifiedLabels.items),
      labels: labelResult,
      labels_truncated: Boolean(verifiedLabels.truncated),
    };
  }

  async function createProject({ title, description }) {
    ensureWriter({ requestIdentity, writeEnabled, writeAllowedEmails });
    const project = await client.createProject({ title, ...(description === undefined ? {} : { description }) });
    try {
      try {
        await client.addProjectUser(project.id, projectOwnerUserId, 2);
      } catch {
        // The write may have reached Vikunja even when its response was lost.
        // Do not retry it; verify the resulting project state below instead.
      }
      const users = listResult(await client.listProjectUsers(project.id));
      const owner = users.items.find((user) => user.id === projectOwnerUserId);
      if (!owner || owner.permission !== 2) throw new Error('owner access not verified');
    } catch {
      logger.event('tool_partial_failure', { tool: 'create_project', project_id: project.id, stage: 'owner_share' });
      throw new ProjectOwnerShareError(project.id);
    }
    logger.event('tool_completed', { tool: 'create_project', project_id: project.id });
    return { project: projectSummary(project), owner_access: 'admin' };
  }

  async function updateTask(input) {
    ensureWriter({ requestIdentity, writeEnabled, writeAllowedEmails });
    if (input.title === undefined && input.description === undefined && input.priority === undefined
      && input.due_date === undefined && !input.labels_add?.length && !input.labels_remove?.length
      && !input.label_ids_add?.length && !input.label_ids_remove?.length) {
      throw new ToolInputError('At least one task field or label change is required.');
    }
    noDuplicates(input.labels_add || []);
    noDuplicates(input.labels_remove || []);
    const overlap = new Set((input.labels_add || []).map((label) => label.trim().toLocaleLowerCase()));
    if ((input.labels_remove || []).some((label) => overlap.has(label.trim().toLocaleLowerCase()))) {
      throw new ToolInputError('A label cannot be added and removed in the same update.');
    }

    const current = await client.getTask(input.task_id);
    if (input.title !== undefined || input.description !== undefined || input.priority !== undefined || hasOwn(input, 'due_date')) {
      await client.updateTask(input.task_id, serializeVikunjaV1Task(current, {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(hasOwn(input, 'due_date') ? { due_date: input.due_date } : {}),
      }));
    }

    if (input.labels_add?.length || input.labels_remove?.length || input.label_ids_add?.length || input.label_ids_remove?.length) {
      const labels = (listResult(await client.listLabels())).items;
      const labelsToAdd = exactLabels(labels, { titles: input.labels_add || [], ids: input.label_ids_add || [] });
      const labelsToRemove = exactLabels(labels, { titles: input.labels_remove || [], ids: input.label_ids_remove || [] });
      const currentLabels = listResult(await client.listTaskLabels(input.task_id));
      const currentIds = new Set(currentLabels.items.map((label) => label.id));
      await applyLabels(client, input.task_id, labelsToAdd.filter((label) => !currentIds.has(label.id)), (label) => client.addLabel(input.task_id, label.id));
      await applyLabels(client, input.task_id, labelsToRemove.filter((label) => currentIds.has(label.id)), (label) => client.removeLabel(input.task_id, label.id));
    }

    const verified = await client.getTask(input.task_id);
    const verifiedLabels = await taskLabels(client, verified);
    logger.event('tool_completed', { tool: 'update_task', task_id: verified.id });
    return { task: taskSummary(verified, verifiedLabels.items), labels_truncated: Boolean(verifiedLabels.truncated) };
  }

  async function completeTask({ task_id }) {
    ensureWriter({ requestIdentity, writeEnabled, writeAllowedEmails });
    const current = await client.getTask(task_id);
    if (isRecurringTask(current)) throw new ToolInputError('Completing recurring tasks is not supported until recurrence behavior is verified end-to-end.');
    if (!current.done) await client.updateTask(task_id, serializeVikunjaV1Task(current, { done: true }));
    const verified = await client.getTask(task_id);
    if (!verified.done) throw new ToolInputError('Task completion could not be verified.');
    const labels = await taskLabels(client, verified);
    logger.event('tool_completed', { tool: 'complete_task', task_id: verified.id, changed: !current.done });
    return { task: taskSummary(verified, labels.items), changed: !current.done, labels_truncated: Boolean(labels.truncated) };
  }

  return { listProjects, listLabels, listTasks, getTask, createProject, createTask, updateTask, completeTask };
}

export function toSafeToolError(error) {
  if (error instanceof ToolInputError || error instanceof WriteDisabledError || error instanceof ProjectOwnerShareError || error instanceof TaskSerializationError) return error.message;
  if (error instanceof VikunjaApiError) return `Vikunja request failed (HTTP ${error.status}).`;
  return 'The requested operation could not be completed.';
}
