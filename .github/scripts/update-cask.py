#!/usr/bin/env python3
import re, sys

cask_path, version, arm_sha, x64_sha = sys.argv[1:]

with open(cask_path) as f:
    text = f.read()

text = re.sub(r'version "[^"]*"', f'version "{version}"', text, count=1)

def replace_sha_in_block(text, block_marker, new_sha):
    pattern = rf'({block_marker}.*?sha256 ")[^"]*(")'
    return re.sub(pattern, rf'\g<1>{new_sha}\g<2>', text, count=1, flags=re.DOTALL)

text = replace_sha_in_block(text, 'on_arm', arm_sha)
text = replace_sha_in_block(text, 'on_intel', x64_sha)

with open(cask_path, 'w') as f:
    f.write(text)

print(f"Updated {cask_path}: version={version}, arm={arm_sha[:8]}..., x64={x64_sha[:8]}...")
