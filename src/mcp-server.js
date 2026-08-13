import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandlers, toSafeToolError } from './tools.js';

const projectSelector = {
  project_id: z.number().int().positive().optional(),
  project_name: z.string().trim().min(1).max(160).optional(),
};

function toolResult(value) {
  return {
    structuredContent: value,
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
}

function guarded(handler) {
  return async (input) => {
    try {
      return toolResult(await handler(input));
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: toSafeToolError(error) }] };
    }
  };
}

export function createMcpServer(dependencies) {
  const server = new McpServer({ name: 'vikunja-mcp', version: '0.1.0' });
  const tools = createToolHandlers(dependencies);
  const writesVisible = dependencies.writeEnabled
    && dependencies.writeAllowedEmails.has(dependencies.requestIdentity.email);
  dependencies.logger.event('tool_catalogue', { write_tools_visible: writesVisible });

  server.registerTool('list_projects', {
    title: 'List Vikunja projects',
    description: 'List projects the ChatGPT Vikunja integration may access.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, guarded(tools.listProjects));

  server.registerTool('list_tasks', {
    title: 'List Vikunja tasks',
    description: 'List tasks in one project. Defaults to open tasks and omits descriptions.',
    inputSchema: {
      ...projectSelector,
      status: z.enum(['open', 'done', 'all']).default('open'),
      labels: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, guarded(tools.listTasks));

  server.registerTool('get_task', {
    title: 'Get Vikunja task',
    description: 'Get one task, including its description and assigned labels.',
    inputSchema: { task_id: z.number().int().positive() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, guarded(tools.getTask));

  server.registerTool('list_labels', {
    title: 'List available Vikunja labels',
    description: 'List existing labels available to this integration. Use label IDs to avoid title ambiguity.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, guarded(tools.listLabels));

  if (writesVisible) server.registerTool('create_task', {
    title: 'Create Vikunja task',
    description: 'Create one task in one project and optionally assign existing labels. Never creates labels.',
    inputSchema: {
      ...projectSelector,
      title: z.string().trim().min(1).max(500),
      description: z.string().max(20000).optional(),
      priority: z.number().int().min(0).max(5).optional(),
      due_date: z.string().datetime({ offset: true }).optional(),
      labels: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
      label_ids: z.array(z.number().int().positive()).max(12).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, guarded(tools.createTask));

  if (writesVisible) server.registerTool('create_project', {
    title: 'Create Vikunja project',
    description: 'Create one project and automatically grant the configured owner Admin access. Does not share with any other user.',
    inputSchema: {
      title: z.string().trim().min(1).max(250),
      description: z.string().max(20000).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, guarded(tools.createProject));

  if (writesVisible) server.registerTool('update_task', {
    title: 'Update Vikunja task',
    description: 'Update one task and optionally add or remove existing label assignments. Does not delete tasks or labels.',
    inputSchema: {
      task_id: z.number().int().positive(),
      title: z.string().trim().min(1).max(500).optional(),
      description: z.string().max(20000).optional(),
      priority: z.number().int().min(0).max(5).optional(),
      due_date: z.string().datetime({ offset: true }).nullable().optional(),
      labels_add: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
      labels_remove: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
      label_ids_add: z.array(z.number().int().positive()).max(12).optional(),
      label_ids_remove: z.array(z.number().int().positive()).max(12).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, guarded(tools.updateTask));

  if (writesVisible) server.registerTool('complete_task', {
    title: 'Complete Vikunja task',
    description: 'Mark one non-recurring task as complete. This is idempotent and verifies the resulting state.',
    inputSchema: { task_id: z.number().int().positive() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, guarded(tools.completeTask));

  return server;
}
