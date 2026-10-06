import { PARAM, readInline, scenarioHref, STRICT_PARAM } from './link.js';
import type { ScenarioSession } from './runtime.js';
import { parseScenario, type Scenario } from './schema.js';

const OPEN_KEY = 'scenario-panel:open';

const SCENARIO_PARAMS = new Set([PARAM, STRICT_PARAM]);

export interface PanelOptions {
  /** Corner to dock in, e.g. to avoid a chat widget. Default "bottom-right". */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Default: the maximum, so the panel stays above app overlays. */
  zIndex?: number;
  /** "auto" follows the OS colour scheme. Default "auto". */
  theme?: 'auto' | 'light' | 'dark';
}

/**
 * Add the floating scenario panel to the page. Framework-agnostic.
 * Remove it with `panel.remove()`; it unsubscribes from the session.
 */
export function mountPanel(session: ScenarioSession, options: PanelOptions = {}) {
  if (!customElements.get('scenario-panel')) {
    customElements.define('scenario-panel', ScenarioPanel);
  }

  const el = new ScenarioPanel();
  el.session = session;
  const [v, h] = (options.position ?? 'bottom-right').split('-');
  el.dataset.v = v;
  el.dataset.h = h;

  if (options.zIndex !== undefined) el.style.zIndex = String(options.zIndex);

  if (options.theme && options.theme !== 'auto') el.dataset.theme = options.theme;
  document.body.append(el);

  return el;
}

/**
 * Snapshot what the app shows now as a self-contained scenario: current URL params,
 * the active network fixtures, and every connected adapter's live state.
 */
export function captureScenario(session: ScenarioSession, name: string, description?: string): Scenario {
  const url: Record<string, string> = {};
  new URLSearchParams(location.search).forEach((v, k) => {
    if (!SCENARIO_PARAMS.has(k)) url[k] = v;
  });

  const state = Object.fromEntries(
    session.keys().flatMap((key) => {
      const value = session.read(key);

      return value === undefined ? [] : [[key, value] as const];
    }),
  );

  const draft = parseScenario({
    name,
    description: description || undefined,
    url,
    network: session.resolved?.network,
    state,
  });

  return session.catalog.resolve(draft); // runs the rules
}

class ScenarioPanel extends HTMLElement {
  session!: ScenarioSession;
  private render?: () => void;
  private unsubscribe?: () => void;

