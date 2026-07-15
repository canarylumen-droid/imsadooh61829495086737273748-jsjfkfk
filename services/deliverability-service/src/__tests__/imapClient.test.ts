import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnect = vi.fn();
const mockGetMailboxLock = vi.fn();
const mockSearch = vi.fn();
const mockLogout = vi.fn();

function MockImapFlow() {
  this.connect = mockConnect;
  this.getMailboxLock = mockGetMailboxLock;
  this.search = mockSearch;
  this.logout = mockLogout;
}

vi.mock('imapflow', () => ({ ImapFlow: MockImapFlow }));

describe('imapClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const seed = {
    id: 'seed-1',
    email: 'seed1@gmail.com',
    provider: 'gmail' as const,
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapUser: 'seed1@gmail.com',
    imapPass: 'app-password',
  };

  it('should return inbox folder when found in INBOX', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockGetMailboxLock.mockResolvedValue({ release: vi.fn() });
    mockSearch.mockResolvedValue([1, 2, 3]);
    mockLogout.mockResolvedValue(undefined);

    const { checkSeedPlacement } = await import('../services/imapClient.js');
    const result = await checkSeedPlacement(seed, 'test-123');
    expect(result.folder).toBe('inbox');
    expect(mockConnect).toHaveBeenCalledOnce();
    expect(mockLogout).toHaveBeenCalledOnce();
  });

  it('should return spam folder when found in Junk/Spam', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockGetMailboxLock.mockResolvedValue({ release: vi.fn() });
    mockSearch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([1]);
    mockLogout.mockResolvedValue(undefined);

    const { checkSeedPlacement } = await import('../services/imapClient.js');
    const result = await checkSeedPlacement(seed, 'test-123');
    expect(result.folder).toBe('spam');
  });

  it('should return promotions folder when found in Promotions', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockGetMailboxLock.mockResolvedValue({ release: vi.fn() });
    mockSearch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([99]);
    mockLogout.mockResolvedValue(undefined);

    const { checkSeedPlacement } = await import('../services/imapClient.js');
    const result = await checkSeedPlacement(seed, 'test-123');
    expect(result.folder).toBe('promotions');
  });

  it('should return not_found when no match in any folder', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockGetMailboxLock.mockResolvedValue({ release: vi.fn() });
    mockSearch.mockResolvedValue([]);
    mockLogout.mockResolvedValue(undefined);

    const { checkSeedPlacement } = await import('../services/imapClient.js');
    const result = await checkSeedPlacement(seed, 'test-123');
    expect(result.folder).toBe('not_found');
  });

  it('should return not_found on connect failure', async () => {
    mockConnect.mockRejectedValue(new Error('Connection refused'));

    const { checkSeedPlacement } = await import('../services/imapClient.js');
    const result = await checkSeedPlacement(seed, 'test-123');
    expect(result.folder).toBe('not_found');
  });

  it('should skip folders that fail lock acquisition and continue to next folders', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockGetMailboxLock
      .mockRejectedValueOnce(new Error('NO Folder'))         // INBOX fails
      .mockResolvedValueOnce({ release: vi.fn() })           // Junk succeeds
      .mockResolvedValueOnce({ release: vi.fn() });          // Spam succeeds
    mockSearch
      .mockResolvedValueOnce([])                              // Junk: no match
      .mockResolvedValueOnce([1]);                            // Spam: match
    mockLogout.mockResolvedValue(undefined);

    const { checkSeedPlacement } = await import('../services/imapClient.js');
    const result = await checkSeedPlacement(seed, 'test-123');
    expect(result.folder).toBe('spam');
  });

  it('should search using X-Seed-Test-ID header', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockGetMailboxLock.mockResolvedValue({ release: vi.fn() });
    mockSearch.mockResolvedValue([10]);
    mockLogout.mockResolvedValue(undefined);

    const { checkSeedPlacement } = await import('../services/imapClient.js');
    await checkSeedPlacement(seed, 'test-456');
    expect(mockSearch).toHaveBeenCalledWith(
      { header: { 'X-Seed-Test-ID': 'test-456' } },
      { uid: true },
    );
  });

  it('should always logout after checking', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockGetMailboxLock.mockResolvedValue({ release: vi.fn() });
    mockSearch.mockResolvedValue([]);
    mockLogout.mockResolvedValue(undefined);

    const { checkSeedPlacement } = await import('../services/imapClient.js');
    await checkSeedPlacement(seed, 'test-123');
    expect(mockLogout).toHaveBeenCalledOnce();
  });

  it('should search folders in order and return first match', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockGetMailboxLock.mockResolvedValue({ release: vi.fn() });
    mockSearch
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([2]);
    mockLogout.mockResolvedValue(undefined);

    const { checkSeedPlacement } = await import('../services/imapClient.js');
    const result = await checkSeedPlacement(seed, 'test-123');
    expect(result.folder).toBe('inbox');
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });
});
