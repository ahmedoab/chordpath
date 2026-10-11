/* ChordPath — desktop/lookup.js
 * The one way ChordPath ever goes online: when the user asks Muse to look a
 * song up, the shell fetches it from Wikipedia. This file decides what may
 * be asked and what comes back; it has no network code of its own, so it can
 * be tested without one. main.js does the fetching.
 *
 * The page never supplies an address. It gives a kind of question and a few
 * words, and the address is built here, always on the one host below.
 */
'use strict';

const HOST = 'en.wikipedia.org';
const API = 'https://' + HOST + '/w/api.php';
const LIMITS = { words: 200, results: 6, snippet: 400, text: 400000, title: 255 };

// The words of a question: plain text, one line, not too long. Null if unusable.
function clean(text) {
  if (typeof text !== 'string') return null;
  const tidy = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return tidy && tidy.length <= LIMITS.words ? tidy : null;
}

// The address for a question. kind: 'search' (find articles) or 'page' (read one).
function buildUrl(kind, text) {
  const words = clean(text);
  if (!words) return null;
  const params = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', utf8: '1' });
  if (kind === 'search') {
    params.set('list', 'search');
    params.set('srsearch', words);
    params.set('srlimit', String(LIMITS.results));
    params.set('srprop', 'snippet');
  } else if (kind === 'page') {
    params.set('prop', 'extracts|info');
    params.set('explaintext', '1');
    params.set('exsectionformat', 'wiki');
    params.set('redirects', '1');
    params.set('inprop', 'url');
    params.set('titles', words);
  } else {
    return null;
  }
  return API + '?' + params.toString();
}

// Whether the shell may request this address at all.
function allowed(url) {
  let parsed;
  try { parsed = new URL(url); } catch (e) { return false; }
  return parsed.protocol === 'https:' && parsed.host === HOST && !parsed.username && !parsed.password;
}

function plain(html, max) {
  return String(html == null ? '' : html)
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ')
    .slice(0, max);
}

// Turns what Wikipedia sent into the little the app needs, as plain text.
// search → [{ title, snippet }]; page → { title, url, text } or null if there is no such article.
function parse(kind, body) {
  const query = body && typeof body === 'object' && body.query && typeof body.query === 'object' ? body.query : {};
  if (kind === 'search') {
    return (Array.isArray(query.search) ? query.search : []).slice(0, LIMITS.results)
      .filter(hit => hit && typeof hit.title === 'string' && hit.title)
      .map(hit => ({ title: plain(hit.title, LIMITS.title), snippet: plain(hit.snippet, LIMITS.snippet).replace(/\s+/g, ' ').trim() }));
  }
  if (kind === 'page') {
    const page = (Array.isArray(query.pages) ? query.pages : [])[0];
    if (!page || page.missing || typeof page.title !== 'string' || typeof page.extract !== 'string' || !page.extract.trim()) return null;
    const title = plain(page.title, LIMITS.title);
    const url = typeof page.fullurl === 'string' && allowed(page.fullurl) ? page.fullurl
      : 'https://' + HOST + '/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
    return { title, url, text: plain(page.extract, LIMITS.text) };
  }
  return null;
}

module.exports = { HOST, LIMITS, clean, buildUrl, allowed, parse };
