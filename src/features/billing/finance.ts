import { currentToken } from '@/platform/person';

// Kete Finance, as Support reaches it (doctrine D-048): an invoice is prepared there, for the
// person, as a draft she — or whoever issues invoices — verifies and issues in Kete Finance.
// Support never issues an invoice.

export interface InvoiceAsked {
  title: string;
  partyId?: string;
  partyName: string;
  projectId?: string;
  taxRate: number;
  lines: { label: string; quantity: number; unitPrice: number }[];
}

export type Prepared =
  | { ok: true; draftId: string; reviewUrl: string }
  | { ok: false; error: 'finance_not_connected' | 'finance_refused'; reason: string };

/** Kete Finance's address, as `FINANCE_URL` names it; its API is under `/api/v1`. */
export function financeUrl(): string | null {
  return (process.env.FINANCE_URL ?? '').trim().replace(/\/$/, '') || null;
}

type Prepare = (invoice: InvoiceAsked) => Promise<Prepared>;

async function askFinance(invoice: InvoiceAsked): Promise<Prepared> {
  const base = financeUrl();
  const token = currentToken();
  if (!base || !token) return { ok: false, error: 'finance_not_connected', reason: '' };
  const response = await fetch(`${base}/api/v1/capabilities/invoices_create`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify(invoice),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!response) return { ok: false, error: 'finance_not_connected', reason: 'unreachable' };
  const answer = (await response.json().catch(() => ({}))) as {
    status?: string;
    draftId?: string;
    error?: string;
    reason?: string;
  };
  if (answer.status === 'draft' && answer.draftId) {
    return { ok: true, draftId: answer.draftId, reviewUrl: `${base}/verification/${answer.draftId}` };
  }
  return {
    ok: false,
    error: 'finance_refused',
    reason: answer.reason ?? answer.error ?? `http_${response.status}`,
  };
}

let prepare: Prepare = askFinance;

/** Tests and other hosts: another way to reach Kete Finance. */
export function useFinance(next: Prepare | undefined): void {
  prepare = next ?? askFinance;
}

export function prepareInvoice(invoice: InvoiceAsked): Promise<Prepared> {
  return prepare(invoice);
}
