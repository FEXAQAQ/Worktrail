/**
 * CodeMirror 6 編輯器：Markdown 報告與 prompt 範本共用。
 * 範本模式提供 `{{` 自動完成，並以波浪底線標示未定義的變數（規格 11.4）。
 */
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme } from '../lib/app';

export const VARIABLE_DOCS: Record<string, string> = {
  period: '期間文字，例如 2026-11-09 ～ 2026-11-15（小交流為第一天到最後一天）',
  period_start: '起始日期',
  period_end: '結束日期',
  today: '產生當天日期',
  user_name: '設定中的使用者名稱',
  records: '週報／小交流：依日期列出任務與子項；績效：各週週報內文',
  dates: '小交流勾選的日期，例如 11/12（四）、11/14（五）',
  stats: '統計數字表',
  previous: '上一期同類型報告的內文',
  transcript: '精簡後的對話內容',
  draft: '擷取到的單號、專案、標題候選、commit',
  previous_items: '同單號前次未完成的子項',
};

/** 標題只加粗不加底線（前段 YAML 後接 --- 會被 Markdown 當成標題） */
const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, fontWeight: '700', textDecoration: 'none' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.link, color: 'var(--accent)' },
    { tag: tags.monospace, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' },
    { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--ink-3)' },
    { tag: tags.list, color: 'var(--ink-2)' },
    { tag: tags.quote, color: 'var(--ink-2)' },
  ]),
);

function variablePlugin(known: Set<string>) {
  const known_ = Decoration.mark({ class: 'cm-known-var' });
  const unknown = Decoration.mark({ class: 'cm-unknown-var', attributes: { title: '未定義的變數：產生時會保留原字樣' } });
  const build = (view: EditorView): DecorationSet => {
    const b = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      for (const m of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
        const start = from + m.index!;
        b.add(start, start + m[0].length, known.has(m[1]!) ? known_ : unknown);
      }
    }
    return b.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function variableCompletion(vars: string[]) {
  return (ctx: CompletionContext) => {
    const m = ctx.matchBefore(/\{\{\s*\w*/);
    if (!m) return null;
    const prefixLen = m.text.match(/^\{\{\s*/)![0].length;
    return {
      from: m.from + prefixLen,
      options: vars.map((v) => ({ label: v, detail: VARIABLE_DOCS[v], apply: `${v}}}`, type: 'variable' })),
      validFor: /^\w*$/,
    };
  };
}

export function Editor({ value, onChange, variables, readOnly, onBlur, minHeight = '420px' }: { value: string; onChange?: (v: string) => void; variables?: string[]; readOnly?: boolean; onBlur?: () => void; minHeight?: string }) {
  const { theme } = useTheme();
  const dark = document.documentElement.classList.contains('dark');
  const extensions = useMemo(() => {
    const ext = [markdown(), highlight, EditorView.lineWrapping];
    if (variables) {
      ext.push(variablePlugin(new Set(variables)));
      ext.push(autocompletion({ override: [variableCompletion(variables)] }));
    }
    if (onBlur) ext.push(EditorView.domEventHandlers({ blur: () => onBlur() }));
    return ext;
  }, [variables, onBlur]);
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      editable={!readOnly}
      theme={dark ? 'dark' : 'light'}
      key={`${theme}-${dark}`}
      extensions={extensions}
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly, autocompletion: !!variables, syntaxHighlighting: false }}
      style={{ minHeight, height: '100%' }}
      minHeight={minHeight}
    />
  );
}

export function MarkdownView({ text }: { text: string }) {
  return (
    <div className="prose-wt">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}
