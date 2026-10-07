import { cp, mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

if (process.env.GITHUB_ACTIONS === 'true') throw new Error('仅允许本地打包，不在 GitHub Actions 中生成发布包')
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('本发布包要求在 Linux x64 环境生成')
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
for (const name of ['apps/api', 'apps/web', 'apps/worker', 'packages/core', 'packages/db', 'packages/adapters']) {
  const workspace = JSON.parse(await readFile(join(root, name, 'package.json'), 'utf8'))
  if (workspace.version !== manifest.version) throw new Error(`${name} 版本号与主版本不一致`)
}
await access(join(root, 'apps/web/dist/index.html'))
const staging = await mkdtemp(join(tmpdir(), 'vpsmonitor-release-'))
const bundleName = `vps-monitor-${manifest.version}`, bundle = join(staging, bundleName)
const output = join(root, 'releases'), filename = `${bundleName}-linux-x64.tar.gz`
await mkdir(bundle); await mkdir(output, { recursive: true })
try {
  for (const name of ['package.json', 'package-lock.json', '.env.example', 'README.md', 'CHANGELOG.md',
    'docs/RELEASE-INSTALL.md', 'docs/GREENCloud.md', 'docs/NOTIFICATIONS.md', 'docs/PUBLIC-SITE.md', 'deploy/install-release.sh', 'deploy/systemd', 'scripts/bero-probe.mjs']) {
    await mkdir(resolve(bundle, name, '..'), { recursive: true })
    await cp(join(root, name), join(bundle, name), { recursive: true })
  }
  for (const name of ['apps/api', 'apps/worker', 'packages/core', 'packages/db', 'packages/adapters']) {
    await mkdir(join(bundle, name), { recursive: true })
    await cp(join(root, name, 'package.json'), join(bundle, name, 'package.json'))
    await cp(join(root, name, 'src'), join(bundle, name, 'src'), {
      recursive: true, filter: path => !path.split('/').includes('fixtures')
    })
  }
  await mkdir(join(bundle, 'apps/web'), { recursive: true })
  await cp(join(root, 'apps/web/package.json'), join(bundle, 'apps/web/package.json'))
  await cp(join(root, 'apps/web/dist'), join(bundle, 'apps/web/dist'), { recursive: true })
  // Fresh production-only installation in staging; never copy development node_modules or data.
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--cache', '/tmp/vpsmonitor-npm-cache'], { cwd: bundle, stdio: 'inherit' })
  const lockHash = createHash('sha256').update(await readFile(join(bundle, 'package-lock.json'))).digest('hex')
  await writeFile(join(bundle, 'release-manifest.json'), JSON.stringify({
    name: manifest.name, version: manifest.version, platform: 'linux', arch: 'x64',
    nodeRequired: manifest.engines.node, buildNode: process.version, packageLockSha256: lockHash,
    builtLocally: true, includesProductionDependencies: true, includesFrontendBuild: true
  }, null, 2) + '\n')
  execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '-czf', join(output, filename), '-C', staging, bundleName], { stdio: 'inherit' })
  const digest = createHash('sha256').update(await readFile(join(output, filename))).digest('hex')
  await writeFile(join(output, 'SHA256SUMS'), `${digest}  ${filename}\n`)
  console.log(`本地发布包：${join(output, filename)}\nSHA256：${digest}`)
} finally { await rm(staging, { recursive: true, force: true }) }
