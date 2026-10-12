/* ChordPath — native/fetch-deps.js
 * Fetches the source code the native audio host is built from, at fixed
 * versions, into native/deps/ (which is not kept in this repository):
 *
 *   - Steinberg's VST 3 SDK (the parts a host needs), to load plugins
 *   - RtAudio, to talk to sound cards through ASIO and WASAPI
 *
 * Needs git and a network connection, once. Run by `npm run build:native`.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEPS = path.join(__dirname, 'deps');
const SOURCES = [
  { dir: 'vst3sdk/pluginterfaces', url: 'https://github.com/steinbergmedia/vst3_pluginterfaces', tag: 'v3.8.1_build_84' },
  { dir: 'vst3sdk/base', url: 'https://github.com/steinbergmedia/vst3_base', tag: 'v3.8.1_build_84' },
  { dir: 'vst3sdk/public.sdk', url: 'https://github.com/steinbergmedia/vst3_public_sdk', tag: 'v3.8.1_build_84' },
  { dir: 'rtaudio', url: 'https://github.com/thestk/rtaudio', tag: '6.0.1' },
];

fs.mkdirSync(DEPS, { recursive: true });
for (const source of SOURCES) {
  const target = path.join(DEPS, source.dir);
  const marker = path.join(target, '.fetched-' + source.tag);
  if (fs.existsSync(marker)) { console.log('have ' + source.dir + ' ' + source.tag); continue; }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  console.log('fetching ' + source.dir + ' ' + source.tag);
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', source.tag, '-c', 'advice.detachedHead=false', source.url, target], { stdio: 'inherit' });
  fs.rmSync(path.join(target, '.git'), { recursive: true, force: true });
  fs.writeFileSync(marker, '');
}
console.log('native sources are in ' + DEPS);
