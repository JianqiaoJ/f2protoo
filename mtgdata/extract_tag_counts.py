#!/usr/bin/env python3
"""从 数据文件字段分析报告.md 提取 raw.tsv 各 distinct tag 及歌曲数量，按数量倒序输出 TS 数组。"""
import re

with open("数据文件字段分析报告.md", "r", encoding="utf-8") as f:
    content = f.read()

def extract_section(content, start_marker, end_marker):
    i = content.find(start_marker)
    if i == -1:
        return ""
    i = content.find("\n", i) + 1
    j = content.find(end_marker, i)
    if j == -1:
        j = len(content)
    return content[i:j]

def parse_block(block, prefix):
    out = []
    for line in block.strip().split("\n"):
        mo = re.match(r"- `([^`]+)` (\d+)首", line)
        if mo:
            full = mo.group(1)
            if full.startswith(prefix):
                tag = full.split("---", 1)[1]
                count = int(mo.group(2))
                out.append((tag, count))
    return out

genre_block = extract_section(content, "**genre**（按 tag 字母序）", "**instrument**")
inst_block = extract_section(content, "**instrument**  ", "**mood/theme**")
mood_block = extract_section(content, "**mood/theme**  ", "**说明**")

genres = parse_block(genre_block, "genre---")
instruments = parse_block(inst_block, "instrument---")
moods = parse_block(mood_block, "mood/theme---")

genres.sort(key=lambda x: -x[1])
instruments.sort(key=lambda x: -x[1])
moods.sort(key=lambda x: -x[1])

def to_ts(name, arr):
    lines = [f'  ["{t}", {c}],' for t, c in arr]
    return "export const " + name + ": [string, number][] = [\n" + "\n".join(lines) + "\n];"

print(to_ts("GENRES_WITH_COUNT", genres))
print()
print(to_ts("INSTRUMENTS_WITH_COUNT", instruments))
print()
print(to_ts("MOODS_THEMES_WITH_COUNT", moods))
