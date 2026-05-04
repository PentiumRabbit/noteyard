import re
import sys

version = sys.argv[1]

with open("src-tauri/tauri.conf.json", "r") as f:
    content = f.read()
content = re.sub(r'"version": "[^"]*"', f'"version": "{version}"', content, count=1)
with open("src-tauri/tauri.conf.json", "w") as f:
    f.write(content)

with open("src-tauri/Cargo.toml", "r") as f:
    content = f.read()
content = re.sub(r'^version = "[^"]*"', f'version = "{version}"', content, count=1, flags=re.MULTILINE)
with open("src-tauri/Cargo.toml", "w") as f:
    f.write(content)
