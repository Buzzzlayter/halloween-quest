"""Package the built site and all eight original illustrations for delivery."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent

with zipfile.ZipFile(root / 'halloween-site-8.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.write(root / 'publish/index.html', arcname='index.html')

with zipfile.ZipFile(root / 'halloween-images-8.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for source in sorted((root / 'artwork').glob('quest-*.png')):
        archive.write(source, arcname='originals/' + source.name)
    for source in sorted((root / 'dist/assets/images').glob('quest-*.webp')):
        archive.write(source, arcname='web/' + source.name)
    archive.write(root / 'artwork/prompts.json', arcname='prompts.json')

print('Packaged: halloween-site-8.zip, halloween-images-8.zip')
