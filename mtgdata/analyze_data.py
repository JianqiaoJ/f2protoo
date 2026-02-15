#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析data文件夹内所有文档的字段结构
"""

import os
import json
import sys
import pandas as pd
from collections import Counter
from pathlib import Path

# 设置输出编码为UTF-8
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def analyze_tsv_file(file_path):
    """分析单个TSV文件"""
    print(f"\n{'='*80}")
    print(f"分析文件: {os.path.basename(file_path)}")
    print(f"{'='*80}")
    
    try:
        # 读取文件 - 使用更宽松的解析方式
        try:
            df = pd.read_csv(file_path, sep='\t', nrows=1000, on_bad_lines='skip', engine='python')
        except TypeError:
            df = pd.read_csv(file_path, sep='\t', nrows=1000, error_bad_lines=False, warn_bad_lines=False, engine='python')
        
        # 获取字段信息
        columns = df.columns.tolist()
        print(f"\n字段列表: {columns}")
        print(f"字段数量: {len(columns)}")
        
        # 检查是否包含歌曲名字和歌手名字
        has_track_name = any('track' in col.lower() and 'name' in col.lower() for col in columns)
        has_artist_name = any('artist' in col.lower() and 'name' in col.lower() for col in columns)
        has_track_title = any('title' in col.lower() for col in columns)
        
        print(f"\n是否包含歌曲名字: {has_track_name or has_track_title}")
        print(f"是否包含歌手名字: {has_artist_name}")
        
        # 检查是否有年份字段
        has_year = any('year' in col.lower() or 'date' in col.lower() for col in columns)
        print(f"是否包含年份/日期字段: {has_year}")
        
        # 读取完整文件进行统计 - 使用更宽松的解析
        try:
            # 旧版本pandas使用error_bad_lines
            df_full = pd.read_csv(file_path, sep='\t', error_bad_lines=False, warn_bad_lines=False, engine='python')
        except:
            # 如果还是失败，手动读取
            import csv
            rows = []
            with open(file_path, 'r', encoding='utf-8') as f:
                reader = csv.reader(f, delimiter='\t')
                header = next(reader)
                for row in reader:
                    if len(row) >= len(header):
                        rows.append(row[:len(header)])
            df_full = pd.DataFrame(rows, columns=header)
        total_rows = len(df_full)
        print(f"\n总记录数: {total_rows}")
        
        # 分析TAGS字段（如果存在）
        if 'TAGS' in columns:
            all_tags = []
            tag_categories = Counter()
            
            for tags_str in df_full['TAGS'].dropna():
                if tags_str and str(tags_str).strip() and str(tags_str) != 'nan':
                    # TAGS可能是单个标签或多个标签（用分隔符分隔）
                    # 先尝试按常见分隔符分割
                    tag_parts = str(tags_str).split('---')
                    if len(tag_parts) >= 2:
                        category = tag_parts[0]
                        tag = '---'.join(tag_parts[1:])  # 处理标签名中可能包含---的情况
                        all_tags.append(f"{category}---{tag}")
                        tag_categories[category] += 1
                    else:
                        all_tags.append(str(tags_str))
            
            distinct_tags = set(all_tags)
            print(f"\nDistinct Tags数量: {len(distinct_tags)}")
            print(f"Tag类别统计: {dict(tag_categories)}")
            
            # 显示前20个最常见的标签
            tag_counter = Counter(all_tags)
            print(f"\n最常见的20个标签:")
            for tag, count in tag_counter.most_common(20):
                print(f"  {tag}: {count}次")
        
        # 如果有年份字段，分析发行区间
        if has_year:
            year_col = None
            for col in columns:
                if 'year' in col.lower():
                    year_col = col
                    break
            
            if year_col:
                years = df_full[year_col].dropna()
                if len(years) > 0:
                    try:
                        years_numeric = pd.to_numeric(years, errors='coerce').dropna()
                        if len(years_numeric) > 0:
                            min_year = int(years_numeric.min())
                            max_year = int(years_numeric.max())
                            print(f"\n发行年份区间: {min_year} - {max_year}")
                            print(f"有年份信息的记录数: {len(years_numeric)}/{total_rows}")
                    except:
                        print(f"\n年份字段存在但无法解析为数字")
        
        # 显示前几行数据示例
        print(f"\n数据示例（前3行）:")
        print(df_full.head(3).to_string())
        
        return {
            'file': os.path.basename(file_path),
            'columns': columns,
            'has_track_name': has_track_name or has_track_title,
            'has_artist_name': has_artist_name,
            'has_year': has_year,
            'total_rows': total_rows,
            'distinct_tags_count': len(distinct_tags) if 'TAGS' in columns else 0,
            'tag_categories': dict(tag_categories) if 'TAGS' in columns else {}
        }
        
    except Exception as e:
        print(f"分析文件时出错: {e}")
        return None

def analyze_tag_files():
    """分析tags文件夹中的文件"""
    tags_dir = Path('/Users/jianqiaoji/Downloads/fffinalproto/data/tags')
    print(f"\n{'='*80}")
    print(f"分析tags文件夹")
    print(f"{'='*80}")
    
    for tag_file in tags_dir.glob('*.txt'):
        print(f"\n文件: {tag_file.name}")
        with open(tag_file, 'r', encoding='utf-8') as f:
            tags = [line.strip() for line in f if line.strip()]
            print(f"标签数量: {len(tags)}")
            print(f"前10个标签:")
            for tag in tags[:10]:
                print(f"  {tag}")

def main():
    data_dir = Path('/Users/jianqiaoji/Downloads/fffinalproto/data')
    
    # 分析所有TSV文件
    tsv_files = list(data_dir.glob('*.tsv'))
    
    results = []
    for tsv_file in sorted(tsv_files):
        result = analyze_tsv_file(tsv_file)
        if result:
            results.append(result)
    
    # 分析tag_map.json
    print(f"\n{'='*80}")
    print(f"分析tag_map.json")
    print(f"{'='*80}")
    tag_map_path = data_dir / 'tag_map.json'
    if tag_map_path.exists():
        with open(tag_map_path, 'r', encoding='utf-8') as f:
            tag_map = json.load(f)
            print(f"Tag映射类别: {list(tag_map.keys())}")
            for category, mappings in tag_map.items():
                print(f"  {category}: {len(mappings)}个映射")
    
    # 分析tags文件夹
    analyze_tag_files()
    
    # 生成总结报告
    print(f"\n{'='*80}")
    print(f"总结报告")
    print(f"{'='*80}")
    print(f"\n所有文件字段分析:")
    for result in results:
        print(f"\n文件: {result['file']}")
        print(f"  字段: {', '.join(result['columns'])}")
        print(f"  包含歌曲名字: {result['has_track_name']}")
        print(f"  包含歌手名字: {result['has_artist_name']}")
        print(f"  包含年份字段: {result['has_year']}")
        print(f"  记录数: {result['total_rows']}")
        print(f"  Distinct Tags数: {result['distinct_tags_count']}")
    
    # 保存结果到文件
    output_file = data_dir / 'analysis_report.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n详细分析结果已保存到: {output_file}")

if __name__ == '__main__':
    main()
