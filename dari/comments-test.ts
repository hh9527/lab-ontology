import assert from 'node:assert/strict';
import {check} from './src/compiler.ts';
import {parse} from './src/syntax.ts';
const source='# 文档注释\r\ndata value = 6.0 / 2.0; # 行尾注释\r\ndata label = "https://example.com/#part /* text */";\nanswer tree! {Answer [Value(value=value),p ["# 文本"]]}; # 文件末尾';
assert.equal(parse(source).length,3);
assert(check(source).bindings.has('value'));
assert.equal(parse('data label="a#b";')[0].value.value,'a#b');
console.log('Hash comments: full lines, trailing comments, CRLF, EOF, literal text and division passed');
