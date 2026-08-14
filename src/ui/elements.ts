/**
 * The embeddable widgets.
 *
 * A static HTML file drops in the UMD bundle and writes
 * `<payroll-gratuity-calculator></payroll-gratuity-calculator>`, and a working,
 * accessible, self-contained calculator appears. No build step, no framework, and
 * no way for the host page's stylesheet to reach inside and break it.
 *
 * Three things are deliberate here. Everything renders into a shadow root, so the
 * host's CSS is isolated from ours in both directions. Every control is a real
 * labelled form control, and the results region is an `aria-live` region, so a
 * screen reader announces the new figure as soon as it changes. And nothing is
 * ever assembled with `innerHTML` from a value - text goes in through
 * `textContent`, so a page that passes user input through an attribute cannot
 * turn that into script.
 */

import { WIDGET_STYLES } from './styles.js';
import {
  type FieldValues,
  TOOLS,
  type ToolDefinition,
  type ToolField,
  type ToolOutput,
  findTool,
} from './tools.js';
import { formatDate } from '../dates.js';
import { PayrollError } from '../errors.js';

let instanceCounter = 0;

/**
 * What the widget classes extend.
 *
 * In a browser this is the real `HTMLElement`. Everywhere else - server-side
 * rendering, a Node test runner, a build step importing the calculators - there
 * is no DOM, and evaluating `class X extends HTMLElement` at module scope throws
 * `ReferenceError` the moment the module loads. The root entry re-exports this
 * file, so that one line made `import '@crmleaf/payroll-js'` fail outright in
 * Node even for callers who only wanted the arithmetic.
 *
 * Falling back to an inert class keeps importing the package free of side
 * effects. Nothing can accidentally use the inert version: `definePayrollElements()`
 * returns early without a `customElements` registry, and there is no registry
 * without a DOM.
 */
const CustomElementBase: typeof HTMLElement =
  typeof HTMLElement === 'undefined'
    ? (class {} as unknown as typeof HTMLElement)
    : HTMLElement;

