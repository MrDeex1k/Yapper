import assert from 'node:assert/strict';
import test from 'node:test';
import { serverInfo } from '../src/lib/server.ts';

test('accepts complete connection information', () => {
  assert.deepEqual(serverInfo({ name: 'Yapper', version: '0.1.0', protocol: 1 }), {
    name: 'Yapper',
    version: '0.1.0',
    protocol: 1,
  });
});

test('rejects missing, non-string and blank display fields', () => {
  for (const input of [
    null,
    [],
    'server',
    { protocol: 1 },
    { name: 'Yapper', protocol: 1 },
    { version: '0.1.0', protocol: 1 },
    { name: 42, version: '0.1.0', protocol: 1 },
    { name: 'Yapper', version: null, protocol: 1 },
    { name: ' ', version: '0.1.0', protocol: 1 },
    { name: 'Yapper', version: '', protocol: 1 },
  ]) {
    assert.throws(() => serverInfo(input), /invalid connection information/);
  }
});

test('requires numeric supported protocol', () => {
  for (const protocol of [undefined, null, '1', 2]) {
    assert.throws(
      () => serverInfo({ name: 'Yapper', version: '0.1.0', protocol }),
      /unsupported protocol/,
    );
  }
});
