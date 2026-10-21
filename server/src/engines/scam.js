// Message safety scanner: rule-based detection of the romance-scam patterns most common in
// Ghana and West Africa. Messages are never blocked; risky ones show the recipient a warning
// and high-risk ones raise a flag for human review (fraud escalation SOP).

const HIGH = [
  { id: 'money_request', re: /\b(send|lend|loan|borrow|transfer|wire|give)\b[^.?!]{0,40}\b(money|cash|cedis?|ghs|gh₵|dollars?|pounds?|euros?|funds|momo)\b/i },
  { id: 'money_request', re: /\b(need|want)\b[^.?!]{0,20}\b(gh₵|ghs|\$|£|€)\s?\d/i },
  { id: 'payment_method', re: /\b(mobile money|momo number|western union|moneygram|gift ?cards?|itunes card|steam card|google play card|airtime)\b/i },
  { id: 'crypto', re: /\b(bitcoin|btc|usdt|crypto(currency)?|forex|binary options?)\b/i },
  { id: 'fee_story', re: /\b(customs|clearance|visa|hospital|medical|school|flight|ticket|shipping|delivery)\s+(fees?|bills?|charges?)\b/i },
  { id: 'investment', re: /\binvest(ment|ing)?\b[^.?!]{0,40}\b(profit|returns?|double|guaranteed)\b/i },
];

const CAUTION = [
  { id: 'contact_share', re: /(\+?233|\b0)[\s-]?[235]\d[\s-]?\d{3}[\s-]?\d{4}\b/ },
  { id: 'contact_share', re: /\b\d[\d\s-]{9,14}\d\b/ },
  { id: 'off_platform', re: /\b(whatsapp|telegram|signal|snapchat|wechat|hangouts|instagram|facebook messenger)\b/i },
];

export const RISK_LABELS = {
  money_request: 'Asking for money',
  payment_method: 'Mentions a payment method often used in scams',
  crypto: 'Mentions crypto or trading',
  fee_story: 'Mentions a fee or bill that needs paying',
  investment: 'Investment offer',
  contact_share: 'Sharing contact details early',
  off_platform: 'Moving the chat to another app early',
};

/**
 * @param text message body
 * @param {{priorMessages:number}} context  messages already exchanged in this match
 * @returns {{risk:'none'|'caution'|'high', reasons:string[]}}
 */
export function scanMessage(text, { priorMessages = 0 } = {}) {
  const reasons = new Set();
  for (const p of HIGH) if (p.re.test(text)) reasons.add(p.id);
  const high = reasons.size > 0;
  // Exchanging numbers is normal once two people know each other; flag it only early on.
  if (priorMessages < 30) for (const p of CAUTION) if (p.re.test(text)) reasons.add(p.id);
  return { risk: high ? 'high' : reasons.size ? 'caution' : 'none', reasons: [...reasons] };
}
