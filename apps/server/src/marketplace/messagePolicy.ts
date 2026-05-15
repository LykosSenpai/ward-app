const bannedTerms = ["scam", "paypal friends", "wire transfer"];

export function validateMarketplaceMessagePolicy(body: string): void {
  const normalized = body.toLowerCase();
  if (bannedTerms.some(term => normalized.includes(term))) {
    throw new Error("Message violates marketplace safety policy. Please revise and try again.");
  }

  const urlMatches = body.match(/https?:\/\//gi) ?? [];
  if (urlMatches.length > 2) {
    throw new Error("Too many links in one message. Please reduce external links.");
  }

  if (/(.)\1{14,}/.test(body)) {
    throw new Error("Message appears to contain spam-like repeated characters.");
  }
}
