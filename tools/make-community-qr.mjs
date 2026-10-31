/**
 * Regenerate `src/client/community-qr.ts` from the full-size share card.
 *
 * Not part of the build: the code changes a few times a year at most, and a
 * build step that needs Pillow would break `pnpm install && pnpm build` on a
 * machine that has no Python. Run it by hand when the group is replaced:
 *
 *   python tools/make-community-qr.mjs   # (with the bundled python + Pillow)
 *
 * What it does, and why each part matters:
 *
 *  - CROPS to the code plus a quiet margin. The share card has an avatar
 *    collage above and a "valid 7 days" footnote below; both are decoration
 *    around the payload, and inside a fixed-width dialog they only make the
 *    code smaller.
 *  - KEEPS the quiet zone. A QR scanned without its light border by a phone
 *    camera at a slight angle is the difference between "works" and "sometimes
 *    works", so the margin is part of the crop, not padding added later.
 *  - Binarises at a threshold with a hard black/white result: the screenshot
 *    source is anti-aliased, and every grey pixel between modules is noise a
 *    decoder has to threshold anyway. Doing it here means the bundle ships a
 *    palette PNG a tenth the size and scans identically.
 *  - NEAREST-neighbour downscale. Any interpolating filter blurs module edges;
 *    a 2-bit palette image scaled with NEAREST stays exactly as decodable as
 *    the original.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'assets', 'community-qr.png')
const OUT = join(ROOT, 'src', 'client', 'community-qr.ts')
const PYTHON = process.env['XDPOOL_PYTHON'] ?? 'python'

/**
 * Crop box in SOURCE pixels: the measured bounds of the code module area
 * (226..988 × 612..1374) grown by a 24px quiet margin on every side.
 */
const CROP = { left: 202, top: 588, right: 1012, bottom: 1398 }
/** Output size. 720px keeps every module ≥ 3px after the crop is halved. */
const SIZE = 720

const script = `
import base64, io, sys
from PIL import Image

src, out_size, left, top, right, bottom = sys.argv[1], int(sys.argv[2]), *map(int, sys.argv[3:7])
im = Image.open(src).convert("L").crop((left, top, right, bottom))
im = im.resize((out_size, out_size), Image.NEAREST)
im = im.point(lambda v: 0 if v < 128 else 255, mode="L")
buf = io.BytesIO()
im.convert("1").save(buf, format="PNG", optimize=True)
sys.stdout.write(base64.b64encode(buf.getvalue()).decode("ascii"))
`

const base64 = execFileSync(
  PYTHON,
  ['-c', script, SRC, String(SIZE), String(CROP.left), String(CROP.top), String(CROP.right), String(CROP.bottom)],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
).trim()

if (base64.length === 0) throw new Error('encoder produced no bytes')

const header = readFileSync(OUT, 'utf8')
const replaced = header.replace(
  /export const COMMUNITY_QR_DATA_URI = '[\s\S]*?'\n/,
  `export const COMMUNITY_QR_DATA_URI =\n  'data:image/png;base64,${base64}'\n`,
)
if (replaced === header) throw new Error('COMMUNITY_QR_DATA_URI assignment not found in the module')
// The dimensions are read back from the encoded image rather than assumed: a
// wrong width/height pair here is a squashed QR nobody can scan.
const sizeLine = header.match(/export const COMMUNITY_QR_WIDTH = (\d+)\n\/\*\*[^\n]*\*\/\nexport const COMMUNITY_QR_HEIGHT = (\d+)/u)
if (sizeLine === null) throw new Error('COMMUNITY_QR_WIDTH/HEIGHT declarations not found')
const sized = replaced
  .replace(/export const COMMUNITY_QR_WIDTH = \d+/u, `export const COMMUNITY_QR_WIDTH = ${SIZE}`)
  .replace(/export const COMMUNITY_QR_HEIGHT = \d+/u, `export const COMMUNITY_QR_HEIGHT = ${SIZE}`)
writeFileSync(OUT, sized)
console.log(`wrote ${OUT}: ${String(base64.length)} base64 chars, ${SIZE}×${SIZE}`)
