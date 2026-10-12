import { type ScenarioInput, startScenarios, unsignedJwt } from 'state-scenarios';
import { cookiesAdapter } from 'state-scenarios/cookies';

const signedIn: ScenarioInput = {
  name: 'signed-in',
  state: { cookies: { session: 'scenario' } }, // so the app's startup check runs
  network: [{
    method: 'POST',
    path: '/api/auth/validate-token',
    response: {
      body: {
        token: unsignedJwt({ sub: 'user-1', name: 'Amara Okafor', roles: ['admin'], exp: 4102444800 }),
      },
    },
  }],
};

await startScenarios({ scenarios: [signedIn], adapters: [cookiesAdapter()] });
