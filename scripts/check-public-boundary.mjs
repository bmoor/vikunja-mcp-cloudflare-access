import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const root = git(['rev-parse', '--show-toplevel']);
const forbidden = [
  { name: 'private host label', expression: new RegExp(`\\b${['s', 'ui'].join('')}\\b`, 'i') },
  { name: 'private domain', expression: new RegExp(['moor', '-ow', '\\.ch'].join(''), 'i') },
  { name: 'private network address', expression: /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/ },
  { name: 'private local path', expression: /(?:\b[A-Za-z]:\\(?:Users|Prj)\\|\/(?:mnt)\/(?:pool|home)\b)/ },
  { name: 'deployment account detail', expression: /\bdeploy@/i },
  { name: 'private forge reference', expression: new RegExp(['gi', 'tea'].join(''), 'i') },
];
const genericEmails = new Set(['owner@example.com', 'owner@example.test', 'other@example.test', 'maintainers@vikunja-mcp.invalid']);
const emailExpression = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const problems = [];

const trackedPaths = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
for (const relativePath of trackedPaths) {
  const content = readFileSync(join(root, relativePath));
  if (content.includes(0)) continue;
  const text = content.toString('utf8');
  for (const rule of forbidden) {
    if (rule.expression.test(text)) problems.push(`${relativePath}: ${rule.name}`);
    rule.expression.lastIndex = 0;
  }
  for (const email of text.match(emailExpression) || []) {
    if (!genericEmails.has(email.toLowerCase())) problems.push(`${relativePath}: real email address`);
  }
}

for (const row of git(['log', '--all', '--format=%H%x00%ae%x00%ce']).split('\n').filter(Boolean)) {
  const [commit, authorEmail, committerEmail] = row.split('\0');
  for (const email of [authorEmail, committerEmail]) {
    if (email && email !== 'maintainers@vikunja-mcp.invalid' && !email.endsWith('@users.noreply.github.com')) {
      problems.push(`${commit.slice(0, 12)}: non-public commit email`);
    }
  }
}

if (problems.length) {
  console.error('Public repository boundary check failed:');
  for (const problem of [...new Set(problems)].sort()) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('Public repository boundary check passed.');
