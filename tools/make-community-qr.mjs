/**
 * Rebuild `src/client/community-qr.ts` from the two group codes.
 *
 * Two codes now, not one, and they are DIFFERENT KINDS of invitation:
 *
 *   - WeChat: this is a BOT account's personal code. Scanning it adds the bot
 *     as a contact, and the user must then send `XD` to be pulled into the
 *     group. A user who only scans and waits sees nothing happen, so the dialog
 *     has to say "发 XD" — the instruction is part of the code, not a caption.
 *   - QQ: this is the group's own join code. Scanning it IS joining.
 *
 * Both are cropped to the code plus its quiet zone and re-encoded as palette
 * PNGs. The crops differ because the sources do:
 *   - the WeChat source is a bare 640×640 code on white;
 *   - the QQ source is a share card with the group name, the group number and a
 *     divider above the code, so its crop starts below all of that.
 *
 * Nearest-neighbour downscale plus hard binarisation on the WeChat one: it is
 * already two-tone, and interpolation would soften module edges. The QQ code is
 * a COLOURED (blue→purple gradient) rounded-module design — binarising it would
 * change what it looks like on the source card, so it keeps its colour and is
 * only resized.
 *
 * Not part of the build: a build step that needs Pillow would break
 * `pnpm install && pnpm build` on a machine without Python. Run it by hand:
 *
 *   XDPOOL_PYTHON=<python with Pillow> node tools/make-community-qr.mjs
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'src', 'client', 'community-qr.ts')
const PYTHON = process.env['XDPOOL_PYTHON'] ?? 'python'

/**
 * Crop boxes in SOURCE pixels, measured from the files rather than guessed:
 * the WeChat code's dark bounding box is (36,40)-(675,679), and the QQ card's
 * coloured region starts at y≈408 (everything above it is the title block).
 * Both are grown by a quiet margin; a QR without one scans at some angles and
 * not others.
 */
const JOBS = [
  {
    label: 'wechat',
    source: join(ROOT, 'assets', 'community-qr-wechat.jpg'),
    crop: { left: 24, top: 28, right: 688, bottom: 692 },
    size: 640,
    binarise: true,
    constName: 'COMMUNITY_QR_WECHAT',
  },
  {
    label: 'qq',
    source: join(ROOT, 'assets', 'community-qr-qq.jpg'),
    crop: { left: 74, top: 394, right: 986, bottom: 1305 },
    // 520px / 16 colours, not 760 / 64: the coloured code dominated the client
    // bundle at 212 KB (a quarter of the whole script) while the dialog draws it
    // at 260 CSS px. 520 still puts ~13 device pixels on every module — three
    // times what a phone camera needs — and the gradient survives 16 colours
    // because it is one smooth ramp, not photographic detail.
    size: 520,
    colors: 16,
    // LANCZOS here, NEAREST for the WeChat code: this one is a GRADIENT, and
    // nearest-neighbour on a gradient produces banding that reads as damage.
    // The module shapes are rounded and anti-aliased in the source anyway, so
    // there is no sharp edge for interpolation to destroy.
    filter: 'LANCZOS',
    binarise: false,
    constName: 'COMMUNITY_QR_QQ',
  },
]

const SCRIPT = `
import base64, io, sys
from PIL import Image
(src, out_size, left, top, right, bottom, bin_flag, colors, filt) = (
    sys.argv[1], int(sys.argv[2]), *map(int, sys.argv[3:7]), sys.argv[7] == "1",
    int(sys.argv[8]), sys.argv[9]
)
im = Image.open(src).convert("L" if bin_flag else "RGB").crop((left, top, right, bottom))
im = im.resize((out_size, out_size), getattr(Image, filt))
if bin_flag:
    im = im.point(lambda v: 0 if v < 128 else 255, mode="L").convert("P", palette=Image.ADAPTIVE, colors=2)
else:
    im = im.convert("P", palette=Image.ADAPTIVE, colors=colors)
buf = io.BytesIO()
im.save(buf, format="PNG", optimize=True)
sys.stdout.write(base64.b64encode(buf.getvalue()).decode("ascii"))
`

const encoded = {}
for (const job of JOBS) {
  const base64 = execFileSync(
    PYTHON,
    ['-c', SCRIPT, job.source, String(job.size),
      String(job.crop.left), String(job.crop.top), String(job.crop.right), String(job.crop.bottom),
      job.binarise ? '1' : '0', String(job.colors ?? 2), job.filter ?? 'NEAREST'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim()
  if (base64.length === 0) throw new Error(`${job.label}: encoder produced no bytes`)
  encoded[job.label] = base64
  console.log(`${job.label}: ${String(base64.length)} base64 chars, ${String(job.size)}×${String(job.size)}`)
}

const template = `/**
 * The two group invite codes, inlined as data URIs.
 *
 * Why embedded rather than served from \`assets/\`: the browser half ships as
 * \`lib/client.js\`, one script the host loads into the settings dialog. Nothing
 * in that script can resolve a path relative to the package, and the plugin's
 * \`/plugins/dsh-xdpool/*\` routes are registered by the host half — adding one
 * more route for a picture that never changes would mean a second thing to keep
 * working across two host lines. A data URI has no path to get wrong.
 *
 * TWO codes, because the two groups are joined differently and one code could
 * not say so:
 *
 *   - {@link COMMUNITY_QR_WECHAT} is a bot's personal code. Scanning it adds the
 *     bot as a contact; the user must then send \`XD\` before it pulls them in.
 *     Skipping that step looks like a broken button, so the dialog prints the
 *     instruction beside this code.
 *   - {@link COMMUNITY_QR_QQ} is the QQ group's own join code. Scanning it is
 *     joining; there is nothing to send.
 *
 * The WeChat source is two-tone and is binarised (no interpolated module
 * edges); the QQ source is a coloured gradient design and keeps its colour,
 * because recolouring it would only make it look like a different code.
 *
 * Regenerate with \`tools/make-community-qr.mjs\` when a code is replaced. An
 * expired code fails SILENTLY — it scans, then the join is refused — which is
 * why both panels carry a line telling the reader to ask for a new one.
 *
 * @module dsh-xdpool/client/community-qr
 */

/** Edge length of the embedded WeChat code, in pixels. */
export const COMMUNITY_QR_WECHAT_SIZE = ${String(JOBS[0].size)}
/** Edge length of the embedded QQ code, in pixels. */
export const COMMUNITY_QR_QQ_SIZE = ${String(JOBS[1].size)}

/** WeChat bot's contact code. Scanning adds the bot; send \`XD\` to be pulled in. */
export const COMMUNITY_QR_WECHAT =
  'data:image/png;base64,${encoded.wechat}'

/** QQ group join code. Scanning is joining — no message to send. */
export const COMMUNITY_QR_QQ =
  'data:image/png;base64,${encoded.qq}'
`

writeFileSync(OUT, template)
console.log(`wrote ${OUT}`)
