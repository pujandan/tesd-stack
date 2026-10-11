#!/usr/bin/env python3
"""
audit.py — Integrity audit for the TESD Stack skill documentation.
Validates:
1. Markdown file links exist
2. GitHub-compatible heading anchor slugs exist in target files
3. Frontmatter fields in SKILL.md
"""

import os
import re
import sys

def gfm_slug(text: str) -> str:
    text = text.lower()
    cleaned = ''
    for c in text:
        if ('a' <= c <= 'z') or ('0' <= c <= '9') or c in (' ', '-'):
            cleaned += c
    return cleaned.replace(' ', '-')

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    skill_dir = os.path.abspath(os.path.join(script_dir, '..'))

    md_files = []
    for root, _, files in os.walk(skill_dir):
        for f in files:
            if f.endswith('.md'):
                md_files.append(os.path.join(root, f))

    errors = []
    link_regex = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')

    # Check SKILL.md frontmatter
    skill_md = os.path.join(skill_dir, 'SKILL.md')
    if os.path.exists(skill_md):
        with open(skill_md, 'r', encoding='utf-8') as f:
            content = f.read()
        if not content.startswith('---'):
            errors.append('SKILL.md missing opening YAML frontmatter (---)')
        elif 'name:' not in content[:300] or 'description:' not in content[:300]:
            errors.append('SKILL.md frontmatter missing required name or description field')

    for filepath in md_files:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        for l_idx, line in enumerate(lines):
            for match in link_regex.finditer(line):
                text, url = match.groups()
                if url.startswith(('http://', 'https://', 'mailto:', 'javascript:')):
                    continue

                path_part, anchor = url.split('#') if '#' in url else (url, None)
                target_file = os.path.normpath(os.path.join(os.path.dirname(filepath), path_part)) if path_part else filepath

                if not os.path.exists(target_file):
                    errors.append(f"{os.path.relpath(filepath, skill_dir)}:{l_idx+1} -> Link target file does not exist: {url}")
                    continue

                if anchor:
                    with open(target_file, 'r', encoding='utf-8') as tf:
                        tlines = tf.readlines()
                    headings = [tl.strip().lstrip('#').strip() for tl in tlines if tl.startswith('#')]
                    slugs = [gfm_slug(h) for h in headings]
                    if anchor not in slugs:
                        errors.append(f"{os.path.relpath(filepath, skill_dir)}:{l_idx+1} -> Anchor #{anchor} not found in {os.path.relpath(target_file, skill_dir)}")

    print(f"Audited {len(md_files)} markdown files in {skill_dir}")
    if errors:
        print(f"\nFound {len(errors)} error(s):")
        for err in errors:
            print(f"  ❌ {err}")
        sys.exit(1)
    else:
        print("✅ All markdown links, anchors, and frontmatter are valid!")
        sys.exit(0)

if __name__ == '__main__':
    main()
