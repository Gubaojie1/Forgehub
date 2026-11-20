const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const schema = [...read('lib/storage.ts').matchAll(/db\.prepare\("(CREATE TABLE IF NOT EXISTS [^"]+)"\)/g)].map((match) => match[1]);

function database() {
  const sql = new DatabaseSync(':memory:');
  for (const statement of schema) sql.exec(statement);
  function statement(query, values = []) {
    return {
      bind: (...more) => statement(query, more),
      first: async () => sql.prepare(query).get(...values) ?? null,
      all: async () => ({ results: sql.prepare(query).all(...values) }),
      run: async () => ({ meta: { changes: Number(sql.prepare(query).run(...values).changes) } }),
      execute() { return /^\s*(SELECT|PRAGMA)/i.test(query) ? this.all() : this.run(); },
    };
  }
  const db = {
    prepare: (query) => statement(query),
    batch: async (statements) => {
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const item of statements) results.push(await item.execute());
        sql.exec('COMMIT');
        return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  return { sql, db };
}

function loadRoute(db) {
  const access = { email: 'admin@example.test', displayName: '管理员', isAdmin: true };
  const storage = {
    getD1: () => db,
    requireAccess: async () => access,
    getSystemOwnerEmail: async () => 'owner@example.test',
    writeAudit: async () => {},
    AccessError: class extends Error { constructor(message, status = 403) { super(message); this.status = status; } },
  };
  const exports = {};
  vm.runInNewContext(compile(read('app/api/users/[email]/route.ts')), {
    exports, require: (name) => name === '@/lib/selfhost-auth' ? { hashPassword: async () => ({ hash: 'h', salt: 's' }) } : storage, Request, Response, console,
  });
  return { route: exports, access };
}

const ctx = (email) => ({ params: Promise.resolve({ email }) });
const remove = (route, email) => route.DELETE(new Request('http://localhost/api', { method: 'DELETE' }), ctx(email));

(async () => {
  const { sql, db } = database();
  const { route, access } = loadRoute(db);
  sql.prepare('INSERT INTO users (email, display_name, role, status, created_at) VALUES (?, ?, ?, ?, ?)').run(access.email, '管理员', 'admin', 'active', '2026-01-01');
  let response = await remove(route, access.email);
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /不能删除自己/);

  response = await remove(route, 'owner@example.test');
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /系统所有者/);

  sql.prepare('INSERT INTO users (email, display_name, role, status, created_at) VALUES (?, ?, ?, ?, ?)').run('only@example.test', '唯一管理员', 'admin', 'active', '2026-01-01');
  sql.prepare("UPDATE users SET status = 'disabled' WHERE email = ?").run(access.email);
  response = await remove(route, 'only@example.test');
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /至少保留一名启用的管理员/);
  sql.prepare("UPDATE users SET status = 'active' WHERE email = ?").run(access.email);

  sql.prepare("INSERT INTO products (id, code, name, family, hw_versions, owner, status, description, owner_email) VALUES ('p', 'P', '睡眠产品', '测试', '1', '负责人', '研发', '', 'lead@example.test')").run();
  sql.prepare('INSERT INTO users (email, display_name, role, status, created_at) VALUES (?, ?, ?, ?, ?)').run('lead@example.test', '负责人', 'product_owner', 'active', '2026-01-01');
  response = await remove(route, 'lead@example.test');
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /睡眠产品/);

  sql.prepare('INSERT INTO users (email, display_name, role, status, created_at) VALUES (?, ?, ?, ?, ?)').run('member@example.test', '普通成员', 'developer', 'active', '2026-01-01');
  sql.prepare("INSERT INTO product_permissions (user_email, product_id) VALUES ('member@example.test', 'p')").run();
  response = await remove(route, 'member@example.test');
  assert.equal(response.status, 200);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('member@example.test').n, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM product_permissions WHERE user_email = ?').get('member@example.test').n, 0);
  sql.close();

  process.env.SELF_HOSTED = 'true';
  process.env.SESSION_SECRET = 'member-delete-session-secret-value';
  process.env.ADMIN_EMAIL = 'admin@forgehub.local';
  const live = database();
  const auth = {};
  vm.runInNewContext(compile(read('lib/selfhost-auth.ts')), { exports: auth, crypto, TextEncoder, TextDecoder, process, btoa, atob, console });
  const storageExports = {};
  vm.runInNewContext(compile(read('lib/storage.ts')), {
    exports: storageExports,
    require: (name) => {
      if (name === '@/lib/platform-env') return { env: { DB: live.db } };
      if (name === '@/lib/realtime') return { publishRealtimeEvent() {} };
      if (name === '@/lib/selfhost-auth') return auth;
      throw new Error(name);
    },
    crypto, TextEncoder, TextDecoder, process, console, URL,
  });
  const adminToken = await auth.createSession('admin@forgehub.local', '管理员');
  const adminAccess = await storageExports.getAccess(new Request('http://localhost', { headers: { authorization: `Bearer ${adminToken}` } }));
  assert.equal(adminAccess.isAdmin, true);
  assert.equal(live.sql.prepare('SELECT role FROM users WHERE email = ?').get('admin@forgehub.local').role, 'admin');
  live.sql.prepare('INSERT INTO users (email, display_name, role, status, created_at) VALUES (?, ?, ?, ?, ?)').run('gone@example.test', '已删除', 'developer', 'active', '2026-01-01');
  const memberToken = await auth.createSession('gone@example.test', '已删除');
  const memberRequest = new Request('http://localhost', { headers: { authorization: `Bearer ${memberToken}` } });
  assert.equal((await storageExports.getAccess(memberRequest)).email, 'gone@example.test');
  live.sql.prepare('DELETE FROM users WHERE email = ?').run('gone@example.test');
  await assert.rejects(() => storageExports.getAccess(memberRequest), (error) => error.status === 401);
  assert.equal(live.sql.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('gone@example.test').n, 0);
  live.sql.close();
  console.log('PASS: member delete guards and deleted accounts stay deleted');
})().catch((error) => { console.error(error); process.exitCode = 1; });
