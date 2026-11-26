import { buildSignData, formatVnpDate, hmacSha512 } from '@repo/payments';
import { ORIGINS, SECRETS } from './config';

/**
 * Plays VNPay: sends the IPN (instant payment notification) a real gateway would send after the
 * customer pays, signed with the same helpers the adapter verifies with and the e2e test secret.
 * The API route is the real production one (`GET /v1/payments/webhook/vnpay`).
 */
export async function sendVnpayIpn(input: {
  paymentId: string;
  /** Order grand total in VND (đồng, integer). */
  amountVnd: number;
  /** `00` = paid; anything else = failed. */
  responseCode?: string;
}): Promise<{ RspCode: string; Message: string }> {
  const code = input.responseCode ?? '00';
  const params: Record<string, string> = {
    vnp_TmnCode: SECRETS.vnpayTmnCode,
    vnp_TxnRef: input.paymentId,
    vnp_Amount: String(input.amountVnd * 100),
    vnp_BankCode: 'NCB',
    vnp_CardType: 'ATM',
    vnp_OrderInfo: 'e2e',
    vnp_PayDate: formatVnpDate(new Date()),
    vnp_ResponseCode: code,
    vnp_TransactionNo: `E2E${Date.now()}`,
    vnp_TransactionStatus: code,
  };
  const secureHash = hmacSha512(SECRETS.vnpayHashSecret, buildSignData(params));
  const query = new URLSearchParams({ ...params, vnp_SecureHash: secureHash });
  const res = await fetch(`${ORIGINS.api}/v1/payments/webhook/vnpay?${query.toString()}`);
  if (!res.ok) throw new Error(`VNPay IPN endpoint answered HTTP ${res.status}`);
  return (await res.json()) as { RspCode: string; Message: string };
}
