import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Group, Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

const helper = fileURLToPath(new URL('../../skills/threejs-object-sculptor/scripts/probe_reference_image.py', import.meta.url));
function pythonCase(source) {
  const prefix = 'import runpy, struct, zlib, io, types\nfrom unittest.mock import Mock, patch\nglobals().update(runpy.run_path(__import__("sys").argv[1]))\n';
  const result = spawnSync('python3', ['-c', prefix + source, helper], {
    encoding:'utf8', timeout:60000, env:{...process.env, PYTHONDONTWRITEBYTECODE:'1'},
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
}

test('PNG probe validates IHDR shape, CRC, and positive dimensions', () => pythonCase(String.raw`
def png(w, h):
    body = b'IHDR' + struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + body + struct.pack('>I', zlib.crc32(body))
assert png_size(png(20, 10)) == (20, 10)
assert png_size(png(20, 0)) is None
assert png_size(png(0x80000000, 1)) is None
assert png_size(png(20, 10)[:24]) is None
assert png_size(png(20, 10)[:-1] + b'\xff') is None
assert png_size(png(20, 10)[:12] + b'NOPE' + png(20, 10)[16:]) is None
`));

test('GIF requires a complete logical screen descriptor with positive extent', () => pythonCase(String.raw`
header = b'GIF89a' + struct.pack('<HHBBB', 20, 10, 0, 0, 0)
assert gif_size(header) == (20, 10)
assert gif_size(header[:10]) is None
assert gif_size(b'GIF89a' + bytes(7)) is None
`));

test('JPEG marker fills are skipped and scan payload is not searched for a fake frame', () => pythonCase(String.raw`
sof = b'\xff\xc0' + struct.pack('>HBHHB', 11, 8, 10, 20, 1) + b'\x01\x11\x00'
assert jpeg_size(b'\xff\xd8\xff' + sof) == (20, 10)
assert jpeg_size(b'\xff\xd8' + sof) == (20, 10)
assert jpeg_size(b'\xff\xd8\xff\xda\x00\x02' + sof) is None
assert jpeg_size(b'\xff\xd8garbage' + sof) is None
assert jpeg_size(b'\xff\xd8\xff\xc0\x00\x07\x08\x00\x0a\x00\x14') is None
`));

test('WebP dimensions belong to declared chunks, not an arbitrary VP8 signature', () => pythonCase(String.raw`
def riff(kind, payload, size=None):
    part = kind + struct.pack('<I', len(payload) if size is None else size) + payload
    part += bytes(len(payload) % 2)
    return b'RIFF' + struct.pack('<I', len(part) + 4) + b'WEBP' + part
vp8 = b'\x10\x00\x00\x9d\x01\x2a' + struct.pack('<HH', 20, 10)
assert webp_size(riff(b'VP8 ', vp8)) == (20, 10)
assert webp_size(riff(b'VP8 ', b'junk' + vp8)) is None
assert webp_size(riff(b'VP8 ', vp8, 2)) is None
assert webp_size(riff(b'VP8L', b'\x2f' + struct.pack('<I', 19 | (9 << 14)))) == (20, 10)
assert webp_size(riff(b'VP8L', b'\x2f' + struct.pack('<I', 1 << 29))) is None
`));

test('BMP CORE and signed INFO headers use different layouts', () => pythonCase(String.raw`
file_header = b'BM' + bytes(12)
core = file_header + struct.pack('<IHHHH', 12, 20, 10, 1, 24)
info = file_header + struct.pack('<IiiHH', 40, 20, -10, 1, 24) + bytes(24)
assert bmp_size(core) == (20, 10)
assert bmp_size(info) == (20, 10)
assert bmp_size(info[:26]) is None
assert bmp_size(file_header + struct.pack('<IiiHH', 40, -20, 10, 1, 24) + bytes(24)) is None
assert bmp_size(file_header + struct.pack('<IHHHH', 12, 20, 0, 1, 24)) is None
`));

test('classic TIFF requires complete directory entries and scalar dimensions', () => pythonCase(String.raw`
for endian, magic in [('<', b'II'), ('>', b'MM')]:
    header = magic + struct.pack(endian + 'HI', 42, 8)
    fields = [struct.pack(endian + 'HHII', tag, 4, 1, value) for tag, value in [(256,20),(257,10)]]
    data = header + struct.pack(endian + 'H', 2) + b''.join(fields) + bytes(4)
    assert tiff_size(data) == (20, 10)
    assert tiff_size(data[:-4]) is None
    duplicate = header + struct.pack(endian + 'H', 3) + b''.join(fields) + fields[0] + bytes(4)
    assert tiff_size(duplicate) is None
assert tiff_size(b'II*\x00\xff\xff\xff\xff') is None
`));

test('probe bounds metadata reads and distinguishes file bytes from scanned bytes', () => pythonCase(String.raw`
class Source(io.BytesIO):
    requests = []
    def read(self, size=-1):
        self.requests.append(size)
        return super().read(size)
    def fileno(self):
        return 42
source = Source(b'GIF89a' + struct.pack('<HHBBB', 20, 10, 0, 0, 0) + bytes(200))
path = Mock()
path.is_file.return_value = True
path.open.return_value = source
with patch('os.fstat', return_value=types.SimpleNamespace(st_mode=0o100644, st_size=10**9)):
    result = probe(path, max_header_bytes=64)
assert source.requests == [64]
assert result['bytes'] == 10**9 and result['scannedBytes'] == 64
assert result['scanLimited'] is True and result['orientationApplied'] is False
assert result['width'] == 20 and result['metadataStatus'] == 'parsed'
for budget in [0, -1, True, 1.5, 2**64]:
    try:
        probe(path, max_header_bytes=budget)
    except ValueError:
        pass
    else:
        raise AssertionError('invalid header budget accepted')
`));

test('attachment endpoint is converted once from parent into child-local coordinates', () => {
  const parent = new Group(); parent.position.set(7, 2, -3); parent.rotation.y = 0.7; parent.scale.set(2, 3, 1);
  const child = new Group(), start = new Vector3(1, 2, 0), end = new Vector3(3, 3, 1);
  child.position.copy(start); child.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.clone().sub(start).normalize());
  parent.add(child); parent.updateMatrixWorld(true);
  const localEnd = end.clone().sub(start).applyQuaternion(child.quaternion.clone().invert());
  assert.ok(localEnd.clone().applyMatrix4(child.matrixWorld).distanceTo(end.clone().applyMatrix4(parent.matrixWorld)) < 1e-12);
  assert.ok(start.clone().applyMatrix4(child.matrixWorld).distanceTo(start.clone().applyMatrix4(parent.matrixWorld)) > 1);
  assert.ok(new Vector3().applyMatrix4(child.matrixWorld).distanceTo(start.clone().applyMatrix4(parent.matrixWorld)) < 1e-12);
});

test('hinge rotation preserves its axis but intentionally changes the full frame', () => {
  const axis = new Vector3(0, 1, 0), rotation = new Quaternion().setFromAxisAngle(axis, Math.PI / 3);
  assert.ok(axis.clone().applyQuaternion(rotation).distanceTo(axis) < 1e-12);
  assert.ok(new Vector3(1,0,0).applyQuaternion(rotation).distanceTo(new Vector3(1,0,0)) > 0.5);
});

test('probe agrees with actual encoded PNG JPEG WebP GIF and TIFF dimensions', async () => {
  for (const format of ['png', 'jpeg', 'webp', 'gif', 'tiff']) {
    const bytes = await sharp({create:{width:20,height:10,channels:3,background:{r:30,g:80,b:140}}}).toFormat(format).toBuffer();
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, 20); assert.equal(metadata.height, 10);
    pythonCase(`import base64\ndata = base64.b64decode('${bytes.toString('base64')}')\nassert detect_size(data) == (20, 10)\n`);
  }
});

test('probe CLI reports a directory as an input error without a traceback', () => {
  const directory = fileURLToPath(new URL('../../skills/threejs-object-sculptor/', import.meta.url));
  const result = spawnSync('python3', [helper, directory], {encoding:'utf8',timeout:60000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(result.status, 2);
  assert.match(result.stderr, /regular file/);
  assert.doesNotMatch(result.stderr, /Traceback/);
});
