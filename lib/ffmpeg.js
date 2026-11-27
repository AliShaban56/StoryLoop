import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);

export async function audioDuration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ]);
  return parseFloat(stdout);
}

// يدمج مقطع الفيديو مع التعليق الصوتي: 1080x1920، طول المشهد = طول الصوت + فاصل صغير.
// لو الفيديو أقصر من الصوت بيثبّت آخر فريم، ولو أطول بيقصّه.
export async function muxScene(clip, audio, out, { padSec = 0.4 } = {}) {
  const dur = (await audioDuration(audio)) + padSec;
  await run('ffmpeg', [
    '-y', '-i', clip, '-i', audio,
    '-filter_complex',
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=60[v];' +
      `[1:a]apad=pad_dur=${padSec},aresample=44100[a]`,
    '-map', '[v]', '-map', '[a]', '-t', dur.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart',
    out,
  ]);
  return dur;
}

// يجمّع المشاهد (نفس الترميز) في فيديو واحد
export async function concat(files, out) {
  const list = path.join(path.dirname(out), 'concat.txt');
  await fs.writeFile(list, files.map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n'));
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
}
