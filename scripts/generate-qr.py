"""Generate PNG/SVG QR codes and a printable A4 HTML sheet.

Run: python scripts/generate-qr.py https://your-site.workers.dev
Requires: python -m pip install --target .qr-tools qrcode zxing-cpp
"""

from pathlib import Path
import html
import json
import sys
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / ".qr-tools"))

import qrcode
import qrcode.image.svg
from PIL import Image
import zxingcpp


def main():
    base_url = sys.argv[1].rstrip("/")
    parts = urlsplit(base_url)
    if parts.scheme != "https" or not parts.netloc or parts.query or parts.fragment:
        raise SystemExit("Specify a valid HTTPS site URL without query or fragment")
    # tasks.js is JavaScript; use Node to read the actual shared source of truth.
    import subprocess
    result = subprocess.run(
        ["node", "-e", "const fs=require('fs'),vm=require('vm');const ctx={window:{}};vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),ctx);console.log(JSON.stringify(ctx.window.HALLOWEEN_TASKS));", str(ROOT / "dist/assets/tasks.js")],
        check=True, capture_output=True, text=True, encoding="utf-8"
    )
    tasks = json.loads(result.stdout)
    output = ROOT / f"qr-codes-{len(tasks)}"
    output.mkdir(exist_ok=True)
    cards = []
    links = []
    for task in tasks:
        task_id = task["id"]
        url = f"{base_url}/?id={task_id}"
        stem = f"task-{task_id:02d}"
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=24, border=4)
        qr.add_data(url)
        qr.make(fit=True)
        png = output / f"{stem}.png"
        qr.make_image(fill_color="black", back_color="white").save(png)
        qr.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(output / f"{stem}.svg")
        with Image.open(png) as image:
            decoded = zxingcpp.read_barcode(image)
            if decoded is None or decoded.text != url:
                raise RuntimeError(f"QR verification failed: {stem}")
        cards.append(f'<article><h2>Задание {task_id:02d}</h2><img src="{stem}.png" alt="QR-код задания {task_id}"><p>{html.escape(url)}</p></article>')
        links.append({"id": task_id, "url": url, "png": f"{stem}.png", "svg": f"{stem}.svg"})
        print(f"Verified {stem}: {url}")
    document = '''<!doctype html><html lang="ru"><meta charset="utf-8"><title>QR-коды — печать</title>
<style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#eee;font-family:Arial,sans-serif;color:#000}.sheet{max-width:186mm;margin:15px auto;background:#fff;display:grid;grid-template-columns:repeat(2,1fr);gap:6mm;break-after:page}.sheet:last-child{break-after:auto}article{border:1px dashed #aaa;text-align:center;padding:5mm;break-inside:avoid}h2{font-size:18px;margin:0 0 3mm}img{width:54mm;height:54mm;display:block;margin:auto}p{font-size:10px;overflow-wrap:anywhere;margin:3mm 0 0;line-height:1.4}.toolbar{text-align:center;padding:15px}button{padding:10px 20px;font:inherit;cursor:pointer}@media print{body{background:white}.sheet{margin:0}.toolbar{display:none}}</style>
<div class="toolbar"><button onclick="window.print()">Печать QR-кодов</button></div>'''
    sheets = ['<main class="sheet">' + ''.join(cards[start:start + 4]) + '</main>' for start in range(0, len(cards), 4)]
    (output / "print.html").write_text(document + "".join(sheets), encoding="utf-8")
    (output / "links.json").write_text(json.dumps(links, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "README.txt").write_text("QR-коды содержат постоянные ссылки на задания. Перед печатью загрузите publish/index.html в Cloudflare и проверьте открытие ссылок на телефоне.\n\nPNG — для печати, SVG — векторный формат. Для общего листа A4 откройте print.html и нажмите кнопку печати. Печатайте без изменения пропорций, сохраняя белые поля вокруг кодов.\n", encoding="utf-8")
    with zipfile.ZipFile(ROOT / f"halloween-qr-codes-{len(tasks)}.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(output.iterdir()):
            if file.is_file():
                archive.write(file, arcname=file.name)


if __name__ == "__main__":
    main()
