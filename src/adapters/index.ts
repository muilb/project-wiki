import type { SourceConfig } from '../config.js';
import { commandAdapter } from './command.js';
import { filesAdapter } from './files.js';
import { gitAdapter } from './git.js';
import { jiraAdapter } from './jira.js';
import { teamsAdapter } from './teams.js';
import type { Adapter } from './types.js';

export const adapters: { [K in SourceConfig['type']]: Adapter<Extract<SourceConfig, { type: K }>> } = {
  teams: teamsAdapter,
  git: gitAdapter,
  jira: jiraAdapter,
  files: filesAdapter,
  command: commandAdapter,
};
