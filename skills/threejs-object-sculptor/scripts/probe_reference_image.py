#!/usr/bin/env python3
"""Probe basic technical properties of a reference image before visual analysis."""

from __future__ import annotations

import argparse
import json
import os
import stat
import struct
import sys
import zlib
from pathlib import Path

# Authored metadata scan budget, not a decoded image-size limit.
DEFAULT_HEADER_BYTES = 1024 * 1024
MAX_HEADER_BYTES = 64 * 1024 * 1024


def positive_size(width: int, height: int) -> tuple[int, int] | None:
    return (width, height) if width > 0 and height > 0 else None


def png_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 33 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    if data[8:16] != b"\x00\x00\x00\x0dIHDR":
        return None
    if zlib.crc32(data[12:29]) != struct.unpack(">I", data[29:33])[0]:
        return None
    width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", data[16:29])
    depths = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
    if depth not in depths.get(color, set()) or compression != 0 or filtering != 0 or interlace not in {0, 1}:
        return None
    if width > 0x7fffffff or height > 0x7fffffff:
        return None
    return positive_size(width, height)


def gif_size(data: bytes) -> tuple[int, int] | None:
    if data[:6] in {b"GIF87a", b"GIF89a"} and len(data) >= 13:
        return positive_size(*struct.unpack("<HH", data[6:10]))
    return None


def jpeg_size(data: bytes) -> tuple[int, int] | None:
    if not data.startswith(b"\xff\xd8"):
        return None
    index = 2
    sof = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while index < len(data):
        if data[index] != 0xFF:
            return None
        while index < len(data) and data[index] == 0xFF:
            index += 1
        if index >= len(data):
            return None
        marker = data[index]
        index += 1
        if marker in {0x00, 0xD8, 0xD9, 0xDA}:
            return None  # Never search entropy data for a dimension-like marker.
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            continue
        if index + 2 > len(data):
            return None
        length = struct.unpack(">H", data[index:index + 2])[0]
        if length < 2 or index + length > len(data):
            return None
        if marker in sof:
            if length < 8:
                return None
            components = data[index + 7]
            if components == 0 or length != 8 + 3 * components:
                return None
            height, width = struct.unpack(">HH", data[index + 3:index + 7])
            return positive_size(width, height)  # Deferred DNL heights remain unparsed.
        index += length
    return None


def webp_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 20 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    size = int.from_bytes(data[4:8], "little")
    if size < 4 or size > 0xfffffff6 or size % 2:
        return None
    end = size + 8
    cursor = 12
    while cursor + 8 <= min(len(data), end):
        kind = data[cursor:cursor + 4]
        length = int.from_bytes(data[cursor + 4:cursor + 8], "little")
        start = cursor + 8
        next_chunk = start + length + length % 2
        if next_chunk > end:
            return None
        # Dimension headers can be read from a bounded prefix of a large chunk.
        if kind == b"VP8X":
            if length < 10 or start + 10 > len(data):
                return None
            width = 1 + int.from_bytes(data[start + 4:start + 7], "little")
            height = 1 + int.from_bytes(data[start + 7:start + 10], "little")
            return (width, height) if width * height <= 0xffffffff else None
        if kind == b"VP8 ":
            if length < 10 or start + 10 > len(data) or data[start] & 1 or data[start + 3:start + 6] != b"\x9d\x01\x2a":
                return None
            width, height = struct.unpack("<HH", data[start + 6:start + 10])
            return positive_size(width & 0x3FFF, height & 0x3FFF)
        if kind == b"VP8L":
            if length < 5 or start + 5 > len(data) or data[start] != 0x2F:
                return None
            header = int.from_bytes(data[start + 1:start + 5], "little")
            if header >> 29:
                return None
            return 1 + (header & 0x3FFF), 1 + ((header >> 14) & 0x3FFF)
        cursor = next_chunk
    return None


def bmp_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 18 or data[:2] != b"BM":
        return None
    dib_size = struct.unpack("<I", data[14:18])[0]
    if dib_size == 12 and len(data) >= 26:
        width, height, planes, depth = struct.unpack("<HHHH", data[18:26])
        return positive_size(width, height) if planes == 1 and depth in {1, 4, 8, 24} else None
    if dib_size in {40, 52, 56, 108, 124} and len(data) >= 14 + dib_size:
        width, height, planes = struct.unpack("<iiH", data[18:28])
        return positive_size(width, abs(height)) if planes == 1 else None
    return None