  disconnectedCallback() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  connectedCallback() {
    // Re-attached (e.g. moved in the DOM): resubscribe and redraw.
    if (this.render) {
      this.unsubscribe = this.session.onChange(this.render);
      this.render();

      return;
    }

    const session = this.session;
    const { catalog } = session;
    const root = this.attachShadow({ mode: 'open' });

    root.innerHTML = `
      <style>${STYLES}</style>
      <button class="toggle" aria-expanded="false" aria-controls="drawer"></button>
      <section id="drawer" aria-label="Scenarios" hidden>
        <header>
          <h2>Scenarios</h2>
          <button class="close" aria-label="Close scenarios panel">×</button>
        </header>
        <p class="error" role="alert"></p>
        <input type="search" placeholder="Filter by name, description or tag" aria-label="Filter scenarios">
        <ul class="list"></ul>
        <div class="unmocked" role="status"></div>
        <section class="live" aria-label="Live state"></section>
        <details class="save">
          <summary>Save as scenario</summary>
          <p class="hint">Current URL, network fixtures and live state, as one shareable scenario.</p>
          <label>Name <input name="save-name" placeholder="e.g. checkout-card-declined" aria-label="Scenario name"></label>
          <label>Description <input name="save-description" aria-label="Scenario description"></label>
          <div class="row">
            <button data-act="save-link">Copy link</button>
            <button data-act="save-json">Download JSON</button>
          </div>
          <input class="saved" readonly aria-label="Saved scenario link" hidden>
        </details>
        <details class="edit">
          <summary>Edit current scenario</summary>
          <textarea spellcheck="false" aria-label="Scenario JSON"></textarea>
          <button data-act="apply">Apply edited scenario</button>
        </details>
        <footer>
          <button data-act="copy">Copy link</button>
          <a class="reset">Reset</a>
        </footer>
      </section>`;

    const find = <T extends Element>(selector: string, type: new() => T): T => {
      const el = root.querySelector(selector);

      if (!(el instanceof type)) throw new Error(`state-scenarios panel: missing ${selector}`);

      return el;
    };

    const toggle = find('.toggle', HTMLButtonElement);
    const drawer = find('#drawer', HTMLElement);
    const error = find('.error', HTMLParagraphElement);

    const run = (fn: () => void | Promise<void>) => async () => {
      error.textContent = '';

      try {
        await fn();
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : String(err);
      }
    };

    const href = (s: Scenario) => {
      try {
        return { href: scenarioHref(catalog.resolve(s), { strict: session.strict }), invalid: false };
      } catch {
        return { href: `?${PARAM}=${encodeURIComponent(s.name)}`, invalid: true };
      }
    };

    find('.list', HTMLUListElement).innerHTML = catalog.list
      .map((s) => ({ s, ...href(s) }))
      .map(
        ({ s, href, invalid }) => `
        <li data-name="${esc(s.name)}" data-search="${
          esc([s.name, s.description, ...(s.tags ?? [])].join(' ').toLowerCase())
        }">
          <a href="${esc(href)}">
            <strong>${esc(s.name)}${invalid ? ' <em>(invalid, opens with error)</em>' : ''}</strong>
            ${s.description ? `<span>${esc(s.description)}</span>` : ''}
            ${s.tags?.length ? `<small>${s.tags.map(esc).join(' · ')}</small>` : ''}
          </a>
          <button class="add" aria-label="Combine ${
          esc(s.name)
        } with the current scenario" title="Combine with the current scenario">+</button>
        </li>`,
      )
      .join('');
    root.querySelectorAll<HTMLLIElement>('li[data-name]').forEach((li) => {
      const name = li.dataset.name!;
      li.querySelector('a')!.onclick = (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return; // let the browser open a new tab
        e.preventDefault();
        void run(() => session.open(name))();
      };

      li.querySelector<HTMLButtonElement>('.add')!.onclick = run(() => {
        const names = new Set((session.active?.name ?? '').split(',').filter(Boolean));
        names.add(name);

        return session.open([...names].join(','));
      });
    });
    const filter = find('input[type=search]', HTMLInputElement);
    filter.oninput = () => {
      const q = filter.value.toLowerCase().trim();
      root.querySelectorAll<HTMLLIElement>('li[data-search]').forEach((li) => {
        li.hidden = !li.dataset.search!.includes(q);
      });
    };

    const editors = new Map<string, { textarea: HTMLTextAreaElement; dirty: boolean; }>();

    const renderLive = () => {
      const keys = session.keys();

      for (const [key, ed] of editors) {
        if (!keys.includes(key)) {
          ed.textarea.closest('details')!.remove();
          editors.delete(key);
        }
      }

      for (const key of keys) {
        let ed = editors.get(key);

        if (!ed) {
          const details = document.createElement('details');
          details.innerHTML = `
            <summary>Live state: <code>${esc(key)}</code></summary>
            <textarea spellcheck="false" aria-label="Live state ${esc(key)}"></textarea>
            <div class="row"><button data-act="live-apply">Apply</button><button data-act="live-revert">Revert</button></div>`;
          find('.live', HTMLElement).append(details);
          const entry = { textarea: details.querySelector('textarea')!, dirty: false };
          entry.textarea.oninput = () => (entry.dirty = true);
          details.ontoggle = () => renderLive();
          details.querySelector<HTMLButtonElement>('[data-act=live-apply]')!.onclick = run(async () => {
            await session.applyState(key, JSON.parse(entry.textarea.value));
            entry.dirty = false;
            renderLive();
          });
          details.querySelector<HTMLButtonElement>('[data-act=live-revert]')!.onclick = () => {
            entry.dirty = false;
            renderLive();
          };

          editors.set(key, ed = entry);
        }

        // Follow the app while open (state can be large), never overwriting what someone is typing.
        if (!ed.dirty && ed.textarea.closest('details')!.open) {
          ed.textarea.value = JSON.stringify(session.read(key) ?? null, null, 2);
        }
      }
    };

    const saveName = find('input[name=save-name]', HTMLInputElement);
    const saveDescription = find('input[name=save-description]', HTMLInputElement);
    const saved = find('.saved', HTMLInputElement);
    const capture = () => captureScenario(session, saveName.value.trim(), saveDescription.value.trim());
    find('[data-act=save-link]', HTMLButtonElement).onclick = run(async () => {
      const link = scenarioHref(capture(), { inline: true, strict: session.strict });
      saved.hidden = false;
      saved.value = link;
      saved.select();
      await navigator.clipboard?.writeText(link).catch(() => {});
    });
    find('[data-act=save-json]', HTMLButtonElement).onclick = run(() => {
      const scenario = capture();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(
        new Blob([`${JSON.stringify(scenario, null, 2)}\n`], { type: 'application/json' }),
      );
      a.download = `${scenario.name}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    const editor = find('.edit textarea', HTMLTextAreaElement);

    if (readInline(location.hash)) find('.edit', HTMLDetailsElement).open = true;
    find('[data-act=apply]', HTMLButtonElement).onclick = run(() =>
      session.openInline(parseScenario(JSON.parse(editor.value)))
    );

    find('[data-act=copy]', HTMLButtonElement).onclick = run(async () => {
      try {
        await navigator.clipboard.writeText(location.href);
      } catch {
        prompt('Copy this link', location.href);
      }
    });
    // An absolute same-origin URL: a path starting with "//" must not read as another host.
    const reset = new URL(location.href);
    reset.search = '';
    reset.hash = '';
    reset.searchParams.set(PARAM, '');
    find('.reset', HTMLAnchorElement).href = reset.href;

    const setOpen = (open: boolean) => {
      drawer.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));

      try {
        sessionStorage.setItem(OPEN_KEY, open ? '1' : '');
      } catch {}
    };

    let stored: string | null = null;

    try {
      stored = sessionStorage.getItem(OPEN_KEY);
    } catch {}

    setOpen(!!stored);
    toggle.onclick = () => setOpen(!!drawer.hidden);
    find('.close', HTMLButtonElement).onclick = () => {
      setOpen(false);
      toggle.focus();
    };

    drawer.onkeydown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggle.focus();
      }
    };

    let shownScenario: string | undefined;

    const render = () => {
      const { active, strict, unhandled } = session;
      toggle.innerHTML = `Scenario: <b>${esc(active?.name ?? 'none')}</b>${strict ? ' (strict)' : ''}`;
      const names = (active?.name ?? '').split(',');
      root.querySelectorAll<HTMLLIElement>('li[data-name]').forEach((li) => {
        const a = li.querySelector('a')!;

        if (names.includes(li.dataset.name!)) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
      find('.unmocked', HTMLElement).innerHTML = unhandled.length
        ? `<p>${unhandled.length} request(s) not covered by this scenario${
          strict ? ' (answered 501)' : ''
        }:</p>
           <ul>${unhandled.map((u) => `<li><code>${esc(u)}</code></li>`).join('')}</ul>`
        : '';

      // Set as a property, not markup, so page text selectors never match the panel's JSON.
      if (active?.name !== shownScenario) {
        shownScenario = active?.name;
        editor.value = JSON.stringify(active ?? { name: 'custom', extends: catalog.list[0]?.name }, null, 2);
      }

      renderLive();
    };

    this.render = render;
    render();
    this.unsubscribe = session.onChange(render);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLES = `
  :host {
    --bg: #ffffff; --fg: #1b1b1f; --muted: #5d5d66; --line: #dcdce2;
    --accent: #4747eb; --accent-fg: #ffffff; --hover: #f2f2f7; --danger: #b42318;
    all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    font: 14px/1.4 system-ui, sans-serif; color: var(--fg);
  }
  @media (prefers-color-scheme: dark) {
    :host(:not([data-theme="light"])) {
      --bg: #1c1c21; --fg: #ececf1; --muted: #a3a3ad; --line: #34343c;
      --accent: #8c8cff; --accent-fg: #101014; --hover: #26262d; --danger: #ff8a80;
    }
  }
  :host([data-theme="dark"]) {
    --bg: #1c1c21; --fg: #ececf1; --muted: #a3a3ad; --line: #34343c;
    --accent: #8c8cff; --accent-fg: #101014; --hover: #26262d; --danger: #ff8a80;
  }
  :host([data-v="top"]) { bottom: auto; top: 16px; }
  :host([data-h="left"]) { right: auto; left: 16px; }
  :host([data-v="top"]) #drawer { bottom: auto; top: 48px; }
  :host([data-h="left"]) #drawer { right: auto; left: 0; }
  :host([data-h="left"]) .toggle { margin-left: 0; }
  * { box-sizing: border-box; font: inherit; color: inherit; }
  button, a { cursor: pointer; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .toggle {
    display: block; margin-left: auto; padding: 8px 14px; border: 0; border-radius: 999px;
    background: var(--accent); color: var(--accent-fg); box-shadow: 0 4px 16px #0003;
  }
  .toggle b, strong { font-weight: 700; }
  #drawer {
    position: absolute; right: 0; bottom: 48px; width: min(400px, calc(100vw - 32px));
    max-height: min(680px, calc(100vh - 96px)); overflow: auto; padding: 12px;
    background: var(--bg); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 40px #0004;
  }
  #drawer[hidden] { display: none; }
  header, footer, .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .row { justify-content: flex-start; margin-top: 8px; }
  h2 { margin: 0; font-size: 16px; font-weight: 700; }
  .close { border: 0; background: none; font-size: 22px; line-height: 1; padding: 4px 8px; border-radius: 6px; }
  input, textarea {
    width: 100%; margin: 6px 0; padding: 8px 10px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--bg);
  }
  label { display: block; margin-top: 6px; color: var(--muted); font-size: 12px; }
  label input { color: var(--fg); font-size: 14px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li[hidden] { display: none; }
  .list li { display: flex; align-items: stretch; gap: 4px; }
  .list a {
    flex: 1; min-width: 0; overflow-wrap: anywhere; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 8px;
    text-decoration: none; border-left: 3px solid transparent;
  }
  .list a:hover { background: var(--hover); }
  .list a[aria-current] { border-left-color: var(--accent); background: var(--hover); }
  .list span { color: var(--muted); }
  .list small { color: var(--muted); font-size: 12px; }
  .add { width: 32px; border: 0; border-radius: 8px; background: none; color: var(--muted); font-size: 18px; }
  .add:hover { background: var(--hover); color: var(--fg); }
  details { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
  summary { cursor: pointer; font-weight: 600; }
  code { font: 12px ui-monospace, monospace; }
  textarea { height: 200px; font: 12px/1.45 ui-monospace, monospace; resize: vertical; }
  .hint { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
  .error { color: var(--danger); white-space: pre-wrap; margin: 8px 0; font-size: 12px; }
  .error:empty, .unmocked:empty { display: none; }
  .unmocked { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: var(--hover); color: var(--danger); font-size: 12px; }
  .unmocked p { margin: 0 0 4px; }
  .unmocked ul { padding-left: 16px; list-style: disc; }
  .unmocked code { overflow-wrap: anywhere; }
  em { font-style: normal; color: var(--danger); font-weight: 400; }
  details button, footer button {
    padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--hover);
  }
  footer { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
  footer a { color: var(--accent); }
`;
