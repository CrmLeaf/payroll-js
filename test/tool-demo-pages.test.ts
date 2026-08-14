import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';

const root = resolve(process.cwd(), '..', '..');
const bundlePath = resolve(process.cwd(), 'dist/payroll.min.js');
const toolsDir = resolve(root, 'tools');
const tools = existsSync(toolsDir) ? readdirSync(toolsDir).sort() : [];

/**
 * Each tool ships `demo/index.html`: a working copy of that one calculator in a
 * single file, opened straight from disk.
 *
 * It is the first thing anyone cloning a tool repository will try, so it is
 * rendered here rather than eyeballed - the real generated file, the real built
 * bundle, three elements per page expected to produce a figure. A page that
 * silently rendered nothing would be worse than no page, because it would read
 * as the calculator being broken.
 *
 * The document is assembled in the order a browser parses it: the classic script
 * runs, then the markup below it. That ordering is the whole reason a bare custom
 * element works with no code from the reader.
 */
const describeDemos = existsSync(bundlePath) && existsSync(toolsDir) ? describe : describe.skip;

describeDemos('every tool demo page, rendered for real', () => {
  async function openDemo(slug: string): Promise<Window> {
    const html = readFileSync(resolve(root, 'tools', slug, 'demo/index.html'), 'utf8');
    const marker = '<script src="./payroll.min.js"></script>';
    const [head, tail] = html.split(marker);

    expect(head, `${slug} no longer loads ./payroll.min.js`).toBeTruthy();

    const window = new Window({ url: 'https://example.test/' });

    window.document.write(head);
    await window.happyDOM.waitUntilComplete();

    const bundle = window.document.createElement('script');
    bundle.textContent = readFileSync(bundlePath, 'utf8');
    window.document.head.append(bundle);
    await window.happyDOM.waitUntilComplete();

    window.document.body.insertAdjacentHTML('beforeend', tail.replace(/<\/body>[\s\S]*$/, ''));
    await window.happyDOM.waitUntilComplete();

    // insertAdjacentHTML deliberately never executes a <script> it inserts, so
    // the page's own guard - the one deciding whether to show the missing-bundle
    // notice - would not run, and the assertion below about what it decided
    // would pass without testing anything. Re-creating the element inserts it
    // properly, which is what makes it execute.
    //
    // That blind spot was not hypothetical: the guard checked for a global the
    // bundle does not set, so all fifteen pages accused a working calculator of
    // being broken, and this test called it fine.
    for (const inert of Array.from(window.document.body.querySelectorAll('script'))) {
      const live = window.document.createElement('script');

      live.textContent = inert.textContent;
      inert.replaceWith(live);
    }

    await window.happyDOM.waitUntilComplete();

    return window;
  }

  it('covers every tool', () => {
    expect(tools.length).toBe(15);
  });

  it.each(tools)('%s renders its calculator three ways', async (slug) => {
    const window = await openDemo(slug);

    // Two <payroll-{slug}> elements - bare, and with a starting attribute - plus
    // the <div data-payroll> form, which the bundle mounts on load.
    const widgets = Array.from(window.document.querySelectorAll('*')).filter((node) =>
      node.tagName.toLowerCase().startsWith('payroll-'),
    );

    expect(widgets.length, `${slug} should show the element twice`).toBe(2);

    for (const widget of widgets) {
      const shadow = widget.shadowRoot;

      expect(shadow, `${slug} did not upgrade`).not.toBeNull();
      expect(
        shadow!.querySelector('.note.error')?.textContent ?? null,
        `${slug} reported an error`,
      ).toBeNull();
      expect(
        shadow!.querySelector('.headline-value')?.textContent,
        `${slug} rendered no figure`,
      ).toBeTruthy();
    }

    await window.happyDOM.close();
  });

  it.each(tools)('%s hides the missing-bundle notice when the bundle is there', async (slug) => {
    const window = await openDemo(slug);

    // The inline script only unhides it, so a reader who did copy the file never
    // sees a warning about not having copied it.
    const notice = window.document.getElementById('missing-bundle') as unknown as HTMLElement;

    expect(notice, `${slug} has no missing-bundle notice`).not.toBeNull();
    expect(notice.hidden, `${slug} warned about a bundle that is present`).toBe(true);

    await window.happyDOM.close();
  });

  it.each(tools)('%s starting attribute names a field the element accepts', async (slug) => {
    const window = await openDemo(slug);

    const withAttribute = Array.from(window.document.querySelectorAll('*')).find(
      (node) =>
        node.tagName.toLowerCase() === `payroll-${slug}` && node.attributes.length > 0,
    );

    expect(withAttribute, `${slug} demonstrates no starting attribute`).toBeTruthy();

    const attribute = withAttribute!.attributes[0];
    const field = attribute.name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const control = withAttribute!.shadowRoot!.querySelector(`[name="${field}"]`);

    // An attribute that matches no field is silently ignored by the element, so
    // the page would be documenting something that does nothing.
    expect(control, `${slug}: ${attribute.name} matches no control`).not.toBeNull();
    expect(
      (control as unknown as HTMLInputElement).value,
      `${slug}: ${attribute.name} did not reach the form`,
    ).toBe(attribute.value);

    await window.happyDOM.close();
  });
});
