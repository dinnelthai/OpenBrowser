import crypto from 'node:crypto';

export type LocalAgentTaskStatus = 'pending' | 'claimed' | 'completed' | 'failed';

export interface LocalAgentTask {
  id: string;
  title?: string;
  content: string;
  sourceUrl?: string;
  status: LocalAgentTaskStatus;
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  result?: string;
}

const tasks = new Map<string, LocalAgentTask>();
const MAX_TASKS = 100;

export function createLocalAgentTask(input: {
  title?: string;
  content: string;
  sourceUrl?: string;
}): LocalAgentTask {
  const task: LocalAgentTask = {
    id: crypto.randomUUID(),
    ...input,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  tasks.set(task.id, task);
  while (tasks.size > MAX_TASKS) {
    const oldest = tasks.keys().next().value;
    if (!oldest) break;
    tasks.delete(oldest);
  }
  return task;
}

export function listLocalAgentTasks(): LocalAgentTask[] {
  return [...tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function claimLocalAgentTask(id: string): LocalAgentTask | null {
  const task = tasks.get(id);
  if (!task || task.status !== 'pending') return null;
  task.status = 'claimed';
  task.claimedAt = new Date().toISOString();
  return task;
}

export function finishLocalAgentTask(
  id: string,
  status: 'completed' | 'failed',
  result: string,
): LocalAgentTask | null {
  const task = tasks.get(id);
  if (!task || task.status === 'completed' || task.status === 'failed') return null;
  task.status = status;
  task.result = result;
  task.completedAt = new Date().toISOString();
  return task;
}