/** Attribute name for a field: `annualCtc` is set as `annual-ctc="1200000"`. */
function attributeFor(field: ToolField): string {
  return field.name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

export class PayrollToolElement extends CustomElementBase {
  static observedAttributes = ['tool', 'heading', 'theme'];

  /** Subclasses pin their tool; `<payroll-tool tool="...">` reads the attribute. */
  protected toolSlug: string | null = null;

  private tool: ToolDefinition | null = null;
  private readonly uid = `pt${(instanceCounter += 1)}`;
  private form: HTMLFormElement | null = null;
  private output: HTMLElement | null = null;
  private rendered = false;

  connectedCallback(): void {
    if (!this.rendered) {
      this.render();
      this.rendered = true;
    }
    this.run();
  }

  attributeChangedCallback(): void {
    if (this.rendered) {
      this.render();
      this.run();
    }
  }

  /** The current form values, so a host page can read or persist them. */
  get values(): FieldValues {
    if (!this.tool || !this.form) return {};

    const values: FieldValues = {};

    for (const field of this.tool.fields) {
      const control = this.form.elements.namedItem(field.name);
      if (!control) continue;

      values[field.name] =
        control instanceof HTMLInputElement && control.type === 'checkbox'
          ? control.checked
          : (control as HTMLInputElement | HTMLSelectElement).value;
    }

    return values;
  }

  private resolveTool(): ToolDefinition | null {
    const name = this.toolSlug ?? this.getAttribute('tool') ?? this.tagName.toLowerCase();
    return findTool(name) ?? null;
  }

  private render(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.replaceChildren();

    const style = document.createElement('style');
    style.textContent = WIDGET_STYLES;
    root.append(style);

    this.tool = this.resolveTool();

    if (!this.tool) {
      const failure = el('div', 'note error');
      failure.textContent = `Unknown payroll tool "${this.getAttribute('tool') ?? this.tagName.toLowerCase()}". Known tools: ${TOOLS.map((tool) => tool.slug).join(', ')}.`;
      root.append(failure);
      return;
    }

    const head = el('div', 'head');
    const heading = el('h2', 'title', this.getAttribute('heading') ?? this.tool.name);
    head.append(heading);

    if (!this.hasAttribute('hide-tagline')) {
      head.append(el('p', 'tagline', this.tool.tagline));
    }

    root.append(head);

    this.form = this.buildForm(this.tool);
    root.append(this.form);

    this.output = el('div', 'result');
    this.output.setAttribute('role', 'status');
    this.output.setAttribute('aria-live', 'polite');
    root.append(this.output);
  }

  private buildForm(tool: ToolDefinition): HTMLFormElement {
    const form = document.createElement('form');
    form.noValidate = true;

    for (const field of tool.fields) {
      form.append(this.buildField(field));
    }

    const actions = el('div', 'actions');
    const submit = el('button', undefined, 'Calculate');
    submit.type = 'submit';
    actions.append(submit);
    form.append(actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.run();
    });

    // Recalculating as the user types is what makes these feel like a calculator
    // rather than a form. The button stays for keyboard and screen-reader users
    // who expect an explicit submit, and for anyone who has scripted it.
    form.addEventListener('input', () => this.run());
    form.addEventListener('change', () => this.run());

    return form;
  }

  private buildField(field: ToolField): HTMLElement {
    const id = `${this.uid}-${field.name}`;
    const wrapper = el('div', field.type === 'checkbox' ? 'field check field--wide' : 'field');

    const label = el('label', undefined, field.label);
    label.htmlFor = id;

    const override = this.getAttribute(attributeFor(field));
    const initial = override ?? (field.default === undefined ? '' : String(field.default));

    let control: HTMLInputElement | HTMLSelectElement;

    if (field.type === 'select') {
      const select = document.createElement('select');
      for (const option of field.options ?? []) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        select.append(node);
      }
      select.value = initial;
      control = select;
    } else {
      const input = document.createElement('input');

      if (field.type === 'checkbox') {
        input.type = 'checkbox';
        input.checked = override === null ? field.default === true : override !== 'false';
      } else if (field.type === 'date') {
        input.type = 'date';
        input.value = initial;
      } else if (field.type === 'text') {
        input.type = 'text';
        input.value = initial;
      } else {
        input.type = 'number';
        input.inputMode = 'decimal';
        input.value = initial;
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        input.step = String(field.step ?? (field.type === 'money' ? 1 : 'any'));
      }

      control = input;
    }

    control.id = id;
    control.name = field.name;

    let hint: HTMLElement | null = null;

    if (field.hint) {
      hint = el('span', 'hint', field.hint);
      hint.id = `${id}-hint`;
      control.setAttribute('aria-describedby', hint.id);
    }

    if (field.type === 'checkbox') {
      // The box sits beside a stacked label and hint, so the tick lines up with
      // the label text rather than floating above a two-line description.
      const stack = el('div');
      stack.append(label);
      if (hint) stack.append(hint);
      wrapper.append(control, stack);
      return wrapper;
    }

    wrapper.append(label, control);
    if (hint) wrapper.append(hint);

    return wrapper;
  }

  /** Recompute and repaint the results region. Safe to call from a host page. */
  run(): void {
    if (!this.tool || !this.output) return;

    this.output.replaceChildren();

    let result: ToolOutput;

    try {
      result = this.tool.run(this.values);
    } catch (error) {
      const failure = el('div', 'note error');
      failure.textContent =
        error instanceof PayrollError || error instanceof Error
          ? error.message
          : 'That combination of inputs could not be calculated.';
      this.output.append(failure);

      this.dispatchEvent(
        new CustomEvent('payroll:error', { detail: { error }, bubbles: true, composed: true }),
      );
      return;
    }

    this.output.append(this.renderResult(result));

    this.dispatchEvent(
      new CustomEvent('payroll:result', {
        detail: { tool: this.tool.slug, values: this.values, result },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderResult(result: ToolOutput): DocumentFragment {
    const fragment = document.createDocumentFragment();

    const headline = el('div', 'headline');
    headline.append(
      el('div', 'headline-label', result.headline.label),
      el('div', 'headline-value', result.headline.value),
    );
    fragment.append(headline);

    if (result.rows.length > 0) {
      const scroll = el('div', 'scroll');
      const table = document.createElement('table');
      table.append(el('caption', undefined, 'Breakdown'));

      const body = document.createElement('tbody');

      for (const line of result.rows) {
        const tr = document.createElement('tr');
        if (line.emphasis) tr.className = 'total';

        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = line.label;

        tr.append(th, el('td', undefined, line.value));
        body.append(tr);
      }

      table.append(body);
      scroll.append(table);
      fragment.append(scroll);
    }

    if (result.events && result.events.length > 0) {
      const list = el('ul', 'events');

      for (const event of result.events) {
        const item = el('li', 'event');
        item.append(el('div', 'event-date', formatDate(event.date, 'j M Y')));

        const detail = el('div');
        detail.append(
          el('div', 'event-title', event.title),
          el('div', 'event-meta', `${event.authority} · ${event.period ?? ''}`),
        );

        item.append(detail);
        list.append(item);
      }

      fragment.append(list);
    }

    if (result.note) {
      fragment.append(el('p', 'note', result.note));
    }

    fragment.append(el('p', 'explanation', result.explanation));

    if (!this.hasAttribute('hide-workings') && result.workings.length > 0) {
      const details = document.createElement('details');
      details.append(el('summary', undefined, 'Show the working'));

      const list = document.createElement('ol');

      for (const step of result.workings) {
        const item = document.createElement('li');
        item.append(el('div', 'step-label', step.label));

        if (step.formula) item.append(el('div', 'step-formula', step.formula));
        if (step.amount) item.append(el('div', 'step-amount', step.amount.format()));
        if (step.citation) item.append(el('div', 'step-citation', step.citation));

        list.append(item);
      }

      details.append(list);

      if (result.citations.length > 0) {
        const citations = el('ul', 'citations');
        for (const citation of result.citations) {
          citations.append(el('li', undefined, citation));
        }
        details.append(citations);
      }

      fragment.append(details);
    }

    return fragment;
  }
}

/** The generic element: `<payroll-tool tool="pf-calculator">`. */
export class PayrollGenericElement extends PayrollToolElement {}

function elementClassFor(tool: ToolDefinition): CustomElementConstructor {
  return class extends PayrollToolElement {
    protected override toolSlug = tool.slug;
  };
}

/**
 * Register every `<payroll-*>` element. Idempotent, so calling it twice - once
 * from the bundle's auto-boot and once from a host page - is harmless.
 */
export function definePayrollElements(registry: CustomElementRegistry | undefined = globalThis.customElements): void {
  if (!registry) return;

  for (const tool of TOOLS) {
    if (!registry.get(tool.element)) {
      registry.define(tool.element, elementClassFor(tool));
    }
  }

  if (!registry.get('payroll-tool')) {
    registry.define('payroll-tool', PayrollGenericElement);
  }
}

/**
 * Upgrade every `<div data-payroll="pf-calculator">` in `root` into a widget.
 *
 * The attribute form exists because plenty of CMS editors strip unknown tags out
 * of the WYSIWYG but leave a `div` with a data attribute alone.
 */
export function mountPayrollTools(root: ParentNode = document): number {
  definePayrollElements();

  let mounted = 0;

  for (const host of Array.from(root.querySelectorAll<HTMLElement>('[data-payroll]'))) {
    if (host.dataset.payrollMounted === 'true') continue;

    const tool = findTool(host.dataset.payroll ?? '');
    if (!tool) continue;

    const widget = document.createElement(tool.element);

    // Carry any configuration the author put on the placeholder across to the
    // widget, so `data-payroll` and the custom element are configured alike.
    for (const { name, value } of Array.from(host.attributes)) {
      if (name === 'data-payroll' || name === 'id' || name === 'class' || name === 'style') continue;
      widget.setAttribute(name.replace(/^data-/, ''), value);
    }

    host.replaceChildren(widget);
    host.dataset.payrollMounted = 'true';
    mounted += 1;
  }

  return mounted;
}

/**
 * Register the elements and mount any placeholders as soon as the document is
 * ready. Called automatically by the browser bundle.
 */
export function autoBoot(): void {
  if (typeof document === 'undefined') return;

  const boot = (): void => {
    definePayrollElements();
    mountPayrollTools();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
