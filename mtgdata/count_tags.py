#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
统计所有TSV文件中每个tag出现的次数，并按次数倒序排列
"""

import csv
from collections import Counter
import os

def count_tags_in_file(filepath):
    """统计单个文件中的tags"""
    tag_counter = Counter()
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter='\t')
            next(reader)  # 跳过表头
            
            for row in reader:
                if len(row) >= 6:  # 确保有TAGS列
                    tags_str = row[5]  # TAGS在第6列（索引5）
                    if tags_str:
                        # 分割tags（可能是空格或制表符分隔）
                        tags = tags_str.split()
                        for tag in tags:
                            tag = tag.strip()
                            if tag:
                                tag_counter[tag] += 1
    except Exception as e:
        print(f"处理文件 {filepath} 时出错: {e}")
    
    return tag_counter

def main():
    # 要处理的TSV文件列表
    tsv_files = [
        'raw.tsv',
        'raw_30s.tsv',
        'raw_30s_cleantags.tsv',
        'raw_30s_cleantags_50artists.tsv',
        'autotagging.tsv',
        'autotagging_genre.tsv',
        'autotagging_instrument.tsv',
        'autotagging_moodtheme.tsv',
    ]
    
    # 统计所有tags
    all_tags_counter = Counter()
    
    for filename in tsv_files:
        filepath = os.path.join(os.path.dirname(__file__), filename)
        if os.path.exists(filepath):
            print(f"正在处理: {filename}...")
            tag_counter = count_tags_in_file(filepath)
            all_tags_counter.update(tag_counter)
            print(f"  - 找到 {len(tag_counter)} 个不同的tag")
        else:
            print(f"文件不存在: {filename}")
    
    # 按次数倒序排列
    sorted_tags = sorted(all_tags_counter.items(), key=lambda x: x[1], reverse=True)
    
    # 输出结果
    print("\n" + "="*80)
    print(f"总共找到 {len(sorted_tags)} 个不同的tag")
    print("="*80)
    print(f"{'排名':<6} {'Tag':<50} {'出现次数':<12}")
    print("-"*80)
    
    for rank, (tag, count) in enumerate(sorted_tags, 1):
        print(f"{rank:<6} {tag:<50} {count:<12}")
    
    # 保存到文件
    output_file = os.path.join(os.path.dirname(__file__), 'tag_count_statistics.txt')
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("Tag出现次数统计（按次数倒序排列）\n")
        f.write("="*80 + "\n")
        f.write(f"总共找到 {len(sorted_tags)} 个不同的tag\n")
        f.write("="*80 + "\n")
        f.write(f"{'排名':<6} {'Tag':<50} {'出现次数':<12}\n")
        f.write("-"*80 + "\n")
        
        for rank, (tag, count) in enumerate(sorted_tags, 1):
            f.write(f"{rank:<6} {tag:<50} {count:<12}\n")
    
    print(f"\n结果已保存到: {output_file}")
    
    # 也保存为CSV格式
    csv_file = os.path.join(os.path.dirname(__file__), 'tag_count_statistics.csv')
    with open(csv_file, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['排名', 'Tag', '出现次数'])
        for rank, (tag, count) in enumerate(sorted_tags, 1):
            writer.writerow([rank, tag, count])
    
    print(f"CSV格式结果已保存到: {csv_file}")

if __name__ == '__main__':
    main()
