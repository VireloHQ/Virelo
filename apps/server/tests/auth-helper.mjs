import assert from 'node:assert/strict';

export async function authenticatedInjector(app) {
  const result = await app.inject({method:'POST',url:'/api/auth/setup',headers:{'x-virelo-request':'1'},
    payload:{username:'test-admin',password:'A test-only passphrase 2026'}});
  assert.equal(result.statusCode,200,result.body);
  const cookie = result.headers['set-cookie'].split(';')[0];
  return options => app.inject({...options,headers:{cookie,'x-virelo-request':'1',...options.headers}});
}
