// Gmail sender module - deprecated in favor of multi-provider-failover
// Kept for backward compatibility

export async function sendViaGmail(options: any) {
  console.warn('sendViaGmail is deprecated. Use multi-provider-failover instead.');
  throw new Error('Gmail sender is deprecated');
}

export default { sendViaGmail };
