"""Package a deployable Worker project (not a static-upload ZIP) and illustrations."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
package['scripts'] = {'deploy': 'wrangler deploy', 'cloudflare:login': 'wrangler login --device'}
package['devDependencies'].pop('sharp', None)
with zipfile.ZipFile(root / 'halloween-site-8.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for source in sorted((root / 'publish').rglob('*')):
        if source.is_file():
            archive.write(source, arcname=source.relative_to(root).as_posix())
    for source in sorted((root / 'server').glob('*.mjs')):
        archive.write(source, arcname=source.relative_to(root).as_posix())
    for name in ['wrangler.jsonc', 'GAME-PLAN.md']:
        archive.write(root / name, arcname=name)
    archive.writestr('package.json', json.dumps(package, ensure_ascii=False, indent=2))
    archive.writestr('README.txt', 'Prebuilt Cloudflare Worker. Not a static drag-and-drop ZIP.\n'
                      'Run: npm.cmd install\nThen: npm.cmd run cloudflare:login\n'
                      'Then: npm.cmd run deploy\nDo not change the Worker name/domain.\n')

with zipfile.ZipFile(root / 'halloween-images-8.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for source in sorted((root / 'artwork').glob('quest-*.png')):
        archive.write(source, arcname='originals/' + source.name)
    for source in sorted((root / 'dist/assets/images').glob('quest-*.webp')):
        archive.write(source, arcname='web/' + source.name)
    archive.write(root / 'artwork/prompts.json', arcname='prompts.json')
print('Packaged deployable Worker and illustrations; no credentials included.')