def tiff_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 8 or data[:4] not in {b"II*\x00", b"MM\x00*"}:
        return None
    endian = "<" if data[:2] == b"II" else ">"
    offset = struct.unpack(f"{endian}I", data[4:8])[0]
    if offset < 8 or offset % 2 or offset + 2 > len(data):
        return None
    entries = struct.unpack(f"{endian}H", data[offset:offset + 2])[0]
    if offset + 2 + entries * 12 + 4 > len(data):
        return None
    dimensions = {}
    for cursor in range(offset + 2, offset + 2 + entries * 12, 12):
        tag, value_type, count = struct.unpack(f"{endian}HHI", data[cursor:cursor + 8])
        if tag not in {256, 257}:
            continue
        if tag in dimensions or value_type not in {3, 4} or count != 1:
            return None
        code = "H" if value_type == 3 else "I"
        byte_count = 2 if value_type == 3 else 4
        dimensions[tag] = struct.unpack(f"{endian}{code}", data[cursor + 8:cursor + 8 + byte_count])[0]
    return positive_size(dimensions.get(256, 0), dimensions.get(257, 0))


def detect_image_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8"):
        return "jpeg"
    if data[:6] in {b"GIF87a", b"GIF89a"}:
        return "gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith(b"BM"):
        return "bmp"
    if data[:4] in {b"II*\x00", b"MM\x00*"}:
        return "tiff"
    return None


def detect_size(data: bytes) -> tuple[int, int] | None:
    return png_size(data) or jpeg_size(data) or gif_size(data) or webp_size(data) or bmp_size(data) or tiff_size(data)


def probe(path: Path, max_header_bytes: int = DEFAULT_HEADER_BYTES) -> dict:
    if type(max_header_bytes) is not int or not 1 <= max_header_bytes <= MAX_HEADER_BYTES:
        raise ValueError(f"max_header_bytes must be an integer from 1 to {MAX_HEADER_BYTES}")
    if not path.is_file():
        raise ValueError("image must be a regular file")
    with path.open("rb") as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("image must be a regular file")
        data = source.read(min(metadata.st_size, max_header_bytes))
    image_type = detect_image_type(data)
    size = detect_size(data)
    scan_limited = metadata.st_size > len(data)
    warnings: list[str] = []
    if not image_type:
        warnings.append("unknown image type")
    if scan_limited:
        warnings.append("metadata scan is limited to a file prefix")
    if not size:
        warnings.append("positive stored dimensions were not found in a supported header within the scan")
        width = height = aspect = None
    else:
        width, height = size
        aspect = width / height
    if image_type and size:
        metadata_status = "parsed"
        status_meaning = "format and stored header dimensions were parsed; pixels were not decoded"
    elif image_type or size:
        metadata_status = "partial"
        status_meaning = "only part of the requested header metadata was parsed"
    else:
        metadata_status = "unparsed"
        status_meaning = "format and dimensions could not be parsed"
    return {
        "path": str(path),
        "format": image_type,
        "bytes": metadata.st_size,
        "scannedBytes": len(data),
        "headerLimitBytes": max_header_bytes,
        "scanLimited": scan_limited,
        "width": width,
        "height": height,
        "aspectRatio": aspect,
        "dimensionSpace": "stored-raster-or-canvas",
        "orientationApplied": False,
        "metadataStatus": metadata_status,
        "metadataStatusMeaning": status_meaning,
        "warnings": warnings,
        "note": "Header metadata only: pixel decoding, orientation, pixel aspect, animation frames, and color profiles are not validated. Visual inspection determines evidence readability.",
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--max-header-bytes", type=int, default=DEFAULT_HEADER_BYTES,
                        help="bounded metadata prefix, default 1 MiB; maximum 64 MiB")
    args = parser.parse_args(argv)
    try:
        path = args.image.expanduser().resolve()
        result = probe(path, args.max_header_bytes)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
