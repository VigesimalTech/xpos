#!/usr/bin/env python3
"""Check every link between docs/features pages: the page exists, and so does its #anchor.

Run from the repository root. Exits 1 and lists each broken link when any is broken.
Anchors are worked out as GitHub does: lower case, punctuation dropped, spaces to "-".
"""

import re
import sys
from pathlib import Path

DOCS = Path("docs/features")
LINK = re.compile(r"\]\(([^)\s]+?\.md)(?:#([^)\s]+))?\)")
HEADING = re.compile(r"^#{1,6}\s+(.*?)\s*#*\s*$")


def slug(text: str) -> str:
	text = re.sub(r"[`*_]|<[^>]+>", "", text).strip().lower()
	text = re.sub(r"[^\w\- ]", "", text)
	return text.replace(" ", "-")


def anchors(page: Path) -> set[str]:
	seen: dict[str, int] = {}
	out = set()
	in_code = False
	for line in page.read_text().splitlines():
		if line.startswith("```"):
			in_code = not in_code
		match = None if in_code else HEADING.match(line)
		if match:
			base = slug(match.group(1))
			n = seen.get(base, 0)
			seen[base] = n + 1
			out.add(base if n == 0 else f"{base}-{n}")
	return out


def main() -> int:
	if not DOCS.is_dir():
		print(f"Run from the repository root: {DOCS} not found")
		return 2
	cache: dict[Path, set[str]] = {}
	broken = []
	for page in sorted(DOCS.glob("*.md")):
		for target, anchor in LINK.findall(page.read_text()):
			if target.startswith("http"):
				continue
			path = (page.parent / target).resolve()
			if not path.exists():
				broken.append(f"{page.name}: {target} does not exist")
				continue
			if anchor and path.parent == DOCS.resolve():
				if path not in cache:
					cache[path] = anchors(path)
				if anchor not in cache[path]:
					broken.append(f"{page.name}: {target}#{anchor} has no such heading")
	for line in broken:
		print(line)
	print(f"{len(broken)} broken link(s)" if broken else "All links resolve")
	return 1 if broken else 0


if __name__ == "__main__":
	sys.exit(main())
