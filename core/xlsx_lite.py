"""Минимальный писатель .xlsx без сторонних библиотек (zipfile + XML).

Повторяет небольшое подмножество API openpyxl, которого хватает выгрузкам трекера:
Workbook / active / create_sheet / ws.cell(row, column, value) / font, fill, border,
alignment / column_dimensions[...].width / row_dimensions[n].height / freeze_panes /
auto_filter.ref / wb.save(file).
Используется как запасной вариант, когда openpyxl не установлен.
"""
import re
import zipfile
from xml.sax.saxutils import escape as _esc

_BAD_XML = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f]')


def get_column_letter(n):
    s = ''
    while n > 0:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s


def _split_ref(ref):
    m = re.match(r'^([A-Z]+)(\d+)$', str(ref).upper())
    col = 0
    for ch in m.group(1):
        col = col * 26 + ord(ch) - 64
    return col, int(m.group(2))


def _argb(c):
    c = str(c or '').lstrip('#').upper()
    return ('FF' + c) if len(c) == 6 else c


class Side(object):
    def __init__(self, style=None, color=None, **kw):
        self.style, self.color = style, color

    def key(self):
        return (self.style, _argb(self.color)) if self.style else None


class Border(object):
    def __init__(self, left=None, right=None, top=None, bottom=None, **kw):
        self.left, self.right, self.top, self.bottom = left, right, top, bottom

    def key(self):
        return tuple(s.key() if s else None for s in (self.left, self.right, self.top, self.bottom))


class Font(object):
    def __init__(self, name=None, size=None, bold=False, italic=False, color=None, **kw):
        self.name, self.size, self.bold, self.italic, self.color = name, size, bold, italic, color

    def key(self):
        return (bool(self.bold), bool(self.italic), _argb(self.color) if self.color else None,
                self.size or 11, self.name or 'Calibri')


class PatternFill(object):
    def __init__(self, fill_type=None, fgColor=None, start_color=None, patternType=None, **kw):
        self.fill_type = fill_type or patternType
        self.fgColor = fgColor or start_color

    def key(self):
        return (self.fill_type, _argb(self.fgColor)) if self.fill_type else None


class Alignment(object):
    def __init__(self, horizontal=None, vertical=None, wrap_text=None, **kw):
        self.horizontal, self.vertical, self.wrap_text = horizontal, vertical, wrap_text

    def key(self):
        return (self.horizontal, self.vertical, bool(self.wrap_text))


class _Cell(object):
    __slots__ = ('value', 'font', 'fill', 'border', 'alignment')

    def __init__(self):
        self.value = self.font = self.fill = self.border = self.alignment = None


class _Dim(object):
    def __init__(self):
        self.width = None
        self.height = None


class _Dims(dict):
    def __missing__(self, k):
        d = self[k] = _Dim()
        return d


class _AutoFilter(object):
    def __init__(self):
        self.ref = None


class Worksheet(object):
    def __init__(self, title):
        self.title = title
        self._cells = {}
        self.column_dimensions = _Dims()
        self.row_dimensions = _Dims()
        self.freeze_panes = None
        self.auto_filter = _AutoFilter()

    def cell(self, row, column, value=None):
        c = self._cells.get((row, column))
        if c is None:
            c = self._cells[(row, column)] = _Cell()
        if value is not None:
            c.value = value
        return c

    def append(self, values):
        r = max([k[0] for k in self._cells] or [0]) + 1
        for i, v in enumerate(values, 1):
            self.cell(row=r, column=i, value=v)


