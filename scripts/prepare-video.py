"""Prepare an MP4 and poster for one quest; keep the input unchanged.

Requires imageio-ffmpeg installed into .qr-tools.
Usage: python scripts/prepare-video.py INPUT.mp4 --task 8
"""
import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / '.qr-tools'))


def main():
    import imageio_ffmpeg
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--task', type=int, required=True)
    args = parser.parse_args()
    if args.task < 1 or not args.input.is_file():
        parser.error('Provide an existing video and a positive task ID')
    video = ROOT / f'dist/assets/videos/quest-{args.task:02d}.mp4'
    poster = ROOT / f'dist/assets/videos/quest-{args.task:02d}-poster.png'
    if video.exists() or poster.exists():
        parser.error('Output already exists; preserve it or choose a new task ID')
    video.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([
        ffmpeg, '-hide_banner', '-loglevel', 'warning', '-n', '-i', str(args.input),
        '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'medium',
        '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart', str(video)
    ], check=True)
    subprocess.run([
        ffmpeg, '-hide_banner', '-loglevel', 'error', '-n', '-i', str(video),
        '-frames:v', '1', str(poster)
    ], check=True)
    print(f'Prepared MP4: {video} ({video.stat().st_size / 1024 / 1024:.2f} MiB)')
    print(f'Poster frame: {poster}')


if __name__ == '__main__':
    main()
