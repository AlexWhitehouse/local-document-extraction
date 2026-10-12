// A minimal .xlsx writer: inline strings, numbers, dates, a bold frozen header row and a few
// number formats. Parts are stored uncompressed in the zip, which Excel accepts.

import { isNumber } from "../../../shared/json.ts";

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

const STYLE = { header: 1, usd: 2, datetime: 3, percent: 4, date: 5 };

// Excel counts days from 1899-12-30; JavaScript dates are milliseconds from 1970-01-01.
const EXCEL_EPOCH_DAYS = 25569;

/** A cell whose number format differs from its column's, such as a mixed summary column. */
export class Formatted {
  constructor(value, format) {
    this.value = value;
    this.format = format;
  }
}

const escapeXml = (text) =>
  String(text)
    // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these characters even when escaped.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function columnName(index) {
  let name = "";

  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;

  return name;
}

function cell(raw, ref, columnFormat) {
  const value = raw instanceof Formatted ? raw.value : raw;
  const format = raw instanceof Formatted ? raw.format : columnFormat;

  if (value === null || value === undefined || value === "") return "";

  const s = STYLE[format] ? ` s="${STYLE[format]}"` : "";

  if (value instanceof Date) {
    const serial = value.getTime() / 86400000 + EXCEL_EPOCH_DAYS;

    return Number.isFinite(serial) ? `<c r="${ref}"${s}><v>${serial}</v></c>` : "";
  }

  if (isNumber(value)) return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : "";

  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml({ columns, rows }) {
  const header = columns.map((column, index) => cell(column.header, `${columnName(index)}1`, "header")).join("");

  const body = rows
    .map((row, rowIndex) => {
      const r = rowIndex + 2;
      const cells = columns.map((column, index) => cell(row[index], `${columnName(index)}${r}`, column.format));

      return `<row r="${r}">${cells.join("")}</row>`;
    })
    .join("");

  const widths = columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 14}" customWidth="1"/>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}"><numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00####"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const sheetName = (name) => name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";

function parts(sheets) {
  const numbered = sheets.map((sheet, index) => ({ ...sheet, id: index + 1 }));

  return [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${numbered
        .map(
          ({ id }) =>
            `<Override PartName="/xl/worksheets/sheet${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join(
          "",
        )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets>${numbered
        .map(({ id, name }) => `<sheet name="${escapeXml(sheetName(name))}" sheetId="${id}" r:id="rId${id}"/>`)
        .join("")}</sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}">${numbered
        .map(
          ({ id }) =>
            `<Relationship Id="rId${id}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${id}.xml"/>`,
        )
        .join("")}<Relationship Id="rId${numbered.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", STYLES],
    ...numbered.map((sheet) => [`xl/worksheets/sheet${sheet.id}.xml`, sheetXml(sheet)]),
  ];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;

  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;

  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);

  return (crc ^ 0xffffffff) >>> 0;
}

function header(size) {
  const bytes = new Uint8Array(size);

  return { bytes, view: new DataView(bytes.buffer) };
}

// Stored (method 0) zip entries dated 1980-01-01, which keeps the output deterministic.
function zip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(12, 33, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, nameBytes.length, true);
    chunks.push(local.bytes, nameBytes, data);

    const entry = header(46);
    entry.view.setUint32(0, 0x02014b50, true);
    entry.view.setUint16(4, 20, true);
    entry.view.setUint16(6, 20, true);
    entry.view.setUint16(14, 33, true);
    entry.view.setUint32(16, crc, true);
    entry.view.setUint32(20, data.length, true);
    entry.view.setUint32(24, data.length, true);
    entry.view.setUint16(28, nameBytes.length, true);
    entry.view.setUint32(42, offset, true);
    central.push(entry.bytes, nameBytes);
    offset += local.bytes.length + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);

  return [...chunks, ...central, end.bytes];
}

/**
 * Builds a workbook from `sheets` of `{ name, columns, rows }`. Columns are `{ header, width?, format? }`,
 * where format is "usd", "percent", "date" or "datetime". Rows are arrays of strings, numbers, Dates,
 * null (an empty cell) or `Formatted` cells.
 */
export function xlsxBlob(sheets) {
  return new Blob(zip(parts(sheets)), { type: MIME });
}
