# Usage: python3 tools/extract_template.py slide1.xml templates/certificate.svg
# slide1.xml comes from unzipping your .pptx (ppt/slides/slide1.xml).
# Re-run this only if the PowerPoint design changes.
import sys, html
from lxml import etree

SLIDE = sys.argv[1]
OUT = sys.argv[2]
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ns = {'a': A, 'p': P, 'r': R}
W, H = 10693400, 7556500

tree = etree.parse(SLIDE)
root = tree.getroot()
spTree = root.find('.//p:cSld/p:spTree', ns)

# Transform: X = tx + sx*x, Y = ty + sy*y
IDENT = (1.0, 1.0, 0.0, 0.0)

def compose_group(T, grp):
    xfrm = grp.find('./p:grpSpPr/a:xfrm', ns)
    off = xfrm.find('a:off', ns); ext = xfrm.find('a:ext', ns)
    choff = xfrm.find('a:chOff', ns); chext = xfrm.find('a:chExt', ns)
    ox, oy = int(off.get('x')), int(off.get('y'))
    ex, ey = int(ext.get('cx')), int(ext.get('cy'))
    cx, cy = int(choff.get('x')), int(choff.get('y'))
    cex, cey = int(chext.get('cx')), int(chext.get('cy'))
    gx = ex / cex if cex else 1.0
    gy = ey / cey if cey else 1.0
    # child-space point c -> parent-space: ox + (c - cx)*gx
    sx, sy, tx, ty = T
    # parent-space -> slide: tx + sx*p
    nsx, nsy = sx * gx, sy * gy
    ntx = tx + sx * (ox - cx * gx)
    nty = ty + sy * (oy - cy * gy)
    return (nsx, nsy, ntx, nty)

def apply(T, x, y):
    sx, sy, tx, ty = T
    return (tx + sx * x, ty + sy * y)

def shape_xfrm(sp):
    xfrm = sp.find('./p:spPr/a:xfrm', ns)
    if xfrm is None:
        xfrm = sp.find('./p:grpSpPr/a:xfrm', ns)
    off = xfrm.find('a:off', ns); ext = xfrm.find('a:ext', ns)
    return int(off.get('x')), int(off.get('y')), int(ext.get('cx')), int(ext.get('cy'))

def color_of(sp, which):
    el = sp.find(f'./p:spPr/a:{which}/a:srgbClr', ns)
    return el.get('val') if el is not None else None

def freeform_d(sp, T):
    ox, oy, ex, ey = shape_xfrm(sp)
    d = []
    for path in sp.findall('./p:spPr/a:custGeom/a:pathLst/a:path', ns):
        pw = int(path.get('w') or ex) or 1
        ph = int(path.get('h') or ey) or 1
        def pt(el):
            px = int(el.get('x')); py = int(el.get('y'))
            lx = ox + px * ex / pw
            ly = oy + py * ey / ph
            X, Y = apply(T, lx, ly)
            return f'{X:.0f} {Y:.0f}'
        for cmd in path:
            tag = etree.QName(cmd).localname
            if tag == 'moveTo':
                d.append('M' + pt(cmd.find('a:pt', ns)))
            elif tag == 'lnTo':
                d.append('L' + pt(cmd.find('a:pt', ns)))
            elif tag == 'cubicBezTo':
                pts = cmd.findall('a:pt', ns)
                d.append('C' + ' '.join(pt(p) for p in pts))
            elif tag == 'close':
                d.append('Z')
    return ' '.join(d)

out = []
def emit_shape(sp, T):
    global BAR_CENTER
    name = sp.find('.//p:cNvPr', ns).get('name')
    if name == 'Freeform 42':
        ox, oy, ex, ey = shape_xfrm(sp)
        BAR_CENTER = apply(T, ox + ex / 2, oy + ey / 2)[1]
    blip = sp.xpath('./p:spPr/a:blipFill', namespaces=ns)
    fill = color_of(sp, 'solidFill')
    if blip:
        # picture fill: signature image (rId4); landscape fills (rId3) are not visible in design
        rid = blip[0].find('.//a:blip', ns).get('{%s}embed' % R)
        if rid != 'rId4':
            # transparent or landscape fills: keep only the outline, if any
            ln = sp.find('./p:spPr/a:ln', ns)
            if ln is not None and ln.find('a:solidFill/a:srgbClr', ns) is not None:
                d = freeform_d(sp, T)
                lc = ln.find('a:solidFill/a:srgbClr', ns).get('val')
                lw = int(ln.get('w', '12700'))
                out.append(f'<path d="{d}" fill="none" stroke="#{lc}" stroke-width="{lw}"/>')
            return
        if rid == 'rId4':
            ox, oy, ex, ey = shape_xfrm(sp)
            X, Y = apply(T, ox, oy)
            w = ex * T[0]; h = ey * T[1]
            out.append(f'<image xlink:href="signature.png" x="{X:.0f}" y="{Y:.0f}" width="{w:.0f}" height="{h:.0f}" preserveAspectRatio="none"/>')
        return
    d = freeform_d(sp, T)
    if not d:
        return
    if fill:
        out.append(f'<path d="{d}" fill="#{fill}"/>')
    else:
        ln = sp.find('./p:spPr/a:ln', ns)
        if ln is not None and ln.find('a:solidFill/a:srgbClr', ns) is not None:
            lc = ln.find('a:solidFill/a:srgbClr', ns).get('val')
            lw = int(ln.get('w', '12700'))
            out.append(f'<path d="{d}" fill="none" stroke="#{lc}" stroke-width="{lw}"/>')

