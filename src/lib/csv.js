// CSV export helper. Builds a UTF-8 CSV (with BOM so Excel shows Persian
// correctly) from an array of rows and triggers a browser download.
//
// Delimiter is a SEMICOLON (';'). In locales where Excel uses a comma as the
// decimal separator (common with Persian/European regional settings), Excel
// expects ';' as the CSV field separator — using ',' dumps every row into one
// cell. ';' + the UTF-8 BOM makes Excel split the columns correctly.

const DELIMITER = ';'

function escapeCell(value) {
  const s = value == null ? '' : String(value)
  // Quote if the cell contains the delimiter, a quote, or a newline.
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * @param {string} filename  e.g. 'history.csv'
 * @param {string[]} headers column titles
 * @param {Array<Array>} rows array of row arrays (same order as headers)
 */
export function downloadCsv(filename, headers, rows) {
  const lines = [headers.map(escapeCell).join(DELIMITER)]
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(DELIMITER))
  }
  // ﻿ BOM makes Excel detect UTF-8 (Persian text renders correctly).
  const csv = '﻿' + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
