const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'maia', 'import.js'), 'utf8');
function helpers() {
 const window = { __CF_MAIA_TEST__: true };
 vm.runInNewContext(source, { window, atob: (s) => Buffer.from(s, 'base64').toString('binary') });
 return window.__CF_MAIA_TEST__;
}
function storage(entries) {
 const keys = Object.keys(entries);
 return { length: keys.length, key: (i) => keys[i], getItem: (k) => (k in entries ? entries[k] : null) };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({alg:'HS256'})}.${b64(claims)}.sig`;

test('reads token and ids from the storage shapes Maia might use', () => {
 const h = helpers();
 const plain = h.readSession(storage({ userAccessKey: JSON.stringify(jwt({})), sel_school: '"11237322"', sel_user: '1513688' }));
 assert.deepEqual({ ...plain, token: Boolean(plain.token) }, { token: true, schoolId: '11237322', studentUid: '1513688' });

 const nested = h.readSession(storage({ userToken: JSON.stringify({ token: 'Bearer ' + jwt({}) }), sel_school: JSON.stringify({ nid: 42, title: 'Paly' }), sel_user: JSON.stringify({ uid: '77', name: 'x' }) }));
 assert.equal(nested.schoolId, '42');
 assert.equal(nested.studentUid, '77');
 assert.ok(nested.token.startsWith('ey'));

 const fromClaims = h.readSession(storage({ other: jwt({ uid: 9001, school_nid: '314' }) }));
 assert.equal(fromClaims.studentUid, '9001');
 assert.equal(fromClaims.schoolId, '314');

 const none = h.readSession(storage({ foo: 'bar' }));
 assert.equal(none.token, null);
});

test('storage diagnostics describe shapes without leaking values', () => {
 const h = helpers();
 const token = jwt({ uid: 1513688 });
 const d = JSON.parse(JSON.stringify(h.describeStorage(storage({ userAccessKey: JSON.stringify(token), sel_school: JSON.stringify({ nid: '11237322', title: 'Palo Alto High' }), authBlob: 'opaque-secret-value' }))));
 const text = JSON.stringify(d);
 for (const secret of [token, '11237322', 'Palo Alto High', 'opaque-secret-value']) assert.equal(text.includes(secret), false, secret);
 assert.deepEqual(d.find((x) => x.key === 'userAccessKey'), { key: 'userAccessKey', kind: 'json-string', len: token.length + 2, jwt: true, digitsOnly: false });
 assert.deepEqual(d.find((x) => x.key === 'sel_school').fields, ['nid:string(digits)', 'title:string']);
 assert.equal(d.find((x) => x.key === 'sel_user').kind, 'missing');
 assert.equal(d.find((x) => x.key === 'authBlob').kind, 'text');
});

test('normalizes Maia scattergram responses', () => {
 const h = helpers();
 const n = h.normalizeScatter({
  0: { sat: '1500', gpa: '3.52', result: 'Accepted ', type: 'Regular Decision' },
  1: { sat: null, gpa: '3.9', result: 'Denied', type: 'Early Decision' },
  avg_gpa: '3.8', student: { gpa: '3.49', wgpa: '3.83', sat: '1500' }, college_table_data: { sat: '1480' },
 });
 assert.deepEqual(JSON.parse(JSON.stringify(n)), {
  points: [
   { sat: 1500, gpa: 3.52, result: 'Accepted', round: 'Regular Decision' },
   { sat: null, gpa: 3.9, result: 'Denied', round: 'Early Decision' },
  ],
  averages: { gpa: 3.8, sat: 1480 },
  student: { gpa: 3.49, wgpa: 3.83, sat: 1500 },
 });
 assert.equal(h.normalizeScatter([]).points.length, 0);
});

test('picks the right Maia search hit', () => {
 const h = helpers();
 const data = { total_records: 2, 0: { nid: 1, title: 'Tufts University School of Medicine' }, 1: { nid: 2, title: 'Tufts University' } };
 assert.equal(h.pickSearchHit(data, 'Tufts University').nid, 2);
 assert.equal(h.pickSearchHit({ 0: { nid: 5, title: 'Something Else' }, 1: { nid: 6, title: 'Other' } }, 'Tufts'), null);
 assert.equal(h.pickSearchHit({}, 'Tufts'), null);
});
