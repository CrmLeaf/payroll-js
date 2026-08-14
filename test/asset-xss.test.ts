// @vitest-environment happy-dom

/**
 * The published browser assets must not build markup from values a user typed.
 *
 * `resources/assets/<slug>.js` is copied into the consuming application's public
 * directory by `vendor:publish`, so a payload rendered here becomes their
 * cross-site scripting bug, in a page handling salary data. Several of the values
 * it renders are free text: an employee name, a code, a designation.
 *
 * The asset is generated from `stubs/tool/asset.js.stub`, so this asserts against
 * the generated output for every tool rather than one copy. A single tool
 * regenerated from a modified stub would fail here.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..', '..');
const toolsDir = resolve(root, 'tools');

/**
 * `tools/` is generated in the monorepo and is not part of this package, so it is
 * absent from a split checkout or an npm tarball. Skip there rather than fail:
 * the assets under test are not this package's to ship.
 */
const describeAssets = existsSync(toolsDir) ? describe : describe.skip;
const tools = existsSync(toolsDir) ? readdirSync(toolsDir) : [];

describeAssets('the published browser assets', () => {
  it('covers every tool', () => {
    expect(tools.length).toBe(15);
  });

  it.each(tools)('%s builds no markup from a value', (slug) => {
    const source = readFileSync(resolve(root, 'tools', slug, 'resources/assets', `${slug}.js`), 'utf8');

    // Strip comments first: the stub explains why innerHTML is avoided, and that
    // sentence should not be what makes this test pass or fail.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/\.innerHTML\s*=/);
    expect(code).not.toMatch(/\.outerHTML\s*=/);
    expect(code).not.toMatch(/insertAdjacentHTML/);
    expect(code).not.toMatch(/document\.write/);
  });

  it.each(tools)('%s ships a demo page that builds no markup', (slug) => {
    // demo/index.html is opened straight from disk, so anything it assembled
    // from a value would run with no server and no Content-Security-Policy in
    // front of it. The page is static and the calculator renders itself into a
    // shadow root, so there is nothing here that needs a sink - this asserts
    // that stays true.
    const page = readFileSync(resolve(root, 'tools', slug, 'demo/index.html'), 'utf8');
    const code = page.replace(/<!--[\s\S]*?-->/g, '');

    expect(code).not.toMatch(/\.innerHTML\s*=/);
    expect(code).not.toMatch(/\.outerHTML\s*=/);
    expect(code).not.toMatch(/insertAdjacentHTML/);
    expect(code).not.toMatch(/document\.write/);
    expect(code).not.toMatch(/eval\(/);

    // The page must not reach the network. A calculator people paste salary
    // figures into has no business making a request, and the whole claim of the
    // script-tag route is that it works offline.
    expect(code).not.toMatch(/https?:\/\/(?!github\.com|www\.w3\.org)/);
  });

  it('renders a script payload as text, not as an element', () => {
    // The shape the asset produces, exercised directly: a name containing markup
    // must arrive as characters in a cell, not as a child element.
    const host = document.createElement('div');
    const cell = document.createElement('td');

    cell.textContent = '<img src=x onerror=alert(1)>';
    host.appendChild(cell);

    expect(host.querySelector('img')).toBeNull();
    expect(cell.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(host.innerHTML).toContain('&lt;img');
  });
});
