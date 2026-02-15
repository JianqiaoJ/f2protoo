#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成详细的Tags分析报告
"""

import sys
import pandas as pd
from collections import Counter
from pathlib import Path
import json

# 设置输出编码为UTF-8
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def analyze_tags_detailed(file_path):
    """详细分析文件的tags"""
    print(f"\nAnalyzing file: {Path(file_path).name}")
    
    try:
        df = pd.read_csv(file_path, sep='\t', error_bad_lines=False, warn_bad_lines=False, engine='python')
        
        if 'TAGS' not in df.columns:
            return None
        
        all_tags = []
        tag_categories = Counter()
        tags_by_category = {'genre': [], 'mood/theme': [], 'instrument': []}
        
        for tags_str in df['TAGS'].dropna():
            if tags_str and str(tags_str).strip() and str(tags_str) != 'nan':
                tag_parts = str(tags_str).split('---')
                if len(tag_parts) >= 2:
                    category = tag_parts[0]
                    tag = '---'.join(tag_parts[1:])
                    full_tag = f"{category}---{tag}"
                    all_tags.append(full_tag)
                    tag_categories[category] += 1
                    
                    if category in tags_by_category:
                        if tag not in tags_by_category[category]:
                            tags_by_category[category].append(tag)
        
        distinct_tags = sorted(set(all_tags))
        
        result = {
            'file': Path(file_path).name,
            'total_tags': len(all_tags),
            'distinct_tags_count': len(distinct_tags),
            'distinct_tags': distinct_tags,
            'tag_categories': dict(tag_categories),
            'tags_by_category': {k: sorted(v) for k, v in tags_by_category.items()}
        }
        
        return result
    except Exception as e:
        print(f"Error: {e}")
        return None

def main():
    data_dir = Path('/Users/jianqiaoji/Downloads/fffinalproto/data')
    tsv_files = list(data_dir.glob('*.tsv'))
    
    results = []
    for tsv_file in sorted(tsv_files):
        result = analyze_tags_detailed(tsv_file)
        if result:
            results.append(result)
    
    # 保存详细结果
    output_file = data_dir / 'detailed_tags_analysis.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    # 生成Markdown报告
    md_file = data_dir / '详细Tags分析报告.md'
    with open(md_file, 'w', encoding='utf-8') as f:
        f.write("# 详细Tags分析报告\n\n")
        f.write("本报告列出每个数据文件中的所有distinct tags。\n\n")
        
        for result in results:
            f.write(f"## {result['file']}\n\n")
            f.write(f"- **总标签数**: {result['total_tags']}\n")
            f.write(f"- **Distinct Tags数**: {result['distinct_tags_count']}\n")
            f.write(f"- **Tag类别统计**: {result['tag_categories']}\n\n")
            
            f.write("### 按类别分类的Tags\n\n")
            for category, tags in result['tags_by_category'].items():
                if tags:
                    f.write(f"#### {category} ({len(tags)}个)\n\n")
                    for tag in tags:
                        f.write(f"- `{category}---{tag}`\n")
                    f.write("\n")
            
            f.write("### 所有Distinct Tags列表\n\n")
            for tag in result['distinct_tags']:
                f.write(f"- `{tag}`\n")
            f.write("\n---\n\n")
    
    print(f"\nDetailed analysis completed!")
    print(f"JSON result: {output_file}")
    print(f"Markdown report: {md_file}")

if __name__ == '__main__':
    main()
