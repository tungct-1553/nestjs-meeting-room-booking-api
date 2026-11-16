import 'dotenv/config';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const issuer = new URL(process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8081/realms/meeting-room');
const realmMatch = issuer.pathname.match(/^\/realms\/([^/]+)$/);
if (!realmMatch) throw new Error('KEYCLOAK_ISSUER must identify a Keycloak realm');
const realm = realmMatch[1];
const base = issuer.origin;
const apiClientId = process.env.API_CLIENT_ID ?? 'meeting-room-api';
const accounts = [
  { username: 'employee@example.test', firstName: 'Employee', role: 'employee', password: required('KEYCLOAK_EMPLOYEE_PASSWORD') },
  { username: 'admin@example.test', firstName: 'Admin', role: 'admin', password: required('KEYCLOAK_TEST_ADMIN_PASSWORD') },
];

async function main() {
  const login = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'admin-cli',
      username: process.env.KEYCLOAK_ADMIN_USERNAME ?? 'admin',
      password: required('KEYCLOAK_ADMIN_PASSWORD'),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!login.ok) throw new Error(`Keycloak admin authentication failed (${login.status})`);
  const { access_token: token } = await login.json();
  if (typeof token !== 'string') throw new Error('Keycloak admin authentication returned no access token');
  const adminPath = `${base}/admin/realms/${realm}`;
  async function api(path, method = 'GET', body) {
    const response = await fetch(`${adminPath}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Keycloak bootstrap ${method} failed (${response.status})`);
    return response.status === 204 || response.status === 201 ? null : response.json();
  }
  const clients = await api(`/clients?clientId=${encodeURIComponent(apiClientId)}`);
  const client = clients.find((entry) => entry.clientId === apiClientId);
  if (!client) throw new Error('API client is missing; import the meeting-room realm first');
  for (const account of accounts) {
    const query = `/users?username=${encodeURIComponent(account.username)}&exact=true`;
    let matches = await api(query);
    const profile = { username: account.username, email: account.username, firstName: account.firstName,
      lastName: 'Local', enabled: true, emailVerified: true, requiredActions: [] };
    if (matches.length === 0) {
      await api('/users', 'POST', profile);
      matches = await api(query);
    }
    if (matches.length !== 1) throw new Error('Expected exactly one local test account');
    const userId = matches[0].id;
    await api(`/users/${userId}`, 'PUT', profile);
    await api(`/users/${userId}/reset-password`, 'PUT', { type: 'password', value: account.password, temporary: false });
    const role = await api(`/clients/${client.id}/roles/${account.role}`);
    const mappingsPath = `/users/${userId}/role-mappings/clients/${client.id}`;
    const mappings = await api(mappingsPath);
    const unexpected = mappings.filter((entry) => entry.name !== account.role && entry.name !== 'employee');
    if (unexpected.length) await api(mappingsPath, 'DELETE', unexpected);
    await api(mappingsPath, 'POST', [role]);
    console.log(`Configured local ${account.role}: ${account.username}`);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
