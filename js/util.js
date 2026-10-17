/* DayZ Studio - utilities: ids, math, DOM helper, file download, ZIP writer */
(function () {
  const DS = (window.DS = window.DS || {});
  const U = (DS.util = {});

  U.uid = (p) => (p || 'id') + '_' + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3);
  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.num = (v, d) => {
    const n = parseFloat(v);
    return isFinite(n) ? n : d === undefined ? 0 : d;
  };
  U.round = (v, d) => {
    const m = Math.pow(10, d === undefined ? 2 : d);
    return Math.round(v * m) / m;
  };
  U.wrap360 = (a) => ((a % 360) + 360) % 360;
  U.deg2rad = (d) => (d * Math.PI) / 180;
  U.dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

  /** XML attribute / text escaping */
  U.xml = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /** Enforce Script string literal escaping */
  U.enf = (s) =>
    String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
  /** number formatting for generated code (always has a dot, no exponent) */
  U.f = (n, d) => {
    const v = U.round(n, d === undefined ? 3 : d);
    let s = v.toFixed(d === undefined ? 3 : d).replace(/(\.\d*?)0+$/, '$1');
    if (s.endsWith('.')) s += '0';
    return s;
  };
  U.safeName = (s) => String(s || 'untitled').replace(/[^A-Za-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled';
  U.pretty = (cls) =>
    String(cls)
      .replace(/^Land_/, '')
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z0-9])/g, '$1 $2');

  /** tiny DOM builder: el('div', {class:'x', onclick:fn}, child, ...) */
  U.el = function (tag, props) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'value') e.value = v;
        else if (k === 'checked') e.checked = !!v;
        else if (k === 'selected') e.selected = !!v;
        else if (k === 'disabled') e.disabled = !!v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const kids = [].concat(arguments[i]);
      for (const c of kids) {
        if (c == null || c === false) continue;
        e.append(c.nodeType ? c : document.createTextNode(String(c)));
      }
    }
    return e;
  };

  U.download = function (filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  };

  U.readFile = (file, as) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      if (as === 'dataurl') r.readAsDataURL(file);
      else r.readAsText(file);
    });

  U.pickFile = function (accept) {
    return new Promise((res) => {
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = accept || '';
      i.onchange = () => res(i.files && i.files[0] ? i.files[0] : null);
      i.click();
    });
  };

  U.debounce = (fn, ms) => {
    let t;
    return function () {
      clearTimeout(t);
      const a = arguments;
      t = setTimeout(() => fn.apply(null, a), ms);
    };
  };

  // ---- CRC32 + store-only ZIP ------------------------------------------------
  const crcTable = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  U.crc32 = function (u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  U.utf8 = (s) => new TextEncoder().encode(s);

  /** files: [{path, data: string|Uint8Array}] -> Blob (application/zip) */
  U.zip = function (files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = U.utf8(f.path);
      const data = typeof f.data === 'string' ? U.utf8(f.data) : f.data;
      const crc = U.crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    let csize = 0;
    central.forEach((c) => (csize += c.length));
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true);
    end.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  };
})();
