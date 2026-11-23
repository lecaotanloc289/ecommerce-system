import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { RUN_ENV, requireRunEnv } from './config';

// The flows are chained (checkout → fulfilment → payout) and live in separate spec files. What one
// leaves for the next (ids) goes through this file, so a Playwright worker restart after a failure
// cannot lose it.

export interface FlowState {
  orderId?: string;
  paymentId?: string;
  /** Order grand total in VND. */
  grandTotal?: number;
  subOrders?: { vendorA?: string; vendorB?: string };
}

function stateFile(): string {
  return `${requireRunEnv(RUN_ENV.sessionsFile)}.state.json`;
}

export function readState(): FlowState {
  return existsSync(stateFile())
    ? (JSON.parse(readFileSync(stateFile(), 'utf8')) as FlowState)
    : {};
}

export function writeState(patch: FlowState): void {
  writeFileSync(stateFile(), JSON.stringify({ ...readState(), ...patch }));
}

export function requireState<K extends keyof FlowState>(key: K): NonNullable<FlowState[K]> {
  const value = readState()[key];
  if (value === undefined) {
    throw new Error(`flow state "${key}" is missing — did the earlier flow fail?`);
  }
  return value;
}
