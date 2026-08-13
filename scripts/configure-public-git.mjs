import { execFileSync } from 'node:child_process';

function git(args) {
  execFileSync('git', args, { stdio: 'inherit' });
}

git(['config', 'core.hooksPath', '.githooks']);
git(['config', 'user.name', 'Vikunja MCP Maintainers']);
git(['config', 'user.email', 'maintainers@vikunja-mcp.invalid']);
console.log('Configured public Git identity and pre-push boundary check for this checkout.');
