import { healthRoutes } from './health';
import type { EmailRepository } from '../../db/email-repository';
import type { Config } from '../../types';

function createMockRepo(emailCount = 0) {
  return {
    count: vi.fn().mockReturnValue(emailCount),
  } as unknown as EmailRepository;
}

const testConfig: Config = {
  smtpPort: 2525,
  apiPort: 3000,
  tls: 'none',
  persist: false,
};

describe('health routes', () => {
  it('should return health status', async () => {
    const repo = createMockRepo(5);
    const app = healthRoutes(repo, testConfig);

    const response = await app
      .handle(new Request('http://localhost/api/health'))
      .then((r: Response) => r.json());

    expect(response).toEqual({
      status: 'ok',
      smtpPort: 2525,
      apiPort: 3000,
      persistent: false,
      emailCount: 5,
    });
  });
});
