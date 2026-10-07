import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('更新检查：一致来源、脏目录拒绝、来源不一致拒绝、缺失分支', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vpsm-update-'))
  const bin = join(dir, 'bin'), mode = join(dir, 'mode')
  await mkdir(bin)
  // A fake git keeps online-update checks isolated from GitHub and the real checkout.
  await writeFile(join(bin, 'git'), `#!/bin/sh
mode=$(cat "$UPDATE_TEST_MODE")
case "$1" in
 rev-parse) echo 1111111111111111111111111111111111111111 ;;
 status) if [ "$mode" = dirty ]; then echo ' M README.md'; fi ;;
 remote) if [ "$mode" = mismatch ]; then echo git@github.com:other/repo.git; else echo git@github.com:DeraDream/vpsMonitor.git; fi ;;
 ls-remote) if [ "$mode" != missing ]; then echo '1111111111111111111111111111111111111111 refs/heads/main'; fi ;;
 *) exit 1 ;;
esac
`)
  await chmod(join(bin, 'git'), 0o755)
  await writeFile(mode, 'clean')
  const port = 51000 + Math.floor(Math.random() * 1000)
  const child = spawn(process.execPath, ['apps/api/src/server.mjs'], { env: { ...process.env, DISABLE_BUILTIN_PROVIDERS: "1", HOST: '127.0.0.1', PORT: String(port), DATA_DIR: join(dir, 'data'), ADMIN_PASSWORD: 'updates-password', PATH: `${bin}:${process.env.PATH}`, UPDATE_TEST_MODE: mode }, stdio: 'ignore' })
  const headers = { Authorization: `Basic ${Buffer.from('admin:updates-password').toString('base64')}` }
  const status = async () => (await fetch(`http://127.0.0.1:${port}/api/updates/status`, { headers })).json()
  try {
    for (let i = 0; i < 100; i++) { try { await status(); break } catch {} await new Promise(r => setTimeout(r, 50)) }
    assert.equal((await status()).deployReady, true)
    assert.equal((await status()).updateAvailable, false)
    await writeFile(mode, 'dirty'); assert.equal((await status()).deployReady, false)
    await writeFile(mode, 'mismatch'); assert.equal((await status()).deployReady, false)
    await t.test('不存在的远端分支应拒绝部署', async () => {
      await writeFile(mode, 'missing')
      const result = await status()
      assert.equal(result.remoteRevision, null)
      assert.equal(result.deployReady, false)
    })
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited }
    await rm(dir, { recursive: true, force: true })
  }
})
