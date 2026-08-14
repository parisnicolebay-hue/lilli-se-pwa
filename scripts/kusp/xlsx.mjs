/**
 * Minimal XLSX reader — no dependencies.
 *
 * An .xlsx file is a ZIP of XML. Node already ships everything needed to read
 * one (`zlib` inflates, and the central directory is a documented format), so
 * a spreadsheet parser here costs fifty lines instead of a dependency tree that
 * would then be running inside a health-adjacent build.
 *
 * Deliberately narrow: it reads cell VALUES from the first worksheet and
 * nothing else. No formulas are evaluated, no styles are interpreted, and no
 * external references are followed — the file comes from TLV, but it is still
 * an untrusted binary, and a parser that cannot execute anything cannot be made
 * to execute anything.
 */

import zlib from 'node:zlib';

/** Read a ZIP archive into { name: Buffer } using the central directory. */
export function unzip(buffer) {
  const files = {};
  // End of central directory: signature 0x06054b50, scanned from the back
  // because it is followed by a variable-length comment.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not_a_zip');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let n = 0; n < entryCount; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip_central_dir_corrupt');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    // The local header repeats the name and extra fields with its own lengths.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) files[name] = Buffer.from(raw);
    else if (method === 8) files[name] = zlib.inflateRawSync(raw);
    else throw new Error('zip_unsupported_compression:' + method);

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const decodeEntities = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/**
 * Read the first worksheet as an array of row arrays.
 *
 * Column letters are honoured, so a blank cell leaves a hole rather than
 * shifting every value after it one column to the left — the failure mode that
 * would silently pair a price with the wrong åtgärd.
 */
export function readSheet(files, sheetPath = 'xl/worksheets/sheet1.xml') {
  const sharedXml = files['xl/sharedStrings.xml']
    ? files['xl/sharedStrings.xml'].toString('utf8') : '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));

  const sheetXml = files[sheetPath];
  if (!sheetXml) throw new Error('xlsx_missing_sheet:' + sheetPath);
  const xml = sheetXml.toString('utf8');

  const columnIndex = (ref) => {
    const letters = /^([A-Z]+)/.exec(ref);
    if (!letters) return 0;
    let n = 0;
    for (const ch of letters[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] || '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs);
      const at = ref ? columnIndex(ref[1]) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs);
      let value = '';
      if (type && type[1] === 'inlineStr') {
        value = decodeEntities([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (v) {
          value = type && type[1] === 's' ? (shared[Number(v[1])] ?? '') : decodeEntities(v[1]);
        }
      }
      while (cells.length < at) cells.push('');
      cells[at] = String(value).trim();
    }
    rows.push(cells);
  }
  return rows;
}
