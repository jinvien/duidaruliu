export type ToolApprovalDecision = 'once' | 'session' | 'reject' | 'aborted';

export type PendingToolApproval = {
  id: string;
  displayName: string;
  serverName: string;
  args: unknown;
};

type Waiter = {
  approval: PendingToolApproval;
  signal: AbortSignal;
  resolve: (decision: ToolApprovalDecision) => void;
};

let pending: PendingToolApproval | null = null;
let waiter: Waiter | null = null;
const listeners = new Set<() => void>();
const sessionAllowed = new Set<string>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeToolApproval(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingToolApproval(): PendingToolApproval | null {
  return pending;
}

export function isToolAllowedForSession(name: string) {
  return sessionAllowed.has(name);
}

export function clearSessionToolAllows() {
  sessionAllowed.clear();
}

export function requestToolApproval(
  approval: PendingToolApproval,
  signal: AbortSignal
): Promise<ToolApprovalDecision> {
  if (signal.aborted) return Promise.resolve('aborted');
  return new Promise((resolve) => {
    const finish = (decision: ToolApprovalDecision) => {
      signal.removeEventListener('abort', onAbort);
      if (waiter?.approval.id === approval.id) {
        waiter = null;
        pending = null;
        emit();
      }
      resolve(decision);
    };
    const onAbort = () => finish('aborted');
    waiter = { approval, signal, resolve: finish };
    pending = approval;
    emit();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function decideToolApproval(decision: Exclude<ToolApprovalDecision, 'aborted'>) {
  if (!waiter) return;
  if (decision === 'session') sessionAllowed.add(waiter.approval.id);
  waiter.resolve(decision);
}
