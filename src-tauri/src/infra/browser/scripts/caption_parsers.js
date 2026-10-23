// Caption files as a page downloads them, turned into the [startSeconds, text] lines that
// questions at the cursor read (browser/page_tools/media_tools/session.rs). Concatenated in front of
// captions.js inside one function, so nothing here becomes a page global.
const mistyCaptions = (() => {
  const MAX_CUES = 20000;
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };
  const clean = (text) =>
    String(text || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
        if (name[0] !== '#') return entities[name.toLowerCase()] ?? whole;
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      })
      .replace(/\s+/g, ' ')
      .trim();
  const finish = (cues) => {
    const seen = new Set();
    return cues
      .filter((cue) => Number.isFinite(cue[0]) && cue[0] >= 0 && cue[1])
      .filter((cue) => {
        const key = cue[0].toFixed(2) + '|' + cue[1];
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a[0] - b[0])
      .slice(0, MAX_CUES);
  };

  // 01:02:03.456, 02:03.456 or 01:02:03,456 (SRT).
  const clock = (value) => {
    const match = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/.exec(String(value || ''));
    if (!match) return NaN;
    const fraction = match[4] ? Number(match[4].padEnd(3, '0')) / 1000 : 0;
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + fraction;
  };

  // WebVTT and SRT share a shape: blocks split by blank lines, a "start --> end" line, then text.
  const blocks = (text) => {
    const cues = [];
    const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    let start = NaN;
    let said = [];
    const flush = () => {
      if (Number.isFinite(start)) cues.push([start, clean(said.join(' '))]);
      start = NaN;
      said = [];
    };
    for (const line of lines) {
      if (line.includes('-->')) {
        flush();
        start = clock(line.split('-->')[0]);
      } else if (!line.trim()) {
        flush();
      } else if (Number.isFinite(start)) {
        said.push(line);
      }
    }
    flush();
    return finish(cues);
  };

  // TTML and DFXP (Kaltura, Panopto), and YouTube's srv3 XML.
  const xml = (text) => {
    if (typeof DOMParser !== 'function') return [];
    const doc = new DOMParser().parseFromString(String(text || ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return [];
    const root = doc.documentElement;
    const tickRate = Number(root && (root.getAttribute('ttp:tickRate') || root.getAttribute('tickRate'))) || 10000000;
    const frameRate = Number(root && (root.getAttribute('ttp:frameRate') || root.getAttribute('frameRate'))) || 30;
    const offset = (value) => {
      const match = /^\s*([\d.]+)(h|m|s|ms|f|t)\s*$/.exec(String(value || ''));
      if (!match) {
        // hh:mm:ss:ff is a frame count after the seconds.
        const frames = /^\s*(\d+):(\d{2}):(\d{2}):(\d+)\s*$/.exec(String(value || ''));
        if (frames) return Number(frames[1]) * 3600 + Number(frames[2]) * 60 + Number(frames[3]) + Number(frames[4]) / frameRate;
        return clock(value);
      }
      const number = Number(match[1]);
      return { h: number * 3600, m: number * 60, s: number, ms: number / 1000, f: number / frameRate, t: number / tickRate }[match[2]];
    };
    const cues = [];
    for (const p of Array.from(doc.getElementsByTagName('*')).filter((node) => node.localName === 'p')) {
      const begin = p.getAttribute('begin');
      const ms = p.getAttribute('t');
      const start = begin != null ? offset(begin) : ms != null ? Number(ms) / 1000 : NaN;
      const parts = [];
      const walk = (node) => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) parts.push(child.nodeValue);
          else if (child.localName === 'br') parts.push(' ');
          else walk(child);
        }
      };
      walk(p);
      cues.push([start, clean(parts.join(''))]);
    }
    return finish(cues);
  };

  // YouTube's json3, and caption lists other players serve as JSON (Panopto's
  // {Caption, Time}, {start, text} transcripts): the longest list of timed text found.
  const startFields = [
    ['tStartMs', 1000], ['startMs', 1000], ['startTimeMs', 1000], ['offsetMs', 1000], ['start_ms', 1000],
    ['start', 1], ['startTime', 1], ['StartTime', 1], ['start_time', 1], ['begin', 1], ['Time', 1],
    ['time', 1], ['offset', 1], ['from', 1],
  ];
  const textFields = ['text', 'Text', 'caption', 'Caption', 'content', 'Content', 'line', 'transcript', 'utf8'];
  const cueOf = (item) => {
    if (!item || typeof item !== 'object') return null;
    const field = startFields.find(([name]) => item[name] != null && item[name] !== '');
    if (!field) return null;
    const raw = item[field[0]];
    const start = typeof raw === 'number' ? raw / field[1] : /:/.test(String(raw)) ? clock(raw) : Number(raw) / field[1];
    let said = '';
    if (Array.isArray(item.segs)) said = item.segs.map((seg) => (seg && seg.utf8) || '').join('');
    else {
      const name = textFields.find((key) => typeof item[key] === 'string');
      if (name) said = item[name];
    }
    return Number.isFinite(start) && said ? [start, clean(said)] : null;
  };
  const json = (value) => {
    let best = [];
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) {
        const cues = node.slice(0, MAX_CUES * 2).map(cueOf).filter(Boolean);
        if (cues.length > best.length && cues.length >= Math.min(node.length, 2) * 0.5) best = cues;
        node.slice(0, 50).forEach((child) => visit(child, depth + 1));
        return;
      }
      Object.keys(node).slice(0, 100).forEach((key) => visit(node[key], depth + 1));
    };
    visit(value, 0);
    // Some players wrap a whole SRT or WebVTT file in a JSON field ({"caption": {"data": "1\n00:00…"}}).
    if (!best.length) {
      const wrapped = (node, depth) => {
        if (typeof node === 'string') {
          if (node.includes('-->')) {
            const cues = blocks(node);
            if (cues.length > best.length) best = cues;
          }
          return;
        }
        if (!node || typeof node !== 'object' || depth > 6) return;
        (Array.isArray(node) ? node.slice(0, 50) : Object.values(node).slice(0, 100))
          .forEach((child) => wrapped(child, depth + 1));
      };
      wrapped(value, 0);
    }
    return finish(best);
  };

  // Panopto's viewer posts getCaptions=true to DeliveryInfo.aspx and gets a list of
  // {Caption, Time, CaptionDuration} rows. The same address also answers with the session,
  // whose Timestamps are slide and chapter titles. Only rows that are captions (no
  // EventTargetType, a CaptionDuration) are read, so a slide title never passes for speech.
  const panoptoAddress = (url) => /\/Pages\/Viewer\/DeliveryInfo\.aspx$/i.test(String(url || '').split(/[?#]/)[0]);
  const panopto = (body) => {
    let rows = body;
    if (typeof rows === 'string') {
      try { rows = JSON.parse(rows); } catch (_) { return []; }
    }
    if (rows && !Array.isArray(rows)) rows = rows.Delivery && rows.Delivery.Timestamps;
    if (!Array.isArray(rows)) return [];
    return finish(rows
      .slice(0, MAX_CUES * 2)
      .filter((row) => row && row.EventTargetType == null && typeof row.CaptionDuration === 'number' && typeof row.Caption === 'string')
      .map((row) => [Number(row.Time), clean(row.Caption)]));
  };
  // Kaltura's players (PlayKit, KAF) ask its API for the caption asset as JSON for their
  // transcript and search, before CC is on: caption_captionasset.serveAsJson, usually inside a
  // multirequest, answers {objects: [{startTime, endTime, content: [{text}]}]} in milliseconds.
  // The multirequest address also answers everything else the player asks; only that shape is read.
  const kalturaAddress = (url) =>
    /\/api_v3\/(?:index\.php\/)?service\/(?:multirequest|caption_captionasset\/action\/serveAsJson)/i.test(String(url || '').split(/[?#]/)[0]);
  const kaltura = (body) => {
    let value = body;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { return []; }
    }
    const cues = [];
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 3) return;
      if (Array.isArray(node.objects)) {
        for (const item of node.objects.slice(0, MAX_CUES * 2)) {
          if (!item || typeof item.startTime !== 'number' || !Array.isArray(item.content)) continue;
          cues.push([item.startTime / 1000, clean(item.content.map((part) => (part && part.text) || '').join(' '))]);
        }
      }
      (Array.isArray(node) ? node.slice(0, 20) : Object.values(node).slice(0, 20)).forEach((child) => visit(child, depth + 1));
    };
    visit(value, 0);
    return finish(cues);
  };

  // A response that holds a whole caption track, which replaces what came before from that
  // address instead of adding to it (another language replaces the first).
  const whole = (url) => panoptoAddress(url) || kalturaAddress(url);

  // Whatever format a response turned out to be; nothing when it is not captions.
  const parse = (body, url) => {
    if (panoptoAddress(url)) return panopto(body);
    if (kalturaAddress(url)) return kaltura(body);
    if (body && typeof body === 'object') return json(body);
    const text = String(body || '').replace(/^﻿/, '').trim();
    if (!text) return [];
    if (/^WEBVTT/.test(text)) return blocks(text);
    if (text[0] === '{' || text[0] === '[') {
      try { return json(JSON.parse(text)); } catch (_) { return []; }
    }
    if (text[0] === '<') return xml(text);
    if (text.includes('-->')) return blocks(text);
    return [];
  };

  // What looks like a caption download, by address or by type. Nothing else is read.
  const looksLikeCaptions = (url, type) =>
    panoptoAddress(url) ||
    kalturaAddress(url) ||
    /text\/vtt|x-subrip|ttml|dfxp/i.test(String(type || '')) ||
    /caption|subtitle|timedtext|transcript|texttrack|\.vtt(\?|$)|\.srt(\?|$)|\.dfxp(\?|$)|\.ttml(\?|$)/i.test(
      String(url || '').split('#')[0]
    );

  const merge = (older, newer) => finish(older.concat(newer));

  return { MAX_CUES, clean, clock, merge, whole, vtt: blocks, srt: blocks, xml, json, panopto, kaltura, parse, looksLikeCaptions };
})();
