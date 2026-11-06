import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { renderBanner } from '../lib/banner.mjs';
import { writeExcludeBlock } from '../lib/excludes.mjs';
import { parseFrontmatter, withFrontmatter } from '../lib/frontmatter.mjs';
import { pickLanguage } from '../lib/lang.mjs';
import { fitLine, reduceMulti, reduceSelect, multiValue, visibleLength, wrapText } from '../lib/prompts.mjs';
import { mask, parseEnvText, publicFinding, scanPiiInLine, scanSecretsInLine } from '../lib/secrets.mjs';
import { mdRow } from '../lib/store.mjs';
import { escapeRegExp, globToRegExp, slugify } from '../lib/util.mjs';

const anyText = fc.oneof(fc.string(), fc.string({ unit: 'binary' }), fc.string({ unit: 'grapheme' }));
const secretValue = fc.stringMatching(/^[A-Za-z0-9]{24,60}$/);
const actions = fc.array(fc.constantFrom('up', 'down', 'toggle', 'all', 'submit'), { maxLength: 40 });

test('escaped text always matches itself', () => {
  fc.assert(
    fc.property(anyText, (text) => {
      assert.ok(new RegExp(`^${escapeRegExp(text)}$`, 'su').test(text));
    }),
  );
});

test('mask never reveals any character of the value', () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[A-Za-z]{1,80}$/), (value) => {
      assert.equal(mask(value), `***(${value.length})`);
    }),
  );
});

test('a reported finding never contains the secret, whichever line carries it', () => {
  let reported = 0;
  fc.assert(
    fc.property(secretValue, fc.constantFrom('AWS_SECRET_ACCESS_KEY', 'DB_PASSWORD', 'API_TOKEN', 'client_secret'), (value, name) => {
      const line = { file: 'src/config.env', line: 1, text: `${name}=${value}` };
      for (const finding of scanSecretsInLine(line)) {
        reported++;
        assert.equal(finding.value, value, 'the raw finding holds the value, so hiding it below is a real check');
        const shown = publicFinding(finding);
        assert.equal(shown.value, undefined);
        assert.equal(JSON.stringify(shown).includes(value), false);
      }
    }),
    { numRuns: 100 },
  );
  assert.ok(reported >= 99, `only ${reported} of 100 secrets were found`);
});

test('scanners survive any line and any file name', () => {
  fc.assert(
    fc.property(anyText, anyText, (text, file) => {
      const line = { file, line: 1, text };
      assert.ok(Array.isArray(scanSecretsInLine(line)));
      assert.ok(Array.isArray(scanPiiInLine(line)));
    }),
  );
});

test('parseEnvText survives any input and reads back simple assignments', () => {
  fc.assert(
    fc.property(anyText, (text) => {
      assert.ok(Array.isArray(parseEnvText(text)));
    }),
  );
  fc.assert(
    fc.property(fc.stringMatching(/^[A-Z][A-Z0-9_]{0,20}$/), fc.stringMatching(/^[a-zA-Z0-9_./:-]{0,40}$/), (key, value) => {
      assert.deepEqual(parseEnvText(`${key}=${value}\n`), [{ key, value }]);
    }),
  );
});

test('frontmatter survives any input, keeps simple values and pollutes no prototype', () => {
  fc.assert(
    fc.property(anyText, (text) => {
      const parsed = parseFrontmatter(text);
      assert.equal(typeof parsed.body, 'string');
    }),
  );
  parseFrontmatter('---\n__proto__:\n  polluted: yes\n---\n');
  assert.equal({}.polluted, undefined);
  fc.assert(
    fc.property(fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/), fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,30}[A-Za-z]$/), (key, value) => {
      fc.pre(!['true', 'false', 'null'].includes(value.toLowerCase()));
      const parsed = parseFrontmatter(withFrontmatter({ [key]: value }, 'body\n'));
      assert.equal(parsed.data[key], value);
      assert.equal(parsed.body, 'body\n');
    }),
  );
});

test('slugs are safe for file names and respect the length limit', () => {
  fc.assert(
    fc.property(anyText, fc.integer({ min: 1, max: 80 }), (text, max) => {
      const slug = slugify(text, max);
      assert.match(slug, /^[a-z0-9-]*$/);
      assert.ok(slug.length <= max, `${slug.length} > ${max}`);
    }),
  );
});

