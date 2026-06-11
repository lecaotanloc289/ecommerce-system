import { execSync } from 'node:child_process';

// Apply migrations to the target DB before the suite runs.
export default function setup() {
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
}
