/**
 * Shared Selector Resolver (Isomorphic: Browser & Node.js)
 * 
 * Responsible for:
 * 1. Generating ranked selector candidates at capture time
 * 2. Building element semantic fingerprints
 * 3. Resolving elements with weighted confidence scoring at replay time
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js CommonJS
    const constants = require('./constants');
    module.exports = factory(constants);
  } else {
    // Browser global / injected page context
    root.SelectorResolver = factory(root.__WORKFLOW_CONSTANTS__ || null);
  }
})(typeof self !== 'undefined' ? self : this, function (importedConstants) {
  // Fallback defaults if executed in browser without bundle
  const CONSTANTS = importedConstants || {
    ACTION_TYPES: { CLICK: 'CLICK', DOUBLE_CLICK: 'DOUBLE_CLICK', TYPE: 'TYPE', SELECT: 'SELECT', KEY_PRESS: 'KEY_PRESS' },
    SELECTOR_STRATEGIES: {
      ID: 'id',
      DATA_ATTR: 'data-attr',
      ATTRIBUTE: 'attribute',
      TEXT: 'text',
      CSS_PATH: 'css-path',
      XPATH: 'xpath'
    },
    STRATEGY_PRIORITIES: { id: 1, 'data-attr': 2, attribute: 3, text: 4, 'css-path': 5, xpath: 6 },
    RESOLVER_WEIGHTS: {
      ID_OR_NAME: 0.30,
      DATA_OR_ARIA: 0.25,
      VISIBLE_TEXT: 0.25,
      OTHER_ATTRS: 0.10,
      CLASSES: 0.10
    },
    MIN_CONFIDENCE_THRESHOLD: 0.70,
    UNSTABLE_ID_PATTERN: /(:r[0-9a-z_-]+:|^ng-|^__|^ember|^\d+$|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|_[0-9a-zA-Z]{5,}|^gridview-\d+|^record-\d+|^tableview-\d+|^ext-gen|^ext-comp|^panel-\d+|^menuitem-\d+|^button-\d+|ext-element-\d+|^mat-select-value-\d+|^mat-option-\d+|^mat-select-\d+|^mat-checkbox-\d+|^mat-input-\d+|^mat-form-field-|^mat-mdc-|^cdk-overlay-|^cdk-describedby-)/i,
    TRANSIENT_CLASS_PATTERN: /^(active|hover|focus|focus-visible|disabled|selected|open|closed|show|hide|entering|leaving|animate-|transition-|css-[a-z0-9]+$)/i,
    PREFERRED_DATA_ATTRIBUTES: [
      'data-testid',
      'data-test',
      'data-qa',
      'data-cy',
      'data-automation',
      'data-id',
      'data-action',
      'data-component'
    ]
  };

  /**
   * Escape special characters in CSS selector components
   */
  function escapeCss(str) {
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return CSS.escape(str);
    }
    return str.replace(/([#;&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
  }

  /**
   * Check if ID is likely stable across builds and page loads
   */
  function isStableId(id) {
    if (!id || typeof id !== 'string') return false;
    const trimmed = id.trim();
    if (trimmed.length < 2 || trimmed.length > 50) return false;
    return !CONSTANTS.UNSTABLE_ID_PATTERN.test(trimmed);
  }

  /**
   * Filter out dynamic, transient, or CSS-in-JS utility classes
   */
  function filterStableClasses(classList) {
    if (!classList) return [];
    const classes = Array.from(classList);
    return classes.filter(cls => {
      if (!cls || typeof cls !== 'string') return false;
      const clean = cls.trim();
      if (clean.length < 2) return false;
      return !CONSTANTS.TRANSIENT_CLASS_PATTERN.test(clean);
    });
  }

  /**
   * Normalize text content for comparison
   */
  function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Safe document querySelectorAll wrapper
   */
  function queryAll(selector, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return [];
    try {
      return Array.from(d.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  /**
   * Evaluate XPath in document
   */
  function queryXPath(xpath, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || typeof XPathResult === 'undefined') return [];
    try {
      const result = d.evaluate(xpath, d, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const nodes = [];
      for (let i = 0; i < result.snapshotLength; i++) {
        nodes.push(result.snapshotItem(i));
      }
      return nodes;
    } catch {
      return [];
    }
  }

  /**
   * Check if element is visible
   */
  function isElementVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    const isBackdrop = Boolean(
      (element.classList && (element.classList.contains('cdk-overlay-backdrop') || element.classList.contains('modal-backdrop'))) ||
      (element.className && typeof element.className === 'string' && element.className.includes('backdrop'))
    );

    if (element.offsetParent === null && element.tagName.toLowerCase() !== 'body') {
      // Check if position is fixed or element is a fixed backdrop
      if (typeof window !== 'undefined') {
        const style = window.getComputedStyle(element);
        if (style.position !== 'fixed' && style.position !== 'sticky' && !isBackdrop) {
          return false;
        }
      } else {
        return false;
      }
    }
    if (typeof window !== 'undefined') {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      if (style.opacity === '0' && !isBackdrop) {
        return false;
      }
    }
    const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
    if (rect && (rect.width <= 0 || rect.height <= 0)) {
      return false;
    }
    return true;
  }

  /**
   * Check if element is interactable (visible and not disabled)
   */
  function isElementInteractable(element) {
    if (!isElementVisible(element)) return false;
    if (element.disabled === true) return false;
    if (element.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  /**
   * Generate scoped CSS path from element up to a stable ancestor or body
   */
  function generateCssPath(element, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!element || element.nodeType !== 1) return null;

    const path = [];
    let current = element;

    while (current && current.nodeType === 1 && current.tagName.toLowerCase() !== 'html') {
      const tag = current.tagName.toLowerCase();

      if (isStableId(current.id)) {
        path.unshift(`#${escapeCss(current.id)}`);
        break;
      }

      if (current.tagName.toLowerCase() === 'body') {
        path.unshift('body');
        break;
      }

      const parent = current.parentElement;
      if (!parent) {
        path.unshift(tag);
        break;
      }

      const children = parent.children ? Array.from(parent.children) : [];
      const sameTagChildren = children.filter(c => c.tagName === current.tagName);

      if (sameTagChildren.length === 1) {
        path.unshift(tag);
      } else {
        const index = sameTagChildren.indexOf(current) + 1;
        path.unshift(`${tag}:nth-of-type(${index})`);
      }

      current = parent;
    }

    const fullPath = path.join(' > ');
    return fullPath || null;
  }

  /**
   * Generate absolute XPath for element
   */
  function generateXPath(element) {
    if (!element || element.nodeType !== 1) return null;
    if (element.tagName.toLowerCase() === 'html') return '/html[1]';
    if (element.tagName.toLowerCase() === 'body') return '/html[1]/body[1]';

    if (isStableId(element.id)) {
      return `//*[@id='${element.id}']`;
    }

    let index = 1;
    const siblings = (element.parentElement && element.parentElement.children) ? Array.from(element.parentElement.children) : [];
    for (const sib of siblings) {
      if (sib === element) break;
      if (sib.tagName === element.tagName) index++;
    }

    const parentXPath = element.parentElement ? generateXPath(element.parentElement) : '';
    return `${parentXPath}/${element.tagName.toLowerCase()}[${index}]`;
  }

  /**
   * Generate ranked selector candidates for a DOM element
   */
  function generateCandidates(element, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!element || element.nodeType !== 1) return [];

    const candidates = [];
    const seenSelectors = new Set();
    const tag = element.tagName.toLowerCase();

    function addCandidate(strategy, value) {
      if (!value || seenSelectors.has(value)) return;
      seenSelectors.add(value);
      const isXpath = strategy === CONSTANTS.SELECTOR_STRATEGIES.XPATH || value.startsWith('//') || value.startsWith('(');
      const matched = isXpath ? queryXPath(value, d) : queryAll(value, d);
      const uniqueness = matched.length;

      candidates.push({
        strategy,
        value,
        uniqueness,
        priority: CONSTANTS.STRATEGY_PRIORITIES[strategy] || 99
      });
    }

    // 1. Stable ID
    if (isStableId(element.id)) {
      addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ID, `#${escapeCss(element.id)}`);
      addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ID, `${tag}#${escapeCss(element.id)}`);
    }

    // 1b. Backdrop / Overlay dismiss elements (clicking outside in blank space to close dropdowns or modals)
    const isBackdropCandidate = Boolean(
      (element.classList && (element.classList.contains('cdk-overlay-backdrop') || element.classList.contains('modal-backdrop'))) ||
      (element.className && typeof element.className === 'string' && element.className.includes('backdrop'))
    );
    if (isBackdropCandidate) {
      addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, '.cdk-overlay-backdrop');
      addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, '.cdk-overlay-container .cdk-overlay-backdrop');
      addCandidate(CONSTANTS.SELECTOR_STRATEGIES.XPATH, '//*[contains(@class, "cdk-overlay-backdrop")]');
      addCandidate(CONSTANTS.SELECTOR_STRATEGIES.XPATH, '//*[contains(@class, "backdrop")]');
    }

    // 2. Preferred Data Attributes (data-testid, data-qa, data-cy, data-id)
    for (const attr of CONSTANTS.PREFERRED_DATA_ATTRIBUTES) {
      if (element.hasAttribute(attr)) {
        const val = element.getAttribute(attr);
        addCandidate(CONSTANTS.SELECTOR_STRATEGIES.DATA_ATTR, `[${attr}="${escapeCss(val)}"]`);
        addCandidate(CONSTANTS.SELECTOR_STRATEGIES.DATA_ATTR, `${tag}[${attr}="${escapeCss(val)}"]`);
      }
    }

    // Check any other custom data-* attributes
    if (element.attributes) {
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        if (attr.name.startsWith('data-') && !CONSTANTS.PREFERRED_DATA_ATTRIBUTES.includes(attr.name)) {
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.DATA_ATTR, `[${attr.name}="${escapeCss(attr.value)}"]`);
        }
      }
    }

    // 3. Meaningful Attributes: name, aria-label, role, placeholder, type, title, alt, src
    const meaningfulAttrs = ['name', 'aria-label', 'placeholder', 'role', 'title', 'alt', 'src'];
    for (const attr of meaningfulAttrs) {
      if (element.hasAttribute(attr)) {
        const val = element.getAttribute(attr);
        if (val && val.trim()) {
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, `${tag}[${attr}="${escapeCss(val)}"]`);
          // If attr is src or href, also add a filename/keyword candidate (e.g. img[src*="save" i])
          if ((attr === 'src' || attr === 'href') && val.length > 5) {
            const lastSegment = val.split(/[/?#]/).filter(Boolean).pop() || '';
            if (lastSegment && lastSegment.length >= 3 && lastSegment.length <= 40) {
              addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, `${tag}[${attr}*="${escapeCss(lastSegment)}"]`);
            }
          }
        }
      }
    }

    // Keyword attribute matchers for common action buttons (Save, Export, Print, PDF, Download, Submit, Close)
    for (const attr of ['title', 'alt', 'aria-label', 'data-action']) {
      if (element.hasAttribute(attr)) {
        const val = (element.getAttribute(attr) || '').trim();
        const actionKeywords = ['save', 'export', 'pdf', 'print', 'download', 'close', 'submit', 'search', 'filter'];
        const matchesKeyword = actionKeywords.some(kw => val.toLowerCase().includes(kw));
        if (matchesKeyword && val.length <= 100) {
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, `${tag}[${attr}="${escapeCss(val)}"]`);
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, `[${attr}="${escapeCss(val)}"]`);
          for (const kw of actionKeywords) {
            if (val.toLowerCase().includes(kw)) {
              addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, `${tag}[${attr}*="${kw}" i]`);
              addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, `[${attr}*="${kw}" i]`);
            }
          }
        }
      }
    }

    // Enclosing Option / Dropdown Item / Checkbox List Item (Angular Material mat-option, [role="option"], etc.)
    const optionParent = element.closest('mat-option, [role="option"], .mat-mdc-option, [role="menuitem"], [role="treeitem"], label, li');
    if (optionParent) {
      const optTag = optionParent.tagName.toLowerCase();
      const optText = normalizeText(optionParent.textContent || '');
      if (optText && optText.length > 0) {
        const escapedFull = optText.replace(/'/g, "\\'");
        addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//${optTag}[normalize-space()='${escapedFull}']`);
        addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//${optTag}[contains(normalize-space(), '${escapedFull}')]`);
        addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//*[@role='option'][contains(normalize-space(), '${escapedFull}')]`);

        // If clicked target is a child (e.g. mat-pseudo-checkbox or icon)
        if (optionParent !== element) {
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//${optTag}[contains(., '${escapedFull}')]//${tag}`);
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//${optTag}[contains(., '${escapedFull}')]//*[contains(@class, 'checkbox') or contains(@class, 'pseudo-checkbox')]`);
        }

        // Substring / prefix candidate for long formatted items: "105992 - DIXIE HIGHWAY..." -> "105992"
        const prefix = optText.split(/[-–—(:]/)[0].trim();
        if (prefix && prefix.length >= 3 && prefix !== optText) {
          const escapedPrefix = prefix.replace(/'/g, "\\'");
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//${optTag}[contains(., '${escapedPrefix}')]`);
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//*[@role='option'][contains(., '${escapedPrefix}')]`);
          if (optionParent !== element) {
            addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//${optTag}[contains(., '${escapedPrefix}')]//${tag}`);
          }
        }
      }
    }

    // Form Controls with Associated Labels (e.g. Customer dropdown / combobox)
    const formField = element.closest('mat-form-field, .mat-form-field, .mat-mdc-form-field, .form-group, .form-field');
    if (formField) {
      const labelEl = formField.querySelector('mat-label, label, .mat-form-field-label, [id*="label"]');
      if (labelEl) {
        const labelText = normalizeText(labelEl.textContent || '').replace(/[*:]/g, '').trim();
        if (labelText.length >= 2) {
          const escapedLbl = labelText.replace(/'/g, "\\'");
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//mat-form-field[.//text()[contains(., '${escapedLbl}')]]//mat-select`);
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//mat-form-field[.//text()[contains(., '${escapedLbl}')]]//*[contains(@class, 'select-value') or contains(@class, 'select-trigger')]`);
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//label[contains(., '${escapedLbl}')]/..//mat-select`);
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, `//label[contains(., '${escapedLbl}')]/..//div[contains(@class, 'select')]`);
        }
      }
    }

    // If element is an icon/image/span inside an interactive parent (button, link, toolbar-item), capture parent candidate
    if (['img', 'i', 'span', 'svg', 'path', 'div', 'td', 'mat-pseudo-checkbox'].includes(tag) && element.parentElement) {
      const interactiveParent = element.closest('button, a, [role="button"], [role="menuitem"], [role="option"], mat-option, .dxxr-item, .dxxr-btn, .dx-button, .dxrd-toolbar-item, .dxm-item, .dxm-content, .dxbButton, [id*="Splitter_Toolbar_Menu"], .x-btn, [onclick], input');
      if (interactiveParent && interactiveParent !== element) {
        const parentTag = interactiveParent.tagName.toLowerCase();
        for (const pAttr of ['title', 'aria-label', 'data-testid', 'data-action', 'name', 'id']) {
          if (interactiveParent.hasAttribute(pAttr)) {
            const pVal = (interactiveParent.getAttribute(pAttr) || '').trim();
            if (pVal && (pAttr !== 'id' || isStableId(pVal))) {
              addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, `${parentTag}[${pAttr}="${escapeCss(pVal)}"] ${tag}`);
              addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, `${parentTag}[${pAttr}="${escapeCss(pVal)}"]`);
            }
          }
        }
      }
    }

    // 4. Visible Text (Buttons, Links, Labels, Grid Cells, or interactive elements with short text)
    const textContent = normalizeText(element.textContent || '');
    if (textContent && textContent.length > 0 && textContent.length <= 60) {
      if (['button', 'a', 'label', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'td', 'th', 'li', 'mat-option'].includes(tag)) {
        // XPath exact text match
        const escapedText = textContent.replace(/'/g, "\\'");
        const textXPath = `//${tag}[normalize-space()='${escapedText}']`;
        addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, textXPath);

        // If it has stable classes (e.g. ExtJS .x-grid-cell-inner), generate class-scoped text XPath
        if (element.classList && element.classList.length > 0) {
          const stableClasses = filterStableClasses(element.classList);
          if (stableClasses.length > 0) {
            const classTextXPath = `//${tag}[contains(@class, '${escapeCss(stableClasses[0])}') and normalize-space()='${escapedText}']`;
            addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, classTextXPath);
          }
        }
      }
    }

    // 5. Scoped CSS Path
    const cssPath = generateCssPath(element, d);
    if (cssPath) {
      addCandidate(CONSTANTS.SELECTOR_STRATEGIES.CSS_PATH, cssPath);
    }

    // 6. Full XPath fallback
    const xpath = generateXPath(element);
    if (xpath) {
      addCandidate(CONSTANTS.SELECTOR_STRATEGIES.XPATH, xpath);
    }

    // Sort: Unique matches (uniqueness === 1) first by priority, then non-unique by priority
    candidates.sort((a, b) => {
      const aUnique = a.uniqueness === 1 ? 0 : 1;
      const bUnique = b.uniqueness === 1 ? 0 : 1;
      if (aUnique !== bUnique) return aUnique - bUnique;
      return a.priority - b.priority;
    });

    return candidates;
  }

  /**
   * Create an element semantic fingerprint
   */
  function createFingerprint(element) {
    if (!element || element.nodeType !== 1) {
      return { tagName: 'unknown' };
    }

    const tag = element.tagName.toLowerCase();
    const isPassword = tag === 'input' && (element.type || '').toLowerCase() === 'password';
    let text = isPassword ? '' : normalizeText(element.textContent || '').slice(0, 120);

    // If text is empty (e.g. checkbox or icon inside option/button/label), inherit enclosing text
    if (!text || text.length === 0) {
      const textParent = (typeof element.closest === 'function')
        ? element.closest('mat-option, [role="option"], .mat-mdc-option, button, a, [role="button"], label, li, tr')
        : null;
      if (textParent) {
        text = normalizeText(textParent.textContent || '').slice(0, 120);
      }
    }

    const attributes = {};
    const trackedAttrs = ['name', 'type', 'role', 'placeholder', 'aria-label', 'title', 'href', 'value'];
    for (const attr of trackedAttrs) {
      if (element.hasAttribute(attr)) {
        if (isPassword && attr === 'value') {
          attributes[attr] = '[REDACTED]';
        } else {
          attributes[attr] = element.getAttribute(attr);
        }
      }
    }

    const dimensions = { width: 0, height: 0 };
    if (element.getBoundingClientRect) {
      const rect = element.getBoundingClientRect();
      dimensions.width = Math.round(rect.width);
      dimensions.height = Math.round(rect.height);
    }

    const isInputCb = tag === 'input' && (element.type || '').toLowerCase() === 'checkbox';
    const isRoleCb = (element.getAttribute('role') || '').toLowerCase() === 'checkbox';
    const isPseudoCb = tag === 'mat-pseudo-checkbox' || (element.classList && typeof element.classList.contains === 'function' && element.classList.contains('mat-pseudo-checkbox'));
    const isMatCb = tag === 'mat-checkbox' || (typeof element.closest === 'function' && Boolean(element.closest('mat-checkbox, .mat-mdc-checkbox, dx-check-box')));
    const isCheckbox = isInputCb || isRoleCb || isPseudoCb || isMatCb;

    let checked = null;
    if (isCheckbox) {
      if (tag === 'input' && typeof element.checked === 'boolean') {
        checked = element.checked;
      } else {
        const aria = typeof element.getAttribute === 'function' ? element.getAttribute('aria-checked') : null;
        if (aria !== null && aria !== undefined) {
          checked = aria === 'true';
        } else if (element.classList && typeof element.classList.contains === 'function') {
          checked = element.classList.contains('mat-mdc-checkbox-checked') ||
                    element.classList.contains('mat-checkbox-checked') ||
                    element.classList.contains('dx-checkbox-checked') ||
                    element.classList.contains('mat-pseudo-checkbox-checked') ||
                    element.classList.contains('is-checked') ||
                    element.classList.contains('checked');
        }
      }
    }

    return {
      tagName: tag,
      id: isStableId(element.id) ? element.id : null,
      name: element.getAttribute('name') || null,
      type: element.getAttribute('type') || null,
      role: element.getAttribute('role') || null,
      placeholder: element.getAttribute('placeholder') || null,
      ariaLabel: element.getAttribute('aria-label') || null,
      text,
      classes: filterStableClasses(element.classList),
      attributes,
      isPassword,
      isCheckbox,
      ...(checked !== null ? { checked } : {}),
      dimensions
    };
  }

  /**
   * Generate a human-friendly, simple name for an element (e.g. "Invoice Button", "Search Field")
   * Works both with live DOM elements and pure fingerprint/target objects.
   */
  function generateFriendlyName(element, fingerprint) {
    const fp = fingerprint || (element && element.nodeType === 1 ? createFingerprint(element) : null) || {};
    const tag = (fp.tagName || (element?.tagName ? element.tagName.toLowerCase() : '') || 'element').toLowerCase();

    // 1. Determine element type suffix
    const hasClass = (cls) => {
      if (!element?.classList) return false;
      if (typeof element.classList.contains === 'function') return element.classList.contains(cls);
      if (Array.isArray(element.classList)) return element.classList.includes(cls);
      return false;
    };
    const isButton = ['button', 'submit'].includes(fp.type) || tag === 'button' || fp.role === 'button' ||
      hasClass('btn') || hasClass('x-btn') || hasClass('dxbButton');
    const isLink = tag === 'a' || fp.role === 'link';
    const isCheckbox = fp.type === 'checkbox' || fp.role === 'checkbox' || tag === 'mat-pseudo-checkbox';
    const isRadio = fp.type === 'radio' || fp.role === 'radio';
    const isOption = tag === 'mat-option' || tag === 'option' || fp.role === 'option';
    const isSelect = tag === 'select' || tag === 'mat-select' || fp.role === 'combobox' || fp.role === 'listbox';
    const isTab = fp.role === 'tab';
    const isRow = tag === 'tr' || fp.role === 'row';
    const isCell = tag === 'td' || tag === 'th' || fp.role === 'gridcell';
    const isCanvas = tag === 'canvas';
    const isInput = tag === 'input' || tag === 'textarea';

    let typeSuffix = 'Element';
    if (isButton) typeSuffix = 'Button';
    else if (isCheckbox) typeSuffix = 'Checkbox';
    else if (isRadio) typeSuffix = 'Radio Option';
    else if (isOption) typeSuffix = 'Option';
    else if (isSelect) typeSuffix = 'Dropdown';
    else if (isLink) typeSuffix = 'Link';
    else if (isTab) typeSuffix = 'Tab';
    else if (isRow) typeSuffix = 'Row';
    else if (isCell) typeSuffix = 'Cell';
    else if (isCanvas) typeSuffix = 'Canvas Area';
    else if (isInput) {
      if (fp.type === 'password') typeSuffix = 'Password Field';
      else if (fp.type === 'search') typeSuffix = 'Search Field';
      else if (fp.type === 'email') typeSuffix = 'Email Field';
      else typeSuffix = 'Input';
    }

    // 2. Discover best descriptive text
    let label = '';

    // Check associated <label> or mat-label
    if (element && element.nodeType === 1) {
      if (element.labels && element.labels.length > 0 && element.labels[0].textContent) {
        label = normalizeText(element.labels[0].textContent);
      } else {
        const formField = element.closest && element.closest('mat-form-field, .form-group, .form-field, label');
        if (formField) {
          const lbl = formField.querySelector('mat-label, label, .mat-form-field-label');
          if (lbl && lbl !== element) {
            label = normalizeText(lbl.textContent);
          }
        }
      }
    }

    // Check ARIA label
    if (!label && fp.ariaLabel) {
      label = normalizeText(fp.ariaLabel);
    }

    // Check title attribute (standard for icons, toolbars, and export buttons)
    if (!label && fp.attributes && fp.attributes.title) {
      label = normalizeText(fp.attributes.title);
    }

    // Check placeholder
    if (!label && fp.placeholder) {
      label = normalizeText(fp.placeholder);
    }

    // Check visible text content
    if (!label && fp.text) {
      label = normalizeText(fp.text);
    }

    // Check parent interactive container text if element is an icon or span
    if (!label && element && element.closest) {
      const interactiveParent = element.closest('button, a, [role="button"], mat-option, label, [title]');
      if (interactiveParent && interactiveParent !== element) {
        label = normalizeText(interactiveParent.getAttribute('title') || interactiveParent.getAttribute('aria-label') || interactiveParent.textContent || '');
      }
    }

    // Check name attribute if descriptive (e.g. customer_name -> Customer Name)
    if (!label && fp.name) {
      const cleanName = fp.name.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      if (cleanName && cleanName.length >= 2 && !/^\d+$/.test(cleanName)) {
        label = cleanName;
      }
    }

    // Check stable ID or testid if descriptive
    if (!label) {
      const testId = (fp.attributes && (fp.attributes['data-testid'] || fp.attributes['data-qa'] || fp.attributes['data-cy'])) || fp.id;
      if (testId && typeof testId === 'string' && !CONSTANTS.UNSTABLE_ID_PATTERN.test(testId)) {
        const words = testId.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/\b(btn|button|input|txt|lbl|field)\b/gi, '').trim();
        if (words && words.length >= 2) {
          label = words;
        }
      }
    }

    // Clean up label
    if (label) {
      label = label.replace(/[.*:…\-]+$/g, '').trim();
      if (label.length > 40) {
        label = label.slice(0, 37).trim() + '…';
      }
      if (label && /^[a-z]/.test(label)) {
        label = label.charAt(0).toUpperCase() + label.slice(1);
      }
    }

    // Combine label + typeSuffix
    if (!label) {
      return typeSuffix === 'Element' ? 'Page Element' : typeSuffix;
    }

    const lowerLabel = label.toLowerCase();
    let lowerSuffix = typeSuffix.toLowerCase();

    if (lowerSuffix === 'search field' && lowerLabel.includes('search')) {
      typeSuffix = 'Field';
      lowerSuffix = 'field';
    }

    if (lowerLabel.endsWith(lowerSuffix) || (lowerSuffix === 'button' && lowerLabel.endsWith('btn')) || (lowerSuffix === 'field' && lowerLabel.endsWith('input'))) {
      return label;
    }

    return `${label} ${typeSuffix}`;
  }

  /**
   * Capture target: generates candidates, semantic fingerprint, and human-friendly name
   */
  function captureTarget(element, doc) {
    const candidates = generateCandidates(element, doc);
    const fingerprint = createFingerprint(element);
    const friendlyName = generateFriendlyName(element, fingerprint);
    return {
      candidates,
      fingerprint,
      friendlyName,
      elementName: friendlyName,
      isCheckbox: Boolean(fingerprint.isCheckbox),
      ...(fingerprint.checked !== undefined ? { checked: fingerprint.checked } : {})
    };
  }

  /**
   * Score candidate element against recorded fingerprint [0.0 - 1.0]
   */
  function scoreFingerprint(element, fingerprint) {
    if (!element || !fingerprint) {
      return { score: 0, matchedTag: false, passed: false };
    }

    const elemTag = element.tagName.toLowerCase();
    const targetTag = (fingerprint.tagName || '').toLowerCase();

    // Check if element and fingerprint represent the same option control
    const isOptionControl = (
      (elemTag === 'mat-option' || (element.getAttribute && element.getAttribute('role') === 'option')) &&
      ['mat-pseudo-checkbox', 'span', 'div'].includes(targetTag)
    ) || (
      (targetTag === 'mat-option' || fingerprint.role === 'option') &&
      ['mat-pseudo-checkbox', 'span', 'div'].includes(elemTag)
    );

    // Mandatory: tag name MUST match (or compatible option control)
    if (elemTag !== targetTag && !isOptionControl) {
      return { score: 0, matchedTag: false, passed: false };
    }

    let score = 0;
    const weights = CONSTANTS.RESOLVER_WEIGHTS;

    // 1. ID or Name match (weight: 0.30)
    let idNameScore = 0;
    const elemId = element.id;
    const targetId = fingerprint.id;
    const elemName = element.getAttribute ? element.getAttribute('name') : null;
    const targetName = fingerprint.name;

    if (targetId && elemId && targetId === elemId) {
      idNameScore = 1.0;
    } else if (targetName && elemName && targetName === elemName) {
      idNameScore = 0.9;
    } else if (!targetId && !targetName) {
      // Element originally had neither id nor name, neutral full score
      idNameScore = 1.0;
    }
    score += idNameScore * weights.ID_OR_NAME;

    // 2. Data attributes or Aria (weight: 0.25)
    let dataAriaScore = 0;
    const targetAria = fingerprint.ariaLabel;
    const elemAria = element.getAttribute ? element.getAttribute('aria-label') : null;
    if (targetAria) {
      dataAriaScore = (elemAria && targetAria === elemAria) ? 1.0 : 0.0;
    } else {
      // Check data attributes
      let matchedDataCount = 0;
      let totalDataCount = 0;
      for (const attr of CONSTANTS.PREFERRED_DATA_ATTRIBUTES) {
        const targetVal = fingerprint.attributes ? fingerprint.attributes[attr] : null;
        if (targetVal) {
          totalDataCount++;
          if (element.getAttribute && element.getAttribute(attr) === targetVal) {
            matchedDataCount++;
          }
        }
      }
      dataAriaScore = totalDataCount > 0 ? (matchedDataCount / totalDataCount) : 1.0;
    }
    score += dataAriaScore * weights.DATA_OR_ARIA;

    // 3. Visible Text (weight: 0.25)
    let textScore = 0;
    const targetText = normalizeText(fingerprint.text || '');
    const elemText = normalizeText(element.textContent || '');

    if (!targetText) {
      textScore = 1.0;
    } else if (targetText === elemText) {
      textScore = 1.0;
    } else if (elemText.includes(targetText) || targetText.includes(elemText)) {
      textScore = 0.85;
    } else {
      // Check normalized token overlap (resilient to whitespace differences)
      const targetTokens = targetText.split(' ').filter(t => t.length > 2);
      const matchedTokens = targetTokens.filter(t => elemText.includes(t));
      if (targetTokens.length > 0 && matchedTokens.length / targetTokens.length >= 0.6) {
        textScore = 0.80;
      } else {
        textScore = 0.0;
      }
    }
    score += textScore * weights.VISIBLE_TEXT;

    // 4. Other Attributes (type, role, placeholder) (weight: 0.10)
    let attrScore = 0;
    let attrChecks = 0;
    ['type', 'role', 'placeholder'].forEach(attr => {
      const targetVal = fingerprint[attr];
      if (targetVal) {
        attrChecks++;
        if (element.getAttribute(attr) === targetVal) {
          attrScore += 1;
        }
      }
    });
    const finalAttrScore = attrChecks > 0 ? (attrScore / attrChecks) : 1.0;
    score += finalAttrScore * weights.OTHER_ATTRS;

    // 5. Classes Jaccard Similarity (weight: 0.10)
    let classScore = 0;
    const targetClasses = new Set(fingerprint.classes || []);
    const elemClasses = new Set(filterStableClasses(element.classList));

    if (targetClasses.size === 0 && elemClasses.size === 0) {
      classScore = 1.0;
    } else {
      const intersection = new Set([...targetClasses].filter(x => elemClasses.has(x)));
      const union = new Set([...targetClasses, ...elemClasses]);
      classScore = union.size > 0 ? (intersection.size / union.size) : 1.0;
    }
    score += classScore * weights.CLASSES;

    const roundedScore = Math.round(score * 100) / 100;
    const passed = roundedScore >= CONSTANTS.MIN_CONFIDENCE_THRESHOLD;

    return {
      score: roundedScore,
      matchedTag: true,
      passed
    };
  }

  /**
   * Resolve an element target using candidate priority and weighted fingerprint scoring
   */
  function resolveElement(target, options, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!target || !target.candidates || !target.fingerprint) {
      return {
        element: null,
        resolvedCandidate: null,
        confidenceScore: 0,
        success: false,
        attempts: [{ error: 'Invalid target object: candidates and fingerprint are required' }]
      };
    }

    const minScore = (options && typeof options.minScore === 'number')
      ? options.minScore
      : CONSTANTS.MIN_CONFIDENCE_THRESHOLD;

    const attempts = [];

    // Evaluate candidates in ranked order
    for (const candidate of target.candidates) {
      const isXpath = candidate.strategy === CONSTANTS.SELECTOR_STRATEGIES.XPATH ||
        candidate.value.startsWith('//') || candidate.value.startsWith('(');

      let matchedNodes = [];
      try {
        matchedNodes = isXpath ? queryXPath(candidate.value, d) : queryAll(candidate.value, d);
      } catch (err) {
        attempts.push({
          candidate,
          matchCount: 0,
          score: 0,
          reason: `Syntax or execution error: ${err.message}`
        });
        continue;
      }

      if (matchedNodes.length === 0) {
        attempts.push({
          candidate,
          matchCount: 0,
          score: 0,
          reason: 'No elements matched selector'
        });
        continue;
      }

      const requireVisible = !options || options.requireVisible !== false;

      // Case 1: Exactly one element matched
      if (matchedNodes.length === 1) {
        const candidateElem = matchedNodes[0];
        const { score, passed } = scoreFingerprint(candidateElem, target.fingerprint);

        if (passed && score >= minScore) {
          if (requireVisible && !isElementVisible(candidateElem)) {
            attempts.push({
              candidate,
              matchCount: 1,
              score,
              reason: 'Element matched but is not yet visible in DOM (0 dimensions or display:none)'
            });
            continue;
          }

          return {
            element: candidateElem,
            resolvedCandidate: candidate,
            confidenceScore: score,
            success: true,
            attempts
          };
        }

        attempts.push({
          candidate,
          matchCount: 1,
          score,
          reason: `Single element matched but fingerprint confidence score (${score}) fell below threshold (${minScore})`
        });
        continue;
      }

      // Case 2: Multiple elements matched - score all of them
      let bestElem = null;
      let highestScore = 0;
      let passingCount = 0;

      for (const elem of matchedNodes) {
        const { score, passed } = scoreFingerprint(elem, target.fingerprint);
        if (passed && score >= 0.85) {
          if (!requireVisible || isElementVisible(elem)) {
            passingCount++;
            if (score > highestScore) {
              highestScore = score;
              bestElem = elem;
            }
          }
        }
      }

      // If exactly ONE element scored highly (>= 0.85) among multiple matches, resolve it disambiguated
      if (passingCount === 1 && bestElem) {
        return {
          element: bestElem,
          resolvedCandidate: candidate,
          confidenceScore: highestScore,
          success: true,
          attempts
        };
      }

      attempts.push({
        candidate,
        matchCount: matchedNodes.length,
        score: highestScore,
        reason: `Ambiguous match: ${matchedNodes.length} elements matched selector and ${passingCount} passed fingerprint validation`
      });
    }

    // Heuristic Fallback: If all candidates failed, attempt Semantic Fingerprint Recovery
    const fingerprint = target.fingerprint;
    const requireVisible = !options || options.requireVisible !== false;

    if (fingerprint && fingerprint.tagName && fingerprint.tagName !== 'unknown') {
      const tag = fingerprint.tagName.toLowerCase();
      let fallbackNodes = [];

      // 1. Try finding elements by visible text if text was captured
      const targetText = normalizeText(fingerprint.text || '');
      if (targetText && targetText.length > 0) {
        const escaped = targetText.replace(/'/g, "\\'");
        try {
          fallbackNodes = queryXPath(`//${tag}[normalize-space()='${escaped}']`, d);
        } catch {}

        if (fallbackNodes.length === 0 && targetText.length > 2) {
          try {
            fallbackNodes = queryXPath(`//${tag}[contains(normalize-space(), '${escaped}')]`, d);
          } catch {}
        }
      }

      // 2. If no text match, try stable classes or backdrop selector
      if (fallbackNodes.length === 0 && Array.isArray(fingerprint.classes) && fingerprint.classes.length > 0) {
        if (fingerprint.classes.some(c => c && c.includes('backdrop'))) {
          try {
            fallbackNodes = queryAll('.cdk-overlay-backdrop, [class*="backdrop"]', d);
          } catch {}
        }
        if (fallbackNodes.length === 0) {
          try {
            const classSelector = `${tag}.${fingerprint.classes.map(c => escapeCss(c)).join('.')}`;
            fallbackNodes = queryAll(classSelector, d);
          } catch {}
        }
      }

      // 3. Score fallback candidate elements against fingerprint
      let bestFallbackElem = null;
      let highestFallbackScore = 0;
      let passingCount = 0;

      for (const elem of fallbackNodes) {
        const { score, passed } = scoreFingerprint(elem, fingerprint);
        if (passed && score >= minScore) {
          if (!requireVisible || isElementVisible(elem)) {
            passingCount++;
            if (score > highestFallbackScore) {
              highestFallbackScore = score;
              bestFallbackElem = elem;
            }
          }
        }
      }

      if (bestFallbackElem && highestFallbackScore >= minScore) {
        return {
          element: bestFallbackElem,
          resolvedCandidate: {
            strategy: 'fingerprint-fallback',
            value: targetText ? `fallback:text="${targetText}"` : `fallback:tag=${tag}`,
            uniqueness: passingCount,
            priority: 99
          },
          confidenceScore: highestFallbackScore,
          success: true,
          attempts
        };
      }
    }

    return {
      element: null,
      resolvedCandidate: null,
      confidenceScore: 0,
      success: false,
      attempts
    };
  }

  return {
    CONSTANTS,
    escapeCss,
    isStableId,
    filterStableClasses,
    normalizeText,
    isElementVisible,
    isElementInteractable,
    generateCssPath,
    generateXPath,
    generateCandidates,
    createFingerprint,
    generateFriendlyName,
    captureTarget,
    scoreFingerprint,
    resolveElement
  };
});
