import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';

const bundlePath = resolve(process.cwd(), 'dist/payroll.min.js');
const examplePath = resolve(process.cwd(), 'examples/embed.html');

/**
 * The example page is the deliverable a reader will judge "embeddable in a plain
 * HTML file" by, so it is exercised rather than eyeballed: the real file, the real
 * built bundle, every widget on it expected to render a figure.
 *
 * The document is assembled in the order a browser parses it - the classic script
 * runs, then the markup below it is parsed - because that ordering is the whole
 * reason a bare custom element works with no code from the author.
 */
const describeExample = existsSync(bundlePath) ? describe : describe.skip;

describeExample('examples/embed.html, loaded for real', () => {
  async function openPage(): Promise<Window> {
    const html = readFileSync(examplePath, 'utf8');
    const marker = '<script src="../dist/payroll.min.js"></script>';
    const [head, tail] = html.split(marker);

    expect(head, 'the example no longer loads ../dist/payroll.min.js').toBeTruthy();

    const window = new Window({ url: 'https://example.test/' });

    window.document.write(head);
    await window.happyDOM.waitUntilComplete();

    const bundle = window.document.createElement('script');
    bundle.textContent = readFileSync(bundlePath, 'utf8');
    window.document.head.append(bundle);
    await window.happyDOM.waitUntilComplete();

    window.document.body.insertAdjacentHTML('beforeend', tail.replace(/<\/body>[\s\S]*$/, ''));
    await window.happyDOM.waitUntilComplete();

    // The page's own trailing script, which demonstrates the library API.
    const inline = /<script>\s*\n\s*\/\/ Everything above([\s\S]*?)<\/script>/.exec(tail);
    if (inline) {
      const demo = window.document.createElement('script');
      demo.textContent = `// Everything above${inline[1]}`;
      window.document.body.append(demo);
      await window.happyDOM.waitUntilComplete();
    }

    (window as unknown as { Payroll: { mountPayrollTools(root: unknown): number } }).Payroll.mountPayrollTools(
      window.document,
    );
    await window.happyDOM.waitUntilComplete();

    return window;
  }

  it('renders every widget on the page, with no errors', async () => {
    const window = await openPage();

    const widgets = Array.from(window.document.querySelectorAll('*')).filter((node) =>
      node.tagName.toLowerCase().startsWith('payroll-'),
    );

    expect(widgets.length).toBeGreaterThanOrEqual(12);

    for (const widget of widgets) {
      const root = widget.shadowRoot;
      const name = widget.tagName.toLowerCase();

      expect(root, `${name} did not upgrade`).not.toBeNull();
      expect(root!.querySelector('.note.error')?.textContent ?? null, `${name} reported an error`).toBeNull();
      expect(root!.querySelector('.headline-value')?.textContent, `${name} rendered no figure`).toBeTruthy();
    }

    await window.happyDOM.close();
  });

  it('never shows the "not built yet" fallback when the bundle is present', async () => {
    const window = await openPage();

    const fallback = window.document.getElementById('fallback') as unknown as HTMLElement;
    expect(fallback.style.display).not.toBe('block');

    await window.happyDOM.close();
  });

  it('runs the library-API demonstration at the foot of the page', async () => {
    const window = await openPage();

    expect(window.document.getElementById('scripted')?.textContent).toContain('(15 × 45,000.00 × 8) ÷ 26');

    await window.happyDOM.close();
  });
});
