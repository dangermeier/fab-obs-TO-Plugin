const test = require('node:test');
const assert = require('node:assert/strict');

const { lanAddresses, needsPublicHost } = require('../src/lan');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k];
  }
  try { return fn(); } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

test('PUBLIC_HOST is advertised as given, in whichever form', () => {
  const url = host => withEnv({ PUBLIC_HOST: host }, () => lanAddresses(3000)[0].url);

  assert.equal(url('192.168.2.10'), 'http://192.168.2.10:3000/control/');
  assert.equal(url('192.168.2.10:3010'), 'http://192.168.2.10:3010/control/');
  assert.equal(url('nas.local'), 'http://nas.local:3000/control/');
  assert.equal(url('https://fab.example/'), 'https://fab.example/control/');
  assert.equal(withEnv({ PUBLIC_HOST: 'nas.local' }, () => lanAddresses(3000)).length, 1);
});

test('without PUBLIC_HOST: real IPv4 adapters, the virtual ones last', () => {
  const list = withEnv({ PUBLIC_HOST: null }, () => lanAddresses(4000));
  for (const e of list) {
    assert.match(e.address, /^\d+\.\d+\.\d+\.\d+$/);
    assert.ok(!e.address.startsWith('169.254.'));
    assert.equal(e.url, `http://${e.address}:4000/control/`);
  }
  const firstVirtual = list.findIndex(e => e.virtual);
  if (firstVirtual >= 0) assert.ok(list.slice(firstVirtual).every(e => e.virtual));
});

test('needsPublicHost: only in a container that was not told its address', () => {
  assert.equal(withEnv({ PUBLIC_HOST: null, FAB_IN_CONTAINER: null }, needsPublicHost), false);
  assert.equal(withEnv({ PUBLIC_HOST: null, FAB_IN_CONTAINER: '1' }, needsPublicHost), true);
  assert.equal(withEnv({ PUBLIC_HOST: '10.0.0.5', FAB_IN_CONTAINER: '1' }, needsPublicHost), false);
});
