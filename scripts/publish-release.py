"""Upload verified local artifacts to GitHub Release; never trigger a workflow."""
import hashlib
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
tag = f'v{version}'
filename = f'vps-monitor-{version}-linux-x64.tar.gz'
archive = root / 'releases' / filename
verification = json.loads((root / 'releases/verification.json').read_text())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
if not verification['verified'] or verification['version'] != version or verification['sha256'] != digest:
    raise SystemExit('发布包验证不匹配，请先运行 node scripts/verify-release.mjs')
token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
if not token:
    raise SystemExit('缺少 GH_TOKEN：SSH 私钥仅用于 Git 推送，Release 上传需要仓库 Contents: write 的 API 凭据')
api = 'https://api.github.com/repos/DeraDream/vpsMonitor'


def request(method, url, body=None, content_type='application/json', allow_missing=False):
    if urlsplit(url).hostname not in ('api.github.com', 'uploads.github.com'):
        raise SystemExit('拒绝非 GitHub API 上传地址')
    if body is not None and not isinstance(body, bytes):
        body = json.dumps(body).encode()
    req = Request(url, data=body, method=method, headers={
        'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'VPSMonitor-local-release',
        'Content-Type': content_type,
    })
    try:
        with urlopen(req, timeout=120) as response:
            return json.load(response)
    except HTTPError as error:
        if allow_missing and error.code == 404:
            return None
        try:
            message = json.loads(error.read()).get('message', '请求失败')
        except Exception:
            message = '请求失败'
        raise SystemExit(f'GitHub API：HTTP {error.code}，{message}') from None


# The tag must already exist; do not create a release against an unverified branch.
request('GET', f'{api}/git/ref/tags/{quote(tag, safe="")}')
notes = (root / f'docs/RELEASE-{tag}.md').read_text()
release = request('GET', f'{api}/releases/tags/{quote(tag, safe="")}', allow_missing=True)
if release is None:
    release = request('POST', f'{api}/releases', {
        'tag_name': tag, 'name': f'VPS Monitor {tag}', 'body': notes,
        'draft': True, 'prerelease': False, 'generate_release_notes': False,
    })
assets = {asset['name']: asset for asset in request('GET', f'{api}/releases/{release["id"]}/assets?per_page=100')}
upload = release['upload_url'].split('{', 1)[0]
for name in (filename, 'SHA256SUMS'):
    data = (root / 'releases' / name).read_bytes()
    checksum = 'sha256:' + hashlib.sha256(data).hexdigest()
    if name in assets:
        if assets[name].get('digest') != checksum:
            raise SystemExit(f'远端已有同名但内容不同的附件 {name}，未覆盖')
        continue
    asset = request('POST', upload + '?name=' + quote(name), data,
                    'application/gzip' if name.endswith('.gz') else 'text/plain')
    if asset.get('digest') != checksum or asset.get('size') != len(data):
        raise SystemExit(f'{name} 上传验证失败，Release 保持草稿')
    assets[name] = asset
if release['draft']:
    release = request('PATCH', f'{api}/releases/{release["id"]}', {
        'draft': False, 'prerelease': False, 'make_latest': 'true', 'body': notes,
    })
result = {'url': release['html_url'], 'tag': tag,
          'assets': [{'name': name, 'url': assets[name]['browser_download_url']} for name in (filename, 'SHA256SUMS')]}
(root / 'releases/published.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
