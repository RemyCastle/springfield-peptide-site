// Run: node workers/supplier-sync/test/mailbox.test.mjs
import assert from 'node:assert/strict';
import PostalMime from 'postal-mime';
import { authPass, mailKind, allowedSender, attachedEmails } from '../src/mailbox.js';

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
// Outlook "forward as attachment": two emails inside one forward.
const CRLF = String.fromCharCode(13, 10);
const inner = (id, from, subject, body) =>
  [`From: ${from}`, 'To: me@example.test', `Subject: ${subject}`, `Message-ID: <${id}@example.test>`, 'Content-Type: text/plain; charset=utf-8', '', body].join(CRLF);
const outer = [
  'From: me@example.test',
  'To: supplier@springfieldpbc.com',
  'Subject: ',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="B"',
  '',
  '--B',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<style>P {margin-top:0;}</style>',
  '--B',
  'Content-Type: message/rfc822',
  'Content-Disposition: attachment; filename="order.eml"',
  '',
  inner('o1', 'Show Me Source <orders@show-me-source.com>', 'Your order #5521', 'Ship to Jane. Total $151.50'),
  '--B',
  'Content-Type: message/rfc822',
  'Content-Disposition: attachment; filename="ship.eml"',
  '',
  inner('s1', 'Show Me Source <orders@show-me-source.com>', 'Your order shipped', 'Tracking 9400 1118 9922'),
  '--B',
  'Content-Type: application/vnd.ms-outlook',
  'Content-Disposition: attachment; filename="old.msg"',
  '',
  'binary',
  '--B--',
  '',
].join(CRLF);
const parsed = await PostalMime.parse(outer);
const att = await attachedEmails(parsed);
assert.equal(att.length, 3);
assert.equal(att[0].kind, 'sms_order');
assert.equal(att[0].subject, 'Your order #5521');
assert.equal(att[0].fromAddr, 'orders@show-me-source.com');
assert.equal(att[1].kind, 'sms_shipping');
assert.equal(att[2].kind, 'unsupported_msg');

console.log('ok: supplier mailbox trust checks + attached emails');
