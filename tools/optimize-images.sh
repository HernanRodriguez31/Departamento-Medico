#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMG_DIR="${IMG_DIR:-"$ROOT_DIR/assets/images"}"
MIN_KB="${MIN_KB:-120}"
QUALITY="${QUALITY:-82}"
DRY_RUN="${DRY_RUN:-0}"

if command -v cwebp >/dev/null 2>&1; then
    TOOL="cwebp"
elif command -v magick >/dev/null 2>&1; then
    TOOL="magick"
elif command -v convert >/dev/null 2>&1; then
    TOOL="convert"
else
    echo "Missing tooling. Install cwebp or ImageMagick to generate WebP files." >&2
    exit 1
fi

file_size_bytes() {
    local file="$1"
    if stat -f%z "$file" >/dev/null 2>&1; then
        stat -f%z "$file"
    else
        stat -c%s "$file"
    fi
}

is_logo_like() {
    local name="$1"
    local lower
    lower="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
    [[ "$lower" == *logo* || "$lower" == *icon* || "$lower" == *favicon* || "$lower" == *identity* || "$lower" == *brisa* ]]
}

convert_to_webp() {
    local src="$1"
    local dst="$2"

    if [[ "$TOOL" == "cwebp" ]]; then
        cwebp -q "$QUALITY" "$src" -o "$dst"
    else
        "$TOOL" "$src" -quality "$QUALITY" "$dst"
    fi
}

count=0

while IFS= read -r -d '' file; do
    base="$(basename "$file")"
    if is_logo_like "$base"; then
        continue
    fi

    size_bytes="$(file_size_bytes "$file")"
    size_kb=$((size_bytes / 1024))
    if (( size_kb < MIN_KB )); then
        continue
    fi

    out="${file%.*}.webp"
    if [[ -f "$out" ]]; then
        continue
    fi

    count=$((count + 1))
    if (( DRY_RUN == 1 )); then
        echo "Would convert: $file -> $out"
    else
        echo "Converting: $file -> $out"
        convert_to_webp "$file" "$out"
    fi
done < <(find "$IMG_DIR" -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" \) -print0)

if (( count == 0 )); then
    echo "No images matched (skipped logos and files under ${MIN_KB}KB)."
else
    echo "Done. Generated ${count} WebP file(s). Update HTML/CSS references as needed."
fi