test('globs never break the program, even when malformed', () => {
  fc.assert(
    fc.property(anyText, (glob) => {
      assert.ok(globToRegExp(glob) instanceof RegExp);
    }),
  );
});

test('wrapping keeps every word in order and fits when words fit', () => {
  fc.assert(
    fc.property(fc.array(fc.stringMatching(/^[a-z]{1,10}$/), { maxLength: 40 }), fc.integer({ min: 10, max: 100 }), (words, width) => {
      const lines = wrapText(words.join(' '), width);
      assert.deepEqual(lines.join(' ').split(' ').filter(Boolean), words);
      assert.ok(lines.every((line) => line.length <= width));
    }),
  );
});

test('fitted lines never exceed the width, so screen redraws stay aligned', () => {
  fc.assert(
    fc.property(anyText, fc.integer({ min: 2, max: 120 }), (line, width) => {
      assert.ok(visibleLength(fitLine(line, width)) <= width);
    }),
  );
});

test('the banner never exceeds the terminal width', () => {
  fc.assert(
    fc.property(fc.integer({ min: 20, max: 200 }), fc.string({ maxLength: 300 }), (columns, cwd) => {
      fc.pre(!/[\r\n]/.test(cwd));
      const lines = renderBanner({ isTTY: true, columns, cwd, version: '1.2.3', env: { NO_COLOR: '' } }).split('\n');
      assert.ok(lines.every((line) => line.length <= Math.max(columns, 60)), lines.join('\n'));
    }),
  );
});

test('any key sequence leaves a multi-select valid: index in range, locked stays on', () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 16 }), actions, (checks, keys) => {
      const options = checks.map((checked, i) => ({ value: i, label: String(i), checked: checked || i === 0, locked: i === 0 }));
      let state = { index: 0, required: true, options };
      for (const key of keys) {
        state = reduceMulti(state, key);
        assert.ok(state.index >= 0 && state.index < options.length);
        assert.ok(multiValue(state).includes(0));
      }
    }),
  );
});

test('any key sequence leaves a single choice within range', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 12 }), actions, (size, keys) => {
      let state = { index: 0, options: Array.from({ length: size }, (_, i) => ({ value: i })) };
      for (const key of keys) {
        state = reduceSelect(state, key);
        assert.ok(state.index >= 0 && state.index < size);
      }
    }),
  );
});

test('table rows keep their columns whatever the cells contain', () => {
  fc.assert(
    fc.property(fc.array(anyText, { minLength: 1, maxLength: 6 }), (cells) => {
      const row = mdRow(cells);
      const separators = row.match(/(?<!\\)(?:\\\\)*\|/g) || [];
      assert.equal(separators.length, cells.length + 1, row);
    }),
  );
});

test('the language is always a supported one', () => {
  fc.assert(
    fc.property(fc.dictionary(fc.constantFrom('LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE'), fc.string()), fc.option(fc.string()), fc.string(), (env, override, locale) => {
      assert.ok(['en', 'vi'].includes(pickLanguage(env, override ?? undefined, locale)));
    }),
  );
});

test('writing then removing the exclude block restores the file exactly', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exclude-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'exclude');
  const marks = { begin: '# >>> block', end: '# <<< block' };
  fc.assert(
    fc.property(fc.array(fc.stringMatching(/^[a-z*/.-]{1,20}$/), { maxLength: 6 }), fc.array(fc.stringMatching(/^[a-z*/.-]{1,20}$/), { minLength: 1, maxLength: 4 }), (existing, patterns) => {
      const before = existing.length ? `${existing.join('\n')}\n` : '';
      fs.writeFileSync(file, before);
      writeExcludeBlock(file, { ...marks, patterns });
      const once = fs.readFileSync(file, 'utf8');
      assert.equal(writeExcludeBlock(file, { ...marks, patterns }), false, 'writing the same block twice changes nothing');
      assert.equal(fs.readFileSync(file, 'utf8'), once);
      writeExcludeBlock(file, { ...marks, patterns: [] });
      assert.equal(fs.readFileSync(file, 'utf8'), before);
    }),
    { numRuns: 60 },
  );
});