BAR_CENTER = None  # set while emitting the course bar (it sits inside a scaled group)

def emit_text(sp, T):
    ox, oy, ex, ey = shape_xfrm(sp)
    X, Y = apply(T, ox, oy)
    w = ex * T[0]; h = ey * T[1]
    texts = sp.xpath('.//a:t/text()', namespaces=ns)
    text = ''.join(texts)
    rpr = sp.find('.//a:rPr', ns)
    sz = int(rpr.get('sz', '1800'))
    bold = rpr.get('b') == '1' or rpr.get('b') == 'true'
    spc = int(rpr.get('spc', '0') or 0)
    lat = sp.find('.//a:rPr/a:latin', ns)
    face = lat.get('typeface') if lat is not None else 'Arimo'
    col = sp.xpath('.//a:rPr/a:solidFill/a:srgbClr/@val', namespaces=ns)[0]
    algn = (sp.xpath('.//a:pPr/@algn', namespaces=ns) or ['l'])[0]
    font_emu = sz * 127 / 100 * 100 / 100  # sz in 1/100 pt -> EMU
    font_emu = sz * 127  # 1pt = 12700 EMU, sz is hundredths of pt -> sz*127
    ls = spc * 127
    cx = X + w / 2
    cy = Y + h / 2
    baseline_mode = None
    if text.strip() == 'Advanced Frontend Workshop':
        # Center the capital-letter height on the black bar, not the whole font box.
        # Arimo cap height is 0.716em, so the baseline sits 0.358em below the bar center.
        bar = BAR_CENTER
        if bar is not None:
            cy = bar + 0.358 * font_emu
            baseline_mode = 'alphabetic'
    if algn == 'ctr':
        anchor, x = 'middle', cx
    else:
        anchor, x = 'start', X
    if 'Mono' in face:
        family = "'JetBrains Mono', monospace"
    else:
        family = "Arimo, Arial, 'Liberation Sans', sans-serif"
    weight = 'bold' if bold else 'normal'
    key = text.strip()
    placeholder = {
        'Student Name': '{{STUDENT_NAME}}',
        'Advanced Frontend Workshop': '{{COURSE_TITLE}}',
        'Instructor Name': '{{INSTRUCTOR_NAME}}',
        'October 2026': '{{ISSUE_DATE}}',
        'RL-2026-0001eewr': '{{CERT_ID}}',
    }.get(key, html.escape(text))
    # max width used for auto-shrink (server side)
    attr_extra = ''
    if placeholder.startswith('{{') :
        attr_extra = f' data-field="{placeholder[2:-2]}" data-maxw="{w:.0f}" data-size="{font_emu:.0f}"'
    out.append(
        f'<text x="{x:.0f}" y="{cy:.0f}" text-anchor="{anchor}" dominant-baseline="{baseline_mode or "central"}" '
        f'font-family="{family}" font-size="{font_emu:.0f}" font-weight="{weight}" '
        f'letter-spacing="{ls}" fill="#{col}"{attr_extra}>{placeholder}</text>'
    )

def walk(parent, T):
    for el in parent:
        tag = etree.QName(el).localname
        if tag == 'grpSp':
            walk(el, compose_group(T, el))
        elif tag == 'sp':
            if el.xpath('.//a:t', namespaces=ns):
                emit_text(el, T)
            else:
                emit_shape(el, T)

walk(spTree, IDENT)

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
       f'<rect width="{W}" height="{H}" fill="#FAFAFA"/>']
svg += out
svg.append('</svg>')
open(OUT, 'w').write('\n'.join(svg))
print('shapes/text emitted:', len(out))