class Workbook(object):
    def __init__(self):
        self.worksheets = [Worksheet('Sheet')]

    @property
    def active(self):
        return self.worksheets[0]

    def create_sheet(self, title=None):
        ws = Worksheet(title or 'Sheet%d' % (len(self.worksheets) + 1))
        self.worksheets.append(ws)
        return ws

    # ---------- запись ----------
    def save(self, fp):
        fonts = [Font().key()]
        fills = [None, ('gray125', None)]
        borders = [(None, None, None, None)]
        xfs = [(0, 0, 0, None)]

        def idx(lst, k):
            if k not in lst:
                lst.append(k)
            return lst.index(k)

        def style(c):
            f = idx(fonts, c.font.key()) if c.font else 0
            fl = idx(fills, c.fill.key()) if c.fill and c.fill.key() else 0
            b = idx(borders, c.border.key()) if c.border else 0
            a = c.alignment.key() if c.alignment else None
            return idx(xfs, (f, fl, b, a))

        names, sheets_xml = [], []
        for ws in self.worksheets:
            nm = ''.join(ch for ch in str(ws.title) if ch not in '[]:*?/\\')[:31] or 'Лист'
            while nm in names:
                nm = nm[:28] + '_' + str(len(names))
            names.append(nm)
            out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">']
            if ws.freeze_panes:
                fc, fr = _split_ref(ws.freeze_panes)
                xs, ys = fc - 1, fr - 1
                pane = 'bottomRight' if xs and ys else ('bottomLeft' if ys else 'topRight')
                out.append('<sheetViews><sheetView workbookViewId="0"><pane%s%s topLeftCell="%s" '
                           'activePane="%s" state="frozen"/></sheetView></sheetViews>' % (
                               ' xSplit="%d"' % xs if xs else '', ' ySplit="%d"' % ys if ys else '',
                               get_column_letter(fc) + str(fr), pane))
            else:
                out.append('<sheetViews><sheetView workbookViewId="0"/></sheetViews>')
            out.append('<sheetFormatPr defaultRowHeight="15"/>')
            cols = []
            for k, d in ws.column_dimensions.items():
                if d.width:
                    ci = _split_ref(str(k) + '1')[0] if not isinstance(k, int) else k
                    cols.append((ci, d.width))
            if cols:
                out.append('<cols>' + ''.join('<col min="%d" max="%d" width="%s" customWidth="1"/>' % (c, c, w)
                                              for c, w in sorted(cols)) + '</cols>')
            out.append('<sheetData>')
            rows = {}
            for (r, c), cell in ws._cells.items():
                rows.setdefault(r, []).append((c, cell))
            heights = {int(k): d.height for k, d in ws.row_dimensions.items() if d.height}
            for r in sorted(set(rows) | set(heights)):
                ht = ' ht="%s" customHeight="1"' % heights[r] if r in heights else ''
                out.append('<row r="%d"%s>' % (r, ht))
                for c, cell in sorted(rows.get(r, []), key=lambda x: x[0]):
                    ref = get_column_letter(c) + str(r)
                    s = style(cell)
                    sa = ' s="%d"' % s if s else ''
                    v = cell.value
                    if v is None or v == '':
                        out.append('<c r="%s"%s/>' % (ref, sa))
                    elif isinstance(v, bool):
                        out.append('<c r="%s"%s t="b"><v>%d</v></c>' % (ref, sa, 1 if v else 0))
                    elif isinstance(v, (int, float)):
                        out.append('<c r="%s"%s><v>%s</v></c>' % (ref, sa, repr(v) if isinstance(v, float) else v))
                    else:
                        t = _esc(_BAD_XML.sub('', str(v)))
                        out.append('<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, sa, t))
                out.append('</row>')
            out.append('</sheetData>')
            if ws.auto_filter.ref:
                out.append('<autoFilter ref="%s"/>' % _esc(ws.auto_filter.ref))
            out.append('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>')
            sheets_xml.append(''.join(out))

        # styles.xml
        st = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">']
        st.append('<fonts count="%d">' % len(fonts))
        for b, i, col, sz, nm in fonts:
            st.append('<font>%s%s<sz val="%s"/>%s<name val="%s"/></font>' % (
                '<b/>' if b else '', '<i/>' if i else '', sz, '<color rgb="%s"/>' % col if col else '', _esc(nm)))
        st.append('</fonts><fills count="%d">' % len(fills))
        for f in fills:
            if f is None:
                st.append('<fill><patternFill patternType="none"/></fill>')
            elif f[1]:
                st.append('<fill><patternFill patternType="%s"><fgColor rgb="%s"/><bgColor indexed="64"/></patternFill></fill>' % f)
            else:
                st.append('<fill><patternFill patternType="%s"/></fill>' % f[0])
        st.append('</fills><borders count="%d">' % len(borders))
        for bk in borders:
            parts = []
            for tag, sd in zip(('left', 'right', 'top', 'bottom'), bk):
                if sd:
                    parts.append('<%s style="%s">%s</%s>' % (tag, sd[0], '<color rgb="%s"/>' % sd[1] if sd[1] else '', tag))
                else:
                    parts.append('<%s/>' % tag)
            st.append('<border>' + ''.join(parts) + '<diagonal/></border>')
        st.append('</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>')
        st.append('<cellXfs count="%d">' % len(xfs))
        for f, fl, b, a in xfs:
            attrs = ' applyFont="1"' if f else ''
            attrs += ' applyFill="1"' if fl else ''
            attrs += ' applyBorder="1"' if b else ''
            if a:
                h, v, w = a
                al = '<alignment%s%s%s/>' % (' horizontal="%s"' % h if h else '', ' vertical="%s"' % v if v else '',
                                             ' wrapText="1"' if w else '')
                st.append('<xf numFmtId="0" fontId="%d" fillId="%d" borderId="%d" xfId="0"%s applyAlignment="1">%s</xf>'
                          % (f, fl, b, attrs, al))
            else:
                st.append('<xf numFmtId="0" fontId="%d" fillId="%d" borderId="%d" xfId="0"%s/>' % (f, fl, b, attrs))
        st.append('</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')

        def qname(n):
            return "'" + n.replace("'", "''") + "'"

        defined = []
        for i, ws in enumerate(self.worksheets):
            if ws.auto_filter.ref and ':' in ws.auto_filter.ref:
                a, b = ws.auto_filter.ref.split(':')
                ca, ra = _split_ref(a)
                cb, rb = _split_ref(b)
                defined.append('<definedName name="_xlnm._FilterDatabase" localSheetId="%d" hidden="1">%s!$%s$%d:$%s$%d</definedName>'
                               % (i, _esc(qname(names[i])), get_column_letter(ca), ra, get_column_letter(cb), rb))
        n = len(self.worksheets)
        own = not hasattr(fp, 'write')
        z = zipfile.ZipFile(fp, 'w', zipfile.ZIP_DEFLATED)
        try:
            z.writestr('[Content_Types].xml',
                       '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                       '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                       '<Default Extension="xml" ContentType="application/xml"/>'
                       '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                       '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                       + ''.join('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1) for i in range(n))
                       + '</Types>')
            z.writestr('_rels/.rels',
                       '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                       '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
            z.writestr('xl/workbook.xml',
                       '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                       'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>'
                       + ''.join('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (_esc(names[i], {'"': '&quot;'}), i + 1, i + 1) for i in range(n))
                       + '</sheets>' + ('<definedNames>' + ''.join(defined) + '</definedNames>' if defined else '') + '</workbook>')
            z.writestr('xl/_rels/workbook.xml.rels',
                       '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                       + ''.join('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1) for i in range(n))
                       + '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' % (n + 1))
            z.writestr('xl/styles.xml', ''.join(st))
            for i, x in enumerate(sheets_xml):
                z.writestr('xl/worksheets/sheet%d.xml' % (i + 1), x)
        finally:
            z.close()
