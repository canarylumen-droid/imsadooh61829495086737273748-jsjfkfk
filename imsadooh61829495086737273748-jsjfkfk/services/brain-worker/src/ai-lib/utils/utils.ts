/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity percentage between two strings (0 to 1)
 */
export function calculateSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  const len = Math.max(s1.length, s2.length);
  if (len === 0) return 1;
  const distance = levenshteinDistance(s1.toLowerCase(), s2.toLowerCase());
  return 1 - distance / len;
}
