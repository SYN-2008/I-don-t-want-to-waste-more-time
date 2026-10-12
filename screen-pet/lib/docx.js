const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

function u16(n) {
  return [n & 0xff, (n >>> 8) & 0xff];
}

function u32(n) {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);

    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0x21),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0)
    ]);

    parts.push(local, name, data);

    central.push(
      new Uint8Array([
        0x50, 0x4b, 0x01, 0x02,
        ...u16(20),
        ...u16(20),
        ...u16(0x0800),
        ...u16(0),
        ...u16(0),
        ...u16(0x21),
        ...u32(crc),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(name.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset)
      ]),
      name
    );

    offset += local.length + name.length + data.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(cdSize),
    ...u32(offset),
    ...u16(0)
  ]);

  const all = [...parts, ...central, eocd];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FONT = '等线';

function para(text, opts) {
  const o = opts || {};
  const sz = o.size || 21;
  const bold = o.bold ? '<w:b/><w:bCs/>' : '';
  const color = o.color ? '<w:color w:val="' + o.color + '"/>' : '';
  const jc = o.align ? '<w:jc w:val="' + o.align + '"/>' : '';
  const spacing =
    '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 80 : o.after) + '" w:line="300" w:lineRule="auto"/>';
  const rPr = '<w:rPr><w:rFonts w:ascii="' + FONT + '" w:eastAsia="' + FONT + '" w:hAnsi="' + FONT + '"/>' + bold + color + '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>';
  const runs = String(text == null ? '' : text)
    .split('\n')
    .map((line, i) => (i ? '<w:r>' + rPr + '<w:br/></w:r>' : '') + '<w:r>' + rPr + '<w:t xml:space="preserve">' + esc(line) + '</w:t></w:r>')
    .join('');
  return '<w:p><w:pPr>' + spacing + jc + rPr + '</w:pPr>' + runs + '</w:p>';
}

export function buildDocx(paragraphs) {
  const body = paragraphs
    .map((p) => {
      if (typeof p === 'string') return para(p, {});
      return para(p.text, p);
    })
    .join('');

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="' + FONT + '" w:eastAsia="' + FONT + '" w:hAnsi="' + FONT + '"/>' +
    '<w:sz w:val="21"/><w:szCs w:val="21"/>' +
    '</w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '</w:styles>';

  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
    { name: 'word/document.xml', data: enc.encode(documentXml) },
    { name: 'word/styles.xml', data: enc.encode(styles) }
  ]);
}

export function buildQuestionDoc({ docTitle, entries }) {
  const paragraphs = [];
  paragraphs.push({ text: docTitle, bold: true, size: 30, after: 60 });
  paragraphs.push({ text: '由「小眼 · 页面助手」自动整理', size: 18, color: '808080', after: 200 });

  entries.forEach((e, idx) => {
    paragraphs.push({
      text: idx + 1 + '. ' + (e.title || '未命名页面') + '　' + (e.when || ''),
      bold: true,
      size: 20,
      color: '0F6E56',
      before: idx ? 240 : 0,
      after: 80
    });
    if (e.url) paragraphs.push({ text: e.url, size: 16, color: '808080', after: 100 });
    paragraphs.push({ text: e.text || '', size: 21, after: e.answer ? 120 : 0 });
    if (e.answer) {
      paragraphs.push({ text: '答案', bold: true, size: 20, color: 'A32D2D', before: 0, after: 60 });
      paragraphs.push({ text: e.answer, size: 21, after: 0 });
    }
  });

  return buildDocx(paragraphs);
}
