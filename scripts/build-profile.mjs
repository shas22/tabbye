import { spawnSync } from 'node:child_process';

// Build, rather than serve: no development connection should keep the worker awake.
const result = spawnSync(process.execPath, ['run', 'build'], {
  env: { ...process.env, WXT_PROFILE: 'true' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
