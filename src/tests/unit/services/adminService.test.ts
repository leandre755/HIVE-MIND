import { jest } from '@jest/globals';

const mockRefresh = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);

jest.unstable_mockModule('../../../services/supabase.js', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn<() => Promise<unknown>>().mockResolvedValue({
      data: [
        { id: 'admin1', role: 'admin' },
        { id: 'super1', role: 'superadmin' },
      ],
      error: null,
    }),
  },
  default: {},
}));

describe('adminService lifecycle', () => {
  let adminService: typeof import('../../../services/adminService.js').adminService;

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
    const mod = await import('../../../services/adminService.js');
    adminService = mod.adminService;
    adminService.refresh = mockRefresh;
  });

  afterEach(() => {
    adminService.destroy();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('init sets up intervals and initial refresh', async () => {
    mockRefresh.mockResolvedValueOnce(true);
    await adminService.init();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('retries initial refresh on failure and then clears it on destroy', async () => {
    mockRefresh.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await adminService.init();

    await jest.advanceTimersByTimeAsync(5000);

    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});
