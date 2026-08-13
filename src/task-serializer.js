export class TaskSerializationError extends Error {}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requiredValue(task, key) {
  if (!hasOwn(task, key)) throw new TaskSerializationError(`Task is missing the required ${key} field.`);
  return task[key];
}

function integer(task, key, minimum = 0) {
  const value = requiredValue(task, key);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TaskSerializationError(`Task has an invalid ${key} field.`);
  }
  return value;
}

function finiteNumber(task, key, minimum = 0) {
  const value = requiredValue(task, key);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new TaskSerializationError(`Task has an invalid ${key} field.`);
  }
  return value;
}

function nullableDate(task, key) {
  const value = requiredValue(task, key);
  if (value === null || typeof value === 'string') return value;
  throw new TaskSerializationError(`Task has an invalid ${key} field.`);
}

function userReferences(task) {
  const assignees = requiredValue(task, 'assignees');
  if (!Array.isArray(assignees) || assignees.some((user) => !Number.isSafeInteger(user?.id) || user.id <= 0)) {
    throw new TaskSerializationError('Task has invalid assignees.');
  }
  return assignees.map((user) => ({ id: user.id }));
}

function reminders(task) {
  const value = requiredValue(task, 'reminders');
  if (!Array.isArray(value)) throw new TaskSerializationError('Task has invalid reminders.');
  return value.map((reminder) => {
    if (!reminder || typeof reminder.reminder !== 'string') {
      throw new TaskSerializationError('Task has an invalid reminder.');
    }
    return {
      reminder: reminder.reminder,
      relative_period: Number.isSafeInteger(reminder.relative_period) ? reminder.relative_period : 0,
      relative_to: typeof reminder.relative_to === 'string' ? reminder.relative_to : '',
    };
  });
}

/**
 * Vikunja v1 task updates are full task representations. Keep all writable
 * fields here so MCP tools cannot accidentally turn a partial edit into data
 * loss when the v1 API replaces absent fields with defaults.
 */
export function serializeVikunjaV1Task(current, changes = {}) {
  if (!current || typeof current !== 'object') throw new TaskSerializationError('Task could not be loaded.');
  const title = hasOwn(changes, 'title') ? changes.title : requiredValue(current, 'title');
  const description = hasOwn(changes, 'description') ? changes.description : requiredValue(current, 'description');
  const dueDate = hasOwn(changes, 'due_date') ? changes.due_date : nullableDate(current, 'due_date');
  const done = hasOwn(changes, 'done') ? changes.done : requiredValue(current, 'done');

  if (typeof title !== 'string' || typeof description !== 'string' || typeof done !== 'boolean') {
    throw new TaskSerializationError('Task update contains invalid fields.');
  }
  if (dueDate !== null && typeof dueDate !== 'string') throw new TaskSerializationError('Task update has an invalid due_date.');

  return {
    title,
    description,
    done,
    due_date: dueDate,
    reminders: reminders(current),
    project_id: integer(current, 'project_id', 1),
    repeat_after: integer(current, 'repeat_after'),
    repeat_mode: integer(current, 'repeat_mode'),
    priority: integer(current, 'priority'),
    start_date: nullableDate(current, 'start_date'),
    end_date: nullableDate(current, 'end_date'),
    assignees: userReferences(current),
    hex_color: requiredValue(current, 'hex_color'),
    percent_done: finiteNumber(current, 'percent_done'),
    bucket_id: integer(current, 'bucket_id'),
    cover_image_attachment_id: integer(current, 'cover_image_attachment_id'),
  };
}

export function isRecurringTask(task) {
  return Number(task.repeat_after) > 0 || Number(task.repeat_mode) !== 0;
}
