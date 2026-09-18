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
    UNSTABLE_ID_PATTERN: /(:r[0-9a-z_-]+:|^ng-|^__|^ember|^\d+$|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|_[0-9a-zA-Z]{5,})/i,
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
    if (element.offsetParent === null && element.tagName.toLowerCase() !== 'body') {
      // Check if position is fixed
      if (typeof window !== 'undefined') {
        const style = window.getComputedStyle(element);
        if (style.position !== 'fixed' && style.position !== 'sticky') {
          return false;
        }
      } else {
        return false;
      }
    }
    if (typeof window !== 'undefined') {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
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
    if (element.disabled) return false;
    if (typeof window !== 'undefined') {
      const style = window.getComputedStyle(element);
      if (style.pointerEvents === 'none') return false;
    }
    return true;
  }

  /**
   * Create unique CSS path relative to closest stable ancestor or root
   */
  function generateCssPath(element, doc) {
    if (!element || element.nodeType !== 1) return '';
    const d = doc || (typeof document !== 'undefined' ? document : null);
    const path = [];
    let current = element;

    while (current && current.nodeType === 1 && current.tagName.toLowerCase() !== 'html') {
      const tag = current.tagName.toLowerCase();

      // If we find an element with a stable ID, we can anchor to it
      if (isStableId(current.id)) {
        const idSelector = `#${escapeCss(current.id)}`;
        if (d && queryAll(idSelector, d).length === 1) {
          path.unshift(idSelector);
          break;
        }
      }

      // Check preferred data attributes
      let foundDataAttr = false;
      for (const attr of CONSTANTS.PREFERRED_DATA_ATTRIBUTES) {
        if (current.hasAttribute(attr)) {
          const val = current.getAttribute(attr);
          const dataSelector = `[${attr}="${escapeCss(val)}"]`;
          if (d && queryAll(dataSelector, d).length === 1) {
            path.unshift(dataSelector);
            foundDataAttr = true;
            break;
          }
        }
      }
      if (foundDataAttr) break;

      // Add tag name + nth-of-type if needed
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(child => child.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          path.unshift(`${tag}:nth-of-type(${index})`);
        } else {
          path.unshift(tag);
        }
      } else {
        path.unshift(tag);
      }

      current = parent;
    }

    return path.join(' > ');
  }

  /**
   * Generate fallback XPath
   */
  function generateXPath(element) {
    if (!element || element.nodeType !== 1) return '';
    if (isStableId(element.id)) {
      return `//*[@id='${element.id}']`;
    }
    const paths = [];
    let current = element;
    while (current && current.nodeType === 1) {
      let index = 1;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.tagName === current.tagName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }
      const tag = current.tagName.toLowerCase();
      paths.unshift(`${tag}[${index}]`);
      current = current.parentNode;
    }
    return `/${paths.join('/')}`;
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

    // 3. Meaningful Attributes: name, aria-label, role, placeholder, type
    const meaningfulAttrs = ['name', 'aria-label', 'placeholder', 'role', 'title'];
    for (const attr of meaningfulAttrs) {
      if (element.hasAttribute(attr)) {
        const val = element.getAttribute(attr);
        if (val && val.trim()) {
          addCandidate(CONSTANTS.SELECTOR_STRATEGIES.ATTRIBUTE, `${tag}[${attr}="${escapeCss(val)}"]`);
        }
      }
    }

    // 4. Visible Text (Buttons, Links, Labels, or interactive elements with short text)
    const textContent = normalizeText(element.textContent || '');
    if (textContent && textContent.length > 0 && textContent.length <= 40) {
      if (['button', 'a', 'label', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        // XPath exact text match
        const escapedText = textContent.replace(/'/g, "\\'");
        const textXPath = `//${tag}[normalize-space()='${escapedText}']`;
        addCandidate(CONSTANTS.SELECTOR_STRATEGIES.TEXT, textXPath);
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
    const rawText = normalizeText(element.textContent || '');
    const text = isPassword ? '' : rawText.slice(0, 120);

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
      dimensions
    };
  }

  /**
   * Capture target: generates both candidates and semantic fingerprint
   */
  function captureTarget(element, doc) {
    const candidates = generateCandidates(element, doc);
    const fingerprint = createFingerprint(element);
    return {
      candidates,
      fingerprint
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

    // Mandatory: tag name MUST match
    if (elemTag !== targetTag) {
      return { score: 0, matchedTag: false, passed: false };
    }

    let score = 0;
    const weights = CONSTANTS.RESOLVER_WEIGHTS;

    // 1. ID or Name match (weight: 0.30)
    let idNameScore = 0;
    const elemId = element.id;
    const targetId = fingerprint.id;
    const elemName = element.getAttribute('name');
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
    const elemAria = element.getAttribute('aria-label');
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
          if (element.getAttribute(attr) === targetVal) {
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
      textScore = 0.8;
    } else {
      textScore = 0.0;
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
    captureTarget,
    scoreFingerprint,
    resolveElement
  };
});
