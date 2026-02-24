import React from 'react';
import { splitTextByTagDisplay } from '../utils/tagToChinese';

/** 渲染文案，将「英文 中文」标签段落加粗（用于气泡、对话框等） */
export function TextWithBoldTags({
  text,
  className,
  as: Component = 'span',
}: {
  text: string;
  className?: string;
  as?: 'span' | 'p' | 'div';
}) {
  const segments = splitTextByTagDisplay(text);
  if (segments.length === 0) return null;
  return (
    <Component className={className}>
      {segments.map((seg, i) =>
        seg.type === 'tag' ? (
          <strong key={i}>{seg.text}</strong>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        )
      )}
    </Component>
  );
}
