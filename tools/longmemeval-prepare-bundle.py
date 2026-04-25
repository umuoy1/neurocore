import argparse
import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path


VARIANTS = [
    ("longmemeval_oracle", ["longmemeval_oracle.json"], "longmemeval_oracle.json"),
    ("longmemeval_s_cleaned", ["longmemeval_s_cleaned.json"], "longmemeval_s_cleaned.json"),
    ("longmemeval_m", ["longmemeval_m_cleaned.json", "longmemeval_m.json"], "longmemeval_m_cleaned.json"),
]


def main():
    args = parse_args()
    dataset_dir = Path(args.dataset).resolve()
    output_dir = Path(args.output_dir).resolve()
    shard_size = args.shard_size

    if not dataset_dir.exists():
        raise SystemExit(f"Dataset directory does not exist: {dataset_dir}")
    if shard_size < 1:
        raise SystemExit("--shard-size must be >= 1")

    if output_dir.exists() and args.clean:
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    sources = resolve_sources(dataset_dir)
    variants = []
    shard_totals = {}

    for variant, source_file, target_name in sources:
        source_meta = file_meta(source_file)
        variant_dir_count, qtypes = write_variant_shards(
            source_file,
            output_dir,
            target_name,
            shard_size,
            args.max_cases_per_variant
        )
        variants.append({
            "variant": variant,
            "source_file": str(source_file),
            "target_filename": target_name,
            "bytes": source_meta["bytes"],
            "sha256": source_meta["sha256"],
            "case_count": sum(variant_dir_count.values()),
            "question_type_counts": qtypes,
            "shard_count": len(variant_dir_count)
        })
        for shard_index, case_count in variant_dir_count.items():
            shard_totals.setdefault(shard_index, {})[variant] = case_count

    shards = []
    for shard_index in sorted(shard_totals):
        variants_in_shard = shard_totals[shard_index]
        shards.append({
            "shard_index": shard_index,
            "path": str(output_dir / f"shard-{shard_index:05d}"),
            "case_count_by_variant": variants_in_shard,
            "complete": len(variants_in_shard) == len(sources)
        })

    manifest = {
        "benchmark": "LongMemEval",
        "prepared_at": datetime.now(timezone.utc).isoformat(),
        "dataset_dir": str(dataset_dir),
        "output_dir": str(output_dir),
        "shard_size": shard_size,
        "max_cases_per_variant": args.max_cases_per_variant,
        "variants": variants,
        "shards": shards
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "manifest": str(manifest_path),
        "variant_count": len(variants),
        "shard_count": len(shards),
        "shard_size": shard_size
    }, indent=2))


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--shard-size", type=int, default=50)
    parser.add_argument("--max-cases-per-variant", type=int)
    parser.add_argument("--clean", action="store_true")
    return parser.parse_args()


def resolve_sources(dataset_dir):
    sources = []
    for variant, filenames, target_name in VARIANTS:
        matches = []
        for root, _, files in os.walk(dataset_dir):
            for filename in files:
                if filename.lower() in filenames:
                    matches.append(Path(root) / filename)
        if not matches:
            raise SystemExit(f"Missing LongMemEval dataset file for {variant}: {', '.join(filenames)}")
        if len(matches) > 1:
            raise SystemExit(f"Multiple LongMemEval dataset files found for {variant}: {matches}")
        sources.append((variant, matches[0].resolve(), target_name))
    return sources


def file_meta(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return {
        "bytes": path.stat().st_size,
        "sha256": digest.hexdigest()
    }


def write_variant_shards(source_file, output_dir, target_name, shard_size, max_cases):
    shard_index = 0
    item_index = 0
    shard_counts = {}
    qtypes = {}
    current_handle = None
    current_count = 0

    try:
        for item in iter_json_array(source_file):
            if max_cases is not None and item_index >= max_cases:
                break
            if current_handle is None or current_count >= shard_size:
                if current_handle is not None:
                    current_handle.write("]\n")
                    current_handle.close()
                shard_index = item_index // shard_size
                shard_dir = output_dir / f"shard-{shard_index:05d}"
                shard_dir.mkdir(parents=True, exist_ok=True)
                current_handle = (shard_dir / target_name).open("w", encoding="utf-8")
                current_handle.write("[")
                current_count = 0

            if current_count > 0:
                current_handle.write(",")
            current_handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")))
            current_count += 1
            item_index += 1
            shard_counts[shard_index] = current_count
            qtype = item.get("question_type")
            qtypes[qtype] = qtypes.get(qtype, 0) + 1
    finally:
        if current_handle is not None:
            current_handle.write("]\n")
            current_handle.close()

    return shard_counts, dict(sorted(qtypes.items()))


def iter_json_array(path):
    decoder = json.JSONDecoder()
    buffer = ""
    started = False

    with path.open("r", encoding="utf-8") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if chunk:
                buffer += chunk

            position = 0
            if not started:
                position = skip_ws(buffer, position)
                if position >= len(buffer):
                    if not chunk:
                        raise ValueError(f"Empty JSON file: {path}")
                    continue
                if buffer[position] != "[":
                    raise ValueError(f"LongMemEval dataset must be a JSON array: {path}")
                position += 1
                started = True

            while True:
                position = skip_ws(buffer, position)
                if position < len(buffer) and buffer[position] == ",":
                    position += 1
                    position = skip_ws(buffer, position)
                if position >= len(buffer):
                    break
                if buffer[position] == "]":
                    return
                try:
                    value, end = decoder.raw_decode(buffer, position)
                except json.JSONDecodeError:
                    break
                yield value
                position = end

            buffer = buffer[position:]
            if not chunk:
                if buffer.strip():
                    raise ValueError(f"Trailing JSON data could not be parsed in {path}")
                return


def skip_ws(value, position):
    while position < len(value) and value[position].isspace():
        position += 1
    return position


if __name__ == "__main__":
    main()
