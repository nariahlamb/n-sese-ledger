import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function loadTs(path) {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'esm',
    target: 'node22', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { stripContextTags } = await loadTs('src/unified-statusbar/core/context-strip.ts');

test('台账侧复用 context-strip：thinking 内含孤儿标签时仍完整保留 <content> 正文', () => {
  const tags = ['options', 'updatevariable', 'orange', 'novel_header', 'thinking'];
  const raw = [
    '<thinking>提及 <orange> 与 <novel_header>，结尾输出 <UpdateVariable> 和 <options>。</thinking>',
    '<content>',
    '<novel_header>[ChapterInfo|1]</novel_header>',
    '桃井奈奈搬进 204 室，走廊飘着烟味。',
    '<orange><div>入住须知</div></orange>',
    '尼古喵喵拍开 202 室门跟后辈借烟，被呛得直咳嗽。',
    '</content>',
    '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>',
    '<options>1. 递水</options>',
  ].join('\n');

  const out = stripContextTags(raw, tags);
  assert.equal(out.includes('<thinking>'), false);
  assert.equal(out.includes('<options>'), false);
  assert.equal(out.includes('桃井奈奈搬进 204 室，走廊飘着烟味。'), true);
  assert.equal(out.includes('尼古喵喵拍开 202 室门跟后辈借烟，被呛得直咳嗽。'), true);
});
