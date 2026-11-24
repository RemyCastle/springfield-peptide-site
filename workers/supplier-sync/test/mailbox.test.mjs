// Run: node workers/supplier-sync/test/mailbox.test.mjs
import assert from 'node:assert/strict';
import { authPass, mailKind, allowedSender } from '../src/mailbox.js';

const T = ['show-me-source.com'];
const dkimOk = 'mx.cloudflare.net; dkim=pass header.d=show-me-source.com header.s=s1; spf=none';
const spfOk = 'mx.cloudflare.net; spf=pass (domain of bounce@mail.show-me-source.com) smtp.mailfrom=bounce@mail.show-me-source.com';
const fail = 'mx.cloudflare.net; dkim=fail header.d=show-me-source.com; spf=softfail smtp.mailfrom=evil.example';
const otherDomainPass = 'mx.cloudflare.net; dkim=pass header.d=evil.example';

assert.equal(authPass([dkimOk], 'orders@show-me-source.com', T), 'dkim');
assert.equal(authPass([spfOk], 'orders@show-me-source.com', T), 'spf', 'subdomain bounce address counts');
assert.equal(authPass([fail], 'orders@show-me-source.com', T), '', 'failed checks are not trusted');
assert.equal(authPass([otherDomainPass], 'orders@show-me-source.com', T), '', 'pass for another domain is not enough');
assert.equal(authPass([dkimOk], 'orders@evil.example', T), '', 'From must be the trusted domain');
assert.equal(authPass([], 'orders@show-me-source.com', T), '', 'no auth header = not trusted');
assert.equal(authPass(['dkim=pass header.d=notshow-me-source.com'], 'a@show-me-source.com', T), '', 'look-alike domain refused');

assert.equal(mailKind('orders@show-me-source.com', 'Your order #12', 'Thanks'), 'sms_order');
assert.equal(mailKind('orders@show-me-source.com', 'Your order shipped', 'Tracking 9400'), 'sms_shipping');
assert.equal(mailKind('venmo@venmo.com', 'Jane paid you $50', ''), 'venmo');

assert.equal(allowedSender({ ALLOWED_FORWARDERS: 'me@example.test, you@example.test' }, 'You@Example.test'), true);
assert.equal(allowedSender({ ALLOWED_FORWARDERS: '' }, 'me@example.test'), false);
console.log('ok: supplier mailbox trust checks');
